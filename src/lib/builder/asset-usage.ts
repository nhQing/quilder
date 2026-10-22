import 'server-only';

/**
 * Asset nào đang được node nào dùng.
 *
 * ## Vì sao con số này làm nên cả trang quản lý ảnh
 *
 * Không có nó, `/builder/assets` chỉ là một thư mục file có thumbnail. Có nó, trang
 * đó trả lời được câu duy nhất người dùng thật sự hỏi trước khi đụng vào một ảnh:
 * **"thay hay bỏ cái này thì vỡ chỗ nào?"**
 *
 * ## Đọc BẢN NHÁP, không đọc release
 *
 * Cùng lý do như `componentUsage()`: thứ sắp bị ảnh hưởng là cái người dùng sẽ
 * publish, không phải cái đang chạy. Một ảnh chỉ còn được dùng ở release cũ thì với
 * người đang sửa, nó là ảnh không ai dùng.
 */

import { ASSET_PAGE_SIZE } from '@/lib/assets/paging';
import { prisma } from '@/lib/db';
import { migrateDoc } from '@/lib/doc/migrate';
import type { Doc } from '@/lib/doc/types';
import { componentIdsIn, loadComponents } from '@/lib/render/components';
import { assetUsesInDoc } from './asset-refs';

export interface AssetUse {
  pageId: string;
  slug: string;
  title: string;
  /** Node trong trang đó đang trỏ tới asset. */
  nodeIds: string[];
}

export interface AssetWithUsage {
  id: string;
  key: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  createdAt: string;
  /** Thư mục ảo, `null` = chưa phân loại. */
  folder: string | null;
  /** Tổng số node đang trỏ tới, trên mọi bản nháp. */
  useCount: number;
  usedBy: AssetUse[];
}

export interface AssetPage {
  /** Chỉ ảnh của trang đang xem. */
  assets: AssetWithUsage[];
  /** Tổng số ảnh trong phạm vi (mọi trang) — thanh phân trang cần nó. */
  total: number;
  /** Tổng byte của cả phạm vi, không phải của trang. */
  totalBytes: number;
  /** Số ảnh không node nào trỏ tới, tính trên cả phạm vi. */
  unused: number;
}

/**
 * Một TRANG asset kèm nơi đang dùng, mới nhất trước.
 *
 * `folder` lọc theo NHÁNH: chọn `trang-chu` thấy cả `trang-chu/hero`. Đó là điều
 * người dùng chờ đợi ở một cây thư mục, và nó khác hẳn `folder = 'trang-chu'`.
 * `folder: null` lọc đúng nhóm chưa phân loại; bỏ trống là không lọc gì.
 *
 * `q` lọc theo `key` (chứa cả tên gốc đã slug hoá — xem `nextAssetKey`): không có
 * cột tên file riêng, nên đây là cách gần nhất người dùng gõ "logo" mà tìm ra
 * `logo-ab12cd34.png`.
 *
 * `used` lọc theo CÓ node nào trỏ tới hay không, trên mọi bản nháp — cùng nguồn
 * với `usedBy`/`useCount` bên dưới, không phải một phép đếm riêng.
 *
 * ## Vì sao cắt trang ở DB chứ không ở client
 *
 * Mỗi ô trong lưới là một thẻ có thumbnail thật. Một kho vài trăm file thì trang
 * gửi về cả vài trăm bản ghi kèm danh sách `usedBy` của từng cái, rồi trình duyệt
 * dựng đúng số ấy thẻ và tải đúng số ấy ảnh. Cắt ở client giữ nguyên cả ba cái giá
 * đó và chỉ ẩn bớt phần đã trả tiền rồi.
 *
 * ## Vì sao ba con số tổng vẫn tính trên cả phạm vi
 *
 * Dòng đầu trang nói "bao nhiêu file, bao nhiêu dung lượng, bao nhiêu chưa dùng".
 * Đó là câu hỏi về CÁI KHO (folder + tìm kiếm), không về trang đang xem — cho nó
 * nhảy theo `?page=` là biến một con số kiểm kê thành một con số vô nghĩa. Nên
 * chúng là aggregate riêng chứ không phải cộng từ mảng đã cắt, và `unused` CỐ Ý
 * không đổi theo `?used=` — đổi theo thì bấm tab "Chưa dùng" sẽ luôn thấy "100%
 * chưa dùng", một con số đúng nhưng vô nghĩa.
 *
 * ## Vì sao `pages` phải đọc TRƯỚC `assets`, không còn song song
 *
 * Trước khi có `?used=`, ba truy vấn (`assets`, `agg`, `pages`) độc lập nhau nên
 * chạy song song được. Lọc theo "đang dùng"/"chưa dùng" đổi `where` của CHÍNH
 * `assets`/`agg`, mà tập id "đang dùng" chỉ có được sau khi quét xong `pages` — nên
 * bước đó giờ phải đứng trước, và chỉ nhánh sau nó mới còn song song được.
 */
