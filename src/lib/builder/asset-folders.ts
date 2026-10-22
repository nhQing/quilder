import 'server-only';

/**
 * Đọc cây thư mục, tạo/đổi tên/xoá thư mục, dời ảnh.
 *
 * ## Hai nguồn cho một cái cây, và luật giữ chúng khớp
 *
 * Bản đầu của file này nói "không có tạo thư mục và không có xoá thư mục" vì thư
 * mục chỉ là giá trị cột `Asset.folder`, nên một thư mục rỗng là một thư mục không
 * tồn tại. Cái làm nó sai là người dùng cần **đặt trước cấu trúc** cho một dự án
 * mới, trước khi có ảnh nào để dời vào.
 *
 * Nên giờ có bảng `AssetFolder` (xem doc của model trong `schema.prisma`), và cây
 * là HỢP của hai nguồn:
 *
 *  - đường dẫn suy ra từ `Asset.folder` — nơi ảnh thật sự nằm;
 *  - hàng trong `AssetFolder` — thư mục có thật dù chưa có ảnh.
 *
 * Luật duy nhất giữ chúng khớp: **mọi lối ghi `Asset.folder` phải gọi
 * `ensureFolderRows()` cùng transaction.** Vi phạm nó thì hậu quả xấu nhất là một
 * thư mục rỗng không hiện trong cây — không ảnh nào mất. Đó là lý do đánh đổi này
 * chịu được việc không có khoá ngoại ép toàn vẹn.
 *
 * ## Xoá thư mục KHÔNG xoá ảnh
 *
 * Ảnh chỉ bị xoá hẳn qua thùng rác (hai bước: bỏ vào rác, rồi admin "Xoá hoàn
 * toàn"); thao tác thư mục không bao giờ xoá ảnh. Ảnh trong rác đi theo thư mục
 * của nó. "Xoá thư mục" ở đây nghĩa là **dời hết ảnh về Chưa phân loại
 * rồi bỏ thư mục khỏi cây**. Giao diện phải nói đúng như vậy, nếu không người dùng
 * sẽ tưởng mình vừa xoá 40 file.
 */

import {
  foldersToEnsure,
  mayDeleteFolder,
  normalizeFolder,
  reparent,
} from '@/lib/assets/folder';
import { prisma } from '@/lib/db';

export interface FolderNode {
  /** Đường dẫn đầy đủ, ví dụ `trang-chu/hero`. */
  path: string;
  /** Đoạn cuối, để hiện trong cây. */
  name: string;
  depth: number;
  /** Số ảnh nằm ĐÚNG ở đây, không tính thư mục con. */
  count: number;
  /** Số ảnh ở đây và mọi thư mục con. */
  total: number;
  /** `sub` của người tạo; `null` = không rõ (có trước registry, hoặc do Agent tạo). */
  createdBy: string | null;
}

export interface FolderTree {
  folders: FolderNode[];
  /** Ảnh chưa phân loại (`folder IS NULL`). */
  unfiled: number;
  all: number;
}

/**
 * Đảm bảo mọi đường dẫn (và cấp cha) có hàng trong registry.
 *
 * Trả về một promise Prisma để bên gọi nhét vào `$transaction([...])` cùng những
 * thao tác khác — thư mục xuất hiện và ảnh dời vào nó phải là MỘT hành động, nếu
 * không một lỗi giữa chừng để lại ảnh trỏ tới thư mục không có trong cây.
 *
 * `skipDuplicates` chứ không phải upsert từng hàng: `createdBy` của hàng đã có
 * KHÔNG bị ghi đè. Người tạo thư mục là người tạo nó, không phải người vừa dời ảnh
 * thứ hai vào — và cột đó quyết định ai xoá được.
 */
export function ensureFolderRows(paths: readonly (string | null)[], actorSub: string | null) {
  const rows = foldersToEnsure(paths).map((path) => ({ path, createdBy: actorSub }));
  return prisma.assetFolder.createMany({ data: rows, skipDuplicates: true });
}

/**
 * Cây thư mục kèm số đếm.
 *
 * Gom bằng `groupBy` thay vì kéo cả bảng `Asset` về: số đếm là thứ database làm
 * tốt hơn, và trang kho ảnh gọi hàm này ở mọi lần tải.
 */
