import 'server-only';

/**
 * Thùng rác ảnh: đưa vào, khôi phục, xem trước, xoá hoàn toàn, thử xoá S3 lại.
 *
 * ## Vì sao hai bước (thùng rác → xoá hoàn toàn)
 *
 * Cùng khuôn với `delete-page.ts`: bước đầu lùi được và không hỏi; bước sau không
 * lùi được nên chỉ làm với ảnh ĐÃ nằm trong thùng rác. Một thao tác mất file thật
 * không được nằm cách một cú bấm.
 *
 * ## Vì sao `trashedAt` chỉ là cờ hiển thị
 *
 * Nó chỉ ẩn ảnh khỏi thư viện và picker. Publish, render, site-icons, og KHÔNG lọc
 * theo nó (xem doc của cột trong `schema.prisma`) — nên đưa ảnh vào thùng rác không
 * làm vỡ trang nào, kể cả khi phép kiểm tham chiếu sót một chỗ.
 *
 * ## Vì sao kiểm tham chiếu LẠI ngay lúc xoá hoàn toàn
 *
 * Ảnh có thể nằm trong thùng rác nhiều ngày, và dialog xem trước có thể mở vài phút.
 * Trong lúc đó có người sửa trang, đăng bài, publish release mới. Kết quả kiểm lúc
 * đưa vào thùng rác (hay lúc xem trước) đã cũ; chỉ kết quả kiểm ngay trước khi xoá
 * mới được phép quyết định một việc không lùi được.
 *
 * ## Vì sao DB trước, S3 sau
 *
 * Hai hệ không chung transaction, nên thứ tự quyết định trạng thái hỏng còn lại khi
 * bước thứ hai lỗi:
 *
 *  - S3 trước, DB lỗi sau: hàng `Asset` còn nguyên, trỏ tới một object đã mất. Ảnh
 *    vẫn hiện trong thùng rác, khôi phục được — và khôi phục ra một ảnh vỡ ở mọi chỗ
 *    dùng nó, không có gì báo trước. Đó là dạng lỗi tệ nhất: trông như thành công.
 *  - DB trước, S3 lỗi sau: còn một object mồ côi trên S3. Không trang nào vỡ thêm,
 *    tốn vài trăm KB lưu trữ, và `AuditLog asset.purge` giữ lại khoá để
 *    `retryPurgeS3` dọn sau. Lỗi rẻ, thấy được, sửa được.
 *
 * Nên xoá hàng + ghi AuditLog trong MỘT transaction trước; S3 làm sau và lỗi S3
 * KHÔNG ném — DB đã xoá rồi, ném ra lúc đó là báo "chưa xoá gì" trong khi đã xoá.
 *
 * ## Vì sao kiểm lại `key` ngay trước mỗi lần xoá S3
 *
 * Khoá đánh địa chỉ theo nội dung (`nextAssetKey`): tải lại đúng file đó sinh lại
 * đúng khoá. Ai đó tải lại ảnh trong khe giữa "DB đã xoá" và "S3 chưa xoá" thì hàng
 * mới trỏ vào chính object sắp bị xoá — xoá tiếp là làm vỡ một ảnh vừa tải lên.
 * Còn hàng mang khoá đó thì bỏ qua: object đang có chủ.
 *
 * ## Vì sao xoá hoàn toàn đòi token xác nhận (C3)
 *
 * Kiểm lại ngay lúc xoá (mục trên) chặn được ảnh vừa thành "đang dùng", nhưng không
 * chặn được chuyện người bấm đang xác nhận một danh sách đã cũ: dialog nói "3 release
 * cũ giữ ảnh", lúc bấm thì cửa sổ rollback đã trôi và một trong ba sắp vỡ. Nên
 * `previewPurge` ký đúng thứ dialog hiện — id xoá được, release giữ ảnh, release sẽ
 * vỡ — và `purgeAssets` tính lại thứ đó từ DB rồi so chữ ký. Khác đi là
 * `PurgeConfirmError` (409): xem lại, không xoá gì. Mẫu là `confirmation-token.ts`
 * của Webstudio; cơ chế ở `src/lib/confirm-token.ts`.
 *
 * ## Vì sao object của ảnh mà release trong cửa sổ còn dùng được GIỮ (E2)
 *
 * Release chỉ niêm phong URL ảnh, không niêm phong bytes. Xoá object là làm vỡ mọi
 * release trỏ tới nó, tức lùi về release đó ra trang vỡ ảnh. Nên với ảnh mà release
 * trong cửa sổ rollback (`rollback-window.ts`) còn dùng, xoá hoàn toàn chỉ xoá hàng
 * `Asset` — ảnh rời thư viện ngay — còn object chuyển sang `AssetHold` và được
 * `sweepAssetHolds` xoá khi các release đó ra khỏi cửa sổ. Không đổi khoá, không
 * chép object: release cũ vẫn trỏ đúng URL cũ.
 */

