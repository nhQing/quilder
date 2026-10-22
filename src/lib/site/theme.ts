/**
 * Theme của site công khai — `Site.theme`.
 *
 *  - `light` — mặc định cho site mới (21/10/2026).
 *  - `dark`  — thứ mọi site render trước ngày đó (`data-theme="dark"` gõ cứng).
 *  - `system`— theo `prefers-color-scheme` của máy người xem: tối là khối `:root` của
 *    `tokens.css`, sáng là khối sáng nhân bản trong `styles/base/theme-system.css`.
 *
 * Giá trị gắn thẳng vào `<html data-theme>`: `tokens.css` đã có sẵn khối
 * `[data-theme="light"]`, và `:root` là theme tối.
 */

export const SITE_THEMES = ['light', 'dark', 'system'] as const;
export type SiteTheme = (typeof SITE_THEMES)[number];

/** Giá trị lạ trong DB (sửa tay, bản cũ) thì về `light` — đúng mặc định của site mới. */
export function parseSiteTheme(v: unknown): SiteTheme {
  return (SITE_THEMES as readonly unknown[]).includes(v) ? (v as SiteTheme) : 'light';
}

export const SITE_THEME_LABEL: Record<SiteTheme, string> = {
  light: 'Sáng',
  dark: 'Tối',
  system: 'Theo máy người xem',
};