export async function listFolders(): Promise<FolderTree> {
  const [rows, registry] = await Promise.all([
    // Số đếm KHÔNG gồm ảnh trong thùng rác.
    prisma.asset.groupBy({ by: ['folder'], where: { trashedAt: null }, _count: { _all: true } }),
    prisma.assetFolder.findMany({ select: { path: true, createdBy: true } }),
  ]);

  const direct = new Map<string, number>();
  let unfiled = 0;
  let all = 0;

  for (const r of rows) {
    const n = r._count._all;
    all += n;
    if (!r.folder) {
      unfiled += n;
      continue;
    }
    direct.set(r.folder, (direct.get(r.folder) ?? 0) + n);
  }

  /*
   * Thư mục cha phải xuất hiện dù không có ảnh nào nằm trực tiếp trong nó — kho có
   * `a/b` mà không có `a` là chuyện bình thường, và cây thiếu `a` thì `a/b` không
   * hiện được ở đâu.
   *
   * Suy ra từ ảnh chứ không chỉ đọc registry: registry có thể thiếu một hàng (dữ
   * liệu khôi phục, một lối ghi cũ), và khi đó cây vẫn phải hiện đúng chỗ ảnh đang
   * nằm. Registry BỔ SUNG thư mục rỗng, nó không thay thế phép suy luận.
   */
  const total = new Map<string, number>();
  for (const [path, n] of direct) {
    for (const parent of foldersToEnsure([path])) {
      total.set(parent, (total.get(parent) ?? 0) + n);
    }
  }
  for (const r of registry) {
    for (const parent of foldersToEnsure([r.path])) {
      if (!total.has(parent)) total.set(parent, 0);
    }
  }

  const owner = new Map(registry.map((r) => [r.path, r.createdBy]));

  const folders: FolderNode[] = [...total.keys()].sort().map((path) => ({
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    depth: path.split('/').length - 1,
    count: direct.get(path) ?? 0,
    total: total.get(path) ?? 0,
    createdBy: owner.get(path) ?? null,
  }));

  return { folders, unfiled, all };
}

export type MoveResult =
  | { ok: true; moved: number }
  | { ok: false; status: number; error: string };

/**
 * Tạo một thư mục rỗng.
 *
 * Không lỗi khi thư mục đã có: người dùng bấm "Thư mục mới" rồi gõ một tên đã tồn
 * tại là muốn tới thư mục đó, không phải muốn một thông báo lỗi.
 */
export async function createFolder(args: {
  path: string;
  actorSub: string;
}): Promise<{ ok: true; path: string } | { ok: false; status: number; error: string }> {
  const folder = normalizeFolder(args.path);
  if (!folder.ok) return { ok: false, status: 400, error: folder.error };
  if (!folder.value) return { ok: false, status: 400, error: 'Thiếu tên thư mục' };

  await prisma.$transaction([
    ensureFolderRows([folder.value], args.actorSub),
    prisma.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'asset.folder.create',
        targetType: 'AssetFolder',
        targetId: folder.value,
        meta: { path: folder.value },
      },
    }),
  ]);

  return { ok: true, path: folder.value };
}

/** Dời một ảnh sang thư mục khác. `null` = đưa về "chưa phân loại". */
export async function moveAsset(args: {
  assetId: string;
  folder: string | null;
  actorSub: string;
}): Promise<MoveResult> {
  return moveAssets({ assetIds: [args.assetId], folder: args.folder, actorSub: args.actorSub });
}

/**
 * Dời nhiều ảnh cùng lúc.
 *
 * Một transaction và MỘT dòng audit log cho cả lô, không phải N dòng: người dùng
 * kéo 12 ảnh vào một thư mục đã làm một hành động, và 12 dòng nhật ký giống hệt
 * nhau chỉ làm nhật ký khó đọc hơn ở đúng lúc cần đọc nó.
 */
