/**
 * Phần thuần của "thay ảnh" và "đổi tên ảnh" — tách khỏi prisma/S3 để test được.
 * Xem `src/lib/builder/replace-asset.ts` cho luật của cả hai thao tác.
 */

import type { AssetKind } from './kind';
import { assetKeyBase } from './key';

/** Tên file hiện tại suy từ khoá: bỏ thư mục và đuôi băm 8 ký tự `-abcd1234`. */
export function fileNameOfKey(key: string): string {
  const base = key.split('/').pop() ?? key;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return stem.replace(/-[0-9a-f]{8}$/, '') + ext;
}

/** Đuôi file (kèm dấu chấm, chữ thường) hoặc chuỗi rỗng. */
export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Phần gốc khoá cho tên mới. Tên không kèm đuôi thì giữ đuôi của file hiện tại —
 * người đổi tên nghĩ tới chữ, không nghĩ tới `.png`, và một khoá mất đuôi làm CDN
 * và trình duyệt đoán sai kiểu khi tải về.
 */
export function renamedBase(name: string, currentKey: string): { ok: true; base: string } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Tên mới rỗng.' };
  if (trimmed.length > 120) return { ok: false, error: 'Tên mới dài quá 120 ký tự.' };
  const withExt = extOf(trimmed) ? trimmed : `${trimmed}${extOf(fileNameOfKey(currentKey))}`;
  const base = assetKeyBase(withExt);
  if (base === 'public/builder/asset' && !/asset/i.test(trimmed)) {
    return { ok: false, error: 'Tên mới không còn ký tự hợp lệ nào (chỉ giữ chữ, số, gạch, chấm).' };
  }
  return { ok: true, base };
}

/**
 * Thay được sang hạng nào. Ảnh ↔ SVG đổi chéo được (đều vẽ bằng node Image); video chỉ
 * thay bằng video, PDF bằng PDF… Font và `data` KHÔNG thay ở đây: font có `FontFace` và
 * được niêm phong riêng theo release, còn `data` là đầu vào của shader — đổi byte của
 * chúng cần đường riêng.
 */
export function replaceBlocked(oldKind: AssetKind | string, newKind: AssetKind | string): string | null {
  if (oldKind === 'font' || oldKind === 'data') {
    return `Ảnh hạng "${oldKind}" không thay bằng tool này.`;
  }
  const visual = (k: string) => k === 'image' || k === 'svg';
  if (visual(oldKind) && visual(newKind)) return null;
  if (oldKind === newKind) return null;
  return `File mới là "${newKind}", không thay được cho "${oldKind}" — node đang dùng nó sẽ vỡ.`;
}
