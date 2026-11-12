/**
 * Quét FONT GỐC của gói dự án → `generated/pack-fonts/<gói>.json`.
 *
 *   pnpm fonts:scan        # chạy tay; next.config.mjs cũng gọi mỗi lần `next dev` / `next build`
 *
 * ## Font gốc là gì
 *
 * Font nằm trong gói (`projects/<gói>/public/fonts/`) và được khai `@font-face` trong
 * `projects/<gói>/styles/fonts.css`. CSS của gói được biên vào bundle nên site và canvas dùng
 * được ngay. Builder thì không đọc CSS của gói — file JSON này là thứ để màn Cài đặt › Font,
 * ô chọn font ở Inspector và tool `list_fonts` THẤY chúng.
 *
 * Font gốc là CHỈ ĐỌC với builder: không API, tool hay script nào sửa/xoá file trong
 * `projects/`. Muốn bỏ một font gốc: `pnpm fonts:adopt` (chép vào kho font), rồi tự xoá khối
 * `@font-face` và file trong repo gói (xem docs/huong-dan/font.md).
 *
 * Một file cho MỖI gói: dev server thường (có gói) và stack e2e (thường không gói) cùng chạy trên
 * một bản checkout — chung một file thì bên nạp config sau ghi đè bên kia.
 *
 * ## Vì sao sinh lúc build, không đọc CSS lúc chạy
 *
 * `fonts.css` là nguồn duy nhất; JSON chỉ là đầu ra, sinh lại mỗi lần build nên không lệch
 * được. Không commit (`/generated/` trong .gitignore). Image chạy mang theo nó nhờ
 * `outputFileTracingIncludes` trong next.config.mjs.
 *
 * Bộ đọc `@font-face` ở đây phải khớp `parseFontFaceCss` (src/lib/fonts/adopt.ts) — test
 * `pack-fonts.test.mjs` so hai bên trên cùng một CSS.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACK_FONTS_DIR = 'generated/pack-fonts';
/** `generated/pack-fonts/<gói>.json` — `null` khi không có gói (không ghi gì). */
export const packFontsFile = (name) => (name ? `${PACK_FONTS_DIR}/${name}.json` : null);
export const PACK_FONTS_VERSION = 1;

const FONT_EXT_RE = /\.(woff2|woff|ttf|otf)$/i;
const COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const FACE_BLOCK_RE = /@font-face\s*\{([^}]*)\}/gi;
const ROOT_BLOCK_RE = /:root\s*\{([^}]*)\}/gi;
const FONT_VAR_RE = /--(font-[a-z0-9-]+)\s*:\s*([^;]+);?/gi;
const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i;

/** Giá trị một khai báo trong thân khối (không phân biệt hoa thường), hoặc `''`. */
function declOf(body, prop) {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]*)`, 'i').exec(body);
  return (m?.[1] ?? '').trim();
}

const unquote = (s) => s.replace(/^\s*(["'])(.*)\1\s*$/, '$2').trim();
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** Comment đầu file → ghi chú giấy phép (một dòng, tối đa 300 ký tự) — như `licenseNoteOf`. */
function licenseNoteOf(css) {
  const m = /\/\*([\s\S]*?)\*\//.exec(css);
  if (!m) return '';
  const text = squash((m[1] ?? '').replace(/-{3,}/g, ' '));
  return text.length > 300 ? `${text.slice(0, 299).trimEnd()}…` : text;
}

/** Mọi file font dưới `dir` (đệ quy), đường dẫn tương đối từ `root`, dấu `/`. */
function fontFilesUnder(dir, root) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...fontFilesUnder(p, root));
    else if (FONT_EXT_RE.test(e.name)) out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

/**
 * @param {string} css
 * @param {string} pack tên gói — `/p/x` đổi thành `projects/<gói>/public/x`
 */
export function parsePackFontCss(css, pack) {
  const clean = css.replace(COMMENT_RE, '');
  const faces = [];
  for (const block of clean.matchAll(FACE_BLOCK_RE)) {
    const body = block[1] ?? '';
    const family = squash(unquote(declOf(body, 'font-family')));
    const u = URL_RE.exec(declOf(body, 'src'));
    const url = (u?.[1] ?? u?.[2] ?? u?.[3] ?? '').trim();
    if (!family || !url) continue;
    faces.push({
      family,
      weight: squash(declOf(body, 'font-weight')) || '400',
      style: declOf(body, 'font-style').toLowerCase() === 'italic' ? 'italic' : 'normal',
      unicodeRange: squash(declOf(body, 'unicode-range')),
      url,
      file: `projects/${pack}/public/${url.replace(/^\/p\//, '')}`,
    });
  }
  /** `--font-*` khai trong `:root` của file — gói đè token font của lõi ở đây. */
  const variables = {};
  for (const block of clean.matchAll(ROOT_BLOCK_RE)) {
    for (const v of (block[1] ?? '').matchAll(FONT_VAR_RE)) variables[v[1].toLowerCase()] = squash(v[2]);
  }
  return { faces, variables, licenseNote: licenseNoteOf(css) };
}

