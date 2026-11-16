import 'server-only';

/**
 * Thay file của một ảnh, và đổi tên ảnh — GIỮ NGUYÊN `assetId` (16/11/2026).
 *
 * ## Vì sao giữ id mà không tải ảnh mới rồi gắn lại
 *
 * Một ảnh có thể đang nằm ở hàng chục node, component và bài viết. Tải ảnh mới rồi gắn lại
 * là đi sửa từng chỗ; giữ id thì mọi chỗ trỏ tới nó nhận file mới cùng lúc.
 *
 * ## Khoá vẫn bất biến
 *
 * Luật ở `assets/key.ts` không đổi: một khoá mãi mãi trỏ cùng byte. Thay hay đổi tên đều
 * GHI MỘT OBJECT MỚI dưới khoá mới (`<tên>-<băm>.<đuôi>`) rồi trỏ hàng `Asset` sang đó.
 * Object cũ KHÔNG bị xoá: các release cũ chụp `url` cũ (`Release.assets`), nên lùi release
 * vẫn ra đúng ảnh cũ. Object cũ thành mồ côi — vô hại, cùng lý lẽ "S3 trước DB" của
 * `upload-asset.ts`.
 *
 * ## Lúc nào thì site thật đổi
 *
 *  - Ảnh trong cây node của trang/component: sau lần Publish kế tiếp (site đọc ảnh chụp).
 *  - Ảnh của BÀI VIẾT/entry (ảnh bìa, thumbnail…): NGAY, vì nội dung đọc bảng `Asset`
 *    live (xem `loadAssets` ở `render/page.ts`).
 *
 * ## Đổi tên kéo theo dời bucket
 *
 * Đổi tên đọc lại byte của ảnh (từ bucket đang cấu hình, hoặc tải qua URL công khai nếu
 * ảnh nằm ở bucket/CDN khác — vd ảnh `cdn-dev` trên builder production) rồi ghi vào bucket
 * HIỆN TẠI. Tức đổi tên một ảnh `cdn-dev` trên production cũng chuyển nó sang CDN của
 * production.
 */

import { nextAssetKey } from '@/lib/assets/key';
import { dbKind } from '@/lib/assets/kind';
import { fileNameOfKey, renamedBase, replaceBlocked } from '@/lib/assets/rename';
import { getObject, objectUrl, putObject } from '@/lib/assets/s3';
import { sniff } from '@/lib/assets/sniff';
import { fetchUrlBytes } from '@/lib/assets/fetch-url';
import { assetKeyBase, MAX_ASSET_BYTES } from '@/lib/builder/upload-asset';
import { prisma } from '@/lib/db';

export interface ChangedAsset {
  id: string;
  key: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  folder: string | null;
  /** Khoá và URL trước khi đổi — để người dùng đối chiếu, và để lần theo AuditLog. */
  previousKey: string;
  previousUrl: string;
  /** Không có gì đổi (cùng byte và cùng tên). */
  unchanged: boolean;
}

export type ChangeAssetResult =
  | { ok: true; asset: ChangedAsset }
  | { ok: false; status: number; error: string; existingAssetId?: string };

const SELECT = {
  id: true, key: true, url: true, mime: true, kind: true,
  width: true, height: true, bytes: true, folder: true, trashedAt: true,
} as const;

async function loadLive(assetId: string) {
  const row = await prisma.asset.findUnique({ where: { id: assetId }, select: SELECT });
  if (!row) return { ok: false as const, status: 404, error: `Không có ảnh ${assetId}` };
  if (row.trashedAt) {
    return { ok: false as const, status: 409, error: 'Ảnh đang ở thùng rác. Khôi phục trước rồi mới thay/đổi tên.' };
  }
  return { ok: true as const, row };
}

/**
 * Ghi byte dưới khoá mới và trỏ hàng sang đó. Dùng chung cho thay và đổi tên.
 */