import type { Prisma } from '@prisma/client';

import { deleteObject } from '@/lib/assets/s3';
import type {
  AssetRef,
  OldReleaseRef,
  PurgeBatch,
  PurgePreview,
  PurgeResult,
  RestoreResult,
  SkippedAsset,
  TrashedAssetItem,
  TrashPage,
  TrashResult,
} from '@/lib/assets/trash-types';
import { ensureFolderRows } from '@/lib/builder/asset-folders';
import { assetReferences } from '@/lib/builder/asset-references';
import { loadRollbackWindow, ROLLBACK_WINDOW_TEXT } from '@/lib/builder/rollback-window';
import { confirmMessage, issueConfirm, verifyConfirm, type ConfirmCheck } from '@/lib/confirm-token';
import { prisma } from '@/lib/db';

/** Trần số ảnh mỗi lần xoá hoàn toàn / thử xoá S3 lại. API cũng kiểm, đây là chốt cuối. */
export const MAX_PURGE_BATCH = 100;

/** Số lần gọi S3 chạy song song. Đủ để "Dọn sạch" vài nghìn ảnh không treo cả phút. */
const S3_CONCURRENCY = 8;

/**
 * Người thao tác. `email` ghi vào `Asset.trashedBy` (cùng quy ước các cột `*By`);
 * `sub` (nếu có) là `AuditLog.userId` như mọi lối ghi khác — không có thì dùng email.
 */
export interface AssetTrashActor {
  email: string;
  sub?: string;
}

interface Row {
  id: string;
  key: string;
  url: string;
  mime: string;
  bytes: number;
  folder: string | null;
  trashedAt: Date | null;
}

interface Refs {
  blocking: AssetRef[];
  oldReleases: OldReleaseRef[];
}

const ROW_SELECT = {
  id: true,
  key: true,
  url: true,
  mime: true,
  bytes: true,
  folder: true,
  trashedAt: true,
} as const;

function uniq(values: readonly string[]): string[] {
  return [...new Set(values)].filter(Boolean);
}

function auditUser(actor: AssetTrashActor): string {
  return actor.sub || actor.email;
}

/** Cùng cách `moveAssets` đặt `targetId` cho một lô. */
function batchTarget(ids: readonly string[]): string {
  return ids.length === 1 ? ids[0]! : `${ids.length} ảnh`;
}

function skipped(row: Row, reason: SkippedAsset['reason'], refs: AssetRef[] = []): SkippedAsset {
  return { id: row.id, key: row.key, url: row.url, mime: row.mime, reason, refs };
}

function missingAsset(id: string): SkippedAsset {
  return { id, key: '', url: '', mime: '', reason: 'missing', refs: [] };
}

/** Đọc các hàng theo id, giữ thứ tự đầu vào; id không có hàng thành `missing`. */
async function loadRows(ids: readonly string[]): Promise<{ rows: Row[]; missing: SkippedAsset[] }> {
  const unique = uniq(ids);
  if (!unique.length) return { rows: [], missing: [] };

  const found = await prisma.asset.findMany({ where: { id: { in: unique } }, select: ROW_SELECT });
  const byId = new Map(found.map((r) => [r.id, r]));

  const rows: Row[] = [];
  const missing: SkippedAsset[] = [];
  for (const id of unique) {
    const row = byId.get(id);
    if (row) rows.push(row);
    else missing.push(missingAsset(id));
  }
  return { rows, missing };
}

