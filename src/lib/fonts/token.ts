/**
 * Hàng `Token` mà mỗi họ font sở hữu (spec §4) — tên, giá trị, mô tả. Thuần: dịch vụ font
 * và phần nhập trang (`transfer/commit.ts`) cùng dùng, để token tạo ở hai đường không lệch
 * định dạng.
 */

import { cssFamilyName } from './css';

/** `font-<slug>`. */
export const fontTokenName = (slug: string) => `font-${slug}`;

/** `"<cssName>", <fallback>` — tên họ qua `cssFamilyName` để tên lạ không phá được CSS. */
export const fontTokenValue = (cssName: string, fallback: string) => `${cssFamilyName(cssName)}, ${fallback}`;

/** `aiDescription` của token họ (§4): `Họ font <cssName> (<nguồn>), weight …`. */
export function describeFontFamily(cssName: string, source: string, faces: { weight: string; style: string }[]): string {
  const label = source === 'google' ? 'Google Fonts' : 'tải lên';
  const weights = [...new Set(faces.map((f) => (f.style === 'italic' ? `${f.weight} italic` : f.weight)))]
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
  return `Họ font ${cssName} (${label}), weight ${weights.join(', ') || '(chưa có face)'}`;
}
