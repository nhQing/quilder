/**
 * Đọc `@font-face` của một file CSS (gói dự án) → kế hoạch nhận font vào kho (§5.2).
 * Thuần: không đụng DB, đĩa hay mạng. Phần ghi nằm ở `scripts/fonts-adopt.ts`.
 */

import { slugify } from './service';
import type { FontSeal, FontStyle } from './types';

export interface AdoptFace {
  family: string;
  weight: string;
  style: FontStyle;
  /** `''` khi CSS không khai `unicode-range`. */
  unicodeRange: string;
  url: string;
  /** Đường file trong repo: `projects/<gói>/public/<phần sau /p/>`. */
  file: string;
}

export interface AdoptPlanItem {
  family: string;
  slug: string;
  action: 'create' | 'skip';
  faces: AdoptFace[];
}

const COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const FACE_BLOCK_RE = /@font-face\s*\{([^}]*)\}/gi;
const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i;

/** Giá trị của một khai báo trong thân khối (không phân biệt hoa thường), hoặc `''`. */
function declOf(body: string, prop: string): string {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]*)`, 'i').exec(body);
  return (m?.[1] ?? '').trim();
}

const unquote = (s: string) => s.replace(/^\s*(["'])(.*)\1\s*$/, '$2').trim();

/** Mọi `@font-face` trong `css`. Khối thiếu `font-family` hoặc `src: url(...)` bị bỏ. */
export function parseFontFaceCss(css: string, pack: string): AdoptFace[] {
  const out: AdoptFace[] = [];
  for (const block of css.replace(COMMENT_RE, '').matchAll(FACE_BLOCK_RE)) {
    const body = block[1] ?? '';
    const family = unquote(declOf(body, 'font-family')).replace(/\s+/g, ' ');
    const u = URL_RE.exec(declOf(body, 'src'));
    const url = (u?.[1] ?? u?.[2] ?? u?.[3] ?? '').trim();
    if (!family || !url) continue;
    const weight = declOf(body, 'font-weight').replace(/\s+/g, ' ') || '400';
    const style: FontStyle = declOf(body, 'font-style').toLowerCase() === 'italic' ? 'italic' : 'normal';
    const unicodeRange = declOf(body, 'unicode-range').replace(/\s+/g, ' ');
    const file = `projects/${pack}/public/${url.replace(/^\/p\//, '')}`;
    out.push({ family, weight, style, unicodeRange, url, file });
  }
  return out;
}

/** Comment đầu file CSS → ghi chú giấy phép: một dòng, bỏ gạch trang trí, tối đa 300 ký tự. */
export function licenseNoteOf(css: string): string {
  const m = /\/\*([\s\S]*?)\*\//.exec(css);
  if (!m) return '';
  const text = (m[1] ?? '').replace(/-{3,}/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 300 ? `${text.slice(0, 299).trimEnd()}…` : text;
}

/**
 * Gom face theo họ (không phân biệt hoa thường) và quyết từng họ:
 * `skip` khi họ đã có trong kho và mọi face đã có sha (8 ký tự đầu) trong `existingShas`;
 * ngược lại `create` với các face còn thiếu. `shaOf(file)` là sha256 hex của byte SẼ được lưu.
 */
export function planAdoption(
  faces: AdoptFace[],
  existing: FontSeal,
  shaOf: (file: string) => string,
  existingShas: Map<string, Set<string>>,
): AdoptPlanItem[] {
  const groups = new Map<string, { family: string; faces: AdoptFace[] }>();
  for (const f of faces) {
    const key = f.family.toLowerCase();
    const g = groups.get(key);
    if (g) g.faces.push(f);
    else groups.set(key, { family: f.family, faces: [f] });
  }
  const short = (sha: string) => sha.slice(0, 8);
  return [...groups.values()].map((g) => {
    const slug = slugify(g.family);
    const exists = existing.families.some((x) => x.slug === slug);
    const have = new Set([...(existingShas.get(slug) ?? [])].map(short));
    const missing = exists ? g.faces.filter((f) => !have.has(short(shaOf(f.file)))) : g.faces;
    return missing.length === 0
      ? { family: g.family, slug, action: 'skip' as const, faces: g.faces }
      : { family: g.family, slug, action: 'create' as const, faces: missing };
  });
}
