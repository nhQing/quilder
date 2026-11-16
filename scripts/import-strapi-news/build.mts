/**
 * Sinh `import-strapi-news.sql` từ bản xuất JSON của dump Strapi (blogs + liên kết + files).
 *
 *   npx tsx scripts/import-strapi-news/build.mts strapi.json src/lib/collections/html-sanitize.ts scripts/import-strapi-news/import-strapi-news.sql
 *
 * Body được làm sạch bằng ĐÚNG `sanitizeArticleHtml` của repo, nên dữ liệu ghi bằng SQL
 * khớp với thứ đường ghi của builder sẽ lưu — mở bài ra sửa rồi lưu không đổi gì thêm.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [, , jsonPath, sanitizerPath, outPath] = process.argv;
const { sanitizeArticleHtml, htmlPlainText } = await import(pathToFileURL(resolve(sanitizerPath!)).href);

interface Blog {
  id: number; locale: 'vi' | 'en'; title: string; slug: string; description: string | null; body: string | null;
  created_at: string; updated_at: string; published_at: string | null; external_link: string | null;
  event: string | null; team_id: number | null; thumb_file: number | null; image_file: number | null;
  seo: { meta_title: string | null; meta_description: string | null; keywords: string | null; meta_file: number | null } | null;
  cats: string[]; groups: string[];
}
interface FileRow {
  id: number; name: string; alt: string | null; width: number | null; height: number | null; mime: string;
  size_kb: number | null; url: string; folder_path: string | null; created_at: string;
}
const data = JSON.parse(readFileSync(jsonPath!, 'utf8')) as {
  blogs: Blog[]; pairs: { vi: number; en: number }[]; files: FileRow[];
  folders: { path: string; name: string }[]; teams: { id: number; name: string; locale: string; avatar_file: number | null }[];
};

/* ── escape ────────────────────────────────────────────────────────────── */

const TAG = '$mm$';
const lit = (s: string | null | undefined): string => {
  if (s === null || s === undefined) return 'NULL';
  if (s.includes(TAG)) throw new Error('Dữ liệu chứa ' + TAG);
  return `${TAG}${s}${TAG}`;
};
const num = (n: number | null | undefined) => (n === null || n === undefined ? 'NULL' : String(n));
const ts = (s: string | null) => (s ? `'${s}'::timestamp` : 'NULL::timestamp');

/* ── thư mục ───────────────────────────────────────────────────────────── */

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const folderName = new Map(data.folders.map((f) => [f.path, f.name]));
/** Strapi `/10/19` → Blog/2024 → `tin-tuc/blog/2024`. Gốc `/` → `tin-tuc`. */
function quilderFolder(p: string | null): string {
  if (!p || p === '/') return 'tin-tuc';
  const parts = p.split('/').filter(Boolean);
  const names: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const nm = folderName.get('/' + parts.slice(0, i).join('/'));
    names.push(slugify(nm ?? `thu-muc-${parts[i - 1]}`));
  }
  return ['tin-tuc', ...names].join('/');
}
const AUTHOR_FOLDER = 'tin-tuc/tac-gia';

/* ── files → Asset ─────────────────────────────────────────────────────── */

const avatarFiles = new Set(data.teams.map((t) => t.avatar_file).filter((x): x is number => !!x));
const kindOf = (mime: string) =>
  mime === 'image/svg+xml' ? 'svg' : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video'
  : mime === 'application/pdf' ? 'pdf' : mime.startsWith('audio/') ? 'audio' : 'file';
