/**
 * Font GỐC của gói dự án — đọc `generated/pack-fonts/<gói>.json` do `scripts/pack-fonts.mjs` sinh
 * lúc `next dev` / `next build` (và `pnpm fonts:scan`).
 *
 * Font gốc dùng được ngay (CSS của gói đã biên vào bundle), nhưng CHỈ ĐỌC với builder: không có
 * đường nào ở đây ghi vào `projects/`. Bỏ một font gốc = `pnpm fonts:adopt` rồi xoá trong repo
 * gói. Thiếu file JSON (Quilder thuần, script tsx, test) thì coi như gói không có font gốc.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { cssFamilyName, familyNameKey } from './css';
import type { FontStyle } from './types';

export interface PackFontFace {
  weight: string;
  style: FontStyle;
  unicodeRange: string;
  /** `/p/fonts/…` — phục vụ bởi route `/p/` của gói. */
  url: string;
  /** `projects/<gói>/public/fonts/…` */
  file: string;
  /** `null` khi file khai trong CSS nhưng không có trên đĩa. */
  bytes: number | null;
}

export interface PackFontManifest {
  version: number;
  pack: string | null;
  /** `projects/<gói>/styles/fonts.css`, hoặc `null` khi gói không có file này. */
  css: string | null;
  licenseNote: string;
  families: { cssName: string; faces: PackFontFace[] }[];
  /** `--font-*` gói đè trong `:root` của `fonts.css` (tên không có `--`). */
  variables: Record<string, string>;
  /** File font trong `public/fonts/` chưa có `@font-face` — chưa dùng được. */
  undeclared: string[];
  /** File khai trong CSS mà không có trên đĩa. */
  missing: string[];
}

export const EMPTY_PACK_FONTS: PackFontManifest = {
  version: 1,
  pack: null,
  css: null,
  licenseNote: '',
  families: [],
  variables: {},
  undeclared: [],
  missing: [],
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

let cached: { mtimeMs: number; manifest: PackFontManifest } | null = null;

/** Kiểm hình dạng tối thiểu; file hỏng hay sai phiên bản thì coi như rỗng. */
export function parsePackFonts(raw: unknown): PackFontManifest {
  const m = raw as Partial<PackFontManifest> | null;
  if (!m || m.version !== 1 || !Array.isArray(m.families)) return EMPTY_PACK_FONTS;
  return {
    ...EMPTY_PACK_FONTS,
    ...m,
    families: m.families.filter((f) => f && typeof f.cssName === 'string' && Array.isArray(f.faces)),
    variables: m.variables && typeof m.variables === 'object' ? m.variables : {},
    undeclared: Array.isArray(m.undeclared) ? m.undeclared : [],
    missing: Array.isArray(m.missing) ? m.missing : [],
  } as PackFontManifest;
}

/**
 * Đọc manifest (cache theo mtime: ở dev file được ghi lại mỗi lần config nạp).
 *
 * Trong vitest, không truyền `root` thì luôn rỗng: file sinh ra phụ thuộc gói đang clone trên
 * máy, test đọc nó sẽ xanh ở máy này và đỏ trên CI. Test cần font gốc truyền `root` hoặc mock.
 */
export function readPackFonts(
  root?: string,
  env: Record<string, string | undefined> = process.env,
): PackFontManifest {
  if (root === undefined && env.VITEST) return EMPTY_PACK_FONTS;
  // Gói đang chạy (đã kiểm lúc build) — tên lạ không bao giờ thành đường dẫn.
  const name = env.QUILDER_PROJECT?.trim();
  if (!name || !NAME_RE.test(name)) return EMPTY_PACK_FONTS;
  const path = join(root ?? process.cwd(), 'generated', 'pack-fonts', `${name}.json`);
  try {
    const { mtimeMs } = statSync(path);
    if (cached?.mtimeMs === mtimeMs) return cached.manifest;
    const manifest = parsePackFonts(JSON.parse(readFileSync(path, 'utf8')));
    cached = { mtimeMs, manifest };
    return manifest;
  } catch {
    return EMPTY_PACK_FONTS;
  }
}

/** Tên họ (không phân biệt hoa thường) trùng một font gốc của gói. */
export function packFamilyNamed(name: string, m: PackFontManifest = readPackFonts()) {
  const key = familyNameKey(name);
  return m.families.find((f) => familyNameKey(f.cssName) === key) ?? null;
}

/**
 * Giá trị THẬT của token font trên site: gói đè `--font-display`… trong `fonts.css`, nên bảng
 * Token (nạp từ `tokens.css` của lõi) nói "Inter" trong khi site ra SF Pro. Đè lại ở đây cho
 * ô chọn font và màn Font không nói sai.
 */
export function withPackVariables<T extends { name: string; value: string }>(
  rows: readonly T[],
  m: PackFontManifest = readPackFonts(),
): T[] {
  return rows.map((r) => (m.variables[r.name] ? { ...r, value: m.variables[r.name]! } : r));
}

/** `@font-face` của font gốc — cho VỎ builder (nó không nạp CSS của gói) xem trước đúng font. */
export function packFontFaceCss(m: PackFontManifest = readPackFonts()): string {
  return m.families
    .flatMap((fam) =>
      fam.faces
        .filter((f) => f.bytes !== null)
        .map(
          (f) =>
            `@font-face {\n  font-family: ${cssFamilyName(fam.cssName)};\n  src: url("${f.url}");\n` +
            `  font-weight: ${f.weight};\n  font-style: ${f.style};\n  font-display: swap;\n` +
            (f.unicodeRange ? `  unicode-range: ${f.unicodeRange};\n` : '') +
            '}',
        ),
    )
    .join('\n');
}