/**
 * Tách ảnh thành "không ai chặn" và "đang dùng".
 *
 * Id nào KHÔNG có trong kết quả của `assetReferences` bị coi là đang dùng: thiếu kết
 * quả kiểm nghĩa là không biết, và với một thao tác xoá file thật thì không biết phải
 * nghiêng về phía giữ lại.
 */
async function splitByRefs(
  rows: readonly Row[],
): Promise<{ ok: Array<{ row: Row; oldReleases: OldReleaseRef[] }>; blocked: SkippedAsset[] }> {
  if (!rows.length) return { ok: [], blocked: [] };

  const refs: Map<string, Refs> = await assetReferences(rows.map((r) => r.id));
  const ok: Array<{ row: Row; oldReleases: OldReleaseRef[] }> = [];
  const blocked: SkippedAsset[] = [];

  for (const row of rows) {
    const r = refs.get(row.id);
    if (!r) blocked.push(skipped(row, 'in-use'));
    else if (r.blocking.length) blocked.push(skipped(row, 'in-use', r.blocking));
    else ok.push({ row, oldReleases: r.oldReleases });
  }
  return { ok, blocked };
}

/** Hợp các release cũ, không trùng, mới nhất trước. */
function unionReleases(lists: readonly OldReleaseRef[][]): OldReleaseRef[] {
  const byId = new Map<string, OldReleaseRef>();
  for (const list of lists) for (const r of list) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

type Deletable = { row: Row; oldReleases: OldReleaseRef[] };

/** Gắn `inWindow` cho từng release cũ theo cửa sổ rollback hiện tại. */
function inWindow(items: readonly Deletable[], window: ReadonlySet<string>): Deletable[] {
  return items.map(({ row, oldReleases }) => ({
    row,
    oldReleases: oldReleases.map((r) => ({ ...r, inWindow: window.has(r.id) })),
  }));
}

/** Release trong cửa sổ còn trỏ tới ảnh này: object phải được giữ. */
function holdersOf(item: Deletable): string[] {
  return item.oldReleases.filter((r) => r.inWindow).map((r) => r.id);
}

/** Tên hành động trong token xác nhận; đổi tên là vô hiệu mọi token đang lưu hành. */
export const PURGE_CONFIRM_ACTION = 'assets.purge';

/**
 * Thứ token xác nhận ký: đúng những gì dialog hiện cho người bấm, không hơn. Thêm
 * `bytes` hay `url` vào đây là bắt người ta xem lại vì một cột không liên quan.
 */
function confirmPayload(items: readonly Deletable[]) {
  const held = new Set<string>();
  const broken = new Set<string>();
  for (const item of items) {
    for (const r of item.oldReleases) (r.inWindow ? held : broken).add(r.id);
  }
  return {
    ids: items.map((i) => i.row.id).sort(),
    held: [...held].sort(),
    broken: [...broken].sort(),
  };
}

/** Xoá hoàn toàn bị từ chối vì thứ người dùng đã xem không còn là thứ sắp xoá. */
export class PurgeConfirmError extends Error {
  constructor(readonly reason: Exclude<ConfirmCheck, { ok: true }>['reason']) {
    super(confirmMessage(reason));
    this.name = 'PurgeConfirmError';
  }
}

/** Chạy `fn` cho từng phần tử, tối đa `limit` cái cùng lúc. */
async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Xoá một object S3 nếu không còn hàng `Asset` nào mang khoá đó.
 *
 * - `alive`: có hàng (tải lại cùng file, hoặc được khôi phục giữa chừng) — không xoá.
 * - `failed`: S3 lỗi, HOẶC chính phép kiểm lại lỗi. Kiểm không được thì không xoá:
 *   object còn đó, `retryPurgeS3` thử lại được; xoá mù thì không lùi được.
 */
async function deleteIfOrphan(
  key: string,
): Promise<{ status: 'deleted' | 'alive' } | { status: 'failed'; error: string }> {
  try {
    const again = await prisma.asset.findUnique({ where: { key }, select: { id: true } });
    if (again) return { status: 'alive' };
    await deleteObject(key);
    return { status: 'deleted' };
  } catch (e) {
    return { status: 'failed', error: errorMessage(e) };
  }
}

/**
 * Ghi AuditLog SAU khi đã đụng S3. Lỗi ở đây bị nuốt có chủ ý: việc thật đã xảy ra,
 * và ném ra lúc này là nói với người dùng một điều sai về thứ họ vừa làm. Khoá cần
 * dọn vẫn nằm trong `asset.purge` nên `retryPurgeS3` không phụ thuộc dòng này.
 */
async function auditAfterS3(data: Prisma.AuditLogUncheckedCreateInput): Promise<void> {
  try {
    await prisma.auditLog.create({ data });
  } catch {
    // Xem docblock.
  }
}

/**
 * Đưa ảnh vào thùng rác.
 *
 * Ảnh đang dùng bị bỏ qua (kèm nơi dùng) chứ không làm hỏng cả lô: người dùng chọn
 * 12 ảnh mà 2 ảnh còn dùng thì vẫn muốn 10 ảnh kia đi. Ảnh đã ở thùng rác tính là
 * xong — bấm lại lần hai không phải lỗi — và giữ nguyên `trashedAt` cũ.
 */
export async function trashAssets(
  ids: readonly string[],
  actor: AssetTrashActor,
): Promise<TrashResult> {
  const { rows, missing } = await loadRows(ids);
  const already = rows.filter((r) => r.trashedAt);
  const { ok, blocked } = await splitByRefs(rows.filter((r) => !r.trashedAt));
  const okIds = ok.map((o) => o.row.id);

  if (okIds.length) {
    await prisma.$transaction([
      // `trashedAt: null` trong where: hai người bấm cùng lúc thì `trashedAt` giữ lần đầu.
      prisma.asset.updateMany({
        where: { id: { in: okIds }, trashedAt: null },
        data: { trashedAt: new Date(), trashedBy: actor.email },
      }),
      prisma.auditLog.create({
        data: {
          userId: auditUser(actor),
          action: 'asset.trash',
          targetType: 'Asset',
          targetId: batchTarget(okIds),
          meta: { ids: okIds, count: okIds.length },
        },
      }),
    ]);
  }

  const done = new Set([...okIds, ...already.map((r) => r.id)]);
  return {
    trashed: rows.filter((r) => done.has(r.id)).map((r) => r.id),
    skipped: [...blocked, ...missing],
  };
}

/**
 * Khôi phục ảnh từ thùng rác, GIỮ nguyên thư mục cũ.
 *
 * `ensureFolderRows` cùng transaction vì luật của `asset-folders.ts`: mọi lối làm một
 * `Asset.folder` hiện lại trong cây phải đảm bảo thư mục có hàng trong registry. Thư
 * mục có thể đã bị dọn khỏi registry trong lúc ảnh nằm thùng rác.
 */
export async function restoreAssets(
  ids: readonly string[],
  actor: AssetTrashActor,
): Promise<RestoreResult> {
  const { rows, missing } = await loadRows(ids);
  const ok = rows.filter((r) => r.trashedAt);
  const notTrashed = rows.filter((r) => !r.trashedAt).map((r) => skipped(r, 'not-trashed'));
  const okIds = ok.map((r) => r.id);

  if (okIds.length) {
    const folders = uniq(ok.map((r) => r.folder ?? ''));
    await prisma.$transaction([
      ensureFolderRows(folders, actor.sub ?? null),
      prisma.asset.updateMany({
        where: { id: { in: okIds }, trashedAt: { not: null } },
        data: { trashedAt: null, trashedBy: null },
      }),
      prisma.auditLog.create({
        data: {
          userId: auditUser(actor),
          action: 'asset.restore',
          targetType: 'Asset',
          targetId: batchTarget(okIds),
          meta: { ids: okIds, count: okIds.length, folders },
        },
      }),
    ]);
  }

  return { restored: okIds, skipped: [...notTrashed, ...missing] };
}

/**
 * Chạy thử "Xoá hoàn toàn": ảnh nào xoá được, ảnh nào bị chặn, release cũ nào giữ
 * ảnh, release nào sẽ vỡ. KHÔNG ghi gì. `all` = mọi ảnh đang ở thùng rác ("Dọn sạch").
 *
 * Kết quả chỉ để hiện dialog — `purgeAssets` kiểm lại từ đầu, không tin bản này. Thứ
 * duy nhất nó mang sang bước xoá là `batches[].confirmToken`, và token chỉ khớp khi
 * bước xoá tính ra đúng danh sách này.
 */
export async function previewPurge(
  arg: { ids: string[] } | { all: true },
): Promise<PurgePreview> {
  let rows: Row[];
  let rejected: SkippedAsset[] = [];

  if ('all' in arg) {
    rows = await prisma.asset.findMany({
      where: { trashedAt: { not: null } },
      orderBy: [{ trashedAt: 'desc' }, { id: 'desc' }],
      select: ROW_SELECT,
    });
  } else {
    const loaded = await loadRows(arg.ids);
    rows = loaded.rows.filter((r) => r.trashedAt);
    rejected = [
      ...loaded.rows.filter((r) => !r.trashedAt).map((r) => skipped(r, 'not-trashed')),
      ...loaded.missing,
    ];
  }

  const [split, window] = await Promise.all([splitByRefs(rows), loadRollbackWindow()]);
  const ok = inWindow(split.ok, window);

  const batches: PurgeBatch[] = [];
  for (let i = 0; i < ok.length; i += MAX_PURGE_BATCH) {
    const chunk = ok.slice(i, i + MAX_PURGE_BATCH);
    batches.push({
      ids: chunk.map((o) => o.row.id),
      confirmToken: issueConfirm(PURGE_CONFIRM_ACTION, confirmPayload(chunk)),
    });
  }

  return {
    deletable: ok.map(({ row, oldReleases }) => ({
      id: row.id,
      key: row.key,
      url: row.url,
      mime: row.mime,
      bytes: row.bytes,
      oldReleases,
    })),
    blocked: [...split.blocked, ...rejected],
    oldReleases: unionReleases(ok.map((o) => o.oldReleases)),
    batches,
    rollbackWindow: ROLLBACK_WINDOW_TEXT,
  };
}

/**
 * Xoá hoàn toàn: xoá hàng `Asset`, rồi xoá object S3 — trừ object mà release trong
 * cửa sổ rollback còn dùng, cái đó vào `AssetHold`. Chỉ ảnh đã ở thùng rác, chỉ ảnh
 * mà phép kiểm tham chiếu NGAY LÚC NÀY không chặn, và chỉ khi `confirmToken` (từ
 * `previewPurge`) khớp đúng danh sách tính lại lúc này — không khớp thì ném
 * `PurgeConfirmError` trước khi ghi bất cứ thứ gì. Thứ tự DB → S3 và phép kiểm lại
 * `key` — xem docblock đầu file.
 */
export async function purgeAssets(
  ids: readonly string[],
  actor: AssetTrashActor,
  confirmToken: unknown,
): Promise<PurgeResult> {
  const unique = uniq(ids);
  if (unique.length > MAX_PURGE_BATCH) {
    throw new Error(
      `Xoá hoàn toàn tối đa ${MAX_PURGE_BATCH} ảnh mỗi lần (nhận ${unique.length}).`,
    );
  }

  const { rows, missing } = await loadRows(unique);
  const notTrashed = rows.filter((r) => !r.trashedAt).map((r) => skipped(r, 'not-trashed'));
  const [split, window] = await Promise.all([
    splitByRefs(rows.filter((r) => r.trashedAt)),
    loadRollbackWindow(),
  ]);
  const { blocked } = split;
  const ok = inWindow(split.ok, window);

  // Kiểm TRƯỚC mọi lối ra, kể cả "không còn gì để xoá": token của một danh sách khác
  // là dấu hiệu người bấm đang nhìn một thứ đã cũ, và họ cần được nói ra điều đó.
  const check = verifyConfirm(confirmToken, PURGE_CONFIRM_ACTION, confirmPayload(ok));
  if (!check.ok) throw new PurgeConfirmError(check.reason);

  const empty = { purged: [], s3Failed: [], held: [] };
  if (!ok.length) return { ...empty, skipped: [...blocked, ...notTrashed, ...missing] };

  const okIds = ok.map((o) => o.row.id);
  const holding = ok.filter((o) => holdersOf(o).length > 0);
  const [{ count }] = await prisma.$transaction([
    // `trashedAt: { not: null }`: ảnh vừa được khôi phục sau phép kiểm ở trên thì thoát.
    prisma.asset.deleteMany({ where: { id: { in: okIds }, trashedAt: { not: null } } }),
    prisma.auditLog.create({
      data: {
        userId: auditUser(actor),
        action: 'asset.purge',
        targetType: 'Asset',
        targetId: batchTarget(okIds),
        // `keys` phẳng để `retryPurgeS3` lọc được bằng JSON path — và CHỈ gồm khoá được
        // phép xoá ngay. Khoá đang giữ nằm ở `held`: để nó trong `keys` là cho "Thử xoá
        // lại" một đường xoá object mà release trong cửa sổ còn dùng.
        meta: {
          count: okIds.length,
          keys: ok.filter((o) => !holdersOf(o).length).map((o) => o.row.key),
          held: holding.map((o) => o.row.key),
          bytes: ok.reduce((n, o) => n + o.row.bytes, 0),
          items: ok.map((o) => ({
            id: o.row.id,
            key: o.row.key,
            url: o.row.url,
            bytes: o.row.bytes,
            folder: o.row.folder,
            oldReleases: o.oldReleases.map((r) => r.id),
            held: holdersOf(o).length > 0,
          })),
          oldReleases: unionReleases(ok.map((o) => o.oldReleases)).map((r) => ({
            id: r.id,
            label: r.label,
            inWindow: r.inWindow ?? false,
          })),
        },
      },
    }),
    // Cùng transaction với lệnh xoá hàng: không có lúc nào ảnh đã rời thư viện mà
    // object chưa được ghi là đang giữ — lượt dọn chạy xen vào cũng không xoá nhầm.
    // `push` khi khoá đã có (tải lại cùng file rồi xoá lần nữa): tập release chỉ hợp lại.
    ...holding.map((o) =>
      prisma.assetHold.upsert({
        where: { key: o.row.key },
        create: {
          key: o.row.key,
          url: o.row.url,
          bytes: o.row.bytes,
          releaseIds: holdersOf(o),
          purgedBy: actor.email,
        },
        update: { releaseIds: { push: holdersOf(o) }, purgedAt: new Date(), purgedBy: actor.email },
      }),
    ),
  ]);

  /*
   * Số hàng xoá được ít hơn số định xoá: có ảnh được khôi phục trong khe giữa phép
   * kiểm và transaction. Đọc lại để báo đúng ảnh nào thật sự mất; ảnh còn hàng thì
   * phép kiểm `key` bên dưới cũng giữ object S3 của nó.
   */
  let purged = ok.map((o) => o.row);
  const raced: SkippedAsset[] = [];
  if (count !== okIds.length) {
    const still = await prisma.asset.findMany({ where: { id: { in: okIds } }, select: { id: true } });
    const alive = new Set(still.map((r) => r.id));
    raced.push(...purged.filter((r) => alive.has(r.id)).map((r) => skipped(r, 'not-trashed')));
    purged = purged.filter((r) => !alive.has(r.id));
  }

  // Ảnh "thua" cuộc đua khôi phục ở trên mà vẫn có hàng `AssetHold`: vô hại — lượt dọn
  // thấy hàng `Asset` còn sống thì chỉ gỡ hàng giữ, không xoá object.
  const heldKeys = new Set(holding.map((o) => o.row.key));
  const toDelete = purged.filter((r) => !heldKeys.has(r.key));

  const failed = new Map<string, string>();
  await forEachLimit(toDelete, S3_CONCURRENCY, async (row) => {
    const res = await deleteIfOrphan(row.key);
    if (res.status === 'failed') failed.set(row.key, res.error);
  });
  const s3Failed = toDelete.map((r) => r.key).filter((k) => failed.has(k));

  if (s3Failed.length) {
    await auditAfterS3({
      userId: auditUser(actor),
      action: 'asset.purge.s3_failed',
      targetType: 'Asset',
      targetId: s3Failed.length === 1 ? s3Failed[0]! : `${s3Failed.length} file`,
      meta: { keys: s3Failed, errors: Object.fromEntries(failed) },
    });
  }

  return {
    purged: purged.map((r) => r.id),
    skipped: [...blocked, ...raced, ...notTrashed, ...missing],
    s3Failed,
    held: purged.filter((r) => heldKeys.has(r.key)).map((r) => r.key),
  };
}

/**
 * Lượt dọn `AssetHold`: xoá object của ảnh đã xoá hoàn toàn khi không còn release nào
 * giữ nó nằm trong cửa sổ rollback.
 *
 * Chạy sau mỗi lần publish (cửa sổ trôi đúng lúc đó), sau mỗi lần xoá hoàn toàn, và
 * qua `pnpm assets:sweep`. Gọi thừa không sao: hàng chưa tới hạn thì để nguyên.
 *
 * - `deleted`: object đã xoá, hàng giữ gỡ.
 * - `released`: có hàng `Asset` mới mang cùng khoá (tải lại đúng file) — object có chủ
 *   trở lại, chỉ gỡ hàng giữ.
 * - `failed`: S3 lỗi; hàng giữ để nguyên, lượt sau thử lại.
 */
export async function sweepAssetHolds(
  opts: { actor?: AssetTrashActor; now?: Date } = {},
): Promise<{ deleted: string[]; released: string[]; failed: string[]; kept: number }> {
  const holds = await prisma.assetHold.findMany({ select: { key: true, releaseIds: true } });
  if (!holds.length) return { deleted: [], released: [], failed: [], kept: 0 };

  const window = await loadRollbackWindow(opts.now);
  const due = holds.filter((h) => !h.releaseIds.some((id) => window.has(id)));

  const status = new Map<string, 'deleted' | 'alive' | 'failed'>();
  const errors = new Map<string, string>();
  await forEachLimit(due, S3_CONCURRENCY, async (h) => {
    const res = await deleteIfOrphan(h.key);
    status.set(h.key, res.status);
    if (res.status === 'failed') errors.set(h.key, res.error);
  });

  const deleted = due.map((h) => h.key).filter((k) => status.get(k) === 'deleted');
  const released = due.map((h) => h.key).filter((k) => status.get(k) === 'alive');
  const failed = due.map((h) => h.key).filter((k) => status.get(k) === 'failed');

  const done = [...deleted, ...released];
  if (done.length) await prisma.assetHold.deleteMany({ where: { key: { in: done } } });
  if (done.length || failed.length) {
    await auditAfterS3({
      userId: opts.actor ? auditUser(opts.actor) : 'system',
      action: 'asset.hold.sweep',
      targetType: 'Asset',
      targetId: `${due.length} file`,
      meta: { deleted, released, failed, errors: Object.fromEntries(errors) },
    });
  }

  return { deleted, released, failed, kept: holds.length - done.length };
}

/** Đọc `meta.keys` của một dòng `asset.purge`; meta lạ thì coi như không có khoá nào. */
function purgedKeysOf(meta: Prisma.JsonValue): string[] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const keys = (meta as Prisma.JsonObject).keys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
}

