# Font động — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tải font lên (file từ máy hoặc Google Fonts) ở Cài đặt › Font hoặc qua MCP, dùng ngay
trong bản nháp, lên site thật khi Publish. Sau lần deploy đầu, thêm font không cần build lại.
Ba họ font của gói MaiMoney chuyển vào kho này.

**Architecture:** File font là `Asset` (kho S3 sẵn có, khoá theo nội dung). Hai bảng mới,
`FontFamily` và `FontFace`, giữ metadata. Mỗi họ sở hữu một hàng `Token` hạng `font`. CSS
`@font-face` sinh từ DB thành `<style data-mm-fonts>`: bản nháp đọc DB qua `unstable_cache`
tag `fonts`, site thật đọc bản niêm phong `Release.fonts`. File phục vụ qua route cùng nguồn
`/mm-font/<key>`.

**Tech Stack:** Next.js 15.5 App Router, Prisma 6 + Postgres, vitest, Playwright, `fontkit`
(đọc metadata), `subset-font` (harfbuzz wasm, cắt bộ chữ và xuất woff2).

**Spec:** `docs/superpowers/specs/2026-10-16-dynamic-fonts-design.md` (bản sửa đã duyệt
11/11/2026). Đọc spec trước. Plan này chỉ ghi những quyết định spec chưa chốt (tên file,
chữ ký hàm, test). Mục spec được trích bằng "§".

**Thay cho:** `docs/superpowers/plans/2026-10-16-dynamic-fonts.md` (viết trước 47 commit, đã cũ).

## Global Constraints

- Nhánh `feat/dynamic-fonts` tách từ `main`. Commit theo Conventional Commits, tiếng Việt
  không dấu (ví dụ `feat(fonts): ...`). Mỗi task một commit, trừ khi task ghi khác.
- Cổng trước khi coi một task là xong: `pnpm typecheck && pnpm lint && pnpm test`. Task
  chạm tool AI hoặc docs sinh tự động thì chạy thêm `pnpm mcp:snapshot`, `pnpm docs:gen`,
  rồi `pnpm docs:check`.
- Không sửa tay file sinh tự động (`mcp/contract.snapshot.json`, `docs/generated/**`).
- Không publish trên môi trường thật. Publish là việc của người dùng.
- Trần một file: `MAX_ASSET_BYTES` = 10 MB (`src/lib/builder/upload-asset.ts:43`).
- Cắt bộ chữ: tối đa **30 giây** mỗi lần, quá thì `too_large`.
- Google Fonts: mỗi request tối đa **10 giây**, tối đa **60 file** mỗi lần nhập.
- `/mm-font`: chỉ nhận khoá prefix `public/`, đuôi `woff2|woff|ttf|otf`, không có `..`, `//`,
  `\`. Header `Cache-Control: public, max-age=31536000, immutable`, có `ETag`.
- Mã lỗi → HTTP (§10): `not_font` 415, `collection_unsupported` 415, `too_large` 413,
  `name_required` 422, `name_reserved` 409, `slug_taken` 409, `license_required` 422,
  `google_not_found` 404, `google_unreachable` 502, `in_use` 409. Thêm `bad_fallback` 422
  (fallback không qua `isSafeTokenValue`, quyết định của plan). Lời nhắn tiếng Việt, nói rõ
  cách xử lý.
- Fallback mặc định (§7.4): sans `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  serif `Georgia, "Times New Roman", serif`; mono `ui-monospace, Menlo, Consolas, monospace`.
- Glyph kiểm tiếng Việt: `ạ ả ã ế ộ ữ ơ ư Ư Đ`. **Không** kiểm `₫` (§7.1).
- Lời nhắn `google_unreachable`: *"Server không kết nối được Google Fonts. Hãy tải font về
  máy rồi dùng mục Tải file font."*
- Mọi thao tác ghi font: ghi `AuditLog` và gọi `revalidateTag('fonts')`.

## Review Focus

1. **Tên họ chỉ khác hoa thường với họ đã có** ("GILROY" khi đã có "gilroy"): phải thêm face
   vào họ cũ, không tạo họ mới, không lỗi `slug_taken`. Test ở Task 6.