async function rewrite(args: {
  row: NonNullable<Awaited<ReturnType<typeof loadLive>> & { ok: true }>['row'];
  bytes: Uint8Array;
  base: string;
  actorSub: string;
  action: 'asset.replace' | 'asset.rename';
}): Promise<ChangeAssetResult> {
  const { row, bytes } = args;
  const found = sniff(bytes);
  if (!found) return { ok: false, status: 415, error: 'Không nhận dạng được file mới (cần PNG, JPEG, SVG, WebP, video…).' };

  const newKind = dbKind(found.mime, args.base);
  const blocked = replaceBlocked(row.kind, newKind);
  if (blocked) return { ok: false, status: 409, error: blocked };

  const key = nextAssetKey(args.base, bytes);
  const unchangedResult = (): ChangeAssetResult => ({
    ok: true,
    asset: {
      id: row.id, key: row.key, url: row.url, mime: row.mime, width: row.width, height: row.height,
      bytes: row.bytes, folder: row.folder, previousKey: row.key, previousUrl: row.url, unchanged: true,
    },
  });
  if (key === row.key) return unchangedResult();

  // Khoá là duy nhất: cùng byte + cùng tên đã là một ảnh khác trong kho.
  const clash = await prisma.asset.findUnique({ where: { key }, select: { id: true } });
  if (clash && clash.id !== row.id) {
    return {
      ok: false,
      status: 409,
      error:
        `Kho đã có đúng file này với tên này (assetId ${clash.id}). Gắn node vào ảnh đó, ` +
        'hoặc đặt tên khác.',
      existingAssetId: clash.id,
    };
  }

  // S3 trước, DB sau — cùng lý do với upload-asset.ts.
  await putObject(key, bytes, found.mime);

  const updated = await prisma.asset.update({
    where: { id: row.id },
    data: {
      kind: newKind,
      key,
      url: objectUrl(key),
      mime: found.mime,
      bytes: bytes.length,
      width: found.width,
      height: found.height,
      // Blurhash cũ là của ảnh cũ. Để trống còn hơn một vệt màu sai.
      blurhash: null,
    },
    select: { id: true, key: true, url: true, mime: true, width: true, height: true, bytes: true, folder: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: args.actorSub,
      action: args.action,
      targetType: 'Asset',
      targetId: row.id,
      meta: { fromKey: row.key, fromUrl: row.url, toKey: key, mime: found.mime, bytes: bytes.length },
    },
  });

  return {
    ok: true,
    asset: { ...updated, previousKey: row.key, previousUrl: row.url, unchanged: false },
  };
}

/** Thay file của ảnh `assetId` bằng `bytes`. Tên giữ như cũ trừ khi truyền `name`. */
export async function replaceAsset(args: {
  assetId: string;
  bytes: Uint8Array;
  /** Tên file của file mới — chỉ dùng lấy ĐUÔI khi không có `name`. */
  fileName?: string;
  /** Tên mới cho ảnh (tuỳ chọn). Không có thì giữ tên hiện tại. */
  name?: string;
  actorSub: string;
}): Promise<ChangeAssetResult> {
  if (!args.bytes.length) return { ok: false, status: 400, error: 'File rỗng' };
  if (args.bytes.length > MAX_ASSET_BYTES) {
    return { ok: false, status: 413, error: `Tối đa ${MAX_ASSET_BYTES / 1024 / 1024} MB` };
  }
  const live = await loadLive(args.assetId);
  if (!live.ok) return live;

  // Tên: `name` nếu có; không thì tên hiện tại. Đuôi lấy theo FILE MỚI (thay PNG bằng
  // JPEG thì khoá phải mang .jpg), suy từ `fileName` hoặc từ kiểu dò được.
  const found = sniff(args.bytes);
  const newExt =
    (args.fileName && /\.[a-z0-9]+$/i.exec(args.fileName)?.[0]) ||
    (found ? `.${found.mime.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg')}` : '');
  const stem = (args.name?.trim() || fileNameOfKey(live.row.key)).replace(/\.[a-z0-9]+$/i, '');
  const base = assetKeyBase(`${stem}${newExt}`);

  return rewrite({ row: live.row, bytes: args.bytes, base, actorSub: args.actorSub, action: 'asset.replace' });
}

/** Đổi tên ảnh — byte giữ nguyên, khoá/URL đổi theo tên mới. */
export async function renameAsset(args: { assetId: string; name: string; actorSub: string }): Promise<ChangeAssetResult> {
  const live = await loadLive(args.assetId);
  if (!live.ok) return live;

  const named = renamedBase(args.name, live.row.key);
  if (!named.ok) return { ok: false, status: 400, error: named.error };

  // Byte hiện tại: từ bucket đang cấu hình nếu ảnh nằm ở đó, không thì qua URL công khai.
  let bytes: Uint8Array;
  if (live.row.url === objectUrl(live.row.key)) {
    try {
      bytes = await getObject(live.row.key);
    } catch (e) {
      return { ok: false, status: 502, error: `Không đọc được file hiện tại trên bucket: ${String(e)}` };
    }
  } else {
    const got = await fetchUrlBytes(live.row.url, 'Ảnh');
    if (!got.ok) return { ok: false, status: got.status, error: got.error };
    bytes = got.bytes;
  }

  return rewrite({ row: live.row, bytes, base: named.base, actorSub: args.actorSub, action: 'asset.rename' });
}