/**
 * Thử xoá lại các object S3 mà lần xoá hoàn toàn trước để sót.
 *
 * Chỉ xoá khoá thoả CẢ HAI: không còn hàng `Asset` nào mang nó, VÀ có trong
 * `meta.keys` của một dòng `asset.purge`. Điều kiện thứ hai biến hàm này từ "xoá
 * object bất kỳ theo tên" thành "dọn nốt việc đã được duyệt và ghi sổ" — một khoá
 * gõ tay hay đoán ra không đi qua được.
 */
export async function retryPurgeS3(
  keys: readonly string[],
  actor: AssetTrashActor,
): Promise<{ deleted: string[]; skipped: string[]; failed: string[] }> {
  const unique = uniq(keys);
  if (unique.length > MAX_PURGE_BATCH) {
    throw new Error(`Thử xoá lại tối đa ${MAX_PURGE_BATCH} file mỗi lần (nhận ${unique.length}).`);
  }
  if (!unique.length) return { deleted: [], skipped: [], failed: [] };

  const [live, logs, holds] = await Promise.all([
    prisma.asset.findMany({ where: { key: { in: unique } }, select: { key: true } }),
    prisma.auditLog.findMany({
      where: {
        action: 'asset.purge',
        OR: unique.map((k) => ({ meta: { path: ['keys'], array_contains: [k] } })),
      },
      select: { meta: true },
    }),
    // Khoá đang giữ cho release trong cửa sổ rollback không bao giờ đi qua đường này,
    // kể cả khi một dòng `asset.purge` cũ (trước E2) có nó trong `keys`.
    prisma.assetHold.findMany({ where: { key: { in: unique } }, select: { key: true } }),
  ]);

  const alive = new Set([...live.map((r) => r.key), ...holds.map((h) => h.key)]);
  const audited = new Set(logs.flatMap((l) => purgedKeysOf(l.meta)));
  const eligible = unique.filter((k) => !alive.has(k) && audited.has(k));

  const status = new Map<string, 'deleted' | 'alive' | 'failed'>();
  await forEachLimit(eligible, S3_CONCURRENCY, async (key) => {
    status.set(key, (await deleteIfOrphan(key)).status);
  });

  const deleted = unique.filter((k) => status.get(k) === 'deleted');
  const failed = unique.filter((k) => status.get(k) === 'failed');
  const skippedKeys = unique.filter((k) => !status.has(k) || status.get(k) === 'alive');

  if (deleted.length || failed.length) {
    await auditAfterS3({
      userId: auditUser(actor),
      action: 'asset.purge.s3_retry',
      targetType: 'Asset',
      targetId: unique.length === 1 ? unique[0]! : `${unique.length} file`,
      meta: { deleted, failed, skipped: skippedKeys },
    });
  }

  return { deleted, skipped: skippedKeys, failed };
}