2. **Tên họ có ký tự lạ** (nháy kép, `\`, `</style>`, chữ có dấu) đọc từ bảng name của file:
   CSS sinh ra vẫn hợp lệ và không thoát khỏi `<style>`. Test ở Task 3.
3. **Release tạo trước tính năng** (`fonts = null`) và release có JSON `fonts` hỏng: trang
   site vẫn render, chỉ không có `data-mm-fonts`. Test ở Task 3 (`fontSealOf`) và Task 9.
4. **Thay hoặc xoá face** mà file cũ vẫn nằm trong `Release.fonts` của một release cũ: file
   không bị dọn khỏi S3 khi đổ thùng rác. Test ở Task 9.
5. **`dryRun` không bao giờ ghi gì**: không `putObject`, không hàng DB, không audit. Test ở
   Task 6.

---

## Cấu trúc file

```
src/lib/fonts/
  types.ts            FontSeal, FontError, mã lỗi/cảnh báo, kiểu input/output dùng chung
  unicode.ts          tập ký tự cắt + unicode-range + glyph kiểm tiếng Việt
  css.ts              FontSeal → @font-face (thuần)
  builtin.ts          Inter của lõi + tên họ dành riêng
  inspect.ts          fontkit → metadata + cảnh báo
  convert.ts          subset-font → woff2
  seal.ts             DB → FontSeal; bản nháp có cache; đọc Release.fonts an toàn
  usage.ts            token đang được dùng ở trang/component nào (dùng chung với design-tokens)
  service.ts          thêm/thay/xoá face, sửa/xoá họ, đồng bộ token, audit, revalidate
  google-parse.ts     đọc phản hồi css2 (thuần)
  google.ts           gọi css2 + tải file
  adopt.ts            đọc @font-face của một file CSS → kế hoạch nhận vào kho (thuần)
src/app/api/fonts/route.ts                    GET, POST
src/app/api/fonts/[id]/route.ts               PATCH, DELETE
src/app/api/fonts/[id]/faces/[faceId]/route.ts DELETE
src/app/mm-font/[...key]/route.ts             GET
src/app/(builder)/builder/settings/fonts/page.tsx
src/components/builder/SettingsTabs.tsx
src/components/builder/fonts/{FontList,FontRow,FontUploadDialog,GoogleFontDialog}.tsx
src/lib/ai/font-tools.ts                      list_fonts, upload_font
scripts/fonts-adopt.ts
tests/fixtures/fonts/                         (sinh trong test từ public/fonts, xem Task 4)
```

---

### Task 1: Thư viện, nhận dạng TTF/OTF/TTC, bảng mới

**Files:**
- Modify: `package.json` (`fontkit`, `subset-font`, `@types/fontkit` nếu cần), `next.config.mjs`
- Modify: `src/lib/assets/sniff.ts:157-160`, `src/lib/assets/kind.ts:128-134`
- Modify: `prisma/schema.prisma` (thêm `FontFamily`, `FontFace`, `Release.fonts`, quan hệ ngược `Asset.fontFaces`)
- Create: `prisma/migrations/<ts>_dynamic_fonts/migration.sql`
- Test: `src/lib/assets/sniff.test.ts` (thêm ca)

**Interfaces:**
- Produces: `sniff()` trả `{ mime: 'font/ttf' }` cho `00 01 00 00` và `true`, `{ mime: 'font/otf' }`
  cho `OTTO`, `{ mime: 'font/collection' }` cho `ttcf`. Bảng Prisma đúng như §4.

- [ ] **Step 1: Viết test hỏng** trong `sniff.test.ts`:
  `it('nhận TTF, OTF, TTC')`: `sniff(bytes([0,1,0,0, ...pad]))?.mime === 'font/ttf'`;
  `ascii('true')` → `'font/ttf'`; `ascii('OTTO')` → `'font/otf'`; `ascii('ttcf')` →
  `'font/collection'`. Ca cũ woff/woff2 giữ nguyên.
- [ ] **Step 2:** `pnpm vitest run src/lib/assets/sniff.test.ts`, thấy 4 ca mới FAIL.
- [ ] **Step 3: Sửa `sniff.ts`**: thêm ba nhánh ngay sau woff/woff2, giữ comment, sửa câu
  "Có sẵn ở đây để việc nhập file font sau này..." thành mô tả hiện tại. Thêm
  `'font/ttf', 'font/otf'` vào `UPLOAD_ACCEPT`. **Không** thêm `font/collection`: TTC bị
  từ chối ở module font (`collection_unsupported`), Thư viện cũng không nhận. Sửa lời nhắn
  415 trong `upload-asset.ts` (liệt kê thêm TTF, OTF).
- [ ] **Step 4:** Test pass.
- [ ] **Step 5: Schema + migration.** Thêm đúng hai model ở §4, `Release.fonts Json?`, và
  `fontFaces FontFace[]` trên `Asset`. Chạy `pnpm exec prisma migrate dev --create-only --name dynamic_fonts`.
  Nếu lệnh đòi reset vì DB local có migration lạ, viết SQL bằng tay theo
  `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
  rồi `pnpm exec prisma migrate deploy`. **Không reset DB.** Nếu `migrate deploy` bị chặn
  quyền, nhờ người dùng chạy `! pnpm exec prisma migrate deploy`.
- [ ] **Step 6: Thư viện.** `pnpm add fontkit subset-font`. Trong `next.config.mjs` thêm
  `serverExternalPackages: ['fontkit', 'subset-font', 'harfbuzzjs']` và
  `outputFileTracingIncludes: { '/api/fonts': ['./node_modules/**/harfbuzzjs/*.wasm', './node_modules/**/wawoff2/**/*.wasm'] }`.
  Đường wasm chính xác: xem `node_modules/subset-font/package.json` → phụ thuộc thật, chỉnh
  glob cho khớp. Kiểm thật ở Task 15.
- [ ] **Step 7:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 8: Commit** `feat(fonts): bang FontFamily/FontFace, nhan dang TTF/OTF/TTC`.

---

### Task 2: Hạng token `font`

**Files:**
- Modify: `src/lib/setup/design-tokens.ts:38-56` (`categorize`) và hàm nhập (cập nhật hạng hàng cũ)
- Modify: `src/lib/builder/token-kinds.ts` (comment dòng 25 không còn đúng)
- Test: `src/lib/setup/design-tokens.test.ts` (tạo nếu chưa có)

**Interfaces:**
- Produces: `categorize(name: string, value?: string): { category; group }`. Trả `'font'`
  khi tên khớp `/^(lv-)?font-/` **và** giá trị là font stack, hoặc khi không có giá trị mà
  tên không khớp `/^(lv-)?font-(size|weight|leading)/`. Còn lại giữ luật cũ.

- [ ] **Step 1: Test hỏng:**
  - `categorize('font-body', '"Inter Variable", system-ui')` → `'font'`
  - `categorize('lv-font-head', 'gilroy, Arial, sans-serif')` → `'font'`
  - `categorize('font-size-l', '1.25rem')` → `'typography'`
  - `categorize('weight-bold', '700')` → `'typography'`
  - `categorize('color-ink', '#000')` → `'color'`
  - "Font stack" = không bắt đầu bằng chữ số, `var(` hay `calc(`.
- [ ] **Step 2:** Test FAIL.
- [ ] **Step 3:** Sửa `categorize`; truyền `value` ở mọi chỗ gọi. Trong `importDesignTokens`,
  hàng đã có mà hạng tính ra khác thì `update` cả `category`, kể cả hàng không đổi giá trị.
- [ ] **Step 4: Test cập nhật hàng cũ:** gọi `importDesignTokens` với DB mock (theo cách test
  sẵn có của file, nếu có) hoặc tách phần "tính thay đổi" thành hàm thuần
  `planTokenUpdates(existing, parsed)` rồi test: hàng `font-body` hạng `typography` → có
  update `category: 'font'`.
- [ ] **Step 5:** Pass, cổng CI, commit `feat(fonts): token font-* mang hang font`.

---

### Task 3: Kiểu dùng chung, tập ký tự, sinh CSS, Inter có sẵn

**Files:**
- Create: `src/lib/fonts/types.ts`, `unicode.ts`, `css.ts`, `builtin.ts`, `seal.ts` (chỉ phần thuần `fontSealOf`)
- Test: `src/lib/fonts/css.test.ts`, `builtin.test.ts`, `seal.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type FontStyle = 'normal' | 'italic';
  export type FontSource = 'upload' | 'google';
  export interface FontSealFace { key: string; weight: string; style: FontStyle; unicodeRange: string }
  export interface FontSealFamily { slug: string; cssName: string; faces: FontSealFace[] }
  export interface FontSeal { families: FontSealFamily[] }
  export const EMPTY_FONT_SEAL: FontSeal;
  export type FontErrorCode = 'not_font' | 'collection_unsupported' | 'too_large' | 'name_required'
    | 'name_reserved' | 'slug_taken' | 'license_required' | 'google_not_found'
    | 'google_unreachable' | 'in_use' | 'bad_fallback';
  export const FONT_ERROR_STATUS: Record<FontErrorCode, number>;
  export class FontError extends Error { constructor(code: FontErrorCode, message: string, extra?: Record<string, unknown>); code; status; extra }
  export type FontWarningCode = 'missing_vietnamese' | 'restricted_embedding';
  export const FONTS_TAG = 'fonts';
  export const FALLBACKS: { sans: string; serif: string; mono: string };
  ```
- Produces (`unicode.ts`): `SUBSET_UNICODE_RANGE: string` (chuỗi `unicode-range` CSS, hợp
  của latin + latin-ext + vietnamese theo Google, gồm các dải ở §7.2), `SUBSET_CODEPOINTS: number[]`
  (cùng tập, dạng số, cho `subset-font`), `VIETNAMESE_PROBE: string` (`'ạảãếộữơưƯĐ'`).
- Produces (`css.ts`): `fontFaceCss(seal: FontSeal): string`, `cssFamilyName(name: string): string`.
- Produces (`builtin.ts`): `BUILTIN_FAMILIES: readonly BuiltinFamily[]` với
  `BuiltinFamily = { cssName: string; tokens: string[]; weight: string; faces: { url: string; unicodeRange: string }[] }`,
  `builtinFontFaceCss(): string`, `isReservedFamilyName(name: string): boolean`.
- Produces (`seal.ts`): `fontSealOf(json: unknown): FontSeal`. Parse bằng zod; face hoặc họ
  sai hình dạng thì bỏ riêng nó, không ném; `null`/`undefined` → `EMPTY_FONT_SEAL`.

- [ ] **Step 1: Test hỏng `css.test.ts`:**
  - một họ hai face → hai khối `@font-face`, có `font-display: swap;`,
    `src: url("/mm-font/public/builder/x-ab12cd34.woff2") format("woff2");`
  - `unicodeRange: ''` → không có dòng `unicode-range`
  - tên `Be "Vietnam" \ Pro` → `font-family: "Be \"Vietnam\" \\ Pro";`
  - tên chứa `</style>` → đầu ra không chứa chuỗi `</style` (escape `<` thành `\3c `)
  - khoá chứa `"` hoặc `)` → face đó bị bỏ
  - `fontFaceCss(EMPTY_FONT_SEAL) === ''`
  - hai lần gọi với họ xáo thứ tự ra cùng chuỗi (sắp theo `slug`, rồi `weight`, `style`, `unicodeRange`)
- [ ] **Step 2: Test hỏng `builtin.test.ts`:**
  - đọc `src/styles/base/typography.css`, lấy mọi `@font-face` (font-family, src url,
    unicode-range): tập (url, unicodeRange) của `BUILTIN_FAMILIES` khớp đúng.
  - đọc `src/styles/tokens.css`, lấy tên họ trong giá trị `--font-display`, `--font-body`,
    `--font-mono`: mọi tên đều `isReservedFamilyName` → `true`.
  - `isReservedFamilyName('INTER')`, `('sans-serif')`, `('system-ui')` → `true`;
    `('gilroy')`, `('SF Pro Display')`, `('Be Vietnam Pro')` → `false`.
- [ ] **Step 3: Test hỏng `seal.test.ts`** (`fontSealOf`): `null` → rỗng; `{families:'x'}` →
  rỗng; một họ thiếu `slug` bị bỏ, họ còn lại giữ nguyên; face có `style: 'oblique'` bị bỏ.
- [ ] **Step 4:** Ba file test FAIL.
- [ ] **Step 5:** Viết bốn module. `isReservedFamilyName` so chữ thường với: tên trong
  `BUILTIN_FAMILIES` (gồm cả "Inter"), danh sách tên dự phòng trong `tokens.css` của lõi (hằng
  số, test giữ khớp), từ khoá chung `serif, sans-serif, monospace, cursive, fantasy, system-ui,
  ui-sans-serif, ui-serif, ui-monospace, ui-rounded, emoji, math, fangsong, inherit, initial,
  unset, revert, -apple-system, blinkmacsystemfont`.
- [ ] **Step 6:** Pass, cổng CI, commit `feat(fonts): FontSeal, sinh @font-face, Inter co san`.

---

### Task 4: Đọc metadata font

**Files:**
- Create: `src/lib/fonts/inspect.ts`
- Create: `tests/fixtures/fonts/make-fixtures.ts` (helper test, không phải binary)
- Test: `src/lib/fonts/inspect.test.ts`

**Interfaces:**
- Consumes: `sniff`, `FontError`, `VIETNAMESE_PROBE`.
- Produces:
  ```ts
  export interface InspectResult {
    format: 'woff2' | 'woff' | 'ttf' | 'otf';
    family: string | null;     // name ID 16, không có thì ID 1
    weight: string;            // "400" hoặc "100 900" khi có trục wght
    style: FontStyle;
    variable: boolean;
    warnings: FontWarningCode[];
  }
  export function inspectFont(bytes: Uint8Array): InspectResult; // ném FontError
  ```

**Fixture:** không commit file font nhị phân mới. Helper đọc `public/fonts/inter-*.woff2`
(OFL, đã có trong repo) rồi dùng `subset-font` (`targetFormat: 'truetype'`) để sinh TTF trong
bộ nhớ. Bản "cấm nhúng" sinh bằng cách vá 2 byte `fsType` (offset 8 trong bảng `OS/2`) của
TTF đó thành `0x0002`. Bản "thiếu tiếng Việt": `inter-latin-wght-normal.woff2` (chỉ latin).

- [ ] **Step 1: Test hỏng:**
  - `inter-vietnamese.woff2` → `format 'woff2'`, `variable true`, `weight '100 900'`,
    `style 'normal'`, không có `missing_vietnamese`. `family`: chép giá trị fontkit đọc
    được lần đầu vào test, sau khi xác nhận nó đến từ name ID 16 nếu file có ID 16.
  - `inter-latin-wght-normal.woff2` → `warnings` chứa `missing_vietnamese`.
  - TTF sinh từ Inter → `format 'ttf'`.
  - TTF đã vá `fsType` → `warnings` chứa `restricted_embedding`.
  - byte `ttcf...` → ném `FontError` mã `collection_unsupported`.
  - PNG 1×1 → `not_font`; mảng 10 MB + 1 byte → `too_large`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Viết `inspectFont` bằng `fontkit.create(Buffer)`. Italic = bit 0 của
  `OS/2.fsSelection` hoặc `post.italicAngle !== 0`. `missing_vietnamese` = có glyph nào trong
  `VIETNAMESE_PROBE` mà `font.hasGlyphForCodePoint` trả `false`.
- [ ] **Step 4:** Pass, commit `feat(fonts): doc metadata font bang fontkit`.

---

### Task 5: Cắt bộ chữ, xuất woff2

**Files:**
- Create: `src/lib/fonts/convert.ts`
- Test: `src/lib/fonts/convert.test.ts`

**Interfaces:**
- Produces: `toWoff2(bytes: Uint8Array, format: InspectResult['format'], opts?: { timeoutMs?: number }): Promise<{ bytes: Uint8Array; unicodeRange: string }>`.
  `format === 'woff2'` → trả nguyên byte, `unicodeRange: ''`. Còn lại → `subset-font` với
  `SUBSET_CODEPOINTS`, `targetFormat: 'woff2'`, giữ trục variable, giữ tính năng OpenType mặc
  định; `unicodeRange: SUBSET_UNICODE_RANGE`. Quá `timeoutMs` (mặc định 30000) → `FontError('too_large', …)`
  kèm gợi ý dùng woff2 đã cắt sẵn.

- [ ] **Step 1: Test hỏng:**
  - woff2 vào → byte ra `===` byte vào (cùng tham chiếu hoặc `Buffer.equals`), range rỗng.
  - TTF sinh từ `inter-vietnamese.woff2` bằng helper Task 4 → ra bắt đầu bằng `wOF2`;
    `inspectFont(ra)` không có `missing_vietnamese`; vẫn `variable true`.
  - `timeoutMs: 1` → ném `too_large`.
- [ ] **Step 2–4:** FAIL → viết → pass.
- [ ] **Step 5: Commit** `feat(fonts): cat bo chu va xuat woff2`.

---

### Task 6: Dịch vụ font, đếm chỗ dùng, bản niêm phong từ DB

**Files:**
- Create: `src/lib/fonts/usage.ts`, `src/lib/fonts/service.ts`
- Modify: `src/lib/fonts/seal.ts` (thêm phần đọc DB)
- Modify: `src/app/api/design-tokens/[id]/route.ts` (dùng `tokenUsage`, chặn token của họ font)
- Test: `src/lib/fonts/service.test.ts`, `src/lib/fonts/usage.test.ts`

**Interfaces:**
- Consumes: `inspectFont`, `toWoff2`, `uploadAsset` (`src/lib/builder/upload-asset.ts:76`),
  `isSafeTokenValue`, `isReservedFamilyName`, `FONTS_TAG`.
- Produces (`seal.ts`):
  `readFontSeal(db?: Prisma.TransactionClient | PrismaClient): Promise<FontSeal>` (không cache),
  `draftFontSeal(): Promise<FontSeal>` (`unstable_cache`, tag `FONTS_TAG`),
  `draftFontFaceCss(): Promise<string>`.
- Produces (`usage.ts`):
  `interface UsageRef { id: string; title: string; href: string }`,
  `tokenUsage(name: string): Promise<{ pages: UsageRef[]; components: UsageRef[] }>`. Quét
  bản nháp và bản live của trang (chuyển nguyên `pagesUsing` ra đây) và của component (bảng
  `Preset`: `tree` nháp + `Release.components` của release đang active). Tìm chuỗi
  `"$token":"<name>"` trên JSON compact như cũ. `href` của trang là `/builder/<pageId>`, của
  component là `/builder/components/<id>`.
- Produces (`service.ts`):
  ```ts
  export interface Actor { email: string; sub: string }
  export interface AddFaceInput {
    bytes: Uint8Array; fileName: string;
    family?: string; weight?: string; style?: FontStyle;
    fallback?: string;                 // chuỗi đã chọn; mặc định FALLBACKS.sans
    licenseConfirmed: boolean; licenseNote?: string;
    dryRun?: boolean;
    source?: FontSource;               // mặc định 'upload'
    googleFamily?: string;
    prepared?: { unicodeRange: string; subset: string };  // file Google: bỏ bước cắt
    adoptToken?: boolean;              // chỉ script adopt: nhận lại token tự tạo cùng tên
  }
  export interface FontUploadResult {   // đúng hình dạng phản hồi POST ở §10
    ok: true; dryRun: boolean;
    family: { id?: string; slug: string; cssName: string; token: string; created: boolean };
    faces: { weight: string; style: FontStyle; subset: string; bytes: number; replaced: boolean }[];
    warnings: { code: FontWarningCode; message: string }[];
  }
  export function slugify(cssName: string): string;
  export function addFace(input: AddFaceInput, actor: Actor): Promise<FontUploadResult>;
  export function updateFamily(id: string, patch: { cssName?: string; fallback?: string; licenseNote?: string | null }, actor: Actor): Promise<void>;
  export function deleteFace(familyId: string, faceId: string, actor: Actor): Promise<void>;
  export function deleteFamily(id: string, actor: Actor): Promise<void>;
  export function listFonts(): Promise<FontListItem[]>;  // dữ liệu cho GET /api/fonts và list_fonts
  export interface FontListItem {
    id: string | null; cssName: string; token: string; source: 'builtin' | FontSource;
    fallback: string; faces: { id: string | null; weight: string; style: FontStyle; subset: string; bytes: number | null; warnings: FontWarningCode[] }[];
    usage: { pages: UsageRef[]; components: UsageRef[] };
    unpublished: boolean; licenseNote: string | null; licenseConfirmedBy: string | null;
  }
  ```
  Luật bám §4, §7.1 bước 6, §9, §10: tên họ so không phân biệt hoa thường; `name_reserved`
  dùng `isReservedFamilyName` hoặc trùng `cssName` của họ khác; `slug_taken` khi token
  `font-<slug>` đã tồn tại mà không thuộc họ nào (trừ khi `adoptToken` và hàng đó
  `custom: true`, khi đó gắn vào họ, đổi hạng `font`, **giữ `value`**); thiếu
  `licenseConfirmed` với `source: 'upload'` → `license_required`; fallback không qua
  `isSafeTokenValue` → `bad_fallback`. Token mới: `value = "<cssName escaped>", <fallback>`,
  `category 'font'`, `custom true`, `aiDescription` theo §4. Đổi `cssName` thì cập nhật
  `value` của token (giữ phần fallback). File lưu vào thư mục `fonts/<slug>`. Ghi DB trong một
  transaction; audit `font.face.add|replace|delete`, `font.family.update|delete`. `unpublished`
  = phần seal của họ khác phần của họ cùng slug trong `Release.fonts` của release đang active.
  `deleteFamily` cần quyền admin, kiểm ở route.
- `design-tokens/[id]` DELETE: token thuộc một `FontFamily` → 409 `"<tên>" thuộc họ font, xoá ở Cài đặt › Font.`;
  thông báo "còn dùng" giờ liệt kê cả component.

**Test** dùng mock Prisma theo mẫu sẵn có trong repo (tìm test nào đang mock `@/lib/db`,
vd. `src/lib/builder/*.test.ts`) và mock `uploadAsset`.

- [ ] **Step 1: Test hỏng `service.test.ts`:**
  - họ mới: tạo `FontFamily`, `FontFace`, `Token` `font-be-vietnam-pro` hạng `font`, `created: true`
  - `slugify('Bé Việt Nam Pro')` → `'be-viet-nam-pro'`
  - **(Review Focus 1)** đã có họ `gilroy`, tải face tên họ `GILROY` → thêm face vào họ cũ, `created: false`
  - trùng `(weight, style, unicodeRange)` → thay `assetId`, `replaced: true`, không tạo face mới
  - `family: 'Inter'` → `FontError name_reserved`
  - token `font-x` tĩnh đã có → `slug_taken`; với `adoptToken` và token tự tạo → nhận lại, `value` không đổi
  - thiếu `licenseConfirmed` (upload) → `license_required`; nguồn google → không cần
  - `fallback: 'x; }'` → `bad_fallback`
  - **(Review Focus 5)** `dryRun: true` → `uploadAsset`, `prisma.*.create|update`, `auditLog.create` đều **không** được gọi; kết quả vẫn có `family.slug`, `faces`, `warnings`
  - `deleteFace` face cuối của họ đang dùng (`tokenUsage` trả 1 trang) → `in_use`
  - `deleteFamily` họ đang dùng → `in_use`, `extra.usage` có danh sách
  - mọi thao tác ghi gọi `revalidateTag('fonts')` (mock `next/cache`)
- [ ] **Step 2: Test hỏng `usage.test.ts`:** trang nháp dùng, trang chỉ release live dùng,
  component nháp dùng → đếm đủ ba; trang lưu trữ (`archivedAt`) không tính.
- [ ] **Step 3:** FAIL → viết → pass.
- [ ] **Step 4:** Cổng CI, commit `feat(fonts): dich vu font, dem cho dung token`.

---

### Task 7: API font và route `/mm-font`

**Files:**
- Create: `src/app/api/fonts/route.ts`, `src/app/api/fonts/[id]/route.ts`,
  `src/app/api/fonts/[id]/faces/[faceId]/route.ts`, `src/app/mm-font/[...key]/route.ts`
- Modify: `src/lib/auth/service-scope.ts` (cho phép `POST /api/fonts`, `GET /api/fonts`)
- Test: `src/app/mm-font/[...key]/route.test.ts`, `src/app/api/fonts/route.test.ts`

**Interfaces:**
- Consumes: `addFace`, `updateFamily`, `deleteFace`, `deleteFamily`, `listFonts`, `getObject` (`src/lib/assets/s3.ts:138`), `requireAuth`.
- Produces: các route ở §10. `POST` nhận multipart (`file`, `family?`, `weight?`, `style?`,
  `fallback?` (`sans|serif|mono|<chuỗi>`), `licenseConfirmed` (`'true'`), `licenseNote?`,
  `dryRun?`) hoặc JSON `{ sourceUrl, … }` hay `{ google: { family, weights?, italic? }, … }`
  (nhánh google nối ở Task 8; tới lúc đó trả 501). `FontError` → `{ error: message, code }` với
  `FONT_ERROR_STATUS[code]`. `sourceUrl`: tải bằng hàm tải URL sẵn có của `upload_asset`
  (`asset-tools.ts`), cùng trần 10 MB.
- Quyền: GET `read`, POST/PATCH/DELETE face `write`, DELETE họ `admin`.

- [ ] **Step 1: Test hỏng `/mm-font`:** mock `getObject`.
  - `public/builder/a-12345678.woff2` → 200, `content-type: font/woff2`, `cache-control` đúng hằng số, có `etag`
  - `public/../secret.woff2`, `public//a.woff2`, `public\a.woff2` → 404
  - `private/a.woff2`, `public/a.png` → 404
  - `getObject` ném (không có object) → 404
  - request có `if-none-match` trùng ETag → 304
- [ ] **Step 2: Test hỏng `/api/fonts`:** mock `requireAuth`, `addFace`:
  - POST multipart hợp lệ → 200, thân là `FontUploadResult`
  - `addFace` ném `FontError('name_reserved')` → 409, `{ code: 'name_reserved' }`
  - viewer gọi POST → 403 (theo `requireAuth`)
  - `serviceMayReach('/api/fonts', 'POST') === true`
- [ ] **Step 3:** FAIL → viết → pass.
- [ ] **Step 4:** Commit `feat(fonts): API font va route /mm-font`.

---

### Task 8: Nhập từ Google Fonts

**Files:**
- Create: `src/lib/fonts/google-parse.ts`, `src/lib/fonts/google.ts`
- Create: `src/lib/fonts/__fixtures__/css2-be-vietnam-pro.css` (phản hồi css2 thật đã lưu, rút gọn)
- Modify: `src/app/api/fonts/route.ts` (nhánh `google`)
- Test: `src/lib/fonts/google-parse.test.ts`, `src/lib/fonts/google.test.ts`

**Interfaces:**
- Produces: `parseGoogleCss(css: string): { subset: string; weight: string; style: FontStyle; unicodeRange: string; url: string }[]`
  (chỉ giữ `vietnamese`, `latin-ext`, `latin`);
  `parseGoogleFamily(input: string): string` (nhận tên hoặc link `fonts.google.com/specimen/Be+Vietnam+Pro`);
  `importGoogleFamily(req: { family: string; weights?: number[]; italic?: boolean; fallback?: string; dryRun?: boolean }, actor: Actor, fetchImpl?: typeof fetch): Promise<FontUploadResult>`.
  Thứ tự gọi, User-Agent, giới hạn và mã lỗi đúng §8. Mỗi file gọi
  `addFace({ …, source: 'google', googleFamily, licenseConfirmed: true, licenseNote: 'Google Fonts (OFL/Apache)', prepared: { unicodeRange, subset } })`.
  `dryRun` không tải file woff2, chỉ trả danh sách face.

- [ ] **Step 1: Test hỏng `google-parse`:** fixture có 5 khối (cyrillic, vietnamese,
  latin-ext, latin, greek) → ra 3 face, đúng `unicodeRange` và URL `fonts.gstatic.com`;
  `parseGoogleFamily('https://fonts.google.com/specimen/Be+Vietnam+Pro')` → `'Be Vietnam Pro'`.
- [ ] **Step 2: Test hỏng `google`** với `fetchImpl` giả:
  - css2 variable trả 200 → một lượt gọi css2, các file được `addFace`
  - variable 400, từng weight: 400 và 700 trả 200 → chỉ hai tổ hợp đó
  - mọi tổ hợp 400 → `google_not_found`
  - `fetchImpl` ném hoặc quá 10 giây → `google_unreachable` với đúng lời nhắn ở Global Constraints
  - 61 file → chỉ nhập 60, kết quả có cảnh báo
- [ ] **Step 3:** FAIL → viết → pass. Nối nhánh `google` vào `POST /api/fonts`.
- [ ] **Step 4:** Commit `feat(fonts): nhap font tu Google Fonts`.

---

### Task 9: Phát CSS font: bản nháp, niêm phong khi Publish, site thật, giữ file

**Files:**
- Modify: `src/app/(render)/render/[pageId]/page.tsx:82-100`, `src/app/(render)/render/component/[id]/page.tsx:53-70`,
  `src/app/(site)/preview/[pageId]/page.tsx:227-256` (in `<style data-mm-fonts>` bằng `draftFontFaceCss()`, ngay trước `data-mm-tokens`)
- Modify: `src/app/api/publish/route.ts:218-265` (chụp `fonts: await readFontSeal(tx)` trong transaction, ghi `Release.fonts`)
- Modify: `src/lib/render/page.ts` (`PublishedPage.fonts: FontSeal`, select `fonts`, `fontSealOf(entry.release.fonts)`)
- Modify: `src/app/(site)/PublishedPageView.tsx:160-215`, `src/app/(site)/preview/release/[id]/page.tsx:89-120` (in `fontFaceCss(page.fonts)`)
- Modify: `src/lib/builder/asset-references-scan.ts` (`ReleaseSource.fonts`, `ReferenceSources.fontFaces`), `src/lib/builder/asset-references.ts:80-141` (nạp hai nguồn đó)
- Test: `src/lib/builder/asset-references-scan.test.ts` (thêm ca), `src/lib/render/release-snapshot.test.ts` hoặc test mới cho `page.ts`

**Interfaces:**
- Consumes: `draftFontFaceCss`, `readFontSeal`, `fontSealOf`, `fontFaceCss`.
- Produces: `PublishedPage.fonts: FontSeal`. Nguồn quét asset mới: face đang có trong
  `FontFace` là "đang dùng" ở bản nháp; khoá trong `Release.fonts` của release live là "site
  thật đang dùng", của release cũ là "đích rollback" (cùng cách `tokens` đang được xếp). Khớp
  khoá → id qua `ScanContext` sẵn có.

- [ ] **Step 1: Test hỏng (Review Focus 4)** trong `asset-references-scan.test.ts`: asset có
  khoá nằm trong `oldReleases[0].fonts.families[0].faces[0].key` và không còn trong
  `fontFaces` → usage có mục rollback (đúng như ca `tokens` hiện có làm); khoá nằm trong
  `fontFaces` → usage nháp.
- [ ] **Step 2: Test hỏng (Review Focus 3)** cho đường site: `loadFromRelease` với
  `release.fonts = null` → `page.fonts` là `EMPTY_FONT_SEAL`; với `fonts = 'rác'` → cũng rỗng,
  không ném. Và `fontFaceCss(EMPTY_FONT_SEAL) === ''` nên view không in thẻ `data-mm-fonts`.
- [ ] **Step 3:** FAIL → viết. Thẻ chỉ in khi chuỗi khác rỗng, giống `tokenCss`.
- [ ] **Step 4:** Pass, cổng CI.
- [ ] **Step 5: Kiểm tay trên dev** (`pnpm dev`, `QUILDER_PROJECT=maimoney`): tải một font
  qua `curl -F` vào `POST /api/fonts`, gán token cho một node bằng MCP `apply_ops`, mở
  `/render/<pageId>`: có `<style data-mm-fonts>` và `document.fonts.check('16px "<tên>"')` là
  `true`. **Không** Publish trên staging.
- [ ] **Step 6: Commit** `feat(fonts): phat @font-face o ban nhap, niem phong khi publish`.

---

### Task 10: Màn Cài đặt › Font

**Files:**
- Create: `src/components/builder/SettingsTabs.tsx` (theo mẫu `AccountTabs.tsx`, tab `general` → `/builder/settings`, `fonts` → `/builder/settings/fonts`)
- Create: `src/app/(builder)/builder/settings/fonts/page.tsx`
- Create: `src/components/builder/fonts/FontList.tsx`, `FontRow.tsx`, `FontUploadDialog.tsx`, `GoogleFontDialog.tsx`
- Modify: `src/app/(builder)/builder/settings/page.tsx` (thêm `SettingsTabs current="general"`)
- Test: `e2e/fonts.spec.ts` (phần màn hình; phần còn lại ở Task 15)

**Interfaces:**
- Consumes: `listFonts()` (server), `GET/POST/PATCH/DELETE /api/fonts…` (client),
  `draftFontFaceCss()` + `builtinFontFaceCss()` in vào trang để chữ xem trước đúng font.
- Bố cục, chữ, hành vi: đúng §11.1–11.4 và khung ASCII ở §11.2. Chữ xem trước:
  `Tiền về nhanh — Ắ ẩ ữ ộ ₫ 0123`. Dòng ⓘ: `Sửa font hiện ngay trong builder; site thật đổi sau lần Publish tới.`
  Dùng component sẵn có ở `src/components/builder/ui/` và ô kéo thả của
  `src/components/builder/transfer/`. Nút theo quyền: không có `write` thì ẩn hai nút tải
  lên, không phải `admin` thì không thấy "Xoá họ".

- [ ] **Step 1: Test e2e hỏng** `e2e/fonts.spec.ts` › `màn Font liệt kê Inter chỉ đọc`: đăng
  nhập admin, mở `/builder/settings/fonts`, thấy hàng `Inter Variable` có chữ `chỉ đọc`, thấy
  hai nút `Nhập từ Google Fonts`, `Tải file font`; tab `Chung` dẫn về `/builder/settings`.
- [ ] **Step 2: Test e2e hỏng** › `tải TTF lên`: dùng `page.setInputFiles` với TTF sinh từ
  helper Task 4 (ghi ra thư mục tạm), tick giấy phép, Lưu → có hàng mới, token
  `font-<slug>` hiển thị, nhãn `Chưa publish`.
- [ ] **Step 3:** FAIL (`pnpm e2e:test -- fonts`) → dựng màn hình → pass.
- [ ] **Step 4:** Chụp màn hình 1440 để người dùng xem (lưu vào scratchpad, không commit).
- [ ] **Step 5: Commit** `feat(fonts): man Cai dat > Font`.

---

### Task 11: Ô chọn họ font trong Inspector

**Files:**
- Modify: `src/components/builder/controls.tsx` (thêm `FontFamilyControl`)
- Modify: `src/components/builder/Inspector.tsx:750` (đặt đầu mục "Chữ")
- Modify: chỗ vỏ builder in CSS chung (tìm nơi `EditorShell`/layout builder nạp style) để in
  `draftFontFaceCss()` + `builtinFontFaceCss()` cho danh sách xem trước
- Test: `src/components/builder/controls.font.test.tsx`

**Interfaces:**
- Consumes: `tokensOfKind(tokens, 'font')`, `useSetStyle(node, breakpoint, 'typography', 'family')`.
- Produces: `FontFamilyControl(props: Common)`: `<select>` liệt kê token hạng `font`, nhãn là
  tên họ đầu tiên trong `value` của token (bỏ nháy), `style={{ fontFamily: value }}` cho từng
  option nếu trình duyệt hỗ trợ; giá trị ghi là `{ $token: name }`; mục rỗng = bỏ đặt. Dưới ô
  có link `Quản lý font →` tới `/builder/settings/fonts`.

- [ ] **Step 1: Test hỏng** (testing-library, theo mẫu test component sẵn có): với 3 token
  (`font-body` hạng font, `font-gilroy` hạng font, `space-l` hạng space) → ô có đúng 2 lựa
  chọn, nhãn `Inter Variable` và `gilroy`; chọn `gilroy` → `setStyle` được gọi với
  `{ $token: 'font-gilroy' }`; có link `Quản lý font →`.
- [ ] **Step 2:** FAIL → viết → pass.
- [ ] **Step 3: Commit** `feat(fonts): o chon ho font trong Inspector`.

---

### Task 12: Tool MCP `list_fonts`, `upload_font`

**Files:**
- Create: `src/lib/ai/font-tools.ts` (`export const FONT_TOOLS: ToolDef[]`)
- Modify: `src/lib/ai/tools.ts:47,704` (đăng ký; sửa mô tả `search_tokens` dòng ~337 thêm hạng `font`)
- Modify: `mcp/server.mjs` (nhánh `upload_font` + `filePath` cạnh `upload_asset` ở dòng ~1187:
  đọc file, gửi multipart tới `POST /api/fonts` kèm mọi tham số, giống `uploadBuffer`)
- Modify: `mcp/README.md`; sinh lại `mcp/contract.snapshot.json` bằng `pnpm mcp:snapshot`
- Test: `src/lib/ai/font-tools.test.ts`, thêm ca vào `e2e/mcp.spec.ts`

**Interfaces:**
- Consumes: `listFonts`, `addFace`, `importGoogleFamily`.
- Produces: tham số và mô tả đúng §12.1–12.2. Phía server, `upload_font` với `filePath` trả
  lỗi như `asset-tools.ts:106-115`. Mô tả `upload_font` phải có ba câu: mỗi lần gọi một file;
  chạy `dryRun` trước cho người dùng xem; **hỏi người dùng về giấy phép, không tự điền
  `licenseConfirmed`**. Mô tả `list_fonts` có ba câu dặn ở §12.1.

- [ ] **Step 1: Test hỏng:** `upload_font` qua server với `filePath` → `{ ok: false }` có chữ
  `filePath chỉ dùng được qua MCP server`; với `google` → gọi `importGoogleFamily`; thiếu cả
  ba nguồn → lỗi; `list_fonts` trả phần tử có `source: 'builtin'` cho Inter.
- [ ] **Step 2:** FAIL → viết → pass.
- [ ] **Step 3:** `pnpm mcp:snapshot && pnpm docs:gen && pnpm docs:check`.
- [ ] **Step 4: Commit** `feat(fonts): tool MCP list_fonts va upload_font` (snapshot và docs
  sinh tự động tách commit riêng `chore(mcp): cap nhat snapshot`).

---

### Task 13: Xuất/nhập trang mang theo font

**Files:**
- Modify: `src/lib/transfer/manifest.ts` (thêm `zBundleFont`, `fonts: z.array(zBundleFont).default([])`)
- Modify: `src/lib/transfer/export.ts`, `import-plan.ts`, `commit.ts`
- Test: các file test sẵn có của `src/lib/transfer/` (thêm ca)

**Interfaces:**
- Produces: `BundleFont = { slug; cssName; fallback; source; googleFamily: string | null; licenseNote: string | null; faces: { weight; style; unicodeRange; subset; assetRef: string }[] }`.
  Luật xuất/nhập đúng §13.1–13.2 (so theo `slug`; khác ở đích thì dùng bản ở đích + mục
  "Việc cần làm sau khi nhập"; `cssName` trùng họ khác slug hoặc trùng họ có sẵn → blocker).
  Gói cũ không có `fonts` vẫn nhập được (`default([])`). Hoàn tác không xoá họ font.

- [ ] **Step 1: Test hỏng:** xuất trang dùng `font-gilroy` → `fonts` có một họ, `assetRef`
  trỏ vào `assets[]`; nhập vào đích trống → tạo họ, face, token; nhập vào đích có họ cùng slug
  thiếu weight 300 → không đổi đích, có việc cần làm chứa `thiếu weight 300`; nhập vào đích có
  họ `cssName` "Gilroy" khác slug → blocker; gói không có trường `fonts` → hợp lệ.
- [ ] **Step 2:** FAIL → viết → pass.
- [ ] **Step 3: Commit** `feat(fonts): xuat nhap trang mang theo font`.

---

### Task 14: Chuyển font của gói vào kho (`pnpm fonts:adopt`)

**Files:**
- Create: `src/lib/fonts/adopt.ts`, `scripts/fonts-adopt.ts`
- Modify: `package.json` (`"fonts:adopt": "node --env-file=.env --conditions=react-server --import tsx scripts/fonts-adopt.ts"`)
- Modify: `projects/example/README.md` (dòng 17 và 69: gói không mang file font hay `@font-face`; font thêm ở Cài đặt › Font; gói chỉ đặt biến trỏ tới tên họ)
- Test: `src/lib/fonts/adopt.test.ts`

**Interfaces:**
- Consumes: `addFace` với `adoptToken: true`, `readFontSeal`.
- Produces:
  ```ts
  export interface AdoptFace { family: string; weight: string; style: FontStyle; unicodeRange: string; url: string; file: string }
  export function parseFontFaceCss(css: string, pack: string): AdoptFace[];
  export function planAdoption(faces: AdoptFace[], existing: FontSeal, shaOf: (file: string) => string, existingShas: Map<string, Set<string>>): { family: string; slug: string; action: 'create' | 'skip'; faces: AdoptFace[] }[];
  ```
  `url` `/p/fonts/x.otf` → `file` `projects/<pack>/public/fonts/x.otf`. `font-weight` thiếu
  → `'400'`; `font-style` thiếu → `'normal'`. Script: tham số `--css <path>` (mặc định
  `projects/$QUILDER_PROJECT/styles/fonts.css`), `--actor <email>` (bắt buộc, phải là user có
  thật), `--apply`. Không `--apply` thì in kế hoạch. `licenseNote` lấy từ đoạn comment đầu
  file CSS (rút gọn ≤ 300 ký tự), `licenseConfirmed: true`, `source: 'upload'`. Giữ
  `unicode-range` từ CSS cho file woff2 (truyền qua `prepared`); file ttf/otf đi qua
  `toWoff2`. Mọi thứ khác theo §5.2.

- [ ] **Step 1: Test hỏng** với chuỗi CSS rút từ `projects/maimoney/styles/fonts.css` (chép
  vào test, vì repo gói không nằm trong CI):
  - ra 11 face, 3 họ: `SF Pro Display` (4), `newYork` (2, có một `italic`), `gilroy` (5)
  - `url("/p/fonts/gilroy-light.otf")` → `file` `projects/maimoney/public/fonts/gilroy-light.otf`
  - khối `:root { --font-display: … }` không sinh face
  - `planAdoption` lần hai (existing có đủ sha) → cả ba `skip`
- [ ] **Step 2:** FAIL → viết → pass.
- [ ] **Step 3: Chạy thử local** (DB local, bucket dev): `pnpm fonts:adopt --actor <email admin local>`
  → in kế hoạch 3 họ / 11 face. Chạy với `--apply`. Mở `/render/<trang chủ>`: chữ không đổi
  (so ảnh chụp trước/sau ở 1440), có `data-mm-fonts` với ba họ. Chạy lại `--apply` → `đã có`
  cả ba. **Không** xoá file trong gói (người dùng tự làm sau khi Publish).
- [ ] **Step 4: Commit** `feat(fonts): script chuyen font cua goi vao kho`.

---

### Task 15: E2E, bản standalone, tài liệu

**Files:**
- Modify: `e2e/fonts.spec.ts` (thêm kịch bản §16 E2E 2–5), `e2e/mcp.spec.ts`
- Modify: `docs/huong-dan/` (thêm trang hướng dẫn Font, theo kiểu các trang có sẵn), `.ai/docs/rules.md` (luật: gói không mang file font)
- Modify: `CLAUDE.md` mục "Bẫy đã gặp": một dòng về font động (gán font bằng `typography.family: {$token:'font-<slug>'}`, font mới chỉ lên site sau Publish)

- [ ] **Step 1: E2E** theo §16: bản nháp (`document.fonts.check` trong iframe canvas), Publish
  trên **stack e2e** (không phải staging) → trang site có `data-mm-fonts`, file từ `/mm-font/…`
  trả 200 + `immutable`; niêm phong (thay face, site chưa đổi, Publish rồi mới đổi); nút xoá
  họ bị khoá khi còn trang dùng; MCP `upload_font` qua `filePath` rồi `list_fonts`.
- [ ] **Step 2:** `pnpm e2e` pass.
- [ ] **Step 3: Bản standalone:** `pnpm docker:build && pnpm docker:up`, tải một TTF qua
  `curl -F file=@x.ttf -F licenseConfirmed=true` vào `POST /api/fonts` của container → 200, face
  `subset` khác rỗng. Lỗi thiếu `.wasm` thì sửa `outputFileTracingIncludes` (Task 1 Step 6)
  rồi build lại.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test && pnpm docs:check`.
- [ ] **Step 5: Commit** `docs(fonts): huong dan Font, e2e va kiem ban standalone`.

---

## Sau khi merge (người dùng làm, không thuộc agent)

Theo §5.2 và §17, ở từng môi trường: deploy → `pnpm fonts:adopt --actor <email>` rồi
`--apply` → kiểm canvas → **Publish** → xoá các khối `@font-face` trong
`projects/maimoney/styles/fonts.css` (giữ khối `:root`) và thư mục
`projects/maimoney/public/fonts/` ở repo gói → deploy gói → kiểm không còn request
`/p/fonts/`.
