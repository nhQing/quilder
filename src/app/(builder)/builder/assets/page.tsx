/**
 * Kho ảnh.
 *
 * ## Vì sao trang này tồn tại, và vì sao nó không phải một thư mục file
 *
 * Đợt 2 mở đường cho Agent tải ảnh lên qua MCP, nhưng người dùng thì chưa có đường
 * nào — một lệch do chính đợt đó tạo ra. Trang này đóng nó.
 *
 * Thứ làm nó khác một trình duyệt file là cột **"đang dùng ở đâu"**. Không có cột
 * đó, người dùng nhìn 11 ô ảnh và không trả lời được câu duy nhất họ thật sự hỏi
 * trước khi đụng vào cái nào: *thay hay bỏ cái này thì vỡ chỗ nào?*
 *
 * ## Xoá là hai bước (07/10/2026) — và vì sao đoạn cũ ở đây từng nói "không xoá"
 *
 * Bản đầu cố ý không có nút xoá: object S3 ghi `immutable` và có thể nằm trong ảnh
 * chụp của một release cũ. Người dùng nghe rủi ro đó rồi vẫn chọn có xoá, nên giờ:
 * Xoá = chuyển vào **Thùng rác** (`?trash=1`, chỉ là một cờ hiển thị, khôi phục được);
 * **Xoá hoàn toàn** mới xoá object thật, chỉ admin, có hộp xác nhận gõ chữ, và bị chặn
 * với ảnh còn được dùng (xem `asset-references.ts`). Release cũ không chặn được, nên
 * hộp xác nhận cảnh báo chúng. Thùng rác không bao giờ tự dọn.
 *
 * ## Vẫn CỐ Ý không có
 *
 * - **Không cắt/đổi kích thước.** Kho là kho.
 *
 * ## Đã có thư mục (27/08/2026) — và vì sao đoạn cũ ở đây từng nói ngược lại
 *
 * Bản đầu của trang này viết "không thư mục, 11 asset chưa cần cây thư mục". Đúng
 * với một site. Cái làm nó sai là builder được dùng cho NHIỀU dự án: kho lớn dần
 * theo số trang, và một danh sách phẳng 200 ảnh không duyệt được.
 *
 * Thư mục là một cột `Asset.folder` chứ không phải một phần của `key` — lý do đầy
 * đủ nằm ở `src/lib/assets/folder.ts`, và nó không phải chuyện thẩm mỹ: khoá đánh
 * địa chỉ theo nội dung, nên thư mục trong khoá sẽ giết phép chống trùng.
 *
 * ## Thư mục tạo trước được (03/09/2026)
 *
 * Bản đầu của cây thư mục không có nút "Thư mục mới": thư mục chỉ là giá trị cột,
 * nên một thư mục rỗng không có chỗ nào để tồn tại. Cái làm nó không đủ là người
 * dùng cần **đặt trước cấu trúc** cho một dự án mới, trước khi có ảnh nào để dời.
 *
 * Bảng `AssetFolder` đóng khoảng đó, và nó chỉ trả lời một câu: thư mục nào tồn tại
 * dù rỗng. File nằm đâu vẫn là `Asset.folder`. Xem `src/lib/builder/asset-folders.ts`.
 *
 * ## Mặc định "Chưa phân loại", không phải "Tất cả" (14/09/2026)
 *
 * Kho lớn dần thì "Tất cả" mở ra là một lưới trăm ảnh đã xếp thư mục xong xuôi —
 * đúng thứ người dùng KHÔNG cần nhìn lại. Thứ họ mở trang này để làm là xử lý ảnh
 * MỚI TẢI LÊN chưa có chỗ, và đó luôn là nhóm "Chưa phân loại". Nên URL trơn
 * `/builder/assets` (không `?folder=`) giờ nghĩa là "Chưa phân loại" — cùng quy ước
 * "mặc định thì không cần vào URL" đã dùng cho `?page=`/`?size=`.
 *
 * "Tất cả" mất chỗ đứng làm mặc định thì vẫn cần một địa chỉ RIÊNG để bấm vào (và
 * để link chia sẻ được) — `?folder=*`. `*` không bao giờ là một thư mục thật vì
 * `FOLDER_SEGMENT_RE` không nhận ký tự đó, nên sentinel này không va với tên người
 * dùng tự đặt. Xem `scopeHref`/parse bên dưới.
 */