/** Manifest rỗng: Quilder thuần, hoặc gói không có `styles/fonts.css`. */
export function emptyManifest(pack = null) {
  return { version: PACK_FONTS_VERSION, pack, css: null, licenseNote: '', families: [], variables: {}, undeclared: [], missing: [] };
}

/**
 * @param {{ name: string | null, dir: string }} project — kết quả `projectDir()`
 * @param {string} [root]
 */
export function scanPackFonts(project, root = process.cwd()) {
  if (!project.name) return emptyManifest();
  const cssRel = `${project.dir}/styles/fonts.css`;
  const cssAbs = resolve(root, cssRel);
  if (!existsSync(cssAbs)) return emptyManifest(project.name);

  const { faces, variables, licenseNote } = parsePackFontCss(readFileSync(cssAbs, 'utf8'), project.name);
  const families = [];
  const missing = [];
  for (const f of faces) {
    const abs = resolve(root, f.file);
    const bytes = existsSync(abs) ? statSync(abs).size : null;
    if (bytes === null) missing.push(f.file);
    const key = f.family.toLowerCase();
    let fam = families.find((x) => x.cssName.toLowerCase() === key);
    if (!fam) families.push((fam = { cssName: f.family, faces: [] }));
    fam.faces.push({ weight: f.weight, style: f.style, unicodeRange: f.unicodeRange, url: f.url, file: f.file, bytes });
  }
  const declared = new Set(faces.map((f) => f.file));
  const undeclared = fontFilesUnder(resolve(root, project.dir, 'public', 'fonts'), resolve(root))
    .filter((f) => !declared.has(f))
    .sort();

  return { version: PACK_FONTS_VERSION, pack: project.name, css: cssRel, licenseNote, families, variables, undeclared, missing };
}

/**
 * Quét rồi ghi file; chỉ ghi khi nội dung đổi (next.config được nạp nhiều lần ở dev).
 * Không có gói thì không ghi gì (`path: null`) — bộ đọc coi như rỗng.
 */
export function writePackFonts(project, root = process.cwd()) {
  const manifest = scanPackFonts(project, root);
  const rel = packFontsFile(project.name);
  if (!rel) return { manifest, path: null, changed: false };
  const path = resolve(root, rel);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const old = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (old !== text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return { manifest, path, changed: old !== text };
}

/** Một dòng cảnh báo cho log build, hoặc `null` khi không có gì đáng nói. */
export function packFontWarnings(manifest) {
  const lines = [];
  for (const f of manifest.missing) lines.push(`  thiếu file: ${f} (khai trong ${manifest.css} nhưng không có trên đĩa)`);
  for (const f of manifest.undeclared) lines.push(`  chưa khai @font-face: ${f} (chưa dùng được)`);
  return lines.length ? `[pack-fonts] font gốc của gói ${manifest.pack}:\n${lines.join('\n')}` : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { projectDir } = await import('./project-dir.mjs');
  const { manifest, path } = writePackFonts(projectDir());
  const where = path ? relative(process.cwd(), path) : '(không ghi file)';
  const faces = manifest.families.reduce((n, f) => n + f.faces.length, 0);
  console.log(
    manifest.pack
      ? `Font gốc của gói ${manifest.pack}: ${manifest.families.length} họ / ${faces} face → ${where}`
      : 'Không có gói dự án (QUILDER_PROJECT trống) — không có font gốc.',
  );
  for (const f of manifest.families) console.log(`  ${f.cssName}: ${f.faces.map((x) => x.weight + (x.style === 'italic' ? 'i' : '')).join(', ')}`);
  const warn = packFontWarnings(manifest);
  if (warn) console.warn(warn);
}