export async function listAssetsWithUsage(
  opts: {
    folder?: string | null;
    q?: string;
    used?: 'used' | 'unused';
    page?: number;
    pageSize?: number;
  } = {},
): Promise<AssetPage> {
  const folderWhere =
    opts.folder === undefined
      ? {}
      : opts.folder === null
        ? { folder: null }
        : { OR: [{ folder: opts.folder }, { folder: { startsWith: `${opts.folder}/` } }] };

  const qWhere = opts.q?.trim()
    ? { key: { contains: opts.q.trim(), mode: 'insensitive' as const } }
    : {};

  const pageSize = Math.max(1, opts.pageSize ?? ASSET_PAGE_SIZE);
  const page = Math.max(1, opts.page ?? 1);

  const pages = await prisma.page.findMany({
    where: { archivedAt: null, draftVersionId: { not: null } },
    orderBy: { slug: 'asc' },
    select: { id: true, slug: true, title: true, draftVersion: { select: { doc: true } } },
  });

  /** assetId → dùng ở đâu. */
  const usage = new Map<string, AssetUse[]>();

  const docs: { page: (typeof pages)[number]; doc: Doc }[] = [];
  for (const p of pages) {
    // Cây hỏng thì bỏ qua trang đó thay vì làm trắng cả trang quản lý ảnh — cùng
    // cách xử lý như `componentsFromSnapshot`.
    try {
      docs.push({ page: p, doc: migrateDoc(p.draftVersion!.doc) });
    } catch {
      continue;
    }
  }

  /*
   * Cây component phải đi CÙNG doc vào `assetUsesInDoc`, và đó không phải phòng xa.
   *
   * Một ảnh chỉ dùng bên trong một component thì KHÔNG doc nào mang id của nó. Thiếu
   * tham số này, `/builder/assets` kê nó là "không ai dùng" trên mọi trang — rồi có
   * người tin con số đó và xoá. `assetIdsOf` đã biết đọc cây component từ trước; nửa
   * còn thiếu đúng là lời gọi ở đây.
   *
   * ## Vì sao nạp theo TẬP component chứ không theo trang
   *
   * Hàm này duyệt MỌI bản nháp, nên "một lượt `loadComponents` cho mỗi trang" là N
   * lượt đọc với N là cả kho trang — và các trang của một site dùng đi dùng lại đúng
   * vài component. Gom theo tập id biến N lượt thành "số tập khác nhau" lượt, chạy
   * song song. Trang không có instance nào cho ra tập rỗng, và `loadComponents` trả
   * map rỗng ngay, không chạm DB.
   *
   * KHÔNG gộp thành một lượt cho toàn bộ union: `loadComponents` nhận một doc và khoá
   * cache theo đúng tập id của doc ấy, nên một union sẽ cần dựng doc giả — và một
   * khoá cache không trang nào dùng lại được là cache không bao giờ trúng.
   */
  const loading = new Map<string, ReturnType<typeof loadComponents>>();
  const trees = await Promise.all(
    docs.map(({ doc }) => {
      const key = componentIdsIn(doc).join(',');
      let pending = loading.get(key);
      if (!pending) {
        pending = loadComponents(doc);
        loading.set(key, pending);
      }
      return pending;
    }),
  );

  docs.forEach(({ page: p, doc }, i) => {
    for (const [assetId, nodeIds] of assetUsesInDoc(doc, trees[i])) {
      const list = usage.get(assetId) ?? [];
      list.push({ pageId: p.id, slug: p.slug, title: p.title, nodeIds });
      usage.set(assetId, list);
    }
  });

  const usedIds = [...usage.keys()];
  const usedWhere =
    opts.used === 'used'
      ? { id: { in: usedIds } }
      : opts.used === 'unused'
        ? { id: { notIn: usedIds } }
        : {};

  // Ảnh trong thùng rác không tính vào lưới, tổng, hay số "Chưa dùng".
  const scopeWhere = { AND: [folderWhere, qWhere, { trashedAt: null }] };

  const [assets, agg, unused] = await Promise.all([
    prisma.asset.findMany({
      where: { AND: [...scopeWhere.AND, usedWhere] },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, key: true, url: true, mime: true,
        width: true, height: true, bytes: true, createdAt: true, folder: true,
      },
    }),
    prisma.asset.aggregate({
      where: { AND: [...scopeWhere.AND, usedWhere] },
      _count: { _all: true },
      _sum: { bytes: true },
    }),
    // Luôn tính trên phạm vi folder+tìm kiếm, KHÔNG áp `usedWhere` — xem docblock.
    usedIds.length
      ? prisma.asset.count({ where: { AND: [...scopeWhere.AND, { id: { notIn: usedIds } }] } })
      : prisma.asset.count({ where: scopeWhere }),
  ]);

  return {
    assets: assets.map((a) => {
      const usedBy = usage.get(a.id) ?? [];
      return {
        ...a,
        createdAt: a.createdAt.toISOString(),
        useCount: usedBy.reduce((n, u) => n + u.nodeIds.length, 0),
        usedBy,
      };
    }),
    total: agg._count._all,
    totalBytes: agg._sum.bytes ?? 0,
    unused,
  };
}
