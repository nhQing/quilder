import 'server-only';

/**
 * Tải một ảnh lên kho asset — dùng chung cho route HTTP và tool MCP.
 *
 * ## Thứ tự các bước là một phần của thiết kế
 *
 *  1. **Dò kiểu trước khi chạm S3.** File không nhận dạng được thì từ chối ngay,
 *     không để một object không rõ nội dung lên bucket đọc công khai.
 *  2. **Khoá theo nội dung** (`nextAssetKey`). Cùng file tải lại là cùng khoá.
 *  3. **Đã có khoá đó thì trả hàng cũ**, không ghi lại (nếu hàng đang ở thùng rác
 *     thì khôi phục nó — upload là cách người dùng "đổi ý"). Đây là trường hợp THƯỜNG
 *     khi ai đó tải lại đúng file, và ghi đè một object `immutable` bằng chính nó
 *     là việc vô nghĩa nhưng vẫn tốn một lượt PUT.
 *  4. **Ghi S3 TRƯỚC, ghi database SAU.**
 *  5. Ghi `Asset` + `AuditLog`.
 *
 * ## Vì sao S3 trước database
 *
 * Ghi DB trước rồi S3 lỗi thì có một hàng `Asset` trỏ tới object không tồn tại —
 * ảnh vỡ trên trang, và không có gì chỉ ra nguyên nhân vì hàng đó trông hoàn toàn
 * bình thường.
 *
 * Ngược lại, S3 xong mà DB lỗi chỉ để lại một object mồ côi: vô hại, không ai
 * tham chiếu tới, và lần tải lại cùng file sẽ dùng đúng nó vì khoá theo nội dung.
 *
 * Hai trạng thái hỏng, và ta chọn cái tự lành.
 */

import { normalizeFolder } from '@/lib/assets/folder';
import { ensureFolderRows } from '@/lib/builder/asset-folders';
import { assetKeyBase, nextAssetKey } from '@/lib/assets/key';
import { objectUrl, putObject } from '@/lib/assets/s3';
import { dbKind } from '@/lib/assets/kind';
import { sniff } from '@/lib/assets/sniff';
import { prisma } from '@/lib/db';

// Giữ đường import cũ: các chỗ đang lấy assetKeyBase từ đây vẫn chạy.
export { assetKeyBase } from '@/lib/assets/key';

/** Trần một file. Ảnh trang web không cần hơn, và không có trần thì một lần gọi
 *  nhầm đủ để lấp bộ nhớ của tiến trình. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

export interface UploadedAsset {
  id: string;
  key: string;
  url: string;
  mime: string;
  /**
   * `null` với file KHÔNG phải ảnh — PDF, video, âm thanh, font.
   *
   * Trước 04/09/2026 hai trường này là `number` bắt buộc, và đó đúng khi kho chỉ
   * nhận ba định dạng ảnh: `sniff()` khi ấy từ chối mọi thứ không khai được kích
   * thước. Từ lúc nhận PDF thì "không có kích thước" là một trạng thái BÌNH THƯỜNG,
   * không phải lỗi — và bắt kiểu phải là `number` sẽ buộc chỗ này bịa ra một con số.
   *
   * Cột `Asset.width/height` trong schema đã là `Int?` từ trước, nên không có
   * migration; chỉ có kiểu ở tầng này từng nói chặt hơn database.
   */
  width: number | null;
  height: number | null;
  bytes: number;
  /** Thư mục ảo, `null` = chưa phân loại. */
  folder: string | null;
  /** Khoá đã tồn tại nên không ghi gì mới. */
  reused: boolean;
  /** Hàng trùng đang ở thùng rác và vừa được khôi phục bởi lần tải này. */
  restored?: boolean;
}

export type UploadAssetResult =
  | { ok: true; asset: UploadedAsset }
  | { ok: false; status: number; error: string };

