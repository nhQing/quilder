/**
 * URL ảnh THU NHỎ cho các ô xem trước trong vỏ builder (Thư viện, bộ chọn, dialog).
 *
 * Trước đây mọi ô vẽ thẳng `Asset.url` — file gốc, có khi vài MB — rồi thu bằng CSS:
 * cuộn một thư mục ảnh hero là tải hàng chục MB chỉ để nhìn những ô 200px. Ở đây ảnh
 * raster đi qua optimizer của Next (`/_next/image`), cùng optimizer site công khai đã
 * dùng, nên không thêm hạ tầng: host của kho ảnh đã khai trong `next.config.mjs`.
 *
 * Trả `null` khi file nên giữ nguyên gốc:
 * - SVG: optimizer không nhận (và vector thì không có gì để thu).
 * - GIF: ảnh động — optimizer trả nguyên file, đi vòng chỉ tốn thêm một lượt.
 * - `data:` / `blob:` (ảnh vừa chọn, chưa lên kho) và URL đã là `/_next/image`.
 *
 * Optimizer vẫn có thể từ chối (host lạ ở bản build cũ, kho tạm ở dev): bên vẽ phải
 * rơi về URL gốc khi `<img>` lỗi — xem `ImageThumb`.
 */

/** `imageSizes` + `deviceSizes` mặc định của Next. `w` ngoài danh sách này → 400. */
const NEXT_WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840] as const;

/** Chất lượng mặc định của Next; Next 16 chỉ nhận đúng `qualities` đã khai (mặc định [75]). */
const QUALITY = 75;

const RASTER = /\.(png|jpe?g|webp|avif)$/i;

function pathOf(url: string): string | null {
  if (url.startsWith('/') && !url.startsWith('//')) return url.split(/[?#]/)[0] ?? null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.pathname : null;
  } catch {
    return null;
  }
}

/** Khổ hợp lệ nhỏ nhất ≥ `px` (vượt khổ lớn nhất thì lấy khổ lớn nhất). */
export function pickWidth(px: number): number {
  return NEXT_WIDTHS.find((w) => w >= px) ?? 3840;
}

function optimized(url: string, w: number): string {
  return `/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=${QUALITY}`;
}

/**
 * `src` + `srcSet` (1x, 2x) cho một ô hiển thị rộng khoảng `displayPx` px CSS,
 * hoặc `null` nếu file nên giữ nguyên gốc.
 */
export function thumbSrc(url: string, displayPx: number): { src: string; srcSet: string } | null {
  const path = pathOf(url);
  if (!path || path.startsWith('/_next/image') || !RASTER.test(path)) return null;
  const w1 = pickWidth(displayPx);
  const w2 = pickWidth(displayPx * 2);
  return { src: optimized(url, w1), srcSet: `${optimized(url, w1)} 1x, ${optimized(url, w2)} 2x` };
}