const keyOf = (url: string) => new URL(url).pathname.replace(/^\//, '');

const fileRows = data.files.map((f) => {
  const folder = avatarFiles.has(f.id) ? AUTHOR_FOLDER : quilderFolder(f.folder_path);
  return `(${f.id},${lit(keyOf(f.url))},${lit(f.url)},${lit(f.mime)},${Math.round((f.size_kb ?? 0) * 1024)},${num(f.width)},${num(f.height)},${lit(f.alt && f.alt.trim() ? f.alt.trim() : null)},${lit(folder)},${ts(f.created_at)},'${kindOf(f.mime)}')`;
});
const folderSet = new Set<string>();
for (const f of data.files) {
  const p = avatarFiles.has(f.id) ? AUTHOR_FOLDER : quilderFolder(f.folder_path);
  const segs = p.split('/');
  for (let i = 1; i <= segs.length; i++) folderSet.add(segs.slice(0, i).join('/'));
}

/* ── taxonomy ──────────────────────────────────────────────────────────── */

/** Strapi category / blog_group slug → khoá Taxonomy của Quilder (gộp như STG đã làm). */
const TAX_MAP: Record<string, string> = {
  // category vi
  'dau-tu': 'dau-tu', 'tet': 'tet', 'su-kien': 'su-kien', 'san-pham': 'san-pham', 'tin-tuc-thi-truong-1': 'tin-tuc-thi-truong',
  // category en
  'lunar-new-year': 'tet', 'investments': 'dau-tu', 'event': 'su-kien', 'product': 'san-pham', 'market-wrap-1': 'tin-tuc-thi-truong',
  // blog_group vi
  'tin-tuc-mai-money': 'tin-tuc-mai-money', 'maimoney-dau-tu': 'dau-tu', 'gia-tri-cong-dong': 'gia-tri-cong-dong',
  'moneytalk-vie': 'moneytalk-vie', 'uu-dai': 'uu-dai', 'tin-tuc-thi-truong': 'tin-tuc-thi-truong',
  // blog_group en
  'maimoney-impact': 'gia-tri-cong-dong', 'maimoney-news': 'tin-tuc-mai-money', 'investing-101': 'dau-tu', 'moneytalk-eng': 'moneytalk-vie',
};
const TAX_DEF: [key: string, vi: string, en: string | null][] = [
  ['dau-tu', 'Đầu tư', 'Investments'],
  ['su-kien', 'Sự kiện', 'Event'],
  ['san-pham', 'Sản phẩm', 'Product'],
  ['tet', 'Tết', 'Lunar New Year'],
  ['tin-tuc-thi-truong', 'Tin Tức Thị Trường', 'Market Wrap'],
  ['tin-tuc-mai-money', 'Tin Tức MaiMoney', 'MaiMoney News'],
  ['gia-tri-cong-dong', 'Giá Trị Cộng Đồng', 'Impact'],
  ['moneytalk-vie', 'Money Talk', 'Money Talk'],
  ['uu-dai', 'Ưu đãi', null],
];

/* ── bài viết ──────────────────────────────────────────────────────────── */

const stats = { slugCut: 0, seoTitleCut: 0, bodyNull: 0, textLoss: [] as number[], dropped: new Map<string, number>(), over120: [] as string[] };

function cleanSlug(s: string | null): string | null {
  if (s === null) return null; // bản en chưa đặt slug riêng → EntryLocale.slug = NULL (dùng slug gốc)
  if (s.length <= 120) return s;
  stats.slugCut++;
  stats.over120.push(s);
  return s.slice(0, 120).replace(/-+[^-]*$/, (m) => (s[120] === '-' ? '' : m)).replace(/-+$/, '');
}
function cleanBody(b: Blog): string {
  const raw = b.body ?? '';
  if (!raw.trim()) { stats.bodyNull++; return ''; }
  // CKEditor cũ của Strapi phát <i>/<b>; ô soạn của builder dùng <em>/<strong>. Cùng nghĩa, nên đổi thẻ thay vì để sanitizer gỡ mất in nghiêng.
  const pre = raw.replace(/<(\/?)i(\s[^>]*)?>/gi, '<$1em$2>').replace(/<(\/?)b(\s[^>]*)?>/gi, '<$1strong$2>');
  const { html, dropped } = sanitizeArticleHtml(pre, { iframeHosts: [] });
  for (const d of dropped) stats.dropped.set(d, (stats.dropped.get(d) ?? 0) + 1);
  const a = htmlPlainText(raw).length, c = htmlPlainText(html).length;
  if (a !== c) stats.textLoss.push(b.id);
  return html;
}
function seoTitle(t: string | null): string | null {
  if (!t) return null;
  if ([...t].length <= 120) return t;
  stats.seoTitleCut++;
  return [...t].slice(0, 119).join('').trimEnd() + '…';
}

const srcRows = data.blogs.map((b) => {
  const seo = b.seo;
  return `(${b.id},${lit(b.locale)},${lit(cleanSlug(b.slug))},${lit(b.slug)},${lit(b.title.trim())},${lit(b.description?.trim() || null)},${lit(cleanBody(b))},` +
    `${ts(b.created_at)},${ts(b.updated_at)},${ts(b.published_at)},${lit(b.external_link?.trim() || null)},${num(b.team_id)},${num(b.image_file ?? b.thumb_file)},${num(b.thumb_file)},` +
    `${lit(seoTitle(seo?.meta_title ?? null))},${lit(seo?.meta_description?.trim() || null)},${lit(seo?.keywords?.trim() || null)},${num(seo?.meta_file ?? null)})`;
});

const taxRows: string[] = [];
const noTax: number[] = [];
const byId = new Map(data.blogs.map((b) => [b.id, b]));
for (const b of data.blogs.filter((x) => x.locale === 'vi')) {
  const keys = new Set([...b.cats, ...b.groups].map((s) => {
    const k = TAX_MAP[s];
    if (!k) throw new Error('Chưa ánh xạ taxonomy: ' + s);
    return k;
  }));
  if (!keys.size) noTax.push(b.id);
  for (const k of keys) taxRows.push(`(${b.id},${lit(k)})`);
}

const teamRows = data.teams.map((t) => `(${t.id},${lit(t.name)},${num(t.avatar_file)})`);
const pairRows = data.pairs.map((p) => `(${p.vi},${p.en})`);

/* ── SQL ───────────────────────────────────────────────────────────────── */

const sql = `-- =====================================================================================
-- Nhập TIN TỨC từ Strapi (prod RDS, catalog cms-strapi-2, dump 11/09/2026) vào Quilder.
--
-- CHẠY TRÊN: server STG, database maimoney_builder (pgAdmin Query Tool hoặc psql -f).
-- Script nằm trong MỘT transaction (BEGIN … COMMIT). Lỗi giữa chừng thì chạy ROLLBACK;
-- không có gì được ghi. Chạy lại an toàn: bài đã có (trùng slug / tiêu đề) bị BỎ QUA.
--
-- Sinh bởi scripts/import-strapi-news/build.ts. Đừng sửa tay phần DỮ LIỆU ở cuối file.
--
-- Việc script làm (theo thứ tự):
--  0. Kiểm tiền điều kiện (User, CollectionType news, Locale en).
--  1. Schema loại "news": body richtext → html; title ≤ 255; excerpt ≤ 600; thêm field
--     thumbnail (sau cover), seo và external_link (chỉ thêm nếu chưa có). Bài đã có được
--     chép cover → thumbnail. MCP không có tool sửa schema nên việc này làm ở đây.
--  2. Đổi body của các bài news ĐANG CÓ từ richtext (mảng) sang chuỗi html — trước khi
--     đổi kiểu, ô soạn html chỉ đọc chuỗi nên mảng cũ sẽ hiện trống.
--  3. Thư mục + Asset (trỏ thẳng cdn.maimoney.com, không copy file; key = đường dẫn S3 gốc).
--  4. Taxonomy (category + blog_group gộp, như STG đang làm); chỉ tạo mục còn thiếu.
--  5. Entry (vi) + bản en (Entry.i18n.en + EntryLocale) + EntryTaxonomy.
--     GIỮ NGUYÊN ngày tạo / ngày sửa / ngày đăng từ Strapi (UTC).
-- =====================================================================================

BEGIN;

CREATE TEMP TABLE _cfg (actor text NOT NULL);
-- Tài khoản ghi vào createdBy / updatedBy. PHẢI là email có trong bảng "User".
INSERT INTO _cfg VALUES ('se1@maimoney.com');

DO $chk$
DECLARE a text;
BEGIN
  SELECT actor INTO a FROM _cfg;
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE email = a) THEN RAISE EXCEPTION 'Không có User %', a; END IF;
  IF NOT EXISTS (SELECT 1 FROM "CollectionType" WHERE key = 'news') THEN RAISE EXCEPTION 'Không có CollectionType news'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Locale" WHERE code = 'en') THEN RAISE EXCEPTION 'Không có Locale en'; END IF;
END
$chk$;

-- ── 1. Schema ───────────────────────────────────────────────────────────────────────
UPDATE "CollectionType" ct SET
  schema = (
    SELECT jsonb_agg(
      CASE f->>'key'
        WHEN 'body'    THEN jsonb_build_object('t','html','key','body','label',f->>'label','required',true,'maxChars',200000)
        WHEN 'title'   THEN f || '{"maxLength":255}'::jsonb
        WHEN 'excerpt' THEN f || '{"maxLength":600}'::jsonb
        ELSE f
      END ORDER BY ord)
    FROM jsonb_array_elements(ct.schema) WITH ORDINALITY AS x(f, ord)
  ),
  "updatedAt" = now()
WHERE ct.key = 'news';

-- Field thumbnail (ảnh trên thẻ tin), đặt ngay sau "cover". Cover giữ nguyên kiểu và tên: nó là ảnh/video đầu trang chi tiết.
UPDATE "CollectionType" ct SET
  schema = (
    SELECT jsonb_agg(e ORDER BY o) FROM (
      SELECT f AS e, ord * 2 AS o FROM jsonb_array_elements(ct.schema) WITH ORDINALITY AS x(f, ord)
      UNION ALL
      SELECT '{"t":"image","key":"thumbnail","label":"Ảnh thu nhỏ (thumbnail)","required":true,"requireAlt":true,"help":"Ảnh trên thẻ tin ở trang danh sách."}'::jsonb, ord * 2 + 1
      FROM jsonb_array_elements(ct.schema) WITH ORDINALITY AS x(f, ord) WHERE f->>'key' = 'cover'
    ) s),
  "updatedAt" = now()
WHERE ct.key = 'news'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ct.schema) f WHERE f->>'key' = 'thumbnail')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(ct.schema) f WHERE f->>'key' = 'cover');

-- Bài đã có chưa có thumbnail: lấy luôn ảnh bìa hiện tại, để thẻ tin trỏ sang thumbnail không bị trống.
UPDATE "Entry" SET data = jsonb_set(data, '{thumbnail}', data->'cover')
WHERE "typeKey" = 'news' AND data ? 'cover' AND NOT data ? 'thumbnail';

UPDATE "CollectionType" ct SET
  schema = ct.schema || '[{"t":"seo","key":"seo","label":"SEO"}]'::jsonb,
  "updatedAt" = now()
WHERE ct.key = 'news' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ct.schema) f WHERE f->>'t' = 'seo');

UPDATE "CollectionType" ct SET
  schema = ct.schema || '[{"t":"link","key":"external_link","label":"Liên kết bài gốc (báo ngoài)","help":"Bài đăng lại từ trang báo khác."}]'::jsonb,
  "updatedAt" = now()
WHERE ct.key = 'news' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ct.schema) f WHERE f->>'key' = 'external_link');

-- ── 2. richtext (mảng inline node) → html (chuỗi) cho bài ĐÃ CÓ ──────────────────────
CREATE FUNCTION pg_temp.rt_esc(s text) RETURNS text LANGUAGE sql IMMUTABLE AS
$f$ SELECT replace(replace(replace(replace(coalesce(s,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $f$;

CREATE FUNCTION pg_temp.rt_inline(n jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS
$f$
DECLARE r text := ''; c jsonb;
BEGIN
  IF jsonb_typeof(n) = 'array' THEN
    FOR c IN SELECT * FROM jsonb_array_elements(n) LOOP r := r || pg_temp.rt_inline(c); END LOOP;
    RETURN r;
  END IF;
  CASE n->>'t'
    WHEN 'text'    THEN RETURN replace(pg_temp.rt_esc(n->>'v'), E'\\n', '<br>');
    WHEN 'br'      THEN RETURN '<br>';
    WHEN 'strong'  THEN RETURN '<strong>' || pg_temp.rt_inline(n->'children') || '</strong>';
    WHEN 'em'      THEN RETURN '<em>' || pg_temp.rt_inline(n->'children') || '</em>';
    WHEN 'link'    THEN RETURN '<a href="' || pg_temp.rt_esc(n->>'href') || '">' || pg_temp.rt_inline(n->'children') || '</a>';
    WHEN 'split'   THEN RETURN pg_temp.rt_inline(n->'children');
    WHEN 'counter' THEN RETURN (n->>'to') || coalesce(n->>'suffix','');
    WHEN 'bind'    THEN RETURN pg_temp.rt_esc(n->>'fallback');
    ELSE RETURN '';
  END CASE;
END
$f$;

-- Hai <br> liền nhau là ngắt đoạn trong richtext cũ → đổi thành </p><p>.
CREATE FUNCTION pg_temp.rt_html(n jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS
$f$
  SELECT regexp_replace(
           '<p>' || replace(pg_temp.rt_inline(n), '<br><br>', '</p><p>') || '</p>',
           '<p>(<br>)*</p>', '', 'g')
$f$;

UPDATE "Entry" SET data = jsonb_set(data, '{body}', to_jsonb(pg_temp.rt_html(data->'body')))
WHERE "typeKey" = 'news' AND jsonb_typeof(data->'body') = 'array';

UPDATE "Entry" e SET i18n = (
  SELECT jsonb_object_agg(k,
    CASE WHEN jsonb_typeof(v) = 'object' AND jsonb_typeof(v->'body') = 'array'
         THEN jsonb_set(v, '{body}', to_jsonb(pg_temp.rt_html(v->'body'))) ELSE v END)
  FROM jsonb_each(e.i18n) AS x(k, v))
WHERE e."typeKey" = 'news' AND e.i18n <> '{}'::jsonb
  AND EXISTS (SELECT 1 FROM jsonb_each(e.i18n) AS x(k, v) WHERE jsonb_typeof(v) = 'object' AND jsonb_typeof(v->'body') = 'array');

-- ── 3. Thư mục + Asset ──────────────────────────────────────────────────────────────
CREATE TEMP TABLE _file (
  file_id int PRIMARY KEY, key text, url text, mime text, bytes int, width int, height int,
  alt text, folder text, created_at timestamp, kind text, asset_id text, existed boolean
);
INSERT INTO _file (file_id, key, url, mime, bytes, width, height, alt, folder, created_at, kind) VALUES
${fileRows.join(',\n')};

UPDATE _file SET asset_id = 'cf' || substr(md5('strapi-file:' || file_id), 1, 23),
                 existed = EXISTS (SELECT 1 FROM "Asset" a WHERE a.key = _file.key);

INSERT INTO "AssetFolder" (path, "createdBy", "createdAt") VALUES
${[...folderSet].sort().map((p) => `(${lit(p)}, NULL, now())`).join(',\n')}
ON CONFLICT (path) DO NOTHING;

INSERT INTO "Asset" (id, kind, key, url, mime, bytes, width, height, alt, folder, "createdAt")
SELECT asset_id, kind, key, url, mime, bytes, width, height, alt, folder, created_at FROM _file
ON CONFLICT (key) DO NOTHING;

-- Key đã có từ lần chạy trước thì dùng id đang có.
UPDATE _file f SET asset_id = a.id FROM "Asset" a WHERE a.key = f.key;

-- ── 4. Taxonomy ─────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _taxdef (key text PRIMARY KEY, name text, name_en text, ord int);
INSERT INTO _taxdef VALUES
${TAX_DEF.map(([k, vi, en], i) => `(${lit(k)}, ${lit(vi)}, ${lit(en)}, ${i})`).join(',\n')};

INSERT INTO "Taxonomy" (id, "typeKey", key, name, i18n, "parentId", "order", status)
SELECT 'ct' || substr(md5('strapi-tax:' || d.key), 1, 23), 'news', d.key, d.name, '{}'::jsonb, NULL,
       (SELECT coalesce(max("order"), 0) FROM "Taxonomy" WHERE "typeKey" = 'news') + 1 + d.ord, 'published'
FROM _taxdef d
ON CONFLICT ("typeKey", key) DO NOTHING;

-- Tên tiếng Anh: chỉ điền khi mục chưa có bản dịch nào.
UPDATE "Taxonomy" t SET i18n = jsonb_build_object('en', jsonb_build_object('name', d.name_en))
FROM _taxdef d
WHERE t."typeKey" = 'news' AND t.key = d.key AND d.name_en IS NOT NULL AND t.i18n = '{}'::jsonb;

-- ── 5. DỮ LIỆU Strapi ──────────────────────────────────────────────────────────────
CREATE TEMP TABLE _src (
  blog_id int PRIMARY KEY, locale text, slug text, slug_orig text, title text, excerpt text, body text,
  created_at timestamp, updated_at timestamp, published_at timestamp, ext_link text, team_id int, cover_file int, thumb_file int,
  seo_title text, seo_desc text, seo_kw text, seo_file int
);
INSERT INTO _src VALUES
${srcRows.join(',\n')};

CREATE TEMP TABLE _pair (vi int, en int);
INSERT INTO _pair VALUES
${pairRows.join(',\n')};

CREATE TEMP TABLE _tax (blog_id int, tax_key text);
INSERT INTO _tax VALUES
${taxRows.join(',\n')};

CREATE TEMP TABLE _team (team_id int PRIMARY KEY, name text, avatar_file int);
INSERT INTO _team VALUES
${teamRows.join(',\n')};

-- Ảnh tác giả: dùng lại asset đang gắn cho cùng tên tác giả trên STG, chưa có thì dùng ảnh Strapi.
CREATE TEMP TABLE _author AS
SELECT t.team_id, t.name,
       coalesce(
         (SELECT e.data #>> '{author_photo,assetId}' FROM "Entry" e
           WHERE e."typeKey" = 'news' AND e.data->>'author_name' = t.name AND e.data #>> '{author_photo,assetId}' IS NOT NULL
           ORDER BY e."createdAt" LIMIT 1),
         f.asset_id) AS asset_id
FROM _team t LEFT JOIN _file f ON f.file_id = t.avatar_file;

-- Kế hoạch: bài vi nào là MỚI. Trùng nếu cùng slug, cùng tiêu đề, hoặc slug STG là bản cắt 80 ký tự của slug Strapi.
CREATE TEMP TABLE _plan AS
SELECT s.blog_id,
       'cs' || substr(md5('strapi-blog:' || s.blog_id), 1, 23) AS entry_id,
       NOT EXISTS (
         SELECT 1 FROM "Entry" e
         WHERE e."typeKey" = 'news'
           AND ( e.slug = s.slug
              OR (length(e.slug) >= 60 AND s.slug LIKE e.slug || '%')
              OR lower(e.data->>'title') = lower(s.title) )
       ) AS is_new
FROM _src s WHERE s.locale = 'vi';

INSERT INTO "Entry" (id, "typeId", "typeKey", slug, data, i18n, status, "publishedAt", "viewCount", "createdAt", "updatedAt", "createdBy", "updatedBy")
SELECT p.entry_id, ct.id, 'news', v.slug,
  jsonb_strip_nulls(jsonb_build_object(
    'title', v.title,
    'slug', v.slug,
    'excerpt', v.excerpt,
    'cover', CASE WHEN cf.asset_id IS NOT NULL THEN jsonb_build_object('assetId', cf.asset_id, 'alt', v.title) END,
    'thumbnail', CASE WHEN tf.asset_id IS NOT NULL THEN jsonb_build_object('assetId', tf.asset_id, 'alt', v.title) END,
    'body', v.body,
    'author_name', tm.name,
    'author_photo', CASE WHEN au.asset_id IS NOT NULL THEN jsonb_build_object('assetId', au.asset_id, 'alt', tm.name) END,
    'seo', nullif(jsonb_strip_nulls(jsonb_build_object(
        'metaTitle', v.seo_title, 'metaDescription', v.seo_desc, 'keywords', v.seo_kw,
        'ogImage', CASE WHEN sf.asset_id IS NOT NULL THEN jsonb_build_object('assetId', sf.asset_id, 'alt', v.title) END)), '{}'::jsonb),
    'external_link', CASE WHEN v.ext_link IS NOT NULL THEN jsonb_build_object('href', v.ext_link) END
  )),
  CASE WHEN en.blog_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('en', jsonb_strip_nulls(jsonb_build_object(
    'title', en.title,
    'excerpt', en.excerpt,
    'body', nullif(en.body, ''),
    'cover', CASE WHEN ecf.asset_id IS NOT NULL AND ecf.asset_id IS DISTINCT FROM cf.asset_id
                  THEN jsonb_build_object('assetId', ecf.asset_id, 'alt', en.title) END,
    'thumbnail', CASE WHEN etf.asset_id IS NOT NULL AND etf.asset_id IS DISTINCT FROM tf.asset_id
                  THEN jsonb_build_object('assetId', etf.asset_id, 'alt', en.title) END,
    'author_name', etm.name,
    'seo', nullif(jsonb_strip_nulls(jsonb_build_object(
        'metaTitle', en.seo_title, 'metaDescription', en.seo_desc, 'keywords', en.seo_kw,
        'ogImage', CASE WHEN esf.asset_id IS NOT NULL THEN jsonb_build_object('assetId', esf.asset_id, 'alt', en.title) END)), '{}'::jsonb),
    'external_link', CASE WHEN en.ext_link IS NOT NULL AND en.ext_link IS DISTINCT FROM v.ext_link
                          THEN jsonb_build_object('href', en.ext_link) END
  ))) END,
  CASE WHEN v.published_at IS NULL THEN 'draft' ELSE 'published' END,
  v.published_at, 0, v.created_at, v.updated_at, c.actor, c.actor
FROM _plan p
JOIN _src v ON v.blog_id = p.blog_id
CROSS JOIN _cfg c
JOIN "CollectionType" ct ON ct.key = 'news'
LEFT JOIN _pair pr ON pr.vi = v.blog_id
LEFT JOIN _src en ON en.blog_id = pr.en
LEFT JOIN _file cf  ON cf.file_id = v.cover_file
LEFT JOIN _file ecf ON ecf.file_id = en.cover_file
LEFT JOIN _file tf  ON tf.file_id = v.thumb_file
LEFT JOIN _file etf ON etf.file_id = en.thumb_file
LEFT JOIN _file sf  ON sf.file_id = v.seo_file
LEFT JOIN _file esf ON esf.file_id = en.seo_file
LEFT JOIN _team tm  ON tm.team_id = v.team_id
LEFT JOIN _team etm ON etm.team_id = (SELECT x.team_id FROM _src x WHERE x.blog_id = en.blog_id)
LEFT JOIN _author au ON au.team_id = v.team_id
WHERE p.is_new;

INSERT INTO "EntryLocale" ("entryId", locale, "typeKey", slug, status, "publishedAt", "createdAt", "updatedAt", "updatedBy")
SELECT p.entry_id, 'en', 'news', en.slug,
       CASE WHEN en.published_at IS NULL THEN 'draft' ELSE 'published' END,
       en.published_at, en.created_at, en.updated_at, c.actor
FROM _plan p
JOIN _pair pr ON pr.vi = p.blog_id
JOIN _src en ON en.blog_id = pr.en
CROSS JOIN _cfg c
WHERE p.is_new
ON CONFLICT DO NOTHING;

INSERT INTO "EntryTaxonomy" ("entryId", "taxonomyId")
SELECT DISTINCT p.entry_id, t.id
FROM _tax x
JOIN _plan p ON p.blog_id = x.blog_id AND p.is_new
JOIN "Taxonomy" t ON t."typeKey" = 'news' AND t.key = x.tax_key
ON CONFLICT DO NOTHING;

-- ── Báo cáo (xem tab Messages) ──────────────────────────────────────────────────────
DO $rep$
DECLARE r record; n_new int; n_skip int;
BEGIN
  SELECT count(*) FILTER (WHERE is_new), count(*) FILTER (WHERE NOT is_new) INTO n_new, n_skip FROM _plan;
  RAISE NOTICE 'Strapi vi: % bài. Thêm mới: %. Bỏ qua (đã có): %.', n_new + n_skip, n_new, n_skip;
  RAISE NOTICE 'Bản en thêm: %', (SELECT count(*) FROM _plan p JOIN _pair pr ON pr.vi = p.blog_id WHERE p.is_new);
  FOR r IN SELECT s.blog_id, s.slug FROM _plan p JOIN _src s ON s.blog_id = p.blog_id WHERE NOT p.is_new ORDER BY s.blog_id LOOP
    RAISE NOTICE 'BỎ QUA #% %', r.blog_id, r.slug;
  END LOOP;
  RAISE NOTICE 'Asset trong script: %. Tạo mới: %. Đã có sẵn: %.', (SELECT count(*) FROM _file), (SELECT count(*) FROM _file WHERE NOT existed), (SELECT count(*) FROM _file WHERE existed);
END
$rep$;

-- Kiểm tra trước khi COMMIT: số bài news và số bài còn body dạng mảng (phải = 0).
SELECT (SELECT count(*) FROM "Entry" WHERE "typeKey" = 'news') AS tong_news,
       (SELECT count(*) FROM "Entry" WHERE "typeKey" = 'news' AND jsonb_typeof(data->'body') = 'array') AS body_con_la_mang,
       (SELECT count(*) FROM "Entry" WHERE id LIKE 'cs%' AND "typeKey" = 'news') AS bai_vua_nhap;

COMMIT;
`;

writeFileSync(outPath!, sql);

console.error(JSON.stringify({
  blogs: data.blogs.length, vi: data.blogs.filter((b) => b.locale === 'vi').length, en: data.blogs.filter((b) => b.locale === 'en').length,
  files: data.files.length, folders: [...folderSet].sort(), taxRows: taxRows.length, noTaxonomy: noTax,
  slugCut: stats.slugCut, over120: stats.over120, seoTitleCut: stats.seoTitleCut, bodyEmpty: stats.bodyNull,
  bodiesWithTextDifference: stats.textLoss.length, droppedTags: [...stats.dropped], sqlBytes: sql.length,
}, null, 1));