export async function uploadAsset(args: {
  bytes: Uint8Array;
  fileName: string;
  actorEmail: string;
  actorSub: string;
  /** Thư mục ảo để xếp ảnh vào. Bỏ trống = chưa phân loại. */
  folder?: string | null;
}): Promise<UploadAssetResult> {
  /*
   * Chuẩn hoá TRƯỚC mọi việc khác, kể cả trước phép dò kiểu.
   *
   * Thư mục không tham gia vào khoá, nên một thư mục sai không làm hỏng object nào
   * — nhưng nó vẫn phải chết trước khi ta ghi lên S3, vì đường ghi này không có
   * bước hoàn tác: object đã lên bucket là vĩnh viễn.
   */
  const folder = normalizeFolder(args.folder);
  if (!folder.ok) return { ok: false, status: 400, error: folder.error };

  if (!args.bytes.length) {
    return { ok: false, status: 400, error: 'File rỗng' };
  }
  if (args.bytes.length > MAX_ASSET_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Tối đa ${MAX_ASSET_BYTES / 1024 / 1024} MB, nhận ${Math.round(args.bytes.length / 1024)} KB`,
    };
  }

  const found = sniff(args.bytes);
  if (!found) {
    return {
      ok: false,
      status: 415,
      error:
        'Không nhận dạng được file. Kho nhận ảnh (PNG, JPEG, SVG), PDF, video ' +
        '(MP4, WebM), âm thanh (MP3, WAV, OGG) và font (WOFF, WOFF2).\n\n' +
        'Kiểu file được đọc từ NỘI DUNG, không từ đuôi tên, nên định dạng nào không ' +
        'có dấu hiệu nhận biết trong byte đầu file thì chưa nhận — docx/xlsx/zip đều ' +
        'là cùng một dấu hiệu, và HTML thì cố ý không nhận. Với ảnh còn thêm một ' +
        'điều kiện: phải đọc được kích thước, vì thiếu nó trang sẽ giật khi ảnh về.',
    };
  }

  const key = nextAssetKey(assetKeyBase(args.fileName), args.bytes);

  const existing = await prisma.asset.findUnique({
    where: { key },
    select: {
      id: true, key: true, url: true, mime: true,
      width: true, height: true, bytes: true, folder: true, trashedAt: true,
    },
  });
  if (existing) {
    let restored = false;
    if (existing.trashedAt) {
      // Tải lại đúng file đã vào rác = khôi phục. Giữ nguyên thư mục cũ của ảnh.
      await prisma.asset.update({
        where: { id: existing.id },
        data: { trashedAt: null, trashedBy: null },
      });
      if (existing.folder) await ensureFolderRows([existing.folder], args.actorSub);
      await prisma.auditLog.create({
        data: {
          userId: args.actorSub,
          action: 'asset.restore',
          targetType: 'Asset',
          targetId: existing.id,
          meta: { key, via: 'upload' },
        },
      });
      restored = true;
    }
    return {
      ok: true,
      asset: {
        id: existing.id,
        key: existing.key,
        url: existing.url,
        mime: existing.mime,
        width: existing.width ?? found.width ?? null,
        height: existing.height ?? found.height ?? null,
        bytes: existing.bytes,
        /*
         * Thư mục CŨ được giữ, không bị đè bằng thư mục của lần tải này.
         *
         * Tải lại đúng một file đã có là chuyện thường, và nó thường xảy ra khi
         * người dùng kéo cả một thư mục vào. Nếu lần tải đó dời ảnh sang chỗ khác
         * thì một thao tác vô hại lại âm thầm sắp xếp lại kho. Dời ảnh là một hành
         * động riêng, có endpoint riêng.
         */
        folder: existing.folder,
        reused: true,
        ...(restored ? { restored: true } : {}),
      },
    };
  }

  await putObject(key, args.bytes, found.mime);

  /*
   * Thư mục phải có hàng trong registry TRƯỚC khi ảnh trỏ vào nó — nếu không, cây
   * thư mục thiếu mất nhánh này cho tới lần có ai dời ảnh vào đó lần nữa. Xem luật
   * ở đầu `asset-folders.ts`.
   */
  if (folder.value) await ensureFolderRows([folder.value], args.actorSub);

  const asset = await prisma.asset.create({
    data: {
      /*
       * Hạng suy ra từ MIME đã sniff, không phải từ đuôi file — xem `assets/kind.ts`.
       *
       * Bản trước viết `found.mime === 'image/svg+xml' ? 'svg' : 'image'`, tức là
       * MỌI thứ không phải SVG đều được ghi là `image`. Đúng khi kho chỉ có ba định
       * dạng ảnh; từ lúc nhận PDF và video thì nó biến một file PDF thành một hàng
       * tự khai là ảnh, và trang Thư viện sẽ tin lời khai đó rồi vẽ `<img>`.
       *
       * `svg` vẫn là hạng riêng vì `NodeRenderer` phải bỏ qua bộ tối ưu với ảnh
       * vector — next/image rasterise SVG và logo mất nét.
       */
      kind: dbKind(found.mime, key),
      key,
      url: objectUrl(key),
      mime: found.mime,
      bytes: args.bytes.length,
      width: found.width,
      height: found.height,
      folder: folder.value,
    },
    select: {
      id: true, key: true, url: true, mime: true,
      width: true, height: true, bytes: true, folder: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: args.actorSub,
      action: 'asset.upload',
      targetType: 'Asset',
      targetId: asset.id,
      meta: { key, mime: found.mime, bytes: args.bytes.length, folder: folder.value },
    },
  });

  return {
    ok: true,
    asset: {
      id: asset.id,
      key: asset.key,
      url: asset.url,
      mime: asset.mime,
      width: asset.width ?? found.width ?? null,
      height: asset.height ?? found.height ?? null,
      bytes: asset.bytes,
      folder: asset.folder,
      reused: false,
    },
  };
}
