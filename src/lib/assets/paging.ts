/**
 * Cỡ trang của kho ảnh.
 *
 * Để riêng một file vì cả hai đầu đều cần: truy vấn ở server (`asset-usage.ts`, có
 * `server-only`) và thanh phân trang ở client. Đặt ở đầu nào cũng bắt đầu kia phải
 * import xuyên ranh giới server/client, và với `server-only` thì một chiều trong đó
 * là lỗi build.
 */

/**
 * Bội số của 2, 3 và 4.
 *
 * Lưới ảnh là `auto-fill` nên số cột đổi theo chiều rộng cửa sổ — thường 2 tới 4.
 * Một cỡ trang không chia hết cho số cột để lại hàng cuối lẻ ô, và hàng lẻ ô đọc ra
 * như "hết ảnh rồi" đúng ở chỗ vẫn còn trang sau.
 */
export const ASSET_PAGE_SIZES = [24, 48, 96] as const;

export const ASSET_PAGE_SIZE = 48;

/** `?size=` của người dùng, hoặc mặc định nếu nó không phải một cỡ có thật. */
export function assetPageSize(raw: string | undefined): number {
  const n = Number(raw);
  return (ASSET_PAGE_SIZES as readonly number[]).includes(n) ? n : ASSET_PAGE_SIZE;
}

/** `?page=` của người dùng, kẹp về 1 nếu rác hoặc âm. */
export function assetPageNumber(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 1 ? n : 1;
}