import { isUnder, mayDeleteFolder, normalizeFolder } from '@/lib/assets/folder';
import { assetPageNumber, assetPageSize } from '@/lib/assets/paging';
import { getSession } from '@/lib/auth/guard';
import { can } from '@/lib/auth/session';
import { listFolders } from '@/lib/builder/asset-folders';
import { countTrashed, listTrashedAssets } from '@/lib/builder/asset-trash';
import { listAssetsWithUsage } from '@/lib/builder/asset-usage';
import type { AssetItem, TrashMeta } from '@/components/builder/asset/types';
import { AssetGrid } from '@/components/builder/AssetGrid';
import { PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; q?: string; used?: string; page?: string; size?: string; trash?: string }>;
}) {
  const { folder: raw, q, used: rawUsed, page: rawPage, size: rawSize, trash: rawTrash } = await searchParams;

  /*
   * Bốn trạng thái: không có tham số = CHƯA PHÂN LOẠI (mặc định mới, xem docblock
   * đầu file); `?folder=*` = tất cả; `?folder=` rỗng = chưa phân loại tường minh;
   * `?folder=x` = nhánh x. Một đường dẫn sai (thư mục không hợp lệ) rơi về mặc định
   * mới luôn — không có lý do để một tên gõ sai lại lộ ra "tất cả".
   */
  let scope: string | null | undefined;
  if (raw === undefined) scope = null;
  else if (raw === '*') scope = undefined;
  else {
    const parsed = normalizeFolder(raw);
    scope = parsed.ok ? parsed.value : null;
  }

  const inTrash = rawTrash === '1';
  const used = rawUsed === 'used' || rawUsed === 'unused' ? rawUsed : undefined;

  /*
   * Phân trang cũng đọc từ URL, cùng lý do như `?folder=`: một trang là một địa chỉ.
   * `?page=` rác hoặc `?size=` không có thật thì rơi về 1 và cỡ mặc định — không đáng
   * làm vỡ trang, và người dùng thấy ngay ở thanh phân trang mình đang ở đâu.
   */
  const rawPageNo = assetPageNumber(rawPage);
  const pageSize = assetPageSize(rawSize);

  const [firstAssets, firstTrash, trashCount, tree, session] = await Promise.all([
    inTrash ? null : listAssetsWithUsage({ folder: scope, q, used, page: rawPageNo, pageSize }),
    inTrash ? listTrashedAssets({ q, page: rawPageNo, pageSize }) : null,
    countTrashed(),
    listFolders(),
    getSession(),
  ]);

  /*
   * `?page=N` vượt trang cuối (vừa xoá/xoá hoàn toàn hết ảnh của trang cuối) thì lưới
   * trống dù vẫn còn ảnh. Kẹp về trang cuối hợp lệ và nạp lại trang đó.
   */
  const lastPage = (n: number) => Math.max(1, Math.ceil(n / pageSize));
  let pageOfAssets = firstAssets;
  let trashPage = firstTrash;
  let page = rawPageNo;
  if (pageOfAssets && pageOfAssets.total > 0 && page > lastPage(pageOfAssets.total)) {
    page = lastPage(pageOfAssets.total);
    pageOfAssets = await listAssetsWithUsage({ folder: scope, q, used, page, pageSize });
  } else if (trashPage && trashPage.total > 0 && page > lastPage(trashPage.total)) {
    page = lastPage(trashPage.total);
    trashPage = await listTrashedAssets({ q, page, pageSize });
  }

  /*
   * Quyền xoá tính ở SERVER, không ở client.
   *
   * Luật là "người tạo, và phải sở hữu CẢ NHÁNH" (xem `mayDeleteFolder`), nên nó cần
   * `createdBy` của mọi thư mục con. Gửi cột đó xuống trình duyệt để client tự tính
   * là phát tán `sub` của người dùng khác ra một màn hình không cần biết chúng —
   * client chỉ cần một chữ có/không, và API vẫn kiểm lại lần nữa.
   */
  const isAdmin = session?.role === 'admin';
  const canWrite = !!session && can(session.role, 'write');
  const folders = tree.folders.map((f) => ({
    path: f.path,
    name: f.name,
    depth: f.depth,
    count: f.count,
    total: f.total,
    canDelete: mayDeleteFolder({
      owners: tree.folders.filter((c) => isUnder(c.path, f.path)).map((c) => c.createdBy),
      actorSub: session?.sub ?? '',
      isAdmin,
    }),
  }));

  /*
   * `total`/`totalBytes`/`unused` là con số của CẢ phạm vi, do truy vấn trả về —
   * không cộng từ `assets`, vì `assets` giờ chỉ là một trang. Cộng từ nó thì dòng
   * "12 file · 3 MB" đổi theo `?page=` và không còn kiểm kê được gì.
   */
  let assets: AssetItem[] = [];
  let total = 0;
  let totalBytes = 0;
  let unused = 0;
  const trashMeta: Record<string, TrashMeta> = {};
  if (pageOfAssets) {
    ({ assets, total, totalBytes, unused } = pageOfAssets);
  } else if (trashPage) {
    total = trashPage.total;
    // Ảnh trong rác không được tính là "đang dùng" nên useCount/usedBy để trống.
    assets = trashPage.items.map((t) => {
      trashMeta[t.id] = { at: t.trashedAt, by: t.trashedByName ?? t.trashedBy };
      return {
        id: t.id,
        key: t.key,
        url: t.url,
        mime: t.mime,
        width: t.width,
        height: t.height,
        bytes: t.bytes,
        createdAt: t.trashedAt,
        folder: t.folder,
        useCount: 0,
        usedBy: [],
      };
    });
  }

  /*
   * Đầu trang (tiêu đề theo phạm vi, đường dẫn, nút) và lời dặn về hợp đồng tải lên
   * nằm trong `AssetGrid`: tiêu đề đổi theo thư mục đang xem, và lời dặn đứng ngay
   * dưới nút "Tải file lên" ở panel thư mục — chỗ người dùng nhìn TRƯỚC khi tải.
   */
  return (
    <PageShell width="wide" className="gap-0">
      <AssetGrid
        assets={assets}
        folders={folders}
        unfiled={tree.unfiled}
        all={tree.all}
        scope={scope}
        q={q ?? ''}
        used={used}
        canRename={isAdmin}
        inTrash={inTrash}
        trashCount={trashCount}
        trashMeta={trashMeta}
        canWrite={canWrite}
        canPurge={isAdmin}
        page={page}
        pageSize={pageSize}
        total={total}
        totalBytes={totalBytes}
        unused={unused}
      />
    </PageShell>
  );
}