export async function moveAssets(args: {
  assetIds: readonly string[];
  folder: string | null;
  actorSub: string;
}): Promise<MoveResult> {
  const folder = normalizeFolder(args.folder);
  if (!folder.ok) return { ok: false, status: 400, error: folder.error };

  const ids = [...new Set(args.assetIds)].filter(Boolean);
  if (!ids.length) return { ok: false, status: 400, error: 'Không có ảnh nào để dời' };

  // Cố ý KHÔNG lọc `trashedAt` ở dời/đổi tên/xoá thư mục: ảnh trong thùng rác đi theo
  // thư mục của nó, để khi khôi phục ảnh không trỏ vào một thư mục đã biến mất.
  const assets = await prisma.asset.findMany({
    where: { id: { in: ids } },
    select: { id: true, folder: true, key: true },
  });

  /*
   * Từ chối cả lô thay vì dời phần tìm được: giao diện vừa nói "dời 12 ảnh", và
   * dời 11 ảnh rồi báo thành công là nói dối về thứ người dùng không kiểm lại.
   */
  if (assets.length !== ids.length) {
    return { ok: false, status: 404, error: 'Có ảnh không còn tồn tại — tải lại trang' };
  }

  const changing = assets.filter((a) => a.folder !== folder.value);
  if (!changing.length) return { ok: true, moved: 0 };

  await prisma.$transaction([
    ensureFolderRows([folder.value], args.actorSub),
    prisma.asset.updateMany({
      where: { id: { in: changing.map((a) => a.id) } },
      data: { folder: folder.value },
    }),
    prisma.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'asset.move',
        targetType: 'Asset',
        targetId: changing.length === 1 ? changing[0]!.id : `${changing.length} ảnh`,
        // Trước VÀ sau: "dời đi đâu" vô dụng nếu không biết nó vốn ở đâu.
        meta: {
          after: folder.value,
          items: changing.map((a) => ({ id: a.id, key: a.key, before: a.folder })),
        },
      },
    }),
  ]);

  return { ok: true, moved: changing.length };
}

/**
 * Đổi tên (hoặc di chuyển) cả một nhánh thư mục.
 *
 * Đổi tên `a` thành `x` kéo theo `a/b` → `x/b`. Đọc rồi ghi từng hàng thay vì một
 * câu `UPDATE ... SET folder = replace(...)`: phép thay chuỗi thô sẽ đụng cả
 * `abc/...` khi đổi tên `a`, và `isUnder` là chỗ duy nhất trong dự án biết luật
 * "nằm dưới" — dùng lại nó đắt hơn vài mili giây, rẻ hơn một luật thứ hai.
 */
export async function renameFolder(args: {
  from: string;
  to: string;
  actorSub: string;
}): Promise<MoveResult> {
  const from = normalizeFolder(args.from);
  const to = normalizeFolder(args.to);
  if (!from.ok) return { ok: false, status: 400, error: `Thư mục nguồn: ${from.error}` };
  if (!to.ok) return { ok: false, status: 400, error: `Thư mục đích: ${to.error}` };
  if (!from.value) return { ok: false, status: 400, error: 'Thiếu thư mục nguồn' };
  if (!to.value) {
    return {
      ok: false,
      status: 400,
      error: 'Thiếu thư mục đích. Muốn bỏ phân loại thì dời từng ảnh về "Chưa phân loại".',
    };
  }
  if (from.value === to.value) return { ok: true, moved: 0 };

  /*
   * Dời một thư mục vào trong chính nó (`a` → `a/b`) tạo ra một đường dẫn tự tham
   * chiếu và, nếu lặp, một cây sâu vô hạn. Chặn ở đây vì đây là chỗ duy nhất biết
   * cả hai đầu.
   */
  if (to.value.startsWith(`${from.value}/`)) {
    return { ok: false, status: 400, error: 'Không dời một thư mục vào bên trong chính nó' };
  }

  const branch = { OR: [{ path: from.value }, { path: { startsWith: `${from.value}/` } }] };

  const [assets, rows] = await Promise.all([
    prisma.asset.findMany({
      where: { OR: [{ folder: from.value }, { folder: { startsWith: `${from.value}/` } }] },
      select: { id: true, folder: true },
    }),
    prisma.assetFolder.findMany({ where: branch, select: { path: true, createdBy: true } }),
  ]);

  /*
   * Không còn 404 khi nhánh không có ảnh: từ khi có registry, một thư mục RỖNG là
   * một thứ tồn tại và phải đổi tên được. Chỉ khi cả hai nguồn đều trống nó mới
   * thật sự không có.
   */
  if (!assets.length && !rows.length) {
    return { ok: false, status: 404, error: `Không có thư mục ${from.value}` };
  }

  const updates = assets
    .map((r) => ({ id: r.id, next: reparent(r.folder!, from.value!, to.value!) }))
    .filter((u): u is { id: string; next: string } => u.next !== null);

  /*
   * Hàng registry được XOÁ rồi tạo lại dưới tên mới, không `update` từng cái:
   * `path` là khoá chính, và đổi khoá chính sang một tên đã tồn tại (đổi `a` thành
   * `b` trong khi `b` đã có) sẽ đụng unique. Xoá-rồi-tạo kèm `skipDuplicates` gộp
   * hai nhánh thành một cách tự nhiên — đúng thứ người dùng chờ đợi khi đổi tên một
   * thư mục thành tên của thư mục khác.
   */
  const nextRows = rows.flatMap((r) => {
    const path = reparent(r.path, from.value!, to.value!);
    return path === null ? [] : [{ path, createdBy: r.createdBy }];
  });

  await prisma.$transaction([
    ...updates.map((u) => prisma.asset.update({ where: { id: u.id }, data: { folder: u.next } })),
    prisma.assetFolder.deleteMany({ where: branch }),
    prisma.assetFolder.createMany({ data: nextRows, skipDuplicates: true }),
    // Cấp cha của tên mới: đổi `a` thành `x/y` thì `x` cũng phải có thật.
    ensureFolderRows([to.value], args.actorSub),
    prisma.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'asset.folder.rename',
        targetType: 'AssetFolder',
        targetId: from.value,
        meta: { before: from.value, after: to.value, assets: updates.length },
      },
    }),
  ]);

  return { ok: true, moved: updates.length };
}