/**
 * Một trang thùng rác, xoá mới nhất trước. `q` lọc theo `key` như kho ảnh thường
 * (xem `listAssetsWithUsage`). `trashedByName` lấy từ `User` theo email; người đã bị
 * xoá khỏi bảng hoặc không đặt tên thì `null` — giao diện tự lùi về email.
 */
export async function listTrashedAssets(opts: {
  q?: string;
  page: number;
  pageSize: number;
}): Promise<TrashPage> {
  const page = Math.max(1, Math.floor(opts.page) || 1);
  const pageSize = Math.max(1, Math.floor(opts.pageSize) || 1);
  const q = opts.q?.trim();
  const where: Prisma.AssetWhereInput = {
    trashedAt: { not: null },
    ...(q ? { key: { contains: q, mode: 'insensitive' } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: [{ trashedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        key: true,
        url: true,
        mime: true,
        width: true,
        height: true,
        bytes: true,
        folder: true,
        trashedAt: true,
        trashedBy: true,
      },
    }),
    prisma.asset.count({ where }),
  ]);

  const emails = uniq(rows.map((r) => r.trashedBy ?? ''));
  const users = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { email: true, name: true },
      })
    : [];
  const names = new Map(users.map((u) => [u.email, u.name || null]));

  const items: TrashedAssetItem[] = rows.map((r) => ({
    id: r.id,
    key: r.key,
    url: r.url,
    mime: r.mime,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    folder: r.folder,
    // `where` đã loại hàng không có `trashedAt`; `?? ''` chỉ để khỏi khẳng định non-null.
    trashedAt: r.trashedAt?.toISOString() ?? '',
    trashedBy: r.trashedBy,
    trashedByName: r.trashedBy ? (names.get(r.trashedBy) ?? null) : null,
  }));

  return { items, total, page, pageSize };
}

/** Số ảnh đang ở thùng rác — số đếm cạnh mục "Thùng rác" trong cây thư mục. */
export async function countTrashed(): Promise<number> {
  return prisma.asset.count({ where: { trashedAt: { not: null } } });
}
