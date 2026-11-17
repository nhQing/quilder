/**
 * Tham số phân trang của `GET /api/assets` — cho bộ chọn ảnh (`AssetDialog`).
 *
 * ## Vì sao (17/11/2026)
 *
 * Bộ chọn ảnh từng tải DANH SÁCH CẢ KHO mỗi lần mở (1029 ảnh, ~290 KB JSON) rồi lọc,
 * tìm và cắt trang ở trình duyệt. Có `take` thì route trả đúng một trang kèm `total`,
 * và tìm/lọc thư mục/lọc kiểu chạy ở DB.
 *
 * Không có `take` = hành vi cũ (cả danh sách): `asset-cache` và `AssetPane` cần tra ảnh
 * theo id, không phải duyệt lưới.
 */

export const ASSET_PICKER_MAX_TAKE = 200;

export interface AssetPageQuery {
  take: number;
  skip: number;
  /** Lọc theo `key` (chứa tên gốc đã slug hoá), không phân biệt hoa thường. */
  q: string | null;
  /** Chỉ những mime này (favicon: PNG/SVG…). `null` = mọi kiểu. */
  mimes: string[] | null;
}

const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;

/** `null` = không phải yêu cầu phân trang (không có `take`). */
export function parseAssetPageQuery(params: URLSearchParams): AssetPageQuery | null {
  const rawTake = params.get('take');
  if (rawTake === null) return null;
  const take = Math.min(ASSET_PICKER_MAX_TAKE, Math.max(1, Number.parseInt(rawTake, 10) || 60));
  const skip = Math.max(0, Number.parseInt(params.get('skip') ?? '0', 10) || 0);
  const q = params.get('q')?.trim().slice(0, 120) || null;
  const mimes = (params.get('mimes') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => MIME.test(m));
  return { take, skip, q, mimes: mimes.length ? mimes : null };
}