/**
 * Xoá một nhánh thư mục: ảnh trong đó về "Chưa phân loại", thư mục biến khỏi cây.
 *
 * KHÔNG xoá file nào — xem doc đầu file.
 *
 * `isAdmin` được truyền vào chứ không tự đọc phiên: file này không biết gì về HTTP,
 * và luật quyền nằm ở `mayDeleteFolder` để test được mà không cần Postgres.
 */
export async function deleteFolder(args: {
  path: string;
  actorSub: string;
  isAdmin: boolean;
}): Promise<MoveResult> {
  const target = normalizeFolder(args.path);
  if (!target.ok) return { ok: false, status: 400, error: target.error };
  if (!target.value) return { ok: false, status: 400, error: 'Thiếu tên thư mục' };

  const path = target.value;
  const branch = { OR: [{ path }, { path: { startsWith: `${path}/` } }] };

  const [rows, assets] = await Promise.all([
    prisma.assetFolder.findMany({ where: branch, select: { path: true, createdBy: true } }),
    prisma.asset.findMany({
      where: { OR: [{ folder: path }, { folder: { startsWith: `${path}/` } }] },
      select: { id: true },
    }),
  ]);

  if (!rows.length && !assets.length) {
    return { ok: false, status: 404, error: `Không có thư mục ${path}` };
  }

  const allowed = mayDeleteFolder({
    owners: rows.map((r) => r.createdBy),
    actorSub: args.actorSub,
    isAdmin: args.isAdmin,
  });
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error:
        'Chỉ người tạo thư mục hoặc admin xoá được — nhánh này có thư mục do người khác tạo, ' +
        'hoặc có từ trước khi builder ghi lại người tạo.',
    };
  }

  /*
   * Ảnh về `null` chứ không về thư mục cha. "Xoá thư mục" là hành động dứt khoát;
   * đẩy ảnh lên cha là giấu chúng ở một chỗ người dùng không nhìn tới, còn "Chưa
   * phân loại" là nơi họ đã biết phải tìm khi cần xếp lại.
   */
  await prisma.$transaction([
    prisma.asset.updateMany({
      where: { id: { in: assets.map((a) => a.id) } },
      data: { folder: null },
    }),
    prisma.assetFolder.deleteMany({ where: branch }),
    prisma.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'asset.folder.delete',
        targetType: 'AssetFolder',
        targetId: path,
        meta: { path, folders: rows.map((r) => r.path), assets: assets.length },
      },
    }),
  ]);

  return { ok: true, moved: assets.length };
}
