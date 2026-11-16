/**
 * Giá trị field `image` / `file` của entry — `{ assetId, alt? }` (xem `zAssetPick` ở
 * entry-data.ts), và cách ô nhập của builder đọc/ghi nó.
 *
 * ## Vì sao có file này (16/11/2026)
 *
 * Ô ảnh của form nhập entry từng coi giá trị là CHUỖI assetId (`typeof value ===
 * 'string'`), trong khi schema, API công khai, tool MCP và script nhập đều lưu
 * object. Hệ quả: mọi bài có ảnh hiện ô ảnh TRỐNG trong builder dù site vẫn ra ảnh,
 * và chọn ảnh mới thì ghi một chuỗi mà server từ chối. Hai hàm đọc dưới đây nhận cả
 * dạng cũ (chuỗi) lẫn dạng đúng (object); hàm ghi luôn ra object.
 */

export interface AssetPick {
  assetId: string;
  alt?: string;
}

/** assetId của một giá trị ảnh, hoặc `null`. */
export function assetIdOf(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && typeof (v as AssetPick).assetId === 'string') {
    return (v as AssetPick).assetId || null;
  }
  return null;
}

/** Chữ thay ảnh đã lưu, hoặc chuỗi rỗng. */
export function altOf(v: unknown): string {
  return v && typeof v === 'object' && typeof (v as AssetPick).alt === 'string' ? (v as AssetPick).alt! : '';
}

/** Chọn ảnh mới (giữ alt cũ — thay ảnh minh hoạ thường không đổi ý nghĩa), hoặc gỡ ảnh. */
export function pickAsset(prev: unknown, id: string | null): AssetPick | null {
  if (!id) return null;
  const alt = altOf(prev);
  return alt ? { assetId: id, alt } : { assetId: id };
}

/** Đổi chữ thay ảnh. Không có ảnh thì giữ nguyên (không tạo giá trị từ alt trần). */
export function withAlt(prev: unknown, alt: string): unknown {
  const id = assetIdOf(prev);
  if (!id) return prev;
  return alt ? { assetId: id, alt } : { assetId: id };
}
