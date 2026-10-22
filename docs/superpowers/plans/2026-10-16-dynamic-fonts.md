# Font động — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tải font lên (file từ máy hoặc Google Fonts) qua màn Cài đặt › Font hoặc qua Claude/MCP, dùng ngay trên bản nháp và lên site thật khi Publish — không build lại image.

**Architecture:**
- **Dữ liệu:** họ font và face lưu ở hai bảng mới `FontFamily` và `FontFace`. File nằm trong kho `Asset` trên S3. Mỗi họ sở hữu một token `font-<slug>`.
- **CSS `@font-face`** là chuỗi sinh bằng hàm thuần từ một "bản niêm phong" (`FontSeal`):
  - bản nháp đọc DB, cache theo tag `fonts`;
  - Publish chụp bản niêm phong vào `Release.fonts`, và site thật đọc từ đó.
- **Phục vụ file:** route cùng nguồn `/mm-font/<key>`, nên không cần CORS.

**Tech Stack:** Next.js 15 (App Router), Prisma 6 / Postgres, S3 (MinIO ở local), vitest, Playwright, `fontkit@2.0.4`, `subset-font@2.9.0` (harfbuzz wasm).

**Spec:** `docs/superpowers/specs/2026-10-16-dynamic-fonts-design.md`

## Global Constraints

- Mọi chữ hiện cho người dùng (lỗi, nhãn, mô tả tool) viết **tiếng Việt có dấu**.
- **Trần file:** 10 MB (`MAX_ASSET_BYTES`). Mỗi lần cắt font tối đa **30 giây**. Mỗi request tới Google tối đa **10 giây**, tối đa **60 file** mỗi lần nhập.
- **Tập ký tự giữ lại:** hợp ba bộ `latin`, `latin-ext`, `vietnamese`, chép nguyên dải của Google (Task 1).
- **Kiểm thiếu tiếng Việt** bằng `ạảãếộữơưƯĐ` (không có ₫).
- **Quyền:**
  - đọc: `read`;
  - thêm, sửa, xoá face: `write`;
  - xoá họ: `admin`.
  - Service token (MCP) chỉ được POST `/api/fonts`.
- **Token** tên `font-<slug>`, `category: 'font'`, `custom: true`, giá trị `"<cssName>", <fallback>`. Slug bất biến.
- **Tên họ CSS** khớp `/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u`, không trùng (không phân biệt hoa thường) với `RESERVED_FAMILY_NAMES` hay họ khác.
- **Khoá font** hợp lệ khớp `^public/[A-Za-z0-9._~\-/]+\.(woff2|woff|ttf|otf)$`, không chứa `..` hay `//`.
- **Không đổi `BUNDLE_FORMAT_VERSION`.** Trường `fonts` của gói mặc định `[]`.
- **Hoàn tác một lần nhập trang không xoá họ font.**
- **Thứ tự kiểm đổi:**
  - Mỗi task kết thúc bằng `pnpm typecheck` và `pnpm test`.
  - Task có e2e thì chạy `pnpm e2e:up` (một lần), sau đó `pnpm e2e:test <file>`; khi thêm route hay file CSS mới thì chạy `pnpm e2e:restart`.
- **Commit:** user chỉ muốn commit khi được yêu cầu. Bước "Commit" chỉ chạy nếu user đã đồng ý cho commit trong phiên thực thi; nếu không, bỏ qua và để thay đổi trong cây làm việc. Message theo kiểu repo (tiếng Việt không dấu, conventional) và kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nhánh:** `ui/v2` đang có nhiều thay đổi chưa commit. Trước Task 1 phải hỏi user commit hay stash, hoặc làm trong worktree, rồi mới tách `feat/dynamic-fonts`.

## Review Focus

1. **File font mỗi weight mang tên họ riêng**, ví dụ "SVN-Gilroy" hay "Gilroy Bold". Người dùng phải gom được nhiều file vào một họ bằng `family` đè lên: tên đè thắng tên đọc được, và hai file cùng tên đè vào chung một họ. *Test ở Task 8 (`prepare.test.ts`) và e2e Task 13 (tải lại cùng `family` không tạo họ mới).*
2. **Tải lại đúng một file đã có** không được sinh face trùng hay báo "thay": `planFace` trả `same`. *Test ở Task 8 (`plan.test.ts`).*
3. **Tên họ có dấu tiếng Việt hoặc chỉ toàn chữ không phải Latin** ("Phông Đẹp", "思源黑体") vẫn ra slug hợp lệ và CSS được escape. *Test ở Task 3 (`names.test.ts`).*
4. **Release tạo trước tính năng này** (`fonts = null`), kể cả khi rollback về đó, không được làm trang lỗi: `parseFontSeal(null)` trả rỗng. *Test ở Task 6 (`css.test.ts`).*
5. **Họ Google chỉ có weight tĩnh và không có italic:** chuỗi thử phải rơi về từng weight và chỉ giữ face tồn tại. *Test ở Task 10 (`google.test.ts`), với `fetch` giả.*

## Bản đồ file

**Mới:**

```
src/lib/fonts/
  vendor.d.ts        khai kiểu cho fontkit, subset-font
  unicode.ts         dải ký tự, UPLOAD_TEXT, VIETNAMESE_PROBE           (+ .test)
  builtin.ts         4 họ có sẵn, RESERVED_FAMILY_NAMES, builtinFontCss (+ .test)
  names.ts           tên/slug/fallback/token/escape                     (+ .test)
  errors.ts          FontErrorCode, FONT_ERROR_STATUS, fail()
  inspect.ts         fontkit → metadata + cảnh báo                      (+ .test)
  convert.ts         subset-font → woff2, timeout                       (+ .test)
  css.ts             FontSeal, parseFontSeal, fontFaceCss, isFontKey    (+ .test)
  prepare.ts         file → PreparedFace                                (+ .test)
  plan.ts            planFace                                           (+ .test)
  usage-scan.ts      quét "$token" trong JSON (thuần)                   (+ .test)
  usage.ts           tokenUsage() đọc DB
  seal.ts            FONTS_TAG, readFontSeal, draftFontFaceCss
  service.ts         ghi DB: lưu face, sửa/xoá họ, xoá face
  google-fixture.ts  phản hồi css2 mẫu cho test
  google-parse.ts    đọc phản hồi css2                                  (+ .test)
  http.ts            kết quả service → NextResponse
  google.ts          gọi Google, tải file                               (+ .test)
  upload.ts          điều phối: file / URL / Google, dryRun
  list.ts            listFonts() cho GET và màn Font
src/lib/design/token-category.ts                                        (+ .test)
src/components/site/FontFaceStyle.tsx
src/app/mm-font/[...key]/route.ts
src/app/api/fonts/route.ts
src/app/api/fonts/[id]/route.ts
src/app/api/fonts/[id]/faces/[faceId]/route.ts
src/app/(builder)/builder/settings/fonts/page.tsx
src/components/builder/SettingsTabs.tsx
src/components/builder/FileDropZone.tsx
src/components/builder/fonts/FontList.tsx
src/components/builder/fonts/FontUploadDialog.tsx
src/components/builder/fonts/GoogleFontDialog.tsx
src/lib/ai/font-tools.ts
e2e/fonts-api.spec.ts
e2e/fonts.spec.ts
```

**Sửa:**

| Nhóm | File |
|---|---|
| Asset và token | `sniff.ts`, `kind.ts`, `upload-asset.ts` (lời báo), `foundations.ts`, `custom-tokens.ts`, `scripts/import-tokens.ts`, `design-tokens/[id]/route.ts` |
| Phát CSS | `render/page.ts`, publish route, 5 trang render (`(render)/render/[pageId]`, `(render)/render/component/[id]`, `(site)/preview/[pageId]`, `(site)/preview/release/[id]`, `(site)/[[...slug]]`) |
| Giữ file | `asset-references.ts`, `asset-references-scan.ts` (+ test), `assets/trash-types.ts` |
| Quyền và builder | `service-scope.ts`, `settings/page.tsx`, `transfer/ZipDropZone.tsx`, `ExtraFields.tsx` |
| AI/MCP | `ai/tools.ts`, `mcp/server.mjs`, `mcp/contract.snapshot.json`, `mcp/README.md` |
| Xuất/nhập | `transfer/{manifest,export,target,import-plan,commit,guides}.ts` (+ test) |
| Hạ tầng | `prisma/schema.prisma`, `next.config.mjs`, `package.json` |

---

### Task 1: Thư viện, khai kiểu, bảng ký tự

**Files:**
- Modify: `package.json`, `next.config.mjs`
- Create: `src/lib/fonts/vendor.d.ts`, `src/lib/fonts/unicode.ts`, `src/lib/fonts/unicode.test.ts`

**Interfaces:**
- Produces:
  - `SUBSET_RANGES: Record<'vietnamese'|'latin-ext'|'latin', string>`, `type SubsetName`, `KEPT_SUBSETS: readonly SubsetName[]`;
  - `parseRanges(s): [number, number][]`, `codePointsOf(...ranges: string[]): number[]`, `rangesOf(cps): string`;
  - `UPLOAD_CODE_POINTS`, `UPLOAD_UNICODE_RANGE: string`, `UPLOAD_TEXT: string`, `VIETNAMESE_PROBE: string[]`.

- [ ] **Step 1: Cài thư viện**

Run: `pnpm add fontkit@2.0.4 subset-font@2.9.0`
Expected: `package.json` có hai dòng mới trong `dependencies`.

Run: `ls node_modules/.pnpm | grep harfbuzz`
Expected: một thư mục `harfbuzzjs@<ver>`. Ghi lại để dùng cho glob ở Step 6.

- [ ] **Step 2: Khai kiểu** — `src/lib/fonts/vendor.d.ts`

```ts
/**
 * fontkit 2.x và subset-font không kèm kiểu. Khai đúng phần dự án dùng — không kéo
 * `@types/*` vào chỉ để có một bộ kiểu mô tả rộng hơn thứ ta gọi.
 */
declare module 'fontkit' {
  export function create(buffer: Buffer, postscriptName?: string): unknown;
}

declare module 'subset-font' {
  export interface SubsetFontOptions {
    targetFormat?: 'woff2' | 'woff' | 'truetype' | 'sfnt';
    preserveNameIds?: number[];
    variationAxes?: Record<string, number | { min: number; max: number; default?: number }>;
  }
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>;
}
```

- [ ] **Step 3: Viết test hỏng** — `src/lib/fonts/unicode.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import {
  codePointsOf, parseRanges, rangesOf, UPLOAD_CODE_POINTS, UPLOAD_TEXT, UPLOAD_UNICODE_RANGE,
} from './unicode';

describe('dải unicode', () => {
  it('đọc dải và điểm lẻ', () => {
    expect(parseRanges('U+0102-0103, U+0323')).toEqual([[0x102, 0x103], [0x323, 0x323]]);
  });

  it('bỏ phần không hợp lệ thay vì ném', () => {
    expect(parseRanges('U+0041, rác, U+zz')).toEqual([[0x41, 0x41]]);
  });

  it('gộp điểm liền nhau thành dải', () => {
    expect(rangesOf([0x43, 0x41, 0x42, 0x45])).toBe('U+0041-0043, U+0045');
  });

  it('rangesOf rồi codePointsOf giữ nguyên tập', () => {
    const r = 'U+0102-0103, U+1EA0-1EF9, U+20AB';
    expect(codePointsOf(rangesOf(codePointsOf(r)))).toEqual(codePointsOf(r));
  });

  it('bộ tải lên có đủ chữ Việt và ₫, không có ký tự điều khiển', () => {
    for (const ch of 'ạảãếộữơưƯĐ₫') expect(UPLOAD_CODE_POINTS).toContain(ch.codePointAt(0));
    expect(UPLOAD_CODE_POINTS[0]).toBe(0x20);
    expect(UPLOAD_UNICODE_RANGE.startsWith('U+0020-')).toBe(true);
    expect(UPLOAD_TEXT.length).toBe(UPLOAD_CODE_POINTS.length);
  });
});
```

- [ ] **Step 4: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/fonts/unicode.test.ts`
Expected: FAIL, "Failed to resolve import ./unicode".

- [ ] **Step 5: Viết `src/lib/fonts/unicode.ts`**

```ts
/**
 * Bộ chữ giữ lại khi cắt font.
 *
 * Ba dải dưới đây chép NGUYÊN từ phản hồi `css2` của Google Fonts (đo 16/10/2026,
 * họ Be Vietnam Pro). Google đã chia sẵn latin / latin-ext / vietnamese:
 *  - font Google giữ đúng từng bộ, mỗi bộ một face mang unicode-range của nó;
 *  - font tải lên được cắt theo HỢP của ba bộ, thành một face duy nhất.
 * Dùng chung một nguồn để hai đường cho ra cùng một tập chữ.
 */
export const SUBSET_RANGES = {
  vietnamese:
    'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, ' +
    'U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
  'latin-ext':
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, ' +
    'U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, ' +
    'U+A720-A7FF',
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, ' +
    'U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
} as const;

export type SubsetName = keyof typeof SUBSET_RANGES;

export const KEPT_SUBSETS: readonly SubsetName[] = ['vietnamese', 'latin-ext', 'latin'];

/** `U+0102-0103, U+0323` → `[[0x102, 0x103], [0x323, 0x323]]`. Phần hỏng thì bỏ. */
export function parseRanges(input: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of input.split(',')) {
    const m = /^\s*U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?\s*$/i.exec(part);
    if (!m) continue;
    const a = parseInt(m[1]!, 16);
    const b = m[2] ? parseInt(m[2], 16) : a;
    out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

/** Mọi điểm mã trong các dải, không trùng, tăng dần. */
export function codePointsOf(...ranges: string[]): number[] {
  const set = new Set<number>();
  for (const r of ranges) {
    for (const [a, b] of parseRanges(r)) for (let cp = a; cp <= b; cp++) set.add(cp);
  }
  return [...set].sort((x, y) => x - y);
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/** Ngược của `codePointsOf`: gộp điểm liền nhau thành dải. */
export function rangesOf(codePoints: readonly number[]): string {
  const sorted = [...new Set(codePoints)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    let end = start;
    while (sorted[i + 1] === end + 1) {
      end += 1;
      i += 1;
    }
    parts.push(start === end ? `U+${hex(start)}` : `U+${hex(start)}-${hex(end)}`);
  }
  return parts.join(', ');
}

/** Ký tự giữ lại khi cắt font tải lên. Bỏ U+0000–001F: ký tự điều khiển không có glyph. */
export const UPLOAD_CODE_POINTS: readonly number[] = codePointsOf(
  ...KEPT_SUBSETS.map((s) => SUBSET_RANGES[s]),
).filter((cp) => cp >= 0x20);

export const UPLOAD_UNICODE_RANGE = rangesOf(UPLOAD_CODE_POINTS);

export const UPLOAD_TEXT = String.fromCodePoint(...UPLOAD_CODE_POINTS);

/**
 * Chữ có dấu dùng để hỏi "font có tiếng Việt không".
 *
 * KHÔNG có ₫: thử 16/10/2026, `gilroy-bold.otf` (bản SVN, đủ dấu) không có ₫ — kiểm
 * nó là cảnh báo sai trên đúng loại font người dùng hay tải nhất.
 */
export const VIETNAMESE_PROBE: readonly string[] = [...'ạảãếộữơưƯĐ'];
```

- [ ] **Step 6: Cho Next mang thư viện font vào bản standalone** — `next.config.mjs`

Trong object `nextConfig`, thêm `serverExternalPackages` và mở rộng `outputFileTracingIncludes`. Thay `<ver>` bằng phiên bản thấy ở Step 1; nếu muốn bền với lần nâng cấp thì dùng `harfbuzzjs@*`.

```js
  // fontkit và subset-font chạy ở route `/api/fonts` và `/api/ai/tool`. subset-font nạp
  // `harfbuzz-subset.wasm` bằng `readFile(require.resolve(...))` lúc chạy — webpack gói
  // nó thì đường dẫn gãy. Để nguyên là package node, và kéo file .wasm vào standalone
  // bằng tay: thiếu nó thì tải font chạy ở dev rồi hỏng đúng lúc lên product.
  serverExternalPackages: ['fontkit', 'subset-font', 'harfbuzzjs'],
```

```js
  outputFileTracingIncludes: {
    '/api/tokens/client': ['./mcp/server.mjs'],
    '/api/fonts': ['./node_modules/.pnpm/harfbuzzjs@*/node_modules/harfbuzzjs/dist/*.wasm'],
    '/api/ai/tool': ['./node_modules/.pnpm/harfbuzzjs@*/node_modules/harfbuzzjs/dist/*.wasm'],
  },
```

- [ ] **Step 7: Chạy test**

Run: `pnpm vitest run src/lib/fonts/unicode.test.ts && pnpm typecheck`
Expected: PASS; typecheck sạch.

- [ ] **Step 8: Commit** (xem Global Constraints)

```bash
git add package.json pnpm-lock.yaml next.config.mjs src/lib/fonts/vendor.d.ts src/lib/fonts/unicode.ts src/lib/fonts/unicode.test.ts
git commit -m "feat(fonts): them fontkit, subset-font va bang ky tu cat font (latin, latin-ext, vietnamese)"
```

---

### Task 2: Nhận diện TTF và OTF trong kho asset

**Files:**
- Modify: `src/lib/assets/sniff.ts` (hàm `otherFormat`), `src/lib/assets/kind.ts` (`UPLOAD_ACCEPT`), `src/lib/builder/upload-asset.ts` (lời báo 415)
- Test: `src/lib/assets/sniff.test.ts`

- [ ] **Step 1: Thêm test hỏng vào `src/lib/assets/sniff.test.ts`**

```ts
describe('font', () => {
  const head = (bytes: number[]) => new Uint8Array([...bytes, ...new Array(32).fill(0)]);

  it('OTF (CFF) nhận ra từ "OTTO"', () => {
    expect(sniff(head([0x4f, 0x54, 0x54, 0x4f]))).toEqual({ mime: 'font/otf' });
  });

  it('TTF nhận ra từ 00 01 00 00 và từ "true"', () => {
    expect(sniff(head([0x00, 0x01, 0x00, 0x00]))).toEqual({ mime: 'font/ttf' });
    expect(sniff(head([0x74, 0x72, 0x75, 0x65]))).toEqual({ mime: 'font/ttf' });
  });

  it('TTC không nhận: kho không biết file nào trong bộ', () => {
    expect(sniff(head([0x74, 0x74, 0x63, 0x66]))).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/assets/sniff.test.ts`
Expected: FAIL ở hai test OTF/TTF (nhận `null`).

- [ ] **Step 3: Sửa `otherFormat` trong `src/lib/assets/sniff.ts`**

Ngay sau hai dòng `wOF2` / `wOFF`:

```ts
  // TTF và OTF — thêm 16/10/2026 cho mục Font (spec 2026-10-16-dynamic-fonts). TTC
  // ('ttcf') cố ý KHÔNG nhận: một file chứa nhiều font, kho không biết dùng cái nào.
  if (ascii(b, 0, 4) === 'OTTO') return { mime: 'font/otf' };
  if (ascii(b, 0, 4) === 'true' || startsWith(b, [0x00, 0x01, 0x00, 0x00])) {
    return { mime: 'font/ttf' };
  }
```

- [ ] **Step 4: Sửa `UPLOAD_ACCEPT` trong `src/lib/assets/kind.ts`**

Thay dòng `'font/woff', 'font/woff2',` bằng:

```ts
  // Trình duyệt thường để MIME rỗng cho .ttf/.otf, nên khai cả đuôi file.
  'font/woff', 'font/woff2', 'font/ttf', 'font/otf', '.woff', '.woff2', '.ttf', '.otf',
```

- [ ] **Step 5: Sửa lời báo 415 trong `src/lib/builder/upload-asset.ts`**

Thay `'(MP4, WebM), âm thanh (MP3, WAV, OGG) và font (WOFF, WOFF2).\n\n' +` bằng:

```ts
        '(MP4, WebM), âm thanh (MP3, WAV, OGG) và font (WOFF2, WOFF, TTF, OTF).\n\n' +
```

- [ ] **Step 6: Chạy test**

Run: `pnpm vitest run src/lib/assets && pnpm typecheck`
Expected: PASS. Nếu `kind.test.ts` có snapshot `UPLOAD_ACCEPT` thì cập nhật đúng chuỗi mới.

- [ ] **Step 7: Commit**

```bash
git add src/lib/assets/sniff.ts src/lib/assets/sniff.test.ts src/lib/assets/kind.ts src/lib/builder/upload-asset.ts
git commit -m "feat(assets): nhan dien TTF va OTF tu noi dung file"
```

---

### Task 3: Tên họ, slug, fallback, họ có sẵn và tên dành riêng

**Files:**
- Modify: `src/lib/design/foundations.ts` (export `FONT_FORBIDDEN_RE`)
- Create: `src/lib/fonts/builtin.ts`, `src/lib/fonts/builtin.test.ts`, `src/lib/fonts/names.ts`, `src/lib/fonts/names.test.ts`

**Interfaces:**
- Produces (`builtin.ts`):
  - `interface BuiltinFace { weight: string; style: 'normal'|'italic'; url: string; format: string; unicodeRange?: string }`;
  - `interface BuiltinFamily { cssName: string; tokens: readonly string[]; faces: readonly BuiltinFace[] }`;
  - `BUILTIN_FONTS`, `RESERVED_FAMILY_NAMES`, `builtinFontCss(): string`.
- Produces (`names.ts`):
  - hằng: `FONT_NAME_RE`, `WEIGHT_RE`, `MAX_FONT_BYTES`, `FALLBACKS`, `type FallbackPreset`, `type FontStyle = 'normal'|'italic'`;
  - hàm: `normalizeCssName(s)`, `fontSlug(cssName)`, `fontTokenName(slug)`, `isReservedFamily(name)`, `cssString(s)`, `resolveFallback(input)`, `fontTokenValue(cssName, fallback)`, `isFontStack(value)`.

- [ ] **Step 1: Export regex** — `src/lib/design/foundations.ts`

Đổi `const FONT_FORBIDDEN_RE = …` thành `export const FONT_FORBIDDEN_RE = …`. Giữ nguyên nội dung và comment.

- [ ] **Step 2: Viết test hỏng cho họ có sẵn** — `src/lib/fonts/builtin.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BUILTIN_FONTS, builtinFontCss } from './builtin';
import { isReservedFamily } from './names';

const typography = readFileSync('src/styles/base/typography.css', 'utf8');
const tokensCss = readFileSync('src/styles/tokens.css', 'utf8');

describe('họ font có sẵn', () => {
  it('khớp từng @font-face trong typography.css', () => {
    const got = [...typography.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, b]) => ({
      family: /font-family:\s*"?([^";]+)"?;/.exec(b!)![1]!.trim(),
      url: /url\("([^"]+)"\)/.exec(b!)![1]!,
      weight: /font-weight:\s*([^;]+);/.exec(b!)![1]!.trim(),
      style: /font-style:\s*([^;]+);/.exec(b!)?.[1]!.trim() ?? 'normal',
    }));
    const want = BUILTIN_FONTS.flatMap((f) =>
      f.faces.map((x) => ({ family: f.cssName, url: x.url, weight: x.weight, style: x.style })),
    );
    expect(new Set(got.map((x) => JSON.stringify(x)))).toEqual(new Set(want.map((x) => JSON.stringify(x))));
  });

  it('token của họ có sẵn có thật trong tokens.css', () => {
    for (const t of BUILTIN_FONTS.flatMap((f) => f.tokens)) {
      expect(tokensCss, t).toMatch(new RegExp(`--${t}:`));
    }
  });

  it('mọi tên trong chuỗi --font-* và --lv-font-* đều là tên dành riêng', () => {
    const stacks = [...tokensCss.matchAll(/--(?:lv-)?font-[a-z0-9-]+:\s*([^;]+);/g)].map((m) => m[1]!);
    const names = stacks.flatMap((s) => s.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')));
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(isReservedFamily(n), n).toBe(true);
  });

  it('CSS xem trước khai đủ mọi face', () => {
    const css = builtinFontCss();
    expect(css.match(/@font-face/g)?.length).toBe(BUILTIN_FONTS.flatMap((f) => f.faces).length);
    expect(css).toContain('font-family: "gilroy"');
  });
});
```

- [ ] **Step 3: Viết test hỏng cho tên** — `src/lib/fonts/names.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import {
  cssString, FALLBACKS, FONT_NAME_RE, fontSlug, fontTokenValue, isFontStack, isReservedFamily,
  normalizeCssName, resolveFallback, WEIGHT_RE,
} from './names';

describe('tên họ font', () => {
  it('chuẩn hoá khoảng trắng', () => {
    expect(normalizeCssName('  Be   Vietnam Pro ')).toBe('Be Vietnam Pro');
  });

  it('slug bỏ dấu tiếng Việt và đ', () => {
    expect(fontSlug('Phông Đẹp')).toBe('phong-dep');
    expect(fontSlug('SVN-Gilroy')).toBe('svn-gilroy');
  });

  it('tên không có chữ Latin vẫn ra slug hợp lệ và ổn định', () => {
    const s = fontSlug('思源黑体');
    expect(s).toMatch(/^ho-[0-9a-f]{8}$/);
    expect(fontSlug('思源黑体')).toBe(s);
  });

  it('regex tên nhận chữ có dấu, chặn ký tự CSS', () => {
    expect(FONT_NAME_RE.test('Phông Đẹp')).toBe(true);
    expect(FONT_NAME_RE.test('a"; } body{')).toBe(false);
    expect(FONT_NAME_RE.test(' bắt đầu bằng khoảng trắng')).toBe(false);
  });

  it('tên dành riêng so không phân biệt hoa thường', () => {
    expect(isReservedFamily('GILROY')).toBe(true);
    expect(isReservedFamily('inter')).toBe(true);
    expect(isReservedFamily('Gilroy Web')).toBe(false);
  });

  it('escape chuỗi CSS', () => {
    expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it('weight: số hoặc dải', () => {
    expect(WEIGHT_RE.test('400')).toBe(true);
    expect(WEIGHT_RE.test('100 900')).toBe(true);
    expect(WEIGHT_RE.test('0')).toBe(false);
    expect(WEIGHT_RE.test('bold')).toBe(false);
  });

  it('fallback: chọn sẵn hoặc tự gõ, chặn tiêm CSS', () => {
    expect(resolveFallback(undefined)).toEqual({ ok: true, value: FALLBACKS.sans });
    expect(resolveFallback('serif')).toEqual({ ok: true, value: FALLBACKS.serif });
    expect(resolveFallback('Arial, sans-serif')).toEqual({ ok: true, value: 'Arial, sans-serif' });
    expect(resolveFallback('x; } body { color: red').ok).toBe(false);
    expect(resolveFallback('url(x)').ok).toBe(false);
  });

  it('giá trị token', () => {
    expect(fontTokenValue('Be Vietnam Pro', FALLBACKS.sans)).toBe(`"Be Vietnam Pro", ${FALLBACKS.sans}`);
    expect(isFontStack(fontTokenValue('Be Vietnam Pro', FALLBACKS.sans))).toBe(true);
    expect(isFontStack('a; b')).toBe(false);
  });
});
```

- [ ] **Step 4: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/fonts/builtin.test.ts src/lib/fonts/names.test.ts`
Expected: FAIL, không resolve được module.

- [ ] **Step 5: Viết `src/lib/fonts/builtin.ts`**

```ts
/**
 * Bốn họ font đóng cứng trong image (`public/fonts` + `src/styles/base/typography.css`).
 *
 * Màn Font liệt kê chúng ở dạng CHỈ ĐỌC (spec §5). Danh sách này là bản sao của
 * `typography.css` — `builtin.test.ts` canh hai bên không lệch.
 */

import { cssString } from './names';

export interface BuiltinFace {
  weight: string;
  style: 'normal' | 'italic';
  url: string;
  format: 'woff2' | 'woff2-variations' | 'truetype' | 'opentype';
  unicodeRange?: string;
}

export interface BuiltinFamily {
  cssName: string;
  /** Token đang trỏ tới họ này (đứng đầu chuỗi font của token). */
  tokens: readonly string[];
  faces: readonly BuiltinFace[];
}

const sf = (weight: string, file: string): BuiltinFace => ({
  weight, style: 'normal', url: `/fonts/sf-pro-display-${file}.woff2`, format: 'woff2',
});
const gilroy = (weight: string, file: string): BuiltinFace => ({
  weight, style: 'normal', url: `/fonts/gilroy-${file}.otf`, format: 'opentype',
});

export const BUILTIN_FONTS: readonly BuiltinFamily[] = [
  {
    cssName: 'SF Pro Display',
    tokens: ['font-display', 'font-body'],
    faces: [sf('400', 'regular'), sf('500', 'medium'), sf('600', 'semibold'), sf('700', 'bold')],
  },
  {
    cssName: 'Inter Variable',
    tokens: ['lv-font-body'],
    faces: [
      {
        weight: '100 900', style: 'normal', url: '/fonts/inter-latin-wght-normal.woff2', format: 'woff2-variations',
        unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215',
      },
      {
        weight: '100 900', style: 'normal', url: '/fonts/inter-vietnamese.woff2', format: 'woff2',
        unicodeRange: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
      },
      {
        weight: '100 900', style: 'normal', url: '/fonts/inter-latin-ext.woff2', format: 'woff2',
        unicodeRange: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
      },
    ],
  },
  {
    cssName: 'newYork',
    tokens: ['font-newyork', 'lv-font-display'],
    faces: [
      { weight: '400', style: 'normal', url: '/fonts/newyork-regular.ttf', format: 'truetype' },
      { weight: '400', style: 'italic', url: '/fonts/newyork-italic.ttf', format: 'truetype' },
    ],
  },
  {
    cssName: 'gilroy',
    tokens: ['font-gilroy', 'lv-font-head'],
    faces: [
      gilroy('300', 'light'), gilroy('400', 'regular'), gilroy('500', 'medium'),
      gilroy('600', 'semibold'), gilroy('700', 'bold'),
    ],
  },
];

/**
 * Tên họ một font tải lên KHÔNG được mang (so không phân biệt hoa thường — tên họ
 * trong CSS không phân biệt).
 *
 * Gồm: họ có sẵn, mọi tên đứng trong chuỗi dự phòng của `--font-*`/`--lv-font-*`
 * (một họ tải lên tên "Inter" sẽ được `--font-gilroy` dùng làm dự phòng và đổi âm
 * thầm trang đang chạy), và từ khoá chung. `builtin.test.ts` canh danh sách này phủ
 * đủ `tokens.css`.
 */
export const RESERVED_FAMILY_NAMES: readonly string[] = [
  'SF Pro Display', 'SF Pro Text', 'SF Mono', 'Inter Variable', 'Inter', 'newYork', 'New York', 'gilroy',
  'Helvetica Neue', 'Arial', 'Georgia', 'Times New Roman', 'Menlo', 'Consolas',
  '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'ui-monospace', 'ui-sans-serif', 'ui-serif',
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'math', 'emoji', 'fangsong',
];

/** `@font-face` của họ có sẵn — chỉ cho màn Font xem trước (builder không nạp typography.css). */
export function builtinFontCss(): string {
  return BUILTIN_FONTS.flatMap((f) =>
    f.faces.map((x) => {
      const lines = [
        `  font-family: ${cssString(f.cssName)};`,
        `  src: url("${x.url}") format("${x.format}");`,
        `  font-weight: ${x.weight};`,
        `  font-style: ${x.style};`,
        '  font-display: swap;',
        ...(x.unicodeRange ? [`  unicode-range: ${x.unicodeRange};`] : []),
      ];
      return `@font-face {\n${lines.join('\n')}\n}`;
    }),
  ).join('\n');
}
```

- [ ] **Step 6: Viết `src/lib/fonts/names.ts`**

```ts
/**
 * Luật đặt tên cho họ font tải lên — hàm thuần, dùng chung cho route, service, MCP và UI.
 */

import { FONT_FORBIDDEN_RE } from '@/lib/design/foundations';

import { RESERVED_FAMILY_NAMES } from './builtin';

/** Tên họ CSS: chữ (mọi bảng chữ), số, khoảng trắng, `-`, `_`; tối đa 64 ký tự. */
export const FONT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u;

/** `400`, hoặc dải `100 900` của variable font. */
export const WEIGHT_RE = /^[1-9]\d{0,3}( [1-9]\d{0,3})?$/;

/** Cùng giá trị `MAX_ASSET_BYTES` (upload-asset.ts); khai lại để file này không kéo prisma. */
export const MAX_FONT_BYTES = 10 * 1024 * 1024;

export type FontStyle = 'normal' | 'italic';

export const FALLBACKS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
} as const;

export type FallbackPreset = keyof typeof FALLBACKS;

export function normalizeCssName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** FNV-1a 32 bit — đủ cho slug dự phòng, không phải băm bảo mật. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * `Phông Đẹp` → `phong-dep`. Tên không còn ký tự a–z/0–9 nào (chữ Hán, Thái…) thì
 * `ho-<băm>`: slug là đuôi token và không bao giờ đổi, nên phải ổn định theo tên.
 */
export function fontSlug(cssName: string): string {
  const slug = cssName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `ho-${fnv(cssName)}`;
}

export const fontTokenName = (slug: string) => `font-${slug}`;

export function isReservedFamily(name: string): boolean {
  const n = name.trim().toLowerCase();
  return RESERVED_FAMILY_NAMES.some((r) => r.toLowerCase() === n);
}

/** Chuỗi CSS trong ngoặc kép. Tên đã qua `FONT_NAME_RE`; escape là lớp chặn thứ hai. */
export function cssString(s: string): string {
  return `"${s.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ')}"`;
}

export function isFontStack(value: string): boolean {
  return value.length > 0 && value.length <= 300 && !FONT_FORBIDDEN_RE.test(value);
}

export function resolveFallback(
  input: string | null | undefined,
): { ok: true; value: string } | { ok: false; error: string } {
  const v = (input ?? 'sans').trim();
  if (v in FALLBACKS) return { ok: true, value: FALLBACKS[v as FallbackPreset] };
  if (!v || v.length > 200 || !isFontStack(v)) {
    return {
      ok: false,
      error: 'Fallback không hợp lệ: không được rỗng, quá 200 ký tự, hay chứa ; { } < > \\ /* url(',
    };
  }
  return { ok: true, value: v };
}

export function fontTokenValue(cssName: string, fallback: string): string {
  return `${cssString(cssName)}, ${fallback}`;
}
```

- [ ] **Step 7: Chạy test**

Run: `pnpm vitest run src/lib/fonts src/lib/design && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/foundations.ts src/lib/fonts/builtin.ts src/lib/fonts/builtin.test.ts src/lib/fonts/names.ts src/lib/fonts/names.test.ts
git commit -m "feat(fonts): luat ten ho, slug, fallback va danh sach ten danh rieng"
```

---

### Task 4: Đọc metadata font và mã lỗi

**Files:**
- Create: `src/lib/fonts/errors.ts`, `src/lib/fonts/inspect.ts`, `src/lib/fonts/inspect.test.ts`

**Interfaces:**
- Produces (`errors.ts`):
  - `type FontErrorCode`, `FONT_ERROR_STATUS: Record<FontErrorCode, number>`;
  - `interface FontFailure { ok: false; code: FontErrorCode; status: number; error: string; usage?: unknown }`;
  - `fail(code, error, extra?): FontFailure`.
- Produces (`inspect.ts`):
  - `type FontFileType = 'woff2'|'woff'|'ttf'|'otf'`;
  - `type FontWarningCode = 'missing_vietnamese'|'restricted_embedding'`, `interface FontWarning { code: FontWarningCode; message: string }`;
  - `interface FontInspection { type; family: string|null; weight: string; style: FontStyle; variable: boolean; warnings: FontWarning[] }`;
  - `fontFileType(bytes): FontFileType | 'ttc' | null`, `inspectFont(bytes): { ok: true; info: FontInspection } | FontFailure`.

- [ ] **Step 1: Viết `src/lib/fonts/errors.ts`**

```ts
/** Mã lỗi của mục Font — route đổi sang HTTP bằng `FONT_ERROR_STATUS`. Spec §10. */
export type FontErrorCode =
  | 'not_font' | 'collection_unsupported' | 'too_large'
  | 'name_required' | 'name_invalid' | 'name_reserved' | 'slug_taken' | 'weight_invalid'
  | 'fallback_invalid' | 'license_required'
  | 'google_not_found' | 'google_unreachable'
  | 'in_use' | 'not_found' | 'bad_request';

export const FONT_ERROR_STATUS: Record<FontErrorCode, number> = {
  not_font: 415,
  collection_unsupported: 415,
  too_large: 413,
  name_required: 422,
  name_invalid: 422,
  name_reserved: 409,
  slug_taken: 409,
  weight_invalid: 422,
  fallback_invalid: 422,
  license_required: 422,
  google_not_found: 404,
  google_unreachable: 502,
  in_use: 409,
  not_found: 404,
  bad_request: 400,
};

export interface FontFailure {
  ok: false;
  code: FontErrorCode;
  status: number;
  error: string;
  /** Chỉ với `in_use`: nơi đang dùng token. */
  usage?: unknown;
}

export function fail(code: FontErrorCode, error: string, extra: { usage?: unknown } = {}): FontFailure {
  return { ok: false, code, status: FONT_ERROR_STATUS[code], error, ...extra };
}
```

- [ ] **Step 2: Viết test hỏng** — `src/lib/fonts/inspect.test.ts`

Test dùng các file sẵn có trong `public/fonts`. Chỉ đọc để kiểm, không phát tán lại.

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { fontFileType, inspectFont } from './inspect';

const font = (f: string) => new Uint8Array(readFileSync(`public/fonts/${f}`));

describe('fontFileType', () => {
  it('nhận woff2, otf, ttf, ttc', () => {
    expect(fontFileType(font('inter-vietnamese.woff2'))).toBe('woff2');
    expect(fontFileType(font('gilroy-bold.otf'))).toBe('otf');
    expect(fontFileType(font('newyork-regular.ttf'))).toBe('ttf');
    expect(fontFileType(new Uint8Array([0x74, 0x74, 0x63, 0x66, ...new Array(12).fill(0)]))).toBe('ttc');
    expect(fontFileType(new TextEncoder().encode('xin chào, không phải font'))).toBeNull();
  });
});

describe('inspectFont', () => {
  it('OTF tĩnh: tên họ, weight, đủ dấu (không kiểm ₫)', () => {
    const r = inspectFont(font('gilroy-bold.otf'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info).toMatchObject({ type: 'otf', family: 'SVN-Gilroy', weight: '700', style: 'normal', variable: false });
    expect(r.info.warnings).toEqual([]);
  });

  it('TTF variable italic: dải weight', () => {
    const r = inspectFont(font('newyork-italic.ttf'));
    if (!r.ok) throw new Error(r.error);
    expect(r.info).toMatchObject({ type: 'ttf', family: 'New York', weight: '400 1000', style: 'italic', variable: true });
  });

  it('font chỉ có bộ latin thì cảnh báo thiếu tiếng Việt', () => {
    const r = inspectFont(font('inter-latin-wght-normal.woff2'));
    if (!r.ok) throw new Error(r.error);
    expect(r.info.weight).toBe('100 900');
    expect(r.info.warnings.map((w) => w.code)).toEqual(['missing_vietnamese']);
  });

  it('TTC và file rác trả mã lỗi', () => {
    const ttc = inspectFont(new Uint8Array([0x74, 0x74, 0x63, 0x66, ...new Array(12).fill(0)]));
    expect(ttc).toMatchObject({ ok: false, code: 'collection_unsupported', status: 415 });
    const junk = inspectFont(new TextEncoder().encode('xin chào, không phải font'));
    expect(junk).toMatchObject({ ok: false, code: 'not_font' });
  });

  it('đầu file hợp lệ nhưng thân hỏng vẫn là not_font, không ném', () => {
    const broken = font('gilroy-bold.otf').slice(0, 64);
    expect(inspectFont(broken)).toMatchObject({ ok: false, code: 'not_font' });
  });
});
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/fonts/inspect.test.ts`
Expected: FAIL, không resolve được `./inspect`.

- [ ] **Step 4: Viết `src/lib/fonts/inspect.ts`**

```ts
/**
 * Đọc metadata một file font bằng fontkit — spec §7.1 bước 1–3. Hàm thuần.
 */

import * as fontkit from 'fontkit';

import { fail, type FontFailure } from './errors';
import type { FontStyle } from './names';
import { VIETNAMESE_PROBE } from './unicode';

export type FontFileType = 'woff2' | 'woff' | 'ttf' | 'otf';
export type FontWarningCode = 'missing_vietnamese' | 'restricted_embedding';

export interface FontWarning {
  code: FontWarningCode;
  message: string;
}

export interface FontInspection {
  type: FontFileType;
  /** Name ID 16 (typographic family), không có thì ID 1. `null` khi file không khai. */
  family: string | null;
  weight: string;
  style: FontStyle;
  variable: boolean;
  warnings: FontWarning[];
}

/** Phần đối tượng fontkit mà file này đọc — fontkit không kèm kiểu. Kiểm 16/10/2026 với 2.0.4. */
interface FkFont {
  getName(key: string, lang?: string): string | null;
  familyName: string | null;
  italicAngle: number;
  variationAxes: Record<string, { min: number; max: number; default: number }> | undefined;
  hasGlyphForCodePoint(cp: number): boolean;
  'OS/2'?: {
    usWeightClass?: number;
    fsSelection?: { italic?: boolean };
    fsType?: { noEmbedding?: boolean };
  };
}

const tag = (b: Uint8Array) => String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!);

export function fontFileType(b: Uint8Array): FontFileType | 'ttc' | null {
  if (b.length < 12) return null;
  const t = tag(b);
  if (t === 'wOF2') return 'woff2';
  if (t === 'wOFF') return 'woff';
  if (t === 'OTTO') return 'otf';
  if (t === 'ttcf') return 'ttc';
  if (t === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'ttf';
  return null;
}

const clampWeight = (w: number) => Math.min(1000, Math.max(1, Math.round(w)));

export function inspectFont(bytes: Uint8Array): { ok: true; info: FontInspection } | FontFailure {
  const type = fontFileType(bytes);
  if (type === 'ttc') {
    return fail(
      'collection_unsupported',
      'File .ttc chứa nhiều font trong một file — chưa hỗ trợ. Tách từng font ra .ttf/.otf rồi tải lên.',
    );
  }
  if (!type) {
    return fail(
      'not_font',
      'Không phải file font. Nhận WOFF2, WOFF, TTF, OTF — kiểu được đọc từ nội dung file, không từ đuôi tên.',
    );
  }

  let font: FkFont;
  try {
    font = fontkit.create(Buffer.from(bytes)) as FkFont;
    // Đọc thử một bảng: file cụt vẫn qua `create` nhưng ném ở lần đọc đầu.
    void font['OS/2'];
  } catch {
    return fail('not_font', 'File font hỏng — không đọc được bảng nào trong file.');
  }

  try {
    const os2 = font['OS/2'];
    const family = (font.getName('preferredFamily') ?? font.familyName ?? '').trim() || null;
    const wght = font.variationAxes?.wght;
    const weight = wght
      ? `${clampWeight(wght.min)} ${clampWeight(wght.max)}`
      : String(clampWeight(os2?.usWeightClass ?? 400));
    const italic = Boolean(os2?.fsSelection?.italic) || (font.italicAngle ?? 0) !== 0;

    const warnings: FontWarning[] = [];
    const missing = VIETNAMESE_PROBE.filter((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0)!));
    if (missing.length) {
      warnings.push({
        code: 'missing_vietnamese',
        message: `Font này không có đủ dấu tiếng Việt (thiếu ${missing.join(' ')}) — chỗ đó sẽ hiện bằng font dự phòng.`,
      });
    }
    if (os2?.fsType?.noEmbedding) {
      warnings.push({
        code: 'restricted_embedding',
        message: 'Giấy phép ghi trong file đánh dấu "không cho nhúng" — kiểm lại quyền dùng font này trên web.',
      });
    }

    return { ok: true, info: { type, family, weight, style: italic ? 'italic' : 'normal', variable: Boolean(wght), warnings } };
  } catch {
    return fail('not_font', 'File font hỏng — fontkit không đọc hết được các bảng.');
  }
}
```

- [ ] **Step 5: Chạy test**

Run: `pnpm vitest run src/lib/fonts/inspect.test.ts && pnpm typecheck`
Expected: PASS. Nếu test "thân hỏng" không ra `not_font` mà ném lỗi, kiểm lại rằng mọi lần đọc thuộc tính fontkit đều nằm trong khối `try`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fonts/errors.ts src/lib/fonts/inspect.ts src/lib/fonts/inspect.test.ts
git commit -m "feat(fonts): doc metadata font (ten ho, weight, italic, variable) va canh bao"
```

---

### Task 5: Cắt font và đổi sang woff2

**Files:**
- Create: `src/lib/fonts/convert.ts`, `src/lib/fonts/convert.test.ts`

**Interfaces:**
- Produces: `class ConvertTimeout extends Error`, `toWoff2(bytes: Uint8Array, opts?: { text?: string; timeoutMs?: number }): Promise<Uint8Array>`.

- [ ] **Step 1: Viết test hỏng** — `src/lib/fonts/convert.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ConvertTimeout, toWoff2 } from './convert';
import { inspectFont } from './inspect';

const font = (f: string) => new Uint8Array(readFileSync(`public/fonts/${f}`));

describe('toWoff2', () => {
  it('OTF → woff2 nhỏ hơn, còn chữ Việt', async () => {
    const src = font('gilroy-bold.otf');
    const out = await toWoff2(src);
    expect(String.fromCharCode(...out.subarray(0, 4))).toBe('wOF2');
    expect(out.length).toBeLessThan(src.length);
    const r = inspectFont(out);
    if (!r.ok) throw new Error(r.error);
    expect(r.info.warnings).toEqual([]);
    expect(r.info.family).toBe('SVN-Gilroy');
  });

  it('giữ trục wght của variable font', async () => {
    const r = inspectFont(await toWoff2(font('newyork-regular.ttf')));
    if (!r.ok) throw new Error(r.error);
    expect(r.info.variable).toBe(true);
  });

  it('quá giờ thì ném ConvertTimeout', async () => {
    await expect(toWoff2(font('gilroy-bold.otf'), { timeoutMs: 1 })).rejects.toBeInstanceOf(ConvertTimeout);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/fonts/convert.test.ts`
Expected: FAIL, không resolve được `./convert`.

- [ ] **Step 3: Viết `src/lib/fonts/convert.ts`**

```ts
/**
 * Cắt font về bộ chữ `UPLOAD_TEXT` và xuất woff2 — spec §7.1 bước 4.
 *
 * subset-font (harfbuzz wasm) giữ tính năng OpenType mặc định và trục variable.
 * Có trần thời gian vì font rất lớn (CJK gần 10 MB) có thể giữ worker hàng phút.
 */

import subsetFont from 'subset-font';

import { UPLOAD_TEXT } from './unicode';

export class ConvertTimeout extends Error {
  constructor() {
    super('Xử lý font quá thời gian cho phép');
  }
}

export async function toWoff2(
  bytes: Uint8Array,
  opts: { text?: string; timeoutMs?: number } = {},
): Promise<Uint8Array> {
  const work = subsetFont(Buffer.from(bytes), opts.text ?? UPLOAD_TEXT, { targetFormat: 'woff2' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConvertTimeout()), opts.timeoutMs ?? 30_000);
  });
  // Promise thua cuộc vẫn chạy nốt và có thể reject — nuốt để không thành unhandled rejection.
  work.catch(() => {});
  try {
    return new Uint8Array(await Promise.race([work, timeout]));
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm vitest run src/lib/fonts/convert.test.ts && pnpm typecheck`
Expected: PASS (lần đầu nạp wasm có thể mất 1–2 giây).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fonts/convert.ts src/lib/fonts/convert.test.ts
git commit -m "feat(fonts): cat font va doi sang woff2 bang subset-font, tran 30 giay"
```

---

### Task 6: Bản niêm phong và sinh `@font-face`

**Files:**
- Create: `src/lib/fonts/css.ts`, `src/lib/fonts/css.test.ts`, `src/components/site/FontFaceStyle.tsx`

**Interfaces:**
- Produces:
  - `interface FontSealFace { key: string; weight: string; style: FontStyle; unicodeRange: string }`;
  - `interface FontSealFamily { slug: string; cssName: string; faces: FontSealFace[] }`, `interface FontSeal { families: FontSealFamily[] }`;
  - `EMPTY_FONT_SEAL`;
  - `isFontKey(key): boolean`, `fontUrl(key): string`, `fontMimeOf(key): string`;
  - `parseFontSeal(raw: unknown): FontSeal`, `fontFaceCss(seal: FontSeal): string`, `unpublishedSlugs(draft: FontSeal, live: FontSeal): Set<string>`;
  - `FontFaceStyle({ css }: { css: string })`.

- [ ] **Step 1: Viết test hỏng** — `src/lib/fonts/css.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { fontFaceCss, fontUrl, isFontKey, parseFontSeal, unpublishedSlugs, type FontSeal } from './css';

const KEY = 'public/builder/be-vietnam-pro-400-normal-1a2b3c4d.woff2';
const seal: FontSeal = {
  families: [{
    slug: 'be-vietnam-pro',
    cssName: 'Be Vietnam Pro',
    faces: [
      { key: KEY, weight: '400', style: 'normal', unicodeRange: 'U+0102-0103, U+1EA0-1EF9' },
      { key: 'public/builder/x-11111111.ttf', weight: '100 900', style: 'italic', unicodeRange: '' },
    ],
  }],
};

describe('khoá font', () => {
  it('chỉ nhận khoá dưới public/ có đuôi font', () => {
    expect(isFontKey(KEY)).toBe(true);
    expect(isFontKey('public/builder/a.png')).toBe(false);
    expect(isFontKey('private/a.woff2')).toBe(false);
    expect(isFontKey('public/../secret.woff2')).toBe(false);
    expect(isFontKey('public//a.woff2')).toBe(false);
    expect(isFontKey('public/a b.woff2')).toBe(false);
  });

  it('URL cùng nguồn', () => {
    expect(fontUrl(KEY)).toBe(`/mm-font/${KEY}`);
  });
});

describe('fontFaceCss', () => {
  it('sinh đủ khối, có swap, bỏ unicode-range rỗng, đúng format', () => {
    const css = fontFaceCss(seal);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('font-family: "Be Vietnam Pro";');
    expect(css).toContain(`src: url("/mm-font/${KEY}") format("woff2");`);
    expect(css).toContain('format("truetype")');
    expect(css).toContain('font-weight: 100 900;');
    expect(css).toContain('font-display: swap;');
    expect(css).toContain('unicode-range: U+0102-0103, U+1EA0-1EF9;');
    expect(css.split('unicode-range').length).toBe(2);
  });

  it('bỏ face và họ không hợp lệ thay vì ném', () => {
    const css = fontFaceCss({
      families: [
        { slug: 'x', cssName: 'x"; } body { color: red', faces: seal.families[0]!.faces },
        { slug: 'y', cssName: 'Y', faces: [{ key: 'public/a.png', weight: '400', style: 'normal', unicodeRange: '' }] },
        { slug: 'z', cssName: 'Z', faces: [{ key: KEY, weight: 'bold', style: 'normal', unicodeRange: '' }] },
      ],
    });
    expect(css).toBe('');
  });

  it('cùng dữ liệu thì cùng chuỗi', () => {
    const shuffled: FontSeal = { families: [{ ...seal.families[0]!, faces: [...seal.families[0]!.faces].reverse() }] };
    expect(fontFaceCss(shuffled)).toBe(fontFaceCss(seal));
  });
});

describe('parseFontSeal', () => {
  it('null (release cũ) và rác thành rỗng', () => {
    expect(parseFontSeal(null)).toEqual({ families: [] });
    expect(parseFontSeal('rác')).toEqual({ families: [] });
    expect(parseFontSeal({ families: [{ slug: 1 }] })).toEqual({ families: [] });
  });

  it('giữ nguyên bản hợp lệ', () => {
    expect(parseFontSeal(JSON.parse(JSON.stringify(seal)))).toEqual(seal);
  });
});

describe('unpublishedSlugs', () => {
  it('họ mới, họ đổi face, họ đổi tên là chưa publish; họ giống hệt thì không', () => {
    const live = seal;
    const draft: FontSeal = {
      families: [
        seal.families[0]!,
        { slug: 'moi', cssName: 'Mới', faces: [] },
      ],
    };
    expect([...unpublishedSlugs(draft, live)]).toEqual(['moi']);
    const renamed: FontSeal = { families: [{ ...seal.families[0]!, cssName: 'Be Vietnam' }] };
    expect([...unpublishedSlugs(renamed, live)]).toEqual(['be-vietnam-pro']);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/fonts/css.test.ts`
Expected: FAIL, không resolve được `./css`.

- [ ] **Step 3: Viết `src/lib/fonts/css.ts`**

```ts
/**
 * Bản niêm phong font và CSS `@font-face` sinh từ nó — spec §6.1. Hàm thuần.
 *
 * Cùng một hàm phục vụ bản nháp (seal đọc từ DB) và site thật (seal chụp trong
 * `Release.fonts`). Mọi trường được kiểm lại ở đây: đây là chỗ DUY NHẤT nằm giữa dữ
 * liệu (đã qua một chặng JSONB) và stylesheet. Hỏng thì bỏ, không ném.
 */

import { cssString, FONT_NAME_RE, WEIGHT_RE, type FontStyle } from './names';

export interface FontSealFace {
  key: string;
  weight: string;
  style: FontStyle;
  /** Rỗng = không giới hạn. */
  unicodeRange: string;
}

export interface FontSealFamily {
  slug: string;
  cssName: string;
  faces: FontSealFace[];
}

export interface FontSeal {
  families: FontSealFamily[];
}

export const EMPTY_FONT_SEAL: FontSeal = { families: [] };

const KEY_RE = /^public\/[A-Za-z0-9._~\-/]+\.(woff2|woff|ttf|otf)$/;
const RANGE_RE = /^U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?(, ?U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?)*$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const FORMAT: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
const MIME: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

const extOf = (key: string) => key.slice(key.lastIndexOf('.') + 1).toLowerCase();

export function isFontKey(key: string): boolean {
  return KEY_RE.test(key) && !key.includes('..') && !key.includes('//');
}

export const fontUrl = (key: string) => `/mm-font/${key}`;

export const fontMimeOf = (key: string) => MIME[extOf(key)] ?? 'application/octet-stream';

function validFace(f: FontSealFace): boolean {
  return (
    isFontKey(f.key) &&
    WEIGHT_RE.test(f.weight) &&
    (f.style === 'normal' || f.style === 'italic') &&
    (f.unicodeRange === '' || RANGE_RE.test(f.unicodeRange))
  );
}

const faceOrder = (a: FontSealFace, b: FontSealFace) =>
  a.weight.localeCompare(b.weight) || a.style.localeCompare(b.style)
  || a.unicodeRange.localeCompare(b.unicodeRange) || a.key.localeCompare(b.key);

export function fontFaceCss(seal: FontSeal): string {
  const blocks: string[] = [];
  const families = [...seal.families].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const fam of families) {
    if (!FONT_NAME_RE.test(fam.cssName)) continue;
    for (const f of [...fam.faces].sort(faceOrder)) {
      if (!validFace(f)) continue;
      const lines = [
        `  font-family: ${cssString(fam.cssName)};`,
        `  src: url("${fontUrl(f.key)}") format("${FORMAT[extOf(f.key)]}");`,
        `  font-weight: ${f.weight};`,
        `  font-style: ${f.style};`,
        '  font-display: swap;',
      ];
      if (f.unicodeRange) lines.push(`  unicode-range: ${f.unicodeRange};`);
      blocks.push(`@font-face {\n${lines.join('\n')}\n}`);
    }
  }
  return blocks.length ? `${blocks.join('\n')}\n` : '';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSONB của `Release.fonts` → `FontSeal`. `null` (release trước tính năng) và rác → rỗng. */
export function parseFontSeal(raw: unknown): FontSeal {
  if (!isObj(raw) || !Array.isArray(raw.families)) return { families: [] };
  const families: FontSealFamily[] = [];
  for (const f of raw.families) {
    if (!isObj(f) || typeof f.slug !== 'string' || !SLUG_RE.test(f.slug) || typeof f.cssName !== 'string' || !Array.isArray(f.faces)) continue;
    const faces: FontSealFace[] = [];
    for (const x of f.faces) {
      if (!isObj(x)) continue;
      const face = { key: x.key, weight: x.weight, style: x.style, unicodeRange: x.unicodeRange ?? '' };
      if (typeof face.key === 'string' && typeof face.weight === 'string' && typeof face.unicodeRange === 'string'
        && (face.style === 'normal' || face.style === 'italic')) {
        faces.push(face as FontSealFace);
      }
    }
    families.push({ slug: f.slug, cssName: f.cssName, faces });
  }
  return { families };
}

const familyKey = (f: FontSealFamily) => JSON.stringify([f.cssName, [...f.faces].sort(faceOrder)]);

/** Slug của họ mà bản nháp khác bản đang chạy — nhãn "Chưa publish" (spec §6.4). */
export function unpublishedSlugs(draft: FontSeal, live: FontSeal): Set<string> {
  const liveBySlug = new Map(live.families.map((f) => [f.slug, familyKey(f)]));
  const out = new Set<string>();
  for (const f of draft.families) if (liveBySlug.get(f.slug) !== familyKey(f)) out.add(f.slug);
  return out;
}
```

- [ ] **Step 4: Viết `src/components/site/FontFaceStyle.tsx`**

```tsx
/**
 * `<style data-mm-fonts>` — `@font-face` của các họ font tải lên. Chuỗi do
 * `fontFaceCss` sinh (đã kiểm từng trường), không phải chuỗi người dùng nhập.
 */
export function FontFaceStyle({ css }: { css: string }) {
  if (!css) return null;
  return (
    <style
      data-mm-fonts=""
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
```

- [ ] **Step 5: Chạy test**

Run: `pnpm vitest run src/lib/fonts/css.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fonts/css.ts src/lib/fonts/css.test.ts src/components/site/FontFaceStyle.tsx
git commit -m "feat(fonts): ban niem phong font va sinh @font-face tu no"
```

---

### Task 7: Bảng dữ liệu

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_dynamic_fonts/migration.sql` (sinh tự động)

- [ ] **Step 1: Kiểm schema không có thay đổi lạ**

Run: `git status --short prisma/schema.prisma`
Expected: không in gì. `migrate dev` chụp **cả file** — xem docblock `EffectPreset` cho sự cố đã xảy ra. Có thay đổi của người khác thì dừng lại và hỏi user.

- [ ] **Step 2: Thêm model** — đặt ngay sau `model EffectPreset { … }` trong `prisma/schema.prisma`

```prisma
/**
 * Họ font tải lên — spec docs/superpowers/specs/2026-10-16-dynamic-fonts-design.md §4.
 *
 * Mỗi họ SỞ HỮU một hàng Token `font-<slug>` (category 'font', custom). Hàng token chỉ
 * được tạo/sửa/xoá qua `src/lib/fonts/service.ts`; route design-tokens từ chối xoá nó.
 *
 * `cssName` @unique ở DB là so có phân biệt hoa thường; luật KHÔNG phân biệt (tên họ
 * trong CSS không phân biệt) do service kiểm.
 */
model FontFamily {
  id                 String     @id @default(cuid())
  /** Đuôi token `font-<slug>`. BẤT BIẾN: đổi là gãy mọi node trỏ vào token. */
  slug               String     @unique
  cssName            String     @unique
  fallback           String
  /** upload | google */
  source             String
  googleFamily       String?
  licenseNote        String?
  licenseConfirmedBy String?
  createdBy          String
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt
  faces              FontFace[]
}

model FontFace {
  id           String     @id @default(cuid())
  familyId     String
  family       FontFamily @relation(fields: [familyId], references: [id], onDelete: Cascade)
  /** "400", hoặc dải "100 900" của variable font. */
  weight       String
  /** normal | italic */
  style        String
  /** "" = không giới hạn. "" thay null để @@unique có hiệu lực trên Postgres. */
  unicodeRange String     @default("")
  /** vietnamese | latin-ext | latin | "" — nhãn hiển thị. */
  subset       String     @default("")
  /** Mã cảnh báo lúc tải lên (missing_vietnamese, restricted_embedding) — màn Font hiện lại. */
  warnings     String[]   @default([])
  assetId      String
  asset        Asset      @relation(fields: [assetId], references: [id], onDelete: Restrict)
  createdAt    DateTime   @default(now())

  @@unique([familyId, weight, style, unicodeRange])
  @@index([assetId])
}
```

Trong `model Asset`, thêm quan hệ ngược (cạnh các quan hệ sẵn có):

```prisma
  fontFaces FontFace[]
```

Trong `model Release`, ngay sau dòng `assets …`:

```prisma
  /**
   * FontSeal (`src/lib/fonts/css.ts`) — họ font tải lên lúc publish. Null ở release tạo
   * trước tính năng font động, nghĩa là không có font động.
   */
  fonts Json?
```

- [ ] **Step 3: Sinh migration và client**

Run: `pnpm db:up && pnpm db:migrate --name dynamic_fonts && pnpm db:generate`
Expected: thư mục `prisma/migrations/<ts>_dynamic_fonts/` có `CREATE TABLE "FontFamily"`, `CREATE TABLE "FontFace"` và `ALTER TABLE "Release" ADD COLUMN "fonts" JSONB`, **không có gì khác**. Có câu lệnh lạ thì dừng lại và hỏi user.

- [ ] **Step 4: Kiểm**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(fonts): bang FontFamily, FontFace va cot Release.fonts"
```

---

### Task 8: Chuẩn bị file và lập kế hoạch face

**Files:**
- Create: `src/lib/fonts/prepare.ts`, `src/lib/fonts/prepare.test.ts`, `src/lib/fonts/plan.ts`, `src/lib/fonts/plan.test.ts`

**Interfaces:**
- Consumes:
  - từ `inspect.ts`: `inspectFont`, `FontWarning`, `FontFileType`;
  - từ `convert.ts`: `toWoff2`, `ConvertTimeout`;
  - từ `names.ts`: `FONT_NAME_RE`, `WEIGHT_RE`, `MAX_FONT_BYTES`, `fontSlug`, `normalizeCssName`, `isReservedFamily`, `FontStyle`;
  - từ `errors.ts`: `fail`, `FontFailure`;
  - từ `unicode.ts`: `UPLOAD_UNICODE_RANGE`.
- Produces (`prepare.ts`):
  - `interface UploadOverrides { family?: string|null; weight?: string|null; style?: FontStyle|null }`;
  - `interface PreparedFace { bytes: Uint8Array; fileName: string; weight: string; style: FontStyle; unicodeRange: string; subset: string; warnings: FontWarning[] }`;
  - `interface Prepared { ok: true; cssName: string; detectedFamily: string|null; type: FontFileType; face: PreparedFace }`;
  - `checkCssName(raw): { ok: true; cssName: string } | FontFailure`;
  - `prepareFontFile(bytes, overrides?, opts?: { convert?: boolean }): Promise<Prepared | FontFailure>`.
- Produces (`plan.ts`):
  - `interface ExistingFace { id: string; weight: string; style: string; unicodeRange: string; assetId: string }`;
  - `type FacePlan = { action: 'create' } | { action: 'replace'; id: string } | { action: 'same'; id: string }`;
  - `planFace(existing, incoming: { weight; style; unicodeRange; assetId }): FacePlan`.

- [ ] **Step 1: Viết test hỏng** — `src/lib/fonts/plan.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { planFace } from './plan';

const face = { id: 'f1', weight: '400', style: 'normal', unicodeRange: '', assetId: 'a1' };

describe('planFace', () => {
  it('chưa có face cùng khoá thì tạo', () => {
    expect(planFace([face], { weight: '700', style: 'normal', unicodeRange: '', assetId: 'a2' })).toEqual({ action: 'create' });
    expect(planFace([face], { weight: '400', style: 'italic', unicodeRange: '', assetId: 'a2' })).toEqual({ action: 'create' });
    expect(planFace([face], { weight: '400', style: 'normal', unicodeRange: 'U+0041', assetId: 'a2' })).toEqual({ action: 'create' });
  });

  it('cùng khoá khác file thì thay', () => {
    expect(planFace([face], { weight: '400', style: 'normal', unicodeRange: '', assetId: 'a2' })).toEqual({ action: 'replace', id: 'f1' });
  });

  it('tải lại đúng file đó thì giữ nguyên', () => {
    expect(planFace([face], { weight: '400', style: 'normal', unicodeRange: '', assetId: 'a1' })).toEqual({ action: 'same', id: 'f1' });
  });
});
```

- [ ] **Step 2: Viết test hỏng** — `src/lib/fonts/prepare.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MAX_FONT_BYTES } from './names';
import { checkCssName, prepareFontFile } from './prepare';
import { UPLOAD_UNICODE_RANGE } from './unicode';

const font = (f: string) => new Uint8Array(readFileSync(`public/fonts/${f}`));

describe('checkCssName', () => {
  it('rỗng, sai ký tự, dành riêng', () => {
    expect(checkCssName('  ')).toMatchObject({ ok: false, code: 'name_required' });
    expect(checkCssName('a{b}')).toMatchObject({ ok: false, code: 'name_invalid' });
    expect(checkCssName('Inter')).toMatchObject({ ok: false, code: 'name_reserved' });
    expect(checkCssName(' Gilroy  Web ')).toEqual({ ok: true, cssName: 'Gilroy Web' });
  });
});

describe('prepareFontFile', () => {
  it('OTF: đổi sang woff2, cắt theo bộ chữ tải lên', async () => {
    const r = await prepareFontFile(font('gilroy-bold.otf'), { family: 'Gilroy Web' });
    if (!r.ok) throw new Error(r.error);
    expect(r.cssName).toBe('Gilroy Web');
    expect(r.detectedFamily).toBe('SVN-Gilroy');
    expect(r.face).toMatchObject({ weight: '700', style: 'normal', unicodeRange: UPLOAD_UNICODE_RANGE, subset: '' });
    expect(r.face.fileName).toBe('gilroy-web-700-normal.woff2');
    expect(String.fromCharCode(...r.face.bytes.subarray(0, 4))).toBe('wOF2');
  });

  it('tên đọc được thuộc danh sách dành riêng thì bắt đặt tên khác; tên đè thắng', async () => {
    expect(await prepareFontFile(font('newyork-regular.ttf'))).toMatchObject({ ok: false, code: 'name_reserved' });
    const r = await prepareFontFile(font('newyork-regular.ttf'), { family: 'NY Web', weight: '400 900' });
    if (!r.ok) throw new Error(r.error);
    expect(r.face.weight).toBe('400 900');
  });

  it('woff2 giữ nguyên byte, không giới hạn unicode-range', async () => {
    const src = font('inter-vietnamese.woff2');
    const r = await prepareFontFile(src, { family: 'Inter Web' });
    if (!r.ok) throw new Error(r.error);
    expect(r.face.bytes).toEqual(src);
    expect(r.face.unicodeRange).toBe('');
  });

  it('dryRun không cắt nhưng vẫn báo unicode-range sẽ dùng', async () => {
    const src = font('gilroy-bold.otf');
    const r = await prepareFontFile(src, { family: 'Gilroy Web' }, { convert: false });
    if (!r.ok) throw new Error(r.error);
    expect(r.face.bytes).toBe(src);
    expect(r.face.unicodeRange).toBe(UPLOAD_UNICODE_RANGE);
  });

  it('weight đè sai, file quá lớn', async () => {
    expect(await prepareFontFile(font('gilroy-bold.otf'), { family: 'G', weight: 'bold' })).toMatchObject({ code: 'weight_invalid' });
    expect(await prepareFontFile(new Uint8Array(MAX_FONT_BYTES + 1))).toMatchObject({ code: 'too_large', status: 413 });
  });
});
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/fonts/plan.test.ts src/lib/fonts/prepare.test.ts`
Expected: FAIL, thiếu module.

- [ ] **Step 4: Viết `src/lib/fonts/plan.ts`**

```ts
/** Một face mới so với các face đã có của họ: tạo, thay file, hay không làm gì. */

export interface ExistingFace {
  id: string;
  weight: string;
  style: string;
  unicodeRange: string;
  assetId: string;
}

export type FacePlan = { action: 'create' } | { action: 'replace'; id: string } | { action: 'same'; id: string };

export function planFace(
  existing: readonly ExistingFace[],
  incoming: { weight: string; style: string; unicodeRange: string; assetId: string },
): FacePlan {
  const hit = existing.find(
    (f) => f.weight === incoming.weight && f.style === incoming.style && f.unicodeRange === incoming.unicodeRange,
  );
  if (!hit) return { action: 'create' };
  return hit.assetId === incoming.assetId ? { action: 'same', id: hit.id } : { action: 'replace', id: hit.id };
}
```

- [ ] **Step 5: Viết `src/lib/fonts/prepare.ts`**

```ts
/**
 * Một file font → face sẵn sàng lưu — spec §7.1 bước 1–4. Không chạm DB hay S3.
 */

import { ConvertTimeout, toWoff2 } from './convert';
import { fail, type FontFailure } from './errors';
import { inspectFont, type FontFileType, type FontWarning } from './inspect';
import {
  FONT_NAME_RE, fontSlug, isReservedFamily, MAX_FONT_BYTES, normalizeCssName, WEIGHT_RE, type FontStyle,
} from './names';
import { UPLOAD_UNICODE_RANGE } from './unicode';

export interface UploadOverrides {
  family?: string | null;
  weight?: string | null;
  style?: FontStyle | null;
}

export interface PreparedFace {
  bytes: Uint8Array;
  fileName: string;
  weight: string;
  style: FontStyle;
  unicodeRange: string;
  subset: string;
  warnings: FontWarning[];
}

export interface Prepared {
  ok: true;
  cssName: string;
  detectedFamily: string | null;
  type: FontFileType;
  face: PreparedFace;
}

export function checkCssName(raw: string): { ok: true; cssName: string } | FontFailure {
  const cssName = normalizeCssName(raw);
  if (!cssName) return fail('name_required', 'Không đọc được tên họ trong file — nhập tên họ.');
  if (!FONT_NAME_RE.test(cssName)) {
    return fail('name_invalid', 'Tên họ chỉ gồm chữ, số, khoảng trắng, "-" và "_", tối đa 64 ký tự.');
  }
  if (isReservedFamily(cssName)) {
    return fail(
      'name_reserved',
      `"${cssName}" trùng tên một font có sẵn hoặc font dự phòng của site. Đặt tên khác, ví dụ "${cssName} Web".`,
    );
  }
  return { ok: true, cssName };
}

export async function prepareFontFile(
  bytes: Uint8Array,
  overrides: UploadOverrides = {},
  opts: { convert?: boolean } = {},
): Promise<Prepared | FontFailure> {
  if (bytes.length > MAX_FONT_BYTES) {
    return fail('too_large', `File font tối đa ${MAX_FONT_BYTES / 1024 / 1024} MB.`);
  }
  const r = inspectFont(bytes);
  if (!r.ok) return r;

  const name = checkCssName(overrides.family ?? r.info.family ?? '');
  if (!name.ok) return name;

  const weight = (overrides.weight ?? r.info.weight).trim();
  if (!WEIGHT_RE.test(weight)) {
    return fail('weight_invalid', 'Weight là một số từ 1 đến 1000, hoặc một dải như "100 900".');
  }
  const style = overrides.style ?? r.info.style;

  // woff2 giữ nguyên byte — đã tối ưu sẵn, cắt lại chỉ tốn CPU và có thể mất glyph.
  const willConvert = r.info.type !== 'woff2';
  let out = bytes;
  if (willConvert && opts.convert !== false) {
    try {
      out = await toWoff2(bytes);
    } catch (e) {
      if (e instanceof ConvertTimeout) {
        return fail('too_large', 'Xử lý font quá 30 giây — file quá lớn. Dùng bản .woff2 đã cắt sẵn.');
      }
      return fail('not_font', `Không cắt được font: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    ok: true,
    cssName: name.cssName,
    detectedFamily: r.info.family,
    type: r.info.type,
    face: {
      bytes: out,
      fileName: `${fontSlug(name.cssName)}-${weight.replace(' ', '-')}-${style}.woff2`,
      weight,
      style,
      unicodeRange: willConvert ? UPLOAD_UNICODE_RANGE : '',
      subset: '',
      warnings: r.info.warnings,
    },
  };
}
```

- [ ] **Step 6: Chạy test**

Run: `pnpm vitest run src/lib/fonts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/fonts/plan.ts src/lib/fonts/plan.test.ts src/lib/fonts/prepare.ts src/lib/fonts/prepare.test.ts
git commit -m "feat(fonts): chuan bi file font (ten, weight, cat) va ke hoach ghep face"
```

---

### Task 9: Đọc và ghi DB — seal, chỗ dùng, service

**Files:**
- Create: `src/lib/fonts/seal.ts`, `src/lib/fonts/usage-scan.ts`, `src/lib/fonts/usage-scan.test.ts`, `src/lib/fonts/usage.ts`, `src/lib/fonts/service.ts`

**Interfaces:**
- Consumes: `FontSeal` (Task 6), `PreparedFace`, `checkCssName` (Task 8), `planFace` (Task 8), `fontSlug`, `fontTokenName`, `fontTokenValue`, `resolveFallback` (Task 3), `fail` (Task 4), `uploadAsset` (`src/lib/builder/upload-asset.ts`), `CUSTOM_TOKENS_TAG` (`src/lib/render/custom-tokens.ts`).
- Produces (`seal.ts`): `FONTS_TAG = 'fonts'`, `readFontSeal(db?): Promise<FontSeal>`, `draftFontSeal(): Promise<FontSeal>`, `draftFontFaceCss(): Promise<string>`.
- Produces (`usage-scan.ts`):
  - `interface UsageRef { label: string; href: string }`, `interface TokenUsage { pages: UsageRef[]; components: UsageRef[] }`;
  - `interface UsageSource { kind: 'page'|'component'; ref: UsageRef; json: unknown }`;
  - `emptyUsage()`, `usageCount(u)`, `scanTokenUsage(names, sources): Map<string, TokenUsage>`.
- Produces (`usage.ts`): `tokenUsage(names: readonly string[]): Promise<Map<string, TokenUsage>>`.
- Produces (`service.ts`):
  - `interface Actor { email: string; sub: string }`;
  - `interface FamilyInput { cssName: string; fallback: string; source: 'upload'|'google'; googleFamily?: string|null; licenseNote?: string|null; licenseConfirmedBy?: string|null }`;
  - `interface SavedFace { weight: string; style: string; subset: string; bytes: number; replaced: boolean }`;
  - `interface SaveResult { ok: true; family: { id: string; slug: string; cssName: string; token: string; created: boolean }; faces: SavedFace[] }`;
  - `findFamilyByName(cssName)`, `saveFontFaces({ family, faces, actor }): Promise<SaveResult | FontFailure>`;
  - `updateFamily(id, patch: { cssName?: string; fallback?: string; licenseNote?: string|null }, actor): Promise<{ ok: true } | FontFailure>`;
  - `deleteFamily(id, actor)`, `deleteFace(familyId, faceId, actor)`: `Promise<{ ok: true } | FontFailure>`.

- [ ] **Step 1: Viết test hỏng** — `src/lib/fonts/usage-scan.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { scanTokenUsage, usageCount, type UsageSource } from './usage-scan';

const page = (href: string, json: unknown): UsageSource => ({ kind: 'page', ref: { label: href, href }, json });

describe('scanTokenUsage', () => {
  it('đếm trang và component, gộp bản nháp + bản live cùng trang', () => {
    const doc = { nodes: { a: { style: { base: { typography: { family: { $token: 'font-gilroy-web' } } } } } } };
    const out = scanTokenUsage(['font-gilroy-web', 'font-khac'], [
      page('/builder/p1', doc),
      page('/builder/p1', doc),
      { kind: 'component', ref: { label: 'Hero', href: '/builder/components/c1' }, json: doc },
    ]);
    expect(out.get('font-gilroy-web')).toEqual({
      pages: [{ label: '/builder/p1', href: '/builder/p1' }],
      components: [{ label: 'Hero', href: '/builder/components/c1' }],
    });
    expect(usageCount(out.get('font-khac')!)).toBe(0);
  });

  it('không khớp tiền tố: font-a không dính font-ab', () => {
    const out = scanTokenUsage(['font-a'], [page('/p', { x: { $token: 'font-ab' } })]);
    expect(usageCount(out.get('font-a')!)).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/fonts/usage-scan.test.ts`
Expected: FAIL, thiếu module.

- [ ] **Step 3: Viết `src/lib/fonts/usage-scan.ts`**

```ts
/**
 * Token đang được dùng ở đâu — phần thuần của `usage.ts`, để test không cần Postgres.
 *
 * Tìm dạng compact `"$token":"<tên>"`: JSON.stringify của Prisma Json không chèn
 * khoảng trắng (cùng lý lẽ với phép kiểm cũ của route design-tokens). Ngoặc kép
 * đóng trong chuỗi tìm là thứ chặn `font-a` khớp nhầm `font-ab`.
 */

export interface UsageRef {
  label: string;
  href: string;
}

export interface TokenUsage {
  pages: UsageRef[];
  components: UsageRef[];
}

export interface UsageSource {
  kind: 'page' | 'component';
  ref: UsageRef;
  json: unknown;
}

export const emptyUsage = (): TokenUsage => ({ pages: [], components: [] });

export const usageCount = (u: TokenUsage) => u.pages.length + u.components.length;

export function scanTokenUsage(names: readonly string[], sources: readonly UsageSource[]): Map<string, TokenUsage> {
  const out = new Map(names.map((n) => [n, emptyUsage()]));
  const seen = new Set<string>();
  for (const s of sources) {
    const text = JSON.stringify(s.json ?? null);
    for (const name of names) {
      if (!text.includes(`"$token":"${name}"`)) continue;
      const key = `${name}|${s.kind}|${s.ref.href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const u = out.get(name)!;
      (s.kind === 'page' ? u.pages : u.components).push(s.ref);
    }
  }
  return out;
}
```

- [ ] **Step 4: Viết `src/lib/fonts/usage.ts`**

```ts
import 'server-only';

import { prisma } from '@/lib/db';

import { scanTokenUsage, type TokenUsage, type UsageSource } from './usage-scan';

/**
 * Chỗ đang dùng các token: bản nháp và bản live của mọi trang chưa lưu trữ, cộng cây
 * component. Dùng chung cho xoá họ font, xoá face cuối, màn Font và route design-tokens.
 */
export async function tokenUsage(names: readonly string[]): Promise<Map<string, TokenUsage>> {
  if (!names.length) return new Map();

  const site = await prisma.site.findFirst({ select: { activeReleaseId: true } });
  const pages = await prisma.page.findMany({
    where: { archivedAt: null },
    select: { id: true, title: true, slug: true, draftVersionId: true },
  });
  const live = site?.activeReleaseId
    ? await prisma.releaseEntry.findMany({
        where: { releaseId: site.activeReleaseId },
        select: { versionId: true },
      })
    : [];
  const versionIds = [
    ...new Set([
      ...pages.map((p) => p.draftVersionId).filter((v): v is string => !!v),
      ...live.map((e) => e.versionId),
    ]),
  ];
  const versions = versionIds.length
    ? await prisma.pageVersion.findMany({
        where: { id: { in: versionIds } },
        select: { pageId: true, doc: true },
      })
    : [];
  const presets = await prisma.preset.findMany({ select: { id: true, name: true, tree: true } });

  const pageById = new Map(pages.map((p) => [p.id, p]));
  const sources: UsageSource[] = [
    ...versions.flatMap((v): UsageSource[] => {
      const p = pageById.get(v.pageId);
      return p ? [{ kind: 'page', ref: { label: `${p.title} (/${p.slug})`, href: `/builder/${p.id}` }, json: v.doc }] : [];
    }),
    ...presets.map((c): UsageSource => ({
      kind: 'component',
      ref: { label: c.name, href: `/builder/components/${c.id}` },
      json: c.tree,
    })),
  ];
  return scanTokenUsage(names, sources);
}
```

- [ ] **Step 5: Viết `src/lib/fonts/seal.ts`**

```ts
import 'server-only';

import type { Prisma } from '@prisma/client';
import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/db';

import { fontFaceCss, type FontSeal } from './css';

/** Tag revalidate — mọi đường ghi font phải gọi nó. */
export const FONTS_TAG = 'fonts';

type Db = Pick<Prisma.TransactionClient, 'fontFamily'>;

/** Đọc thẳng DB. Route publish gọi bản này (không qua cache) để niêm phong đúng lúc bấm. */
export async function readFontSeal(db: Db = prisma): Promise<FontSeal> {
  const families = await db.fontFamily.findMany({
    orderBy: { slug: 'asc' },
    select: {
      slug: true,
      cssName: true,
      faces: {
        orderBy: [{ weight: 'asc' }, { style: 'asc' }, { unicodeRange: 'asc' }],
        select: { weight: true, style: true, unicodeRange: true, asset: { select: { key: true } } },
      },
    },
  });
  return {
    families: families.map((f) => ({
      slug: f.slug,
      cssName: f.cssName,
      faces: f.faces.map((x) => ({
        key: x.asset.key,
        weight: x.weight,
        style: x.style === 'italic' ? 'italic' : 'normal',
        unicodeRange: x.unicodeRange,
      })),
    })),
  };
}

const cachedSeal = unstable_cache(() => readFontSeal(), ['font-seal'], { tags: [FONTS_TAG] });

/** Bản nháp — canvas, xem nháp, màn Font. */
export const draftFontSeal = (): Promise<FontSeal> => cachedSeal();

export async function draftFontFaceCss(): Promise<string> {
  return fontFaceCss(await cachedSeal());
}
```

- [ ] **Step 6: Viết `src/lib/fonts/service.ts`**

```ts
import 'server-only';

import { Prisma } from '@prisma/client';
import { revalidateTag } from 'next/cache';

import { uploadAsset } from '@/lib/builder/upload-asset';
import { prisma } from '@/lib/db';
import { CUSTOM_TOKENS_TAG } from '@/lib/render/custom-tokens';

import { fail, type FontFailure } from './errors';
import { fontSlug, fontTokenName, fontTokenValue, isReservedFamily, normalizeCssName, resolveFallback } from './names';
import { planFace } from './plan';
import { checkCssName, type PreparedFace } from './prepare';
import { FONTS_TAG } from './seal';
import { usageCount } from './usage-scan';
import { tokenUsage } from './usage';

export interface Actor {
  email: string;
  sub: string;
}

export interface FamilyInput {
  cssName: string;
  fallback: string;
  source: 'upload' | 'google';
  googleFamily?: string | null;
  licenseNote?: string | null;
  licenseConfirmedBy?: string | null;
}

export interface SavedFace {
  weight: string;
  style: string;
  subset: string;
  bytes: number;
  replaced: boolean;
}

export interface SaveResult {
  ok: true;
  family: { id: string; slug: string; cssName: string; token: string; created: boolean };
  faces: SavedFace[];
}

class SlugTaken extends Error {}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

function revalidate() {
  revalidateTag(FONTS_TAG);
  revalidateTag(CUSTOM_TOKENS_TAG);
}

/** So tên KHÔNG phân biệt hoa thường — tên họ trong CSS không phân biệt. */
export function findFamilyByName(cssName: string) {
  return prisma.fontFamily.findFirst({
    where: { cssName: { equals: normalizeCssName(cssName), mode: 'insensitive' } },
    select: {
      id: true, slug: true, cssName: true,
      faces: { select: { id: true, weight: true, style: true, unicodeRange: true, assetId: true } },
    },
  });
}

/**
 * Lưu một hay nhiều face vào một họ (tạo họ + token nếu chưa có) — spec §7.1 bước 5–6.
 *
 * File lên S3 TRƯỚC transaction: object không hoàn tác được, nhưng khoá theo nội dung
 * nên lần ghi lại sau một transaction hỏng là no-op.
 */
export async function saveFontFaces(input: {
  family: FamilyInput;
  faces: PreparedFace[];
  actor: Actor;
}): Promise<SaveResult | FontFailure> {
  const cssName = normalizeCssName(input.family.cssName);
  const existing = await findFamilyByName(cssName);
  if (!existing && isReservedFamily(cssName)) return checkCssName(cssName) as FontFailure;
  const slug = existing?.slug ?? fontSlug(cssName);

  const uploaded: { face: PreparedFace; assetId: string; bytes: number }[] = [];
  for (const face of input.faces) {
    const r = await uploadAsset({
      bytes: face.bytes,
      fileName: face.fileName,
      actorEmail: input.actor.email,
      actorSub: input.actor.sub,
      folder: `fonts/${slug}`.slice(0, 46),
    });
    if (!r.ok) return fail(r.status === 413 ? 'too_large' : 'not_font', r.error);
    uploaded.push({ face, assetId: r.asset.id, bytes: r.asset.bytes });
  }

  const run = () =>
    prisma.$transaction(async (tx) => {
      let family = existing
        ? await tx.fontFamily.findUnique({ where: { id: existing.id }, include: { faces: true } })
        : null;
      let created = false;
      if (!family) {
        const tokenName = fontTokenName(slug);
        if (await tx.token.findUnique({ where: { name: tokenName }, select: { id: true } })) {
          throw new SlugTaken(tokenName);
        }
        family = await tx.fontFamily.create({
          data: {
            slug, cssName,
            fallback: input.family.fallback,
            source: input.family.source,
            googleFamily: input.family.googleFamily ?? null,
            licenseNote: input.family.licenseNote ?? null,
            licenseConfirmedBy: input.family.licenseConfirmedBy ?? null,
            createdBy: input.actor.email,
          },
          include: { faces: true },
        });
        await tx.token.create({
          data: {
            name: tokenName,
            value: fontTokenValue(cssName, input.family.fallback),
            category: 'font',
            custom: true,
            aiDescription: `Họ font ${cssName} (${input.family.source === 'google' ? 'Google Fonts' : 'tải lên'}). Gán bằng typography.family.`,
          },
        });
        created = true;
      }

      const faces: SavedFace[] = [];
      const known = [...family.faces];
      for (const u of uploaded) {
        const { weight, style, unicodeRange, subset, warnings } = u.face;
        const plan = planFace(known, { weight, style, unicodeRange, assetId: u.assetId });
        const codes = warnings.map((w) => w.code);
        if (plan.action === 'create') {
          const made = await tx.fontFace.create({
            data: { familyId: family.id, weight, style, unicodeRange, subset, warnings: codes, assetId: u.assetId },
          });
          known.push(made);
        } else if (plan.action === 'replace') {
          await tx.fontFace.update({ where: { id: plan.id }, data: { assetId: u.assetId, subset, warnings: codes } });
        }
        faces.push({ weight, style, subset, bytes: u.bytes, replaced: plan.action === 'replace' });
      }

      await tx.auditLog.create({
        data: {
          userId: input.actor.sub,
          action: 'font.upload',
          targetType: 'FontFamily',
          targetId: family.id,
          meta: { cssName, created, faces } as unknown as Prisma.InputJsonObject,
        },
      });
      return {
        ok: true as const,
        family: { id: family.id, slug: family.slug, cssName: family.cssName, token: fontTokenName(family.slug), created },
        faces,
      };
    });

  try {
    const result = await run();
    revalidate();
    return result;
  } catch (e) {
    if (e instanceof SlugTaken) {
      return fail('slug_taken', `Đã có token "${e.message}" — đặt tên họ khác.`);
    }
    if (isUnique(e)) {
      return fail('slug_taken', 'Họ font này vừa được tạo ở nơi khác cùng lúc — thử lại.');
    }
    throw e;
  }
}

export async function updateFamily(
  id: string,
  patch: { cssName?: string; fallback?: string; licenseNote?: string | null },
  actor: Actor,
): Promise<{ ok: true } | FontFailure> {
  const family = await prisma.fontFamily.findUnique({ where: { id } });
  if (!family) return fail('not_found', 'Không tìm thấy họ font.');

  let cssName = family.cssName;
  if (patch.cssName !== undefined && normalizeCssName(patch.cssName) !== family.cssName) {
    const checked = checkCssName(patch.cssName);
    if (!checked.ok) return checked;
    const clash = await findFamilyByName(checked.cssName);
    if (clash && clash.id !== id) return fail('name_reserved', `Đã có họ "${clash.cssName}".`);
    cssName = checked.cssName;
  }
  let fallback = family.fallback;
  if (patch.fallback !== undefined) {
    const f = resolveFallback(patch.fallback);
    if (!f.ok) return fail('fallback_invalid', f.error);
    fallback = f.value;
  }

  await prisma.$transaction([
    prisma.fontFamily.update({
      where: { id },
      data: { cssName, fallback, ...(patch.licenseNote !== undefined ? { licenseNote: patch.licenseNote } : {}) },
    }),
    prisma.token.update({
      where: { name: fontTokenName(family.slug) },
      data: { value: fontTokenValue(cssName, fallback) },
    }),
    prisma.auditLog.create({
      data: {
        userId: actor.sub, action: 'font.update', targetType: 'FontFamily', targetId: id,
        meta: { before: { cssName: family.cssName, fallback: family.fallback }, after: { cssName, fallback } },
      },
    }),
  ]);
  revalidate();
  return { ok: true };
}

export async function deleteFamily(id: string, actor: Actor): Promise<{ ok: true } | FontFailure> {
  const family = await prisma.fontFamily.findUnique({ where: { id }, select: { slug: true, cssName: true } });
  if (!family) return fail('not_found', 'Không tìm thấy họ font.');
  const token = fontTokenName(family.slug);
  const usage = (await tokenUsage([token])).get(token)!;
  if (usageCount(usage)) {
    return fail('in_use', `Còn ${usageCount(usage)} nơi đang dùng "${family.cssName}". Đổi font ở những chỗ đó trước.`, { usage });
  }
  await prisma.$transaction([
    prisma.token.deleteMany({ where: { name: token } }),
    prisma.fontFamily.delete({ where: { id } }),
    prisma.auditLog.create({
      data: { userId: actor.sub, action: 'font.delete', targetType: 'FontFamily', targetId: id, meta: { cssName: family.cssName } },
    }),
  ]);
  revalidate();
  return { ok: true };
}

export async function deleteFace(familyId: string, faceId: string, actor: Actor): Promise<{ ok: true } | FontFailure> {
  const family = await prisma.fontFamily.findUnique({
    where: { id: familyId },
    select: { slug: true, cssName: true, faces: { select: { id: true, weight: true, style: true } } },
  });
  const face = family?.faces.find((f) => f.id === faceId);
  if (!family || !face) return fail('not_found', 'Không tìm thấy face này.');
  if (family.faces.length === 1) {
    const token = fontTokenName(family.slug);
    const usage = (await tokenUsage([token])).get(token)!;
    if (usageCount(usage)) {
      return fail('in_use', `Đây là file cuối của "${family.cssName}" và còn ${usageCount(usage)} nơi đang dùng.`, { usage });
    }
  }
  await prisma.$transaction([
    prisma.fontFace.delete({ where: { id: faceId } }),
    prisma.auditLog.create({
      data: {
        userId: actor.sub, action: 'font.face.delete', targetType: 'FontFamily', targetId: familyId,
        meta: { weight: face.weight, style: face.style },
      },
    }),
  ]);
  revalidate();
  return { ok: true };
}
```

Ghi chú:
- `folder` cắt còn 46 ký tự vì mỗi đoạn thư mục tối đa 40 ký tự (`FOLDER_SEGMENT_RE`): `fonts/` (6 ký tự) cộng slug tối đa 40.
- Slug dài hơn 40 vẫn là slug đúng; chỉ thư mục duyệt kho bị cắt.

- [ ] **Step 7: Chạy test và typecheck**

Run: `pnpm vitest run src/lib/fonts && pnpm typecheck`
Expected: PASS. Phần ghi DB được e2e ở Task 12 kiểm.

- [ ] **Step 8: Commit**

```bash
git add src/lib/fonts/seal.ts src/lib/fonts/usage-scan.ts src/lib/fonts/usage-scan.test.ts src/lib/fonts/usage.ts src/lib/fonts/service.ts
git commit -m "feat(fonts): doc ban niem phong, dem cho dung token va ghi ho font vao DB"
```

---

### Task 10: Nhập từ Google Fonts

**Files:**
- Create: `src/lib/fonts/google-fixture.ts`, `src/lib/fonts/google-parse.ts`, `src/lib/fonts/google-parse.test.ts`, `src/lib/fonts/google.ts`, `src/lib/fonts/google.test.ts`

**Interfaces:**
- Produces (`google-parse.ts`):
  - `interface GoogleFace { subset: string; family: string; style: FontStyle; weight: string; url: string; unicodeRange: string }`;
  - `parseGoogleCss(css): GoogleFace[]`, `keepSubsets(faces): GoogleFace[]`, `googleFamilyFromInput(input): string|null`;
  - `rangeUrl(family, italic): string`, `singleUrl(family, weight, italic): string`.
- Produces (`google.ts`):
  - `type FetchLike = (url: string, init?: RequestInit) => Promise<Response>`;
  - `interface FetchedFace extends GoogleFace { bytes: Uint8Array }`;
  - `fetchGoogleFaces(input: { family: string; weights?: number[]; italic?: boolean }, fetchImpl?: FetchLike): Promise<{ ok: true; family: string; faces: FetchedFace[] } | FontFailure>`.

- [ ] **Step 1: Viết fixture và test hỏng**

Fixture nằm ở file riêng, không trong file test. Nếu `google.test.ts` import thẳng từ một file `.test.ts`, mọi `describe` của file kia sẽ chạy thêm một lần.

`src/lib/fonts/google-fixture.ts`:

```ts
/** Rút từ phản hồi thật ngày 16/10/2026 (Be Vietnam Pro, wght@400), thêm một khối cyrillic. */
export const CSS2_SAMPLE = `/* cyrillic */
@font-face {
  font-family: 'Be Vietnam Pro';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/bevietnampro/v12/cyr.woff2) format('woff2');
  unicode-range: U+0400-045F;
}
/* vietnamese */
@font-face {
  font-family: 'Be Vietnam Pro';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/bevietnampro/v12/vi.woff2) format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'Be Vietnam Pro';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/bevietnampro/v12/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Be Vietnam Pro';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/bevietnampro/v12/lat.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
`;
```

`src/lib/fonts/google-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { CSS2_SAMPLE } from './google-fixture';
import { googleFamilyFromInput, keepSubsets, parseGoogleCss, rangeUrl, singleUrl } from './google-parse';

describe('parseGoogleCss', () => {
  it('đọc từng khối kèm tên bộ chữ', () => {
    const faces = parseGoogleCss(CSS2_SAMPLE);
    expect(faces).toHaveLength(4);
    expect(faces[1]).toEqual({
      subset: 'vietnamese', family: 'Be Vietnam Pro', style: 'normal', weight: '400',
      url: 'https://fonts.gstatic.com/s/bevietnampro/v12/vi.woff2',
      unicodeRange: 'U+0102-0103, U+0110-0111, U+1EA0-1EF9, U+20AB',
    });
  });

  it('chỉ giữ vietnamese, latin-ext, latin', () => {
    expect(keepSubsets(parseGoogleCss(CSS2_SAMPLE)).map((f) => f.subset)).toEqual(['vietnamese', 'latin-ext', 'latin']);
  });

  it('bỏ khối có URL ngoài fonts.gstatic.com', () => {
    expect(parseGoogleCss(CSS2_SAMPLE.replace('https://fonts.gstatic.com/s/bevietnampro/v12/vi.woff2', 'https://evil.example/x.woff2'))).toHaveLength(3);
  });
});

describe('googleFamilyFromInput', () => {
  it('tên, link specimen, link có tham số', () => {
    expect(googleFamilyFromInput(' Be  Vietnam Pro ')).toBe('Be Vietnam Pro');
    expect(googleFamilyFromInput('https://fonts.google.com/specimen/Be+Vietnam+Pro')).toBe('Be Vietnam Pro');
    expect(googleFamilyFromInput('https://fonts.google.com/specimen/Inter?query=inter')).toBe('Inter');
    expect(googleFamilyFromInput('a;b')).toBeNull();
  });
});

describe('URL css2', () => {
  it('dải variable và từng weight', () => {
    expect(rangeUrl('Be Vietnam Pro', true)).toBe(
      'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,100..900;1,100..900&display=swap',
    );
    expect(rangeUrl('Inter', false)).toBe('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
    expect(singleUrl('Inter', 700, true)).toBe('https://fonts.googleapis.com/css2?family=Inter:ital,wght@1,700&display=swap');
  });
});
```

- [ ] **Step 2: Viết test hỏng** — `src/lib/fonts/google.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { fetchGoogleFaces, type FetchLike } from './google';
import { CSS2_SAMPLE } from './google-fixture';

const css = (weight: number) => CSS2_SAMPLE.replaceAll('font-weight: 400', `font-weight: ${weight}`)
  .replaceAll('.woff2', `-${weight}.woff2`);

/** Họ tĩnh, không có italic, chỉ có 400 và 700. */
const staticFont: FetchLike = async (url) => {
  if (url.startsWith('https://fonts.gstatic.com/')) return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
  const m = /ital,wght@0,(\d+)&/.exec(url);
  if (m && (m[1] === '400' || m[1] === '700')) return new Response(css(Number(m[1])));
  return new Response('bad', { status: 400 });
};

describe('fetchGoogleFaces', () => {
  it('họ tĩnh không italic: rơi về từng weight, giữ face tồn tại', async () => {
    const r = await fetchGoogleFaces({ family: 'Be Vietnam Pro' }, staticFont);
    if (!r.ok) throw new Error(r.error);
    expect(r.family).toBe('Be Vietnam Pro');
    expect(r.faces.map((f) => `${f.weight}/${f.subset}`)).toEqual([
      '400/vietnamese', '400/latin-ext', '400/latin', '700/vietnamese', '700/latin-ext', '700/latin',
    ]);
    expect(r.faces.every((f) => f.style === 'normal' && f.bytes.length === 4)).toBe(true);
  });

  it('không có họ đó thì google_not_found', async () => {
    const none: FetchLike = async () => new Response('bad', { status: 400 });
    expect(await fetchGoogleFaces({ family: 'Khong Co' }, none)).toMatchObject({ ok: false, code: 'google_not_found' });
  });

  it('mất mạng thì google_unreachable ngay, không thử tiếp 18 lần', async () => {
    let calls = 0;
    const down: FetchLike = async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    };
    expect(await fetchGoogleFaces({ family: 'Inter' }, down)).toMatchObject({ ok: false, code: 'google_unreachable', status: 502 });
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/fonts/google-parse.test.ts src/lib/fonts/google.test.ts`
Expected: FAIL, thiếu module.

- [ ] **Step 4: Viết `src/lib/fonts/google-parse.ts`**

```ts
/** Phản hồi `css2` của Google Fonts → danh sách face. Hàm thuần — spec §8. */

import type { FontStyle } from './names';
import { KEPT_SUBSETS } from './unicode';

export interface GoogleFace {
  subset: string;
  family: string;
  style: FontStyle;
  weight: string;
  url: string;
  unicodeRange: string;
}

const BLOCK_RE = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi;
/** Chỉ tải từ máy chủ file của Google — phản hồi bị chèn URL lạ thì bỏ khối đó. */
const URL_RE = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s'"]+\.woff2)\)/;

const prop = (body: string, name: string) =>
  new RegExp(`${name}\\s*:\\s*([^;]+);`, 'i').exec(body)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;

export function parseGoogleCss(css: string): GoogleFace[] {
  const out: GoogleFace[] = [];
  for (const m of css.matchAll(BLOCK_RE)) {
    const body = m[2]!;
    const family = prop(body, 'font-family')?.replace(/^['"]|['"]$/g, '');
    const style = prop(body, 'font-style');
    const weight = prop(body, 'font-weight');
    const url = URL_RE.exec(body)?.[1];
    if (!family || !weight || !url || (style !== 'normal' && style !== 'italic')) continue;
    out.push({ subset: m[1]!.toLowerCase(), family, style, weight, url, unicodeRange: prop(body, 'unicode-range') ?? '' });
  }
  return out;
}

export function keepSubsets(faces: readonly GoogleFace[]): GoogleFace[] {
  return faces.filter((f) => (KEPT_SUBSETS as readonly string[]).includes(f.subset));
}

/** Tên họ, hoặc link `fonts.google.com/specimen/<Tên>` → tên họ. `null` khi không hợp lệ. */
export function googleFamilyFromInput(input: string): string | null {
  let name = input.trim();
  const m = /fonts\.google\.com\/specimen\/([^/?#]+)/i.exec(name);
  if (m) name = decodeURIComponent(m[1]!.replace(/\+/g, ' '));
  name = name.replace(/\s+/g, ' ').trim();
  return /^[A-Za-z0-9][A-Za-z0-9 ]{0,63}$/.test(name) ? name : null;
}

const BASE = 'https://fonts.googleapis.com/css2';
const fam = (family: string) => family.replace(/ /g, '+');

export function rangeUrl(family: string, italic: boolean): string {
  return italic
    ? `${BASE}?family=${fam(family)}:ital,wght@0,100..900;1,100..900&display=swap`
    : `${BASE}?family=${fam(family)}:wght@100..900&display=swap`;
}

export function singleUrl(family: string, weight: number, italic: boolean): string {
  return `${BASE}?family=${fam(family)}:ital,wght@${italic ? 1 : 0},${weight}&display=swap`;
}
```

- [ ] **Step 5: Viết `src/lib/fonts/google.ts`**

```ts
/**
 * Kéo font từ Google Fonts về — spec §8. `fetchImpl` tiêm được để test không gọi mạng.
 *
 * Thứ tự thử:
 *  1. dải variable (có italic, rồi không italic);
 *  2. từng weight 100–900 (× italic nếu lấy).
 * Lỗi mạng thì DỪNG NGAY: thử tiếp 18 lần, mỗi lần chờ 10 giây, là bắt người dùng
 * đợi 3 phút để nhận cùng một câu trả lời.
 */

import { fail, type FontFailure } from './errors';
import { googleFamilyFromInput, keepSubsets, parseGoogleCss, rangeUrl, singleUrl, type GoogleFace } from './google-parse';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchedFace extends GoogleFace {
  bytes: Uint8Array;
}

/** Google trả woff2 chỉ khi User-Agent là trình duyệt hiện đại. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 10_000;
const MAX_FILES = 60;
const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const UNREACHABLE =
  'Server không kết nối được Google Fonts. Hãy tải font về máy rồi dùng mục "Tải file font".';

class Unreachable extends Error {}

async function get(url: string, f: FetchLike): Promise<Response> {
  try {
    return await f(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Unreachable();
  }
}

export async function fetchGoogleFaces(
  input: { family: string; weights?: number[]; italic?: boolean },
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; family: string; faces: FetchedFace[] } | FontFailure> {
  const name = googleFamilyFromInput(input.family);
  if (!name) return fail('bad_request', 'Tên họ Google Fonts chỉ gồm chữ không dấu, số và khoảng trắng — hoặc dán link specimen.');
  const italic = input.italic ?? true;

  const tryCss = async (url: string): Promise<GoogleFace[] | null> => {
    const r = await get(url, fetchImpl);
    return r.ok ? parseGoogleCss(await r.text()) : null;
  };

  try {
    let faces: GoogleFace[] = [];
    if (!input.weights?.length) {
      faces = (await tryCss(rangeUrl(name, italic))) ?? (italic ? (await tryCss(rangeUrl(name, false))) ?? [] : []);
    }
    if (!faces.length) {
      for (const w of input.weights?.length ? input.weights : ALL_WEIGHTS) {
        for (const ital of italic ? [false, true] : [false]) {
          faces.push(...((await tryCss(singleUrl(name, w, ital))) ?? []));
        }
      }
    }
    faces = keepSubsets(faces);
    if (!faces.length) return fail('google_not_found', `Google Fonts không có họ "${name}" (hoặc không có weight đã chọn).`);
    if (faces.length > MAX_FILES) return fail('bad_request', `Quá ${MAX_FILES} file — chọn bớt weight.`);

    const out: FetchedFace[] = [];
    for (const face of faces) {
      const r = await get(face.url, fetchImpl);
      if (!r.ok) throw new Unreachable();
      out.push({ ...face, bytes: new Uint8Array(await r.arrayBuffer()) });
    }
    return { ok: true, family: faces[0]!.family, faces: out };
  } catch (e) {
    if (e instanceof Unreachable) return fail('google_unreachable', UNREACHABLE);
    throw e;
  }
}
```

- [ ] **Step 6: Chạy test**

Run: `pnpm vitest run src/lib/fonts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/fonts/google-fixture.ts src/lib/fonts/google-parse.ts src/lib/fonts/google-parse.test.ts src/lib/fonts/google.ts src/lib/fonts/google.test.ts
git commit -m "feat(fonts): nhap ho font tu Google Fonts (vietnamese, latin-ext, latin)"
```

---

### Task 11: Token font — hạng `font`, phát CSS, chặn xoá nhầm

**Files:**
- Create: `src/lib/design/token-category.ts`, `src/lib/design/token-category.test.ts`
- Modify: `scripts/import-tokens.ts`, `src/lib/design/foundations.ts`, `src/lib/design/foundations.test.ts`, `src/lib/render/custom-tokens.ts`, `src/app/api/design-tokens/[id]/route.ts`

**Interfaces:**
- Produces:
  - `categorizeToken(name): { category: string; group: string | null }`;
  - `isCustomTokenValue(name, value): boolean` (trong `foundations.ts`).
- Consumes: `tokenUsage`, `usageCount` (Task 9).

- [ ] **Step 1: Viết test hỏng** — `src/lib/design/token-category.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { categorizeToken } from './token-category';

describe('categorizeToken', () => {
  it('họ font vào hạng font — bộ chọn typography.family lọc đúng hạng này', () => {
    for (const n of ['font-display', 'font-body', 'font-mono', 'font-newyork', 'font-gilroy', 'lv-font-head', 'lv-font-body']) {
      expect(categorizeToken(n), n).toEqual({ category: 'font', group: null });
    }
  });

  it('các hạng khác giữ nguyên', () => {
    expect(categorizeToken('weight-bold').category).toBe('typography');
    expect(categorizeToken('leading-body').category).toBe('typography');
    expect(categorizeToken('color-bg').category).toBe('color');
    expect(categorizeToken('mm-s6-head-gap')).toEqual({ category: 'figma', group: 's6' });
    expect(categorizeToken('lv-gap').category).toBe('other');
  });
});
```

Thêm vào `src/lib/design/foundations.test.ts`:

```ts
describe('isCustomTokenValue', () => {
  it('màu hex với mọi tên; chuỗi font chỉ với tên font-*', () => {
    expect(isCustomTokenValue('brand', '#6937ff')).toBe(true);
    expect(isCustomTokenValue('font-be-vietnam-pro', '"Be Vietnam Pro", system-ui, sans-serif')).toBe(true);
    expect(isCustomTokenValue('brand', '"Be Vietnam Pro", sans-serif')).toBe(false);
    expect(isCustomTokenValue('font-x', 'a; } body { color: red')).toBe(false);
    expect(isCustomTokenValue('font-x', 'url(https://x)')).toBe(false);
    expect(isCustomTokenValue('font-x', '')).toBe(false);
  });
});
```

Thêm `isCustomTokenValue` vào dòng import ở đầu file test.

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/design`
Expected: FAIL, thiếu `token-category` và `isCustomTokenValue`.

- [ ] **Step 3: Viết `src/lib/design/token-category.ts`**

Chuyển hàm `categorize` từ `scripts/import-tokens.ts` sang đây: giữ nguyên thân hàm, đổi tên, thêm luật font ở đầu.

```ts
/**
 * Tên token → hạng + nhóm. Tách khỏi `scripts/import-tokens.ts` để test được (script
 * gọi `main()` ngay khi nạp và cần Postgres).
 */
export function categorizeToken(name: string): { category: string; group: string | null } {
  // Họ font — đứng TRƯỚC luật `font*` → typography bên dưới. Bộ chọn `typography.family`
  // lọc `category === 'font'`; xếp chúng vào 'typography' là bộ chọn rỗng (16/10/2026).
  if (/^(lv-)?font-/.test(name)) return { category: 'font', group: null };
  if (name.startsWith('mm-')) {
    // --mm-s6-head-gap → group 's6'
    const seg = name.slice(3).split('-')[0] ?? null;
    return { category: 'figma', group: seg };
  }
  if (name.startsWith('color-') || name.startsWith('surface') || name.startsWith('ink')) {
    return { category: 'color', group: null };
  }
  if (name.startsWith('space') || name === 'gutter' || name === 'measure') {
    return { category: 'space', group: null };
  }
  if (name.startsWith('step')) return { category: 'typeScale', group: null };
  if (name.startsWith('font') || name.startsWith('weight')
    || name.startsWith('leading') || name.startsWith('tracking')) {
    return { category: 'typography', group: null };
  }
  if (name.startsWith('radius')) return { category: 'radius', group: null };
  if (name.startsWith('dur')) return { category: 'duration', group: null };
  if (name.startsWith('ease')) return { category: 'easing', group: null };
  if (name.startsWith('shadow')) return { category: 'shadow', group: null };
  if (name.startsWith('z-')) return { category: 'zIndex', group: null };
  return { category: 'other', group: null };
}
```

Trong `scripts/import-tokens.ts`:
- xoá hàm `categorize`;
- thêm `import { categorizeToken } from '../src/lib/design/token-category';`;
- đổi `const { category, group } = categorize(name);` thành `categorizeToken(name)`.

Không phải đổi gì thêm: nhánh `update` của `upsert` đã ghi lại `category` cho hàng có sẵn, kể cả hàng `frozen`.

- [ ] **Step 4: Thêm `isCustomTokenValue`** — `src/lib/design/foundations.ts`, ngay dưới `FONT_FORBIDDEN_RE`

```ts
/**
 * Token TỰ TẠO phát được vào stylesheet: màu hex, hoặc chuỗi font của một họ font
 * tải lên (tên `font-<slug>`, spec 2026-10-16-dynamic-fonts §6.5). Dùng chung cho
 * đường đọc bảng live và đường đọc ảnh chụp release — hai đường, một luật.
 */
export function isCustomTokenValue(name: string, value: string): boolean {
  if (TOKEN_COLOR_RE.test(value)) return true;
  const v = value.trim();
  return name.startsWith('font-') && v.length > 0 && v.length <= 300 && !FONT_FORBIDDEN_RE.test(v);
}
```

Nếu `TOKEN_COLOR_RE` khai **sau** chỗ này trong file, đặt hàm xuống dưới dòng khai `TOKEN_COLOR_RE` (dòng 38).

- [ ] **Step 5: Dùng luật mới trong `src/lib/render/custom-tokens.ts`**

- Import: `import { TOKEN_COLOR_RE, TOKEN_NAME_RE, isCustomTokenValue, isEmittableOverride } from '@/lib/design/foundations';`
- Trong `usable()`: đổi `if (row.custom) return TOKEN_COLOR_RE.test(row.value);` thành `if (row.custom) return isCustomTokenValue(row.name, row.value);`. Sửa câu docblock "Token tự tạo vẫn chỉ nhận MÀU" thành "Token tự tạo nhận màu, và chuỗi font của họ font tải lên (`isCustomTokenValue`)".
- Trong `tokenCssFromSeal()`: đổi `.filter(([name, value]) => TOKEN_NAME_RE.test(name) && TOKEN_COLOR_RE.test(value))` thành `.filter(([name, value]) => TOKEN_NAME_RE.test(name) && isCustomTokenValue(name, value))`.

- [ ] **Step 6: Chặn xoá token font và đếm cả component** — `src/app/api/design-tokens/[id]/route.ts`

- Xoá hàm `pagesUsing`. Thêm import:

```ts
import { tokenUsage } from '@/lib/fonts/usage';
import { usageCount } from '@/lib/fonts/usage-scan';
```

- Select thêm `category: true` trong `prisma.token.findUnique`.
- Ngay sau khối `if (!token.custom) { … }`:

```ts
  if (token.category === 'font') {
    // Token của một họ font: xoá ở đây là để lại họ font mồ côi không có token.
    return NextResponse.json(
      { error: `"${token.name}" thuộc một họ font — xoá ở Cài đặt › Font.` },
      { status: 409 },
    );
  }
```

- Thay khối `const used = await pagesUsing(token.name); if (used.length) { … }` bằng:

```ts
  const usage = (await tokenUsage([token.name])).get(token.name)!;
  if (usageCount(usage)) {
    const where = [...usage.pages, ...usage.components].map((u) => u.label);
    return NextResponse.json(
      {
        error: `Còn ${where.length} nơi đang dùng "${token.name}": ${where.join(', ')}. Đổi màu ở những chỗ đó trước.`,
        pages: usage.pages.map((u) => u.label),
        components: usage.components.map((u) => u.label),
      },
      { status: 409 },
    );
  }
```

- [ ] **Step 7: Chạy test và nạp lại token ở dev**

Run: `pnpm vitest run src/lib/design src/lib/render && pnpm typecheck && pnpm tokens:import`
Expected: PASS. Script in ra số hàng `updated` lớn hơn 0 (các token font đổi hạng).

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/token-category.ts src/lib/design/token-category.test.ts scripts/import-tokens.ts src/lib/design/foundations.ts src/lib/design/foundations.test.ts src/lib/render/custom-tokens.ts "src/app/api/design-tokens/[id]/route.ts"
git commit -m "feat(tokens): token font vao hang font, phat chuoi font cua ho tai len, chan xoa token font"
```

---

### Task 12: Route `/mm-font/[...key]`

**Files:**
- Create: `src/app/mm-font/[...key]/route.ts`

**Interfaces:**
- Consumes: `isFontKey`, `fontMimeOf` (Task 6); `getObject` (`src/lib/assets/s3.ts`).

Phần kiểm khoá đã có test ở `css.test.ts` (Task 6). Phần chạy thật được e2e kiểm ở Task 13.

- [ ] **Step 1: Viết route**

```ts
import { getObject } from '@/lib/assets/s3';
import { fontMimeOf, isFontKey } from '@/lib/fonts/css';

export const runtime = 'nodejs';

/**
 * File font phục vụ CÙNG NGUỒN với site — spec §6.6.
 *
 * Trình duyệt tải font ở chế độ CORS; để font trên CDN thì mỗi môi trường phải tự bật
 * CORS cho bucket, quên là font hỏng âm thầm. Đi qua đây thì không có cấu hình nào để quên.
 *
 * Không tra DB: file của release cũ có thể đã rời bảng Asset mà vẫn được AssetHold giữ
 * trên S3, và mọi object dưới `public/` vốn đã công khai trên CDN. `isFontKey` là thứ
 * giữ route này khỏi thành một proxy S3 mở. Middleware không chạy ở đây: `matcher` của
 * nó bỏ qua đường dẫn có dấu chấm.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.join('/');
  if (!isFontKey(key)) return new Response('Không tìm thấy', { status: 404 });

  let bytes: Uint8Array;
  try {
    bytes = await getObject(key);
  } catch {
    return new Response('Không tìm thấy', { status: 404 });
  }

  const hash = key.slice(key.lastIndexOf('-') + 1, key.lastIndexOf('.'));
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': fontMimeOf(key),
      // Khoá mang hash nội dung — cùng URL luôn cùng byte, nên cache vĩnh viễn an toàn.
      'cache-control': 'public, max-age=31536000, immutable',
      etag: `"${hash}"`,
    },
  });
}
```

- [ ] **Step 2: Kiểm**

Run: `pnpm typecheck && pnpm lint`
Expected: sạch.

- [ ] **Step 3: Commit**

```bash
git add "src/app/mm-font/[...key]/route.ts"
git commit -m "feat(fonts): route /mm-font phuc vu file font cung nguon, cache immutable"
```

---

### Task 13: API `/api/fonts` và điều phối tải lên

**Files:**
- Create: `src/lib/fonts/upload.ts`, `src/lib/fonts/list.ts`, `src/lib/fonts/http.ts`, `src/app/api/fonts/route.ts`, `src/app/api/fonts/[id]/route.ts`, `src/app/api/fonts/[id]/faces/[faceId]/route.ts`, `e2e/fonts-api.spec.ts`
- Modify: `src/lib/auth/service-scope.ts`, `src/lib/auth/service-scope.test.ts`

**Interfaces:**
- Consumes:
  - Task 8: `prepareFontFile`, `checkCssName`, `PreparedFace`, `UploadOverrides`, `planFace`;
  - Task 9: `findFamilyByName`, `saveFontFaces`, `updateFamily`, `deleteFamily`, `deleteFace`, `Actor`, `readFontSeal`, `tokenUsage`, `emptyUsage`, `TokenUsage`;
  - Task 10: `fetchGoogleFaces`;
  - Task 6: `parseFontSeal`, `unpublishedSlugs`, `fontFaceCss`, `EMPTY_FONT_SEAL`;
  - Task 3: `BUILTIN_FONTS`, `builtinFontCss`, `resolveFallback`, `fontSlug`, `fontTokenName`, `MAX_FONT_BYTES`.
- Produces (`upload.ts`):
  - `interface FontUploadResponse { ok: true; dryRun: boolean; family: { id?: string; slug: string; cssName: string; token: string; created: boolean }; faces: { weight: string; style: string; subset: string; bytes: number; replaced: boolean }[]; warnings: FontWarning[] }`;
  - `type FontUploadResult = FontUploadResponse | FontFailure`;
  - `uploadFontFile(args)`, `uploadFontFromUrl(args)`, `importGoogleFont(args)`.
- Produces (`list.ts`):
  - `interface FontFaceItem { id: string|null; weight: string; style: string; subset: string; bytes: number|null; key: string|null; warnings: string[] }`;
  - `interface FontListItem { id: string|null; source: 'builtin'|'upload'|'google'; cssName: string; slug: string|null; tokens: string[]; fallback: string|null; licenseNote: string|null; licenseConfirmedBy: string|null; faces: FontFaceItem[]; usage: TokenUsage; unpublished: boolean }`;
  - `listFonts(): Promise<{ fonts: FontListItem[]; previewCss: string }>`.
- Produces (`http.ts`): `fontResponse(r: { ok: true } | FontFailure): NextResponse`.

- [ ] **Step 1: Viết `src/lib/fonts/upload.ts`**

```ts
import 'server-only';

import { fail, type FontFailure } from './errors';
import { fetchGoogleFaces } from './google';
import type { FontWarning } from './inspect';
import { fontSlug, fontTokenName, MAX_FONT_BYTES, resolveFallback } from './names';
import { planFace } from './plan';
import { checkCssName, prepareFontFile, type PreparedFace, type UploadOverrides } from './prepare';
import { findFamilyByName, saveFontFaces, type Actor } from './service';

export interface FontUploadResponse {
  ok: true;
  dryRun: boolean;
  family: { id?: string; slug: string; cssName: string; token: string; created: boolean };
  faces: { weight: string; style: string; subset: string; bytes: number; replaced: boolean }[];
  warnings: FontWarning[];
}

export type FontUploadResult = FontUploadResponse | FontFailure;

interface Common {
  fallback?: string | null;
  licenseNote?: string | null;
  dryRun?: boolean;
  actor: Actor;
}

/** Kết quả `dryRun`: họ sẽ tạo mới hay thêm vào họ có sẵn, face nào sẽ thay. */
async function preview(cssName: string, faces: PreparedFace[], warnings: FontWarning[]): Promise<FontUploadResponse> {
  const existing = await findFamilyByName(cssName);
  const slug = existing?.slug ?? fontSlug(cssName);
  return {
    ok: true,
    dryRun: true,
    family: {
      ...(existing ? { id: existing.id } : {}),
      slug,
      cssName: existing?.cssName ?? cssName,
      token: fontTokenName(slug),
      created: !existing,
    },
    faces: faces.map((f) => ({
      weight: f.weight, style: f.style, subset: f.subset, bytes: f.bytes.length,
      replaced: planFace(existing?.faces ?? [], { ...f, assetId: '' }).action !== 'create',
    })),
    warnings,
  };
}

export async function uploadFontFile(
  args: Common & { bytes: Uint8Array; overrides?: UploadOverrides; licenseConfirmed: boolean },
): Promise<FontUploadResult> {
  const fallback = resolveFallback(args.fallback);
  if (!fallback.ok) return fail('fallback_invalid', fallback.error);
  if (!args.dryRun && !args.licenseConfirmed) {
    return fail('license_required', 'Cần xác nhận "Tôi có quyền dùng font này trên web" trước khi lưu.');
  }
  const p = await prepareFontFile(args.bytes, args.overrides ?? {}, { convert: !args.dryRun });
  if (!p.ok) return p;
  if (args.dryRun) return preview(p.cssName, [p.face], p.face.warnings);

  const saved = await saveFontFaces({
    family: {
      cssName: p.cssName, fallback: fallback.value, source: 'upload',
      licenseNote: args.licenseNote ?? null, licenseConfirmedBy: args.actor.email,
    },
    faces: [p.face],
    actor: args.actor,
  });
  if (!saved.ok) return saved;
  return { ok: true, dryRun: false, family: saved.family, faces: saved.faces, warnings: p.face.warnings };
}

export async function uploadFontFromUrl(
  args: Common & { sourceUrl: string; overrides?: UploadOverrides; licenseConfirmed: boolean },
): Promise<FontUploadResult> {
  if (!/^https:\/\//i.test(args.sourceUrl)) return fail('bad_request', 'Chỉ nhận link https://');
  let res: Response;
  try {
    res = await fetch(args.sourceUrl, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return fail('bad_request', `Không tải được ${args.sourceUrl}.`);
  }
  if (!res.ok) return fail('bad_request', `Tải ${args.sourceUrl} trả về ${res.status}.`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_FONT_BYTES) {
    return fail('too_large', `File font tối đa ${MAX_FONT_BYTES / 1024 / 1024} MB.`);
  }
  return uploadFontFile({ ...args, bytes: new Uint8Array(await res.arrayBuffer()) });
}

export async function importGoogleFont(
  args: Common & { google: { family: string; weights?: number[]; italic?: boolean }; cssName?: string | null },
): Promise<FontUploadResult> {
  const fallback = resolveFallback(args.fallback);
  if (!fallback.ok) return fail('fallback_invalid', fallback.error);
  const g = await fetchGoogleFaces(args.google);
  if (!g.ok) return g;
  // Họ Google trùng tên dành riêng (vd. "Inter") thì người dùng đặt tên khác qua `cssName`.
  const name = checkCssName(args.cssName ?? g.family);
  if (!name.ok) return name;

  const slug = fontSlug(name.cssName);
  const faces: PreparedFace[] = g.faces.map((f) => ({
    bytes: f.bytes,
    fileName: `${slug}-${f.weight.replace(' ', '-')}-${f.style}-${f.subset}.woff2`,
    weight: f.weight, style: f.style, unicodeRange: f.unicodeRange, subset: f.subset, warnings: [],
  }));
  if (args.dryRun) return preview(name.cssName, faces, []);

  const saved = await saveFontFaces({
    family: {
      cssName: name.cssName, fallback: fallback.value, source: 'google',
      googleFamily: g.family, licenseNote: 'Google Fonts (OFL/Apache)', licenseConfirmedBy: null,
    },
    faces,
    actor: args.actor,
  });
  if (!saved.ok) return saved;
  return { ok: true, dryRun: false, family: saved.family, faces: saved.faces, warnings: [] };
}
```

- [ ] **Step 2: Viết `src/lib/fonts/list.ts`**

```ts
import 'server-only';

import { prisma } from '@/lib/db';

import { BUILTIN_FONTS, builtinFontCss } from './builtin';
import { EMPTY_FONT_SEAL, fontFaceCss, parseFontSeal, unpublishedSlugs } from './css';
import { fontTokenName } from './names';
import { readFontSeal } from './seal';
import { emptyUsage, type TokenUsage, type UsageRef } from './usage-scan';
import { tokenUsage } from './usage';

export interface FontFaceItem {
  id: string | null;
  weight: string;
  style: string;
  subset: string;
  bytes: number | null;
  key: string | null;
  warnings: string[];
}

export interface FontListItem {
  id: string | null;
  source: 'builtin' | 'upload' | 'google';
  cssName: string;
  slug: string | null;
  tokens: string[];
  fallback: string | null;
  licenseNote: string | null;
  licenseConfirmedBy: string | null;
  faces: FontFaceItem[];
  usage: TokenUsage;
  unpublished: boolean;
}

const uniq = (refs: UsageRef[]) => [...new Map(refs.map((r) => [r.href, r])).values()];

export async function listFonts(): Promise<{ fonts: FontListItem[]; previewCss: string }> {
  const families = await prisma.fontFamily.findMany({
    orderBy: { cssName: 'asc' },
    include: {
      faces: {
        orderBy: [{ weight: 'asc' }, { style: 'asc' }, { subset: 'asc' }],
        include: { asset: { select: { key: true, bytes: true } } },
      },
    },
  });
  const site = await prisma.site.findFirst({ select: { activeRelease: { select: { fonts: true } } } });
  const live = site?.activeRelease ? parseFontSeal(site.activeRelease.fonts) : EMPTY_FONT_SEAL;
  const draft = await readFontSeal();
  const dirty = unpublishedSlugs(draft, live);

  const names = [...families.map((f) => fontTokenName(f.slug)), ...BUILTIN_FONTS.flatMap((b) => b.tokens)];
  const usage = await tokenUsage(names);
  const usageOf = (tokens: readonly string[]): TokenUsage => {
    const all = tokens.map((t) => usage.get(t) ?? emptyUsage());
    return { pages: uniq(all.flatMap((u) => u.pages)), components: uniq(all.flatMap((u) => u.components)) };
  };

  const uploaded: FontListItem[] = families.map((f) => ({
    id: f.id,
    source: f.source === 'google' ? 'google' : 'upload',
    cssName: f.cssName,
    slug: f.slug,
    tokens: [fontTokenName(f.slug)],
    fallback: f.fallback,
    licenseNote: f.licenseNote,
    licenseConfirmedBy: f.licenseConfirmedBy,
    faces: f.faces.map((x) => ({
      id: x.id, weight: x.weight, style: x.style, subset: x.subset,
      bytes: x.asset.bytes, key: x.asset.key, warnings: x.warnings,
    })),
    usage: usageOf([fontTokenName(f.slug)]),
    unpublished: dirty.has(f.slug),
  }));

  const builtin: FontListItem[] = BUILTIN_FONTS.map((b) => ({
    id: null, source: 'builtin', cssName: b.cssName, slug: null, tokens: [...b.tokens],
    fallback: null, licenseNote: null, licenseConfirmedBy: null,
    faces: b.faces.map((x) => ({
      id: null, weight: x.weight, style: x.style, subset: '', bytes: null, key: null, warnings: [],
    })),
    usage: usageOf(b.tokens),
    unpublished: false,
  }));

  return { fonts: [...uploaded, ...builtin], previewCss: `${fontFaceCss(draft)}\n${builtinFontCss()}` };
}
```

- [ ] **Step 3: Viết `src/lib/fonts/http.ts`**

```ts
import 'server-only';

import { NextResponse } from 'next/server';

import type { FontFailure } from './errors';

/** Kết quả của service → HTTP. Lỗi mang `code` để client và MCP rẽ nhánh không cần đọc chữ. */
export function fontResponse<T extends { ok: true }>(r: T | FontFailure): NextResponse {
  if (r.ok) return NextResponse.json(r);
  return NextResponse.json(
    { error: r.error, code: r.code, ...(r.usage ? { usage: r.usage } : {}) },
    { status: r.status },
  );
}
```

- [ ] **Step 4: Viết `src/app/api/fonts/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth/guard';
import { fail } from '@/lib/fonts/errors';
import { fontResponse } from '@/lib/fonts/http';
import { listFonts } from '@/lib/fonts/list';
import { MAX_FONT_BYTES } from '@/lib/fonts/names';
import { importGoogleFont, uploadFontFile, uploadFontFromUrl } from '@/lib/fonts/upload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, ...(await listFonts()) });
}

const zStyle = z.enum(['normal', 'italic']);

const zJson = z
  .object({
    sourceUrl: z.string().url().optional(),
    google: z
      .object({
        family: z.string().min(1).max(200),
        weights: z.array(z.number().int().min(1).max(1000)).max(9).optional(),
        italic: z.boolean().optional(),
      })
      .strict()
      .optional(),
    family: z.string().max(64).optional(),
    weight: z.string().max(9).optional(),
    style: zStyle.optional(),
    fallback: z.string().max(200).optional(),
    licenseConfirmed: z.boolean().optional(),
    licenseNote: z.string().max(500).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.sourceUrl) !== Boolean(v.google), { message: 'Cần đúng một trong sourceUrl, google' });

export async function POST(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const actor = { email: auth.email, sub: auth.sub };

  if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fontResponse(fail('bad_request', 'Cần multipart/form-data với trường "file".'));
    }
    const file = form.get('file');
    if (!(file instanceof File)) return fontResponse(fail('bad_request', 'Thiếu trường "file".'));
    if (file.size > MAX_FONT_BYTES) {
      return fontResponse(fail('too_large', `File font tối đa ${MAX_FONT_BYTES / 1024 / 1024} MB.`));
    }
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const style = zStyle.nullable().safeParse(str('style'));
    if (!style.success) return fontResponse(fail('bad_request', 'style là normal hoặc italic.'));
    return fontResponse(
      await uploadFontFile({
        bytes: new Uint8Array(await file.arrayBuffer()),
        overrides: { family: str('family'), weight: str('weight'), style: style.data },
        fallback: str('fallback'),
        licenseConfirmed: str('licenseConfirmed') === 'true',
        licenseNote: str('licenseNote'),
        dryRun: str('dryRun') === 'true',
        actor,
      }),
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fontResponse(fail('bad_request', 'JSON không hợp lệ.'));
  }
  const parsed = zJson.safeParse(raw);
  if (!parsed.success) return fontResponse(fail('bad_request', parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ.'));
  const b = parsed.data;
  const common = { fallback: b.fallback ?? null, licenseNote: b.licenseNote ?? null, dryRun: b.dryRun ?? false, actor };

  if (b.google) return fontResponse(await importGoogleFont({ ...common, google: b.google, cssName: b.family ?? null }));
  return fontResponse(
    await uploadFontFromUrl({
      ...common,
      sourceUrl: b.sourceUrl!,
      overrides: { family: b.family ?? null, weight: b.weight ?? null, style: b.style ?? null },
      licenseConfirmed: b.licenseConfirmed ?? false,
    }),
  );
}
```

- [ ] **Step 5: Viết `src/app/api/fonts/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth/guard';
import { fail } from '@/lib/fonts/errors';
import { fontResponse } from '@/lib/fonts/http';
import { deleteFamily, updateFamily } from '@/lib/fonts/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const zPatch = z
  .object({
    cssName: z.string().max(64).optional(),
    fallback: z.string().max(200).optional(),
    licenseNote: z.string().max(500).nullable().optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = zPatch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fontResponse(fail('bad_request', 'Dữ liệu không hợp lệ.'));
  return fontResponse(await updateFamily(id, parsed.data, { email: auth.email, sub: auth.sub }));
}

/** Xoá cả họ: chỉ admin (service token luôn bị từ chối `admin`, nên Claude không xoá được). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  return fontResponse(await deleteFamily(id, { email: auth.email, sub: auth.sub }));
}
```

- [ ] **Step 6: Viết `src/app/api/fonts/[id]/faces/[faceId]/route.ts`**

```ts
import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { fontResponse } from '@/lib/fonts/http';
import { deleteFace } from '@/lib/fonts/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; faceId: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const { id, faceId } = await params;
  return fontResponse(await deleteFace(id, faceId, { email: auth.email, sub: auth.sub }));
}
```

- [ ] **Step 7: Mở `/api/fonts` cho service token**

Trong `src/lib/auth/service-scope.ts`, ngay sau dòng `if (pathname === '/api/assets') return method === 'POST';`:

```ts
  // upload_font với `filePath`: proxy POST multipart giống upload_asset. Chỉ POST —
  // sửa/xoá họ font là việc của người, không qua Claude.
  if (pathname === '/api/fonts') return method === 'POST';
```

Trong `src/lib/auth/service-scope.test.ts`, thêm vào test đầu:

```ts
    expect(serviceMayReach('/api/fonts', 'POST')).toBe(true);
    expect(serviceMayReach('/api/fonts', 'GET')).toBe(false);
    expect(serviceMayReach('/api/fonts/abc', 'DELETE')).toBe(false);
```

- [ ] **Step 8: Viết e2e** — `e2e/fonts-api.spec.ts`

```ts
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * API font — spec docs/superpowers/specs/2026-10-16-dynamic-fonts-design.md §10.
 * Dùng `newyork-regular.ttf` có sẵn trong repo (TTF variable) để đi qua bước cắt + đổi woff2.
 */
const NY = readFileSync('public/fonts/newyork-regular.ttf');
const rand = () => Math.random().toString(36).slice(2, 7);

const upload = (request: APIRequestContext, fields: Record<string, string>, buffer: Buffer = NY, name = 'newyork-regular.ttf') =>
  request.post('/api/fonts', { multipart: { file: { name, mimeType: 'font/ttf', buffer }, ...fields } });

type ListItem = { id: string; cssName: string; tokens: string[]; unpublished: boolean; faces: { key: string }[]; fallback: string };
const list = async (request: APIRequestContext): Promise<ListItem[]> => (await (await request.get('/api/fonts')).json()).fonts;

test.describe('API font', () => {
  test('dryRun đọc metadata, không ghi gì', async ({ request }) => {
    const family = `E2E Dry ${rand()}`;
    const res = await upload(request, { family, dryRun: 'true' });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, dryRun: true, family: { cssName: family, created: true } });
    expect(body.faces[0].weight).toBe('400 1000');
    expect((await list(request)).some((f) => f.cssName === family)).toBe(false);
  });

  test('lưu thật mà thiếu xác nhận giấy phép thì 422', async ({ request }) => {
    const res = await upload(request, { family: `E2E ${rand()}` });
    expect(res.status()).toBe(422);
    expect((await res.json()).code).toBe('license_required');
  });

  test('tên đọc được là tên dành riêng ("New York") thì 409', async ({ request }) => {
    const res = await upload(request, { licenseConfirmed: 'true' });
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('name_reserved');
  });

  test('không phải font thì 415', async ({ request }) => {
    const res = await upload(request, { family: 'X', licenseConfirmed: 'true' }, Buffer.from('xin chào, không phải font'), 'gia.ttf');
    expect(res.status()).toBe(415);
  });

  test('tải, tải lại không nhân bản, phục vụ file, sửa, xoá', async ({ request }) => {
    const family = `E2E Font ${rand()}`;
    const res = await upload(request, { family, licenseConfirmed: 'true', licenseNote: 'e2e' });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.family.token).toMatch(/^font-e2e-font-/);
    expect(body.family.created).toBe(true);

    const again = await (await upload(request, { family, licenseConfirmed: 'true' })).json();
    expect(again.family.created).toBe(false);
    expect(again.faces[0].replaced).toBe(false);

    const item = (await list(request)).find((f) => f.cssName === family)!;
    expect(item.faces).toHaveLength(1);
    expect(item.unpublished).toBe(true);

    const file = await request.get(`/mm-font/${item.faces[0]!.key}`);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toBe('font/woff2');
    expect(file.headers()['cache-control']).toContain('immutable');
    expect((await request.get('/mm-font/public/builder/khong-co.png')).status()).toBe(404);

    expect((await request.patch(`/api/fonts/${item.id}`, { data: { fallback: 'serif' } })).status()).toBe(200);
    const tokens = (await (await request.get('/api/design-tokens')).json()).tokens as { id: string; name: string; value: string }[];
    const token = tokens.find((t) => t.name === body.family.token)!;
    expect(token.value).toBe(`"${family}", Georgia, "Times New Roman", serif`);
    expect((await request.delete(`/api/design-tokens/${token.id}`)).status()).toBe(409);

    expect((await request.delete(`/api/fonts/${item.id}`)).status()).toBe(200);
    expect((await list(request)).some((f) => f.cssName === family)).toBe(false);
  });
});
```

- [ ] **Step 9: Chạy**

Run: `pnpm vitest run src/lib/auth && pnpm typecheck && pnpm e2e:up && pnpm e2e:test e2e/fonts-api.spec.ts`
Expected: PASS. Stack đã chạy từ trước thì dùng `pnpm e2e:restart` thay `e2e:up`, vì có route mới.

- [ ] **Step 10: Commit**

```bash
git add src/lib/fonts/upload.ts src/lib/fonts/list.ts src/lib/fonts/http.ts src/app/api/fonts src/lib/auth/service-scope.ts src/lib/auth/service-scope.test.ts e2e/fonts-api.spec.ts
git commit -m "feat(fonts): API /api/fonts - tai file, tai tu URL, nhap Google Fonts, sua, xoa"
```

---

### Task 14: Phát `@font-face` ở bản nháp, niêm phong khi Publish

**Files:**
- Modify:
  - `src/lib/render/page.ts`;
  - `src/app/api/publish/route.ts`;
  - `src/app/(render)/render/[pageId]/page.tsx`, `src/app/(render)/render/component/[id]/page.tsx`;
  - `src/app/(site)/preview/[pageId]/page.tsx`, `src/app/(site)/preview/release/[id]/page.tsx`, `src/app/(site)/[[...slug]]/page.tsx`.
- Create: `e2e/fonts.spec.ts` (phần render; Task 16 thêm phần UI)

**Interfaces:**
- Consumes: `draftFontFaceCss`, `readFontSeal` (Task 9); `fontFaceCss`, `parseFontSeal`, `FontSeal` (Task 6); `FontFaceStyle` (Task 6).
- Produces: `PublishedPage.fonts: FontSeal`.

- [ ] **Step 1: Bản nháp — ba trang**

Trong cả ba file `(render)/render/[pageId]/page.tsx`, `(render)/render/component/[id]/page.tsx` và `(site)/preview/[pageId]/page.tsx`:

```ts
import { FontFaceStyle } from '@/components/site/FontFaceStyle';
import { draftFontFaceCss } from '@/lib/fonts/seal';
```

Ngay sau dòng `const tokenCss = await customTokensCss();`:

```ts
  // Bản NHÁP: đọc bảng font live, giống token tự tạo ở trên. Site thật đọc ảnh chụp release.
  const fontCss = await draftFontFaceCss();
```

Ngay trước khối `{tokenCss && (<style data-mm-tokens … />)}`:

```tsx
      <FontFaceStyle css={fontCss} />
```

- [ ] **Step 2: `PublishedPage` mang bản niêm phong font** — `src/lib/render/page.ts`

- Import: `import { parseFontSeal, type FontSeal } from '@/lib/fonts/css';`
- Trong `interface PublishedPage`, sau `tokens`:

```ts
  /** Ảnh chụp font của chính release này — xem `Release.fonts`. Release cũ: rỗng. */
  fonts: FontSeal;
```

- Trong `loadFromRelease`, thêm `fonts: true` vào `release: { select: { … } }`. Trong object trả về, sau `tokens`, thêm `fonts: parseFontSeal(entry.release.fonts),`.

- [ ] **Step 3: Site thật và xem release cũ**

Trong `(site)/[[...slug]]/page.tsx` và `(site)/preview/release/[id]/page.tsx`:

```ts
import { FontFaceStyle } from '@/components/site/FontFaceStyle';
import { fontFaceCss } from '@/lib/fonts/css';
```

Sau dòng `const tokenCss = tokenCssFromSeal(page.tokens);`:

```ts
  const fontCss = fontFaceCss(page.fonts);
```

Ngay trước khối `{tokenCss && (…)}` trong JSX, thêm `<FontFaceStyle css={fontCss} />`.

- [ ] **Step 4: Niêm phong khi Publish** — `src/app/api/publish/route.ts`

- Import: `import { readFontSeal } from '@/lib/fonts/seal';`
- Ngay sau `const tokens = tokenSnapshot(tokenRows);`:

```ts
  // Font tải lên — cùng lý do với token ở trên: bảng nguồn là BẢN NHÁP. Đọc thẳng, không
  // qua cache, để niêm phong đúng thứ đang có lúc bấm Publish.
  const fonts = (await readFontSeal()) as unknown as Prisma.InputJsonObject;
```

- Trong `tx.release.create({ data: { … } })`, thêm `fonts,` ngay sau `tokens,`.

- [ ] **Step 5: Viết e2e** — `e2e/fonts.spec.ts`

```ts
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';

/** Font động — bản nháp thấy ngay, site thật đổi khi Publish. Spec 2026-10-16-dynamic-fonts §6. */
const NY = readFileSync('public/fonts/newyork-regular.ttf');
const rand = () => Math.random().toString(36).slice(2, 7);

async function uploadFont(request: APIRequestContext, family: string) {
  const res = await request.post('/api/fonts', {
    multipart: { file: { name: 'ny.ttf', mimeType: 'font/ttf', buffer: NY }, family, licenseConfirmed: 'true' },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { family: { id: string; token: string } };
}

test.describe('font động khi render', () => {
  test('bản nháp có @font-face ngay; site thật chỉ có sau Publish', async ({ page, request }) => {
    const family = `E2E Render ${rand()}`;
    await uploadFont(request, family);

    // Bản nháp: một trang bất kỳ dựng ở /render/<id>. Lấy id qua tool list_pages (mẫu ở agent-tools.spec.ts).
    const res = await request.post('/api/ai/tool', { data: { tool: 'list_pages', input: {} } });
    expect(res.ok(), await res.text()).toBe(true);
    const pageId = (await res.json()).result.pages[0].id as string;
    await page.goto(`/render/${pageId}`);
    await expect(page.locator('style[data-mm-fonts]')).toContainText(`font-family: "${family}"`);

    // Site thật: chưa Publish thì chưa có.
    await page.goto('/');
    const before = await page.locator('style[data-mm-fonts]').allTextContents();
    expect(before.join('')).not.toContain(family);

    expect((await request.post('/api/publish', { data: { action: 'publish', label: `e2e font ${family}` } })).status()).toBe(200);
    await page.goto('/');
    await expect(page.locator('style[data-mm-fonts]')).toContainText(`font-family: "${family}"`);
    await expect(page.locator('style[data-mm-fonts]')).toContainText('/mm-font/public/');
  });
});
```

- [ ] **Step 6: Chạy**

Run: `pnpm typecheck && pnpm test && pnpm e2e:restart && pnpm e2e:test e2e/fonts.spec.ts e2e/release-sealed.spec.ts e2e/release-preview.spec.ts`
Expected: PASS. Hai spec release cũ không đỏ, vì release cũ có `fonts = null` thì `parseFontSeal` trả rỗng.

- [ ] **Step 7: Commit**

```bash
git add src/lib/render/page.ts src/app/api/publish/route.ts "src/app/(render)" "src/app/(site)/preview" "src/app/(site)/[[...slug]]/page.tsx" e2e/fonts.spec.ts
git commit -m "feat(fonts): phat @font-face o ban nhap, niem phong font vao Release khi Publish"
```

---

### Task 15: Giữ file font khỏi bị dọn

**Files:**
- Modify: `src/lib/assets/trash-types.ts`, `src/lib/builder/asset-references-scan.ts`, `src/lib/builder/asset-references-scan.test.ts`, `src/lib/builder/asset-references.ts`

**Interfaces:**
- Produces:
  - `AssetRefKind` thêm `'font'`;
  - `ReleaseSource.fonts: unknown`;
  - `ReferenceSources.fontFaces: { assetId: string; familyCssName: string }[]`.

- [ ] **Step 1: Viết test hỏng** — thêm vào `src/lib/builder/asset-references-scan.test.ts`

Sửa hai helper để có giá trị mặc định: thêm `fontFaces: [],` vào `sources()` và `fonts: {},` vào `release()`. Rồi thêm:

```ts
describe('font', () => {
  it('face của một họ font đang giữ file thì CHẶN xoá', () => {
    const r = scan({ fontFaces: [{ assetId: IMG, familyCssName: 'Gilroy Web' }] }).get(IMG)!;
    expect(r.blocking).toEqual([{ kind: 'font', label: 'Font Gilroy Web', href: '/builder/settings/fonts' }]);
  });

  it('release đang chạy niêm phong khoá file font thì CHẶN; release cũ thì CẢNH BÁO', () => {
    const fonts = { families: [{ slug: 'g', cssName: 'G', faces: [{ key: KEY, weight: '400', style: 'normal', unicodeRange: '' }] }] };
    const live = scan({ liveReleases: [release({ fonts })] }).get(IMG)!;
    expect(live.blocking.map((b) => b.kind)).toEqual(['live-release']);
    const old = scan({ oldReleases: [release({ fonts })] }).get(IMG)!;
    expect(old.blocking).toEqual([]);
    expect(old.oldReleases.map((o) => o.id)).toEqual(['r1']);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/builder/asset-references-scan.test.ts`
Expected: FAIL (kiểu thiếu `fontFaces`/`fonts`, và không có chỗ chặn).

- [ ] **Step 3: Sửa kiểu và bộ quét**

`src/lib/assets/trash-types.ts`: thêm `| 'font'` vào cuối union `AssetRefKind`.

`src/lib/builder/asset-references-scan.ts`:
- Trong `interface ReleaseSource`, sau `tokens: unknown;`, thêm `fonts: unknown;`.
- Trong `interface ReferenceSources`, sau `tokens: TokenSource[];`:

```ts
  /** Face của họ font tải lên — file đang được `@font-face` của bản nháp trỏ tới. */
  fontFaces: { assetId: string; familyCssName: string }[];
```

- Trong `releaseHits`, ngay sau dòng `hits.push({ where: 'token', ids: idsInJson(rel.tokens, ctx) });`:

```ts
  // `Release.fonts` giữ KHOÁ file (không phải id) — `idsInJson` dò khoá trong chuỗi.
  hits.push({ where: 'font', ids: idsInJson(rel.fonts, ctx) });
```

- Trong `scanAssetReferences`, ngay sau vòng `for (const t of src.tokens) { … }`:

```ts
  for (const f of src.fontFaces) {
    block([f.assetId], { kind: 'font', label: `Font ${f.familyCssName}`, href: '/builder/settings/fonts' });
  }
```

`src/lib/builder/asset-references.ts`:
- Thêm vào `Promise.all` một truy vấn (đặt sau `releases`, và thêm `fontFaces` vào mảng destructure):

```ts
      prisma.fontFace.findMany({
        where: { assetId: { in: unique } },
        select: { assetId: true, family: { select: { cssName: true } } },
      }),
```

- Trong select của `prisma.release.findMany`, thêm `fonts: true`. Trong vòng dựng `source: ReleaseSource`, thêm `fonts: r.fonts,`.
- Trong object truyền vào `scanAssetReferences`, thêm:

```ts
    fontFaces: fontFaces.map((f) => ({ assetId: f.assetId, familyCssName: f.family.cssName })),
```

- [ ] **Step 4: Chạy test**

Run: `pnpm vitest run src/lib/builder src/lib/assets && pnpm typecheck`
Expected: PASS. Nếu nơi khác dựng `ReferenceSources` hay `ReleaseSource` (typecheck sẽ chỉ ra), thêm `fontFaces: []` / `fonts: null` ở đó.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assets/trash-types.ts src/lib/builder/asset-references-scan.ts src/lib/builder/asset-references-scan.test.ts src/lib/builder/asset-references.ts
git commit -m "feat(fonts): file font dang dung hoac nam trong release khong bi don khoi kho"
```

---

### Task 16: Màn Cài đặt › Font và link trong Inspector

**Files:**
- Create:
  - `src/components/builder/SettingsTabs.tsx`, `src/components/builder/FileDropZone.tsx`;
  - `src/components/builder/fonts/FontList.tsx`, `src/components/builder/fonts/FontUploadDialog.tsx`, `src/components/builder/fonts/GoogleFontDialog.tsx`;
  - `src/app/(builder)/builder/settings/fonts/page.tsx`.
- Modify:
  - `src/app/(builder)/builder/settings/page.tsx`, `src/components/builder/transfer/ZipDropZone.tsx`;
  - `src/components/builder/ExtraFields.tsx`, `src/lib/builder/extra-fields.ts`;
  - `e2e/fonts.spec.ts`.

**Interfaces:**
- Consumes: `listFonts`, `FontListItem` (Task 13, chỉ `import type` ở client); `FALLBACKS`, `cssString` (Task 3); API ở Task 13.
- Produces: `SettingsTabs({ current: 'general'|'fonts' })`; `FileDropZone(props)`; `FontList(props)`; `FontUploadDialog(props)`; `GoogleFontDialog(props)`.

- [ ] **Step 1: Viết e2e hỏng** — thêm vào `e2e/fonts.spec.ts`

```ts
test.describe('màn Cài đặt › Font', () => {
  test('họ có sẵn hiện chỉ đọc; tải file, đổi tên dành riêng, thấy dòng xem trước', async ({ page }) => {
    const family = `E2E UI ${rand()}`;
    await page.goto('/builder/settings');
    await page.locator('[data-settings-tab="fonts"]').click();
    await expect(page).toHaveURL(/\/builder\/settings\/fonts$/);
    await expect(page.locator('[data-font-row="gilroy"]')).toContainText('Có sẵn trong bản build');

    await page.getByRole('button', { name: 'Tải file font' }).click();
    await page.getByLabel('Chọn file font').setInputFiles('public/fonts/newyork-regular.ttf');
    // Tên đọc được ("New York") là tên dành riêng: dòng báo lỗi, người dùng gõ tên khác.
    await expect(page.getByRole('alert').filter({ hasText: 'New York Web' })).toBeVisible();
    await page.getByLabel('Tên họ', { exact: true }).fill(family);
    await page.getByLabel('Tôi có quyền dùng font này trên web').check();
    await page.getByRole('button', { name: 'Lưu' }).click();

    const row = page.locator(`[data-font-row="${family}"]`);
    await expect(row).toContainText('Chưa publish');
    await expect(row).toContainText(/font-e2e-ui-/);
    const loaded = await page.evaluate(async (f) => (await document.fonts.load(`16px "${f}"`, 'Tiền')).length, family);
    expect(loaded).toBeGreaterThan(0);
  });

  test('mở thẳng đường dẫn màn Font được', async ({ page }) => {
    await page.goto('/builder/settings/fonts');
    await expect(page.getByRole('heading', { name: 'Font' })).toBeVisible();
    await expect(page.locator('[data-settings-tab="fonts"]')).toHaveAttribute('aria-current', /page|true/);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `pnpm e2e:test e2e/fonts.spec.ts`
Expected: FAIL, không có `[data-settings-tab="fonts"]`.

- [ ] **Step 3: Viết `src/components/builder/SettingsTabs.tsx`**

```tsx
import { LinkTabs } from './ui/Tabs';

/** Hai mục của Cài đặt — theo mẫu `AccountTabs`. */
export function SettingsTabs({ current }: { current: 'general' | 'fonts' }) {
  return (
    <LinkTabs
      label="Mục trong Cài đặt"
      value={current}
      className="self-start"
      items={[
        { id: 'general', href: '/builder/settings', label: 'Chung', data: { 'data-settings-tab': 'general' } },
        { id: 'fonts', href: '/builder/settings/fonts', label: 'Font', data: { 'data-settings-tab': 'fonts' } },
      ]}
    />
  );
}
```

Trong `src/app/(builder)/builder/settings/page.tsx`: import `SettingsTabs` và đặt `<SettingsTabs current="general" />` ngay dưới `<PageHeader title="Cài đặt chung" />`.

- [ ] **Step 4: Tách ô kéo thả** — `src/components/builder/FileDropZone.tsx`

```tsx
'use client';

import { useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';

import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

/**
 * Ô kéo thả file dùng chung — tách từ `transfer/ZipDropZone` (16/10/2026) để màn Font
 * nhận nhiều file font bằng đúng một hành vi kéo thả.
 */
export function FileDropZone({
  accept, multiple, accepts, wrongMessage, idleText, buttonLabel, inputLabel, data, onFiles,
}: {
  accept: string;
  multiple?: boolean;
  accepts: (f: File) => boolean;
  wrongMessage: (f: File) => string;
  idleText: string;
  buttonLabel: string;
  inputLabel: string;
  data?: Record<string, string>;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  const take = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    const bad = files.find((f) => !accepts(f));
    if (bad) {
      setWrong(wrongMessage(bad));
      return;
    }
    setWrong(null);
    onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        {...data}
        data-over={over || undefined}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          over ? 'border-shell-accent bg-shell-accent-soft/70' : 'border-shell-line',
        )}
      >
        <Icon name="upload" size={24} className={over ? 'text-shell-accent' : 'text-shell-muted'} />
        <p className="font-semibold">{over ? 'Thả file vào đây' : idleText}</p>
        <p className="text-small text-shell-muted">hoặc</p>
        <Button variant="primary" icon="upload" onClick={() => input.current?.click()}>
          {buttonLabel}
        </Button>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          aria-label={inputLabel}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {wrong && <p role="alert" className="text-small text-shell-danger">{wrong}</p>}
    </div>
  );
}
```

Thay toàn bộ thân `src/components/builder/transfer/ZipDropZone.tsx` (giữ docblock đầu file) bằng:

```tsx
'use client';

import { FileDropZone } from '../FileDropZone';

const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';

export function ZipDropZone({ onFile }: { onFile: (file: File) => void }) {
  return (
    <FileDropZone
      accept=".zip,application/zip"
      accepts={isZip}
      wrongMessage={(f) => `"${f.name}" không phải file .zip. Chọn gói đã xuất từ menu ⋯ › "Xuất trang (.zip)".`}
      idleText="Kéo file gói .zip vào đây"
      buttonLabel="Chọn file .zip"
      inputLabel="File gói (.zip)"
      data={{ 'data-zip-drop': '' }}
      onFiles={(files) => onFile(files[0]!)}
    />
  );
}
```

- [ ] **Step 5: Viết `src/components/builder/fonts/FontUploadDialog.tsx`**

```tsx
'use client';

import { useState } from 'react';

import { FileDropZone } from '../FileDropZone';
import { Button } from '../ui/Button';
import { Checkbox, SelectField, TextField } from '../ui/Field';
import { Dialog } from '../ui/Overlay';

type Status = 'checking' | 'ready' | 'saving' | 'saved' | 'failed';

interface Row {
  key: string;
  file: File;
  family: string;
  weight: string;
  style: 'normal' | 'italic';
  warnings: { code: string; message: string }[];
  error: string | null;
  status: Status;
  replaced: boolean;
}

const isFontFile = (f: File) => /\.(woff2?|ttf|otf)$/i.test(f.name);
/** Lỗi tên thì người dùng sửa được ngay trên dòng — không coi là hỏng. */
const NAME_CODES = new Set(['name_required', 'name_invalid', 'name_reserved']);

async function post(file: File, fields: Record<string, string>) {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
  const res = await fetch('/api/fonts', { method: 'POST', body: form });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

export function FontUploadDialog({
  open, presetFamily, onClose, onDone,
}: {
  open: boolean;
  presetFamily?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [fallback, setFallback] = useState('sans');
  const [license, setLicense] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const add = async (files: File[]) => {
    const fresh: Row[] = files.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`, file, family: presetFamily ?? '', weight: '', style: 'normal',
      warnings: [], error: null, status: 'checking', replaced: false,
    }));
    setRows((rs) => [...rs, ...fresh]);
    for (const r of fresh) {
      const { ok, body } = await post(r.file, { dryRun: 'true', family: presetFamily ?? '' });
      if (ok) {
        patch(r.key, {
          status: 'ready', family: body.family.cssName, weight: body.faces[0].weight, style: body.faces[0].style,
          warnings: body.warnings, replaced: body.faces[0].replaced,
        });
      } else {
        patch(r.key, { status: NAME_CODES.has(body.code) ? 'ready' : 'failed', error: body.error ?? 'Không đọc được file.' });
      }
    }
  };

  const close = () => {
    const any = rows.some((r) => r.status === 'saved');
    setRows([]);
    setLicense(false);
    setNote('');
    if (any) onDone();
    else onClose();
  };

  const save = async () => {
    setSaving(true);
    for (const r of rows.filter((x) => x.status === 'ready')) {
      patch(r.key, { status: 'saving', error: null });
      const { ok, body } = await post(r.file, {
        family: r.family, weight: r.weight, style: r.style, fallback,
        licenseConfirmed: 'true', licenseNote: note,
      });
      patch(r.key, ok ? { status: 'saved' } : { status: 'ready', error: body.error ?? 'Lưu thất bại.' });
    }
    setSaving(false);
  };

  const families = [...new Set(rows.filter((r) => r.family).map((r) => r.family))];
  const ready = rows.some((r) => r.status === 'ready');
  const allSaved = rows.length > 0 && rows.every((r) => r.status === 'saved');

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Tải file font"
      description="Nhận .woff2, .woff, .ttf, .otf. File .ttf/.otf được cắt còn chữ Latin + tiếng Việt và đổi sang .woff2."
      actions={
        allSaved ? (
          <Button variant="primary" onClick={close}>Xong</Button>
        ) : (
          <>
            <Button onClick={close}>Huỷ</Button>
            <Button variant="primary" loading={saving} disabled={!ready || !license} onClick={save}>Lưu</Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <FileDropZone
          accept=".woff2,.woff,.ttf,.otf"
          multiple
          accepts={isFontFile}
          wrongMessage={(f) => `"${f.name}" không phải file font (.woff2, .woff, .ttf, .otf).`}
          idleText="Kéo các file font vào đây"
          buttonLabel="Chọn file font"
          inputLabel="Chọn file font"
          onFiles={add}
        />
        {rows.map((r) => (
          <div key={r.key} data-font-upload-row={r.file.name} className="flex flex-col gap-2 rounded-lg border border-shell-line p-3">
            <div className="flex items-center gap-2 text-small">
              <span className="font-semibold">{r.file.name}</span>
              <span className="text-shell-muted">
                {{ checking: 'đang đọc…', ready: r.replaced ? 'sẽ thay file cũ' : 'sẵn sàng', saving: 'đang lưu…', saved: 'đã lưu', failed: 'lỗi' }[r.status]}
              </span>
            </div>
            {r.status !== 'failed' && (
              <div className="grid gap-2 sm:grid-cols-3">
                <TextField label="Tên họ" value={r.family} disabled={r.status !== 'ready'} onChange={(e) => patch(r.key, { family: e.target.value, error: null })} />
                <TextField label="Weight" value={r.weight} placeholder="đọc từ file" disabled={r.status !== 'ready'} onChange={(e) => patch(r.key, { weight: e.target.value })} />
                <SelectField
                  label="Kiểu"
                  value={r.style}
                  disabled={r.status !== 'ready'}
                  onChange={(e) => patch(r.key, { style: e.target.value as Row['style'] })}
                  options={[{ value: 'normal', label: 'normal' }, { value: 'italic', label: 'italic' }]}
                />
              </div>
            )}
            {r.warnings.map((w) => (
              <p key={w.code} className="text-small text-shell-warn">{w.message}</p>
            ))}
            {r.error && <p role="alert" className="text-small text-shell-danger">{r.error}</p>}
          </div>
        ))}
        {families.length > 0 && (
          <p className="text-small text-shell-muted">Họ font: {families.join(', ')}. File cùng tên họ được gom vào một họ.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Fallback (khi tạo họ mới)"
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
            options={[{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }]}
          />
          <TextField label="Ghi chú giấy phép" value={note} placeholder="vd. Gilroy — mua bản web 2024" onChange={(e) => setNote(e.target.value)} />
        </div>
        <Checkbox label="Tôi có quyền dùng font này trên web" checked={license} onChange={(e) => setLicense(e.target.checked)} />
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 6: Viết `src/components/builder/fonts/GoogleFontDialog.tsx`**

```tsx
'use client';

import { useState } from 'react';

import { Button } from '../ui/Button';
import { Checkbox, SelectField, TextField } from '../ui/Field';
import { Dialog } from '../ui/Overlay';

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

interface Found {
  cssName: string;
  created: boolean;
  faces: { weight: string; style: string; subset: string }[];
}

export function GoogleFontDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [family, setFamily] = useState('');
  const [cssName, setCssName] = useState('');
  const [italic, setItalic] = useState(true);
  /** Rỗng = lấy mọi weight Google có. */
  const [weights, setWeights] = useState<number[]>([]);
  const [fallback, setFallback] = useState('sans');
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/fonts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        google: { family, italic, ...(weights.length ? { weights } : {}) },
        ...(cssName.trim() ? { family: cssName.trim() } : {}),
        fallback,
        dryRun,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? `Lỗi ${res.status}`);
      setFound(null);
      return;
    }
    if (dryRun) {
      setFound({ cssName: body.family.cssName, created: body.family.created, faces: body.faces });
      return;
    }
    setFound(null);
    setFamily('');
    setCssName('');
    onDone();
  };

  const toggle = (w: number) => setWeights((ws) => (ws.includes(w) ? ws.filter((x) => x !== w) : [...ws, w].sort()));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nhập từ Google Fonts"
      description="Font được kéo về kho của mình (self-host) — site không gọi Google lúc chạy. Chỉ lấy bộ chữ Latin và tiếng Việt."
      actions={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button loading={busy && !found} disabled={!family.trim()} onClick={() => send(true)}>Tìm</Button>
          <Button variant="primary" loading={busy && !!found} disabled={!found} onClick={() => send(false)}>Nhập</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label="Tên họ hoặc link"
          value={family}
          placeholder="Be Vietnam Pro, hoặc https://fonts.google.com/specimen/…"
          onChange={(e) => { setFamily(e.target.value); setFound(null); }}
        />
        <fieldset className="flex flex-wrap gap-3">
          <legend className="mb-1 text-small text-shell-muted">Weight (không chọn = lấy tất cả)</legend>
          {WEIGHTS.map((w) => (
            <Checkbox key={w} label={String(w)} checked={weights.includes(w)} onChange={() => { toggle(w); setFound(null); }} />
          ))}
        </fieldset>
        <Checkbox label="Lấy cả italic" checked={italic} onChange={(e) => { setItalic(e.target.checked); setFound(null); }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Tên họ dùng ở site (tuỳ chọn)" value={cssName} placeholder="để trống = tên Google" onChange={(e) => setCssName(e.target.value)} />
          <SelectField
            label="Fallback"
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
            options={[{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }]}
          />
        </div>
        {found && (
          <p className="text-small">
            {found.created ? 'Sẽ tạo họ' : 'Sẽ thêm vào họ có sẵn'} <strong>{found.cssName}</strong>: {found.faces.length} file (
            {[...new Set(found.faces.map((f) => `${f.weight}${f.style === 'italic' ? ' italic' : ''}`))].join(', ')}).
          </p>
        )}
        {error && <p role="alert" className="text-small text-shell-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 7: Viết `src/components/builder/fonts/FontList.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import type { FontListItem } from '@/lib/fonts/list';
import { cssString, FALLBACKS } from '@/lib/fonts/names';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { ConfirmDialog } from '../ui/Overlay';
import { FontUploadDialog } from './FontUploadDialog';
import { GoogleFontDialog } from './GoogleFontDialog';

const SAMPLE = 'Tiền về nhanh — Ắ ẩ ữ ộ ₫ 0123';
const SOURCE_LABEL: Record<FontListItem['source'], string> = {
  builtin: 'Có sẵn trong bản build (chỉ đọc)',
  upload: 'Tải lên',
  google: 'Google Fonts',
};

const weightsLabel = (f: FontListItem) => {
  const w = [...new Set(f.faces.map((x) => x.weight.replace(' ', '–')))].join(' ');
  return w ? `${w}${f.faces.some((x) => x.style === 'italic') ? ' · italic' : ''}` : 'Chưa có file';
};
const usedCount = (f: FontListItem) => f.usage.pages.length + f.usage.components.length;

export function FontList({
  fonts, previewCss, canWrite, isAdmin,
}: {
  fonts: FontListItem[];
  previewCss: string;
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ family?: string } | null>(null);
  const [google, setGoogle] = useState(false);
  const done = () => {
    setUpload(null);
    setGoogle(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* @font-face của mọi họ để dòng xem trước vẽ bằng chính font đó. Chuỗi do server sinh. */}
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: previewCss }} />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-small text-shell-muted">ⓘ Sửa font hiện ngay trong builder; site thật đổi sau lần Publish tới.</p>
        {canWrite && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button icon="globe" onClick={() => setGoogle(true)}>Nhập từ Google Fonts</Button>
            <Button variant="primary" icon="upload" onClick={() => setUpload({})}>Tải file font</Button>
          </div>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {fonts.map((f) => {
          const id = f.id ?? f.cssName;
          return (
            <FontRow
              key={id}
              font={f}
              open={open === id}
              onToggle={() => setOpen(open === id ? null : id)}
              canWrite={canWrite}
              isAdmin={isAdmin}
              onChanged={() => router.refresh()}
              onReplace={() => setUpload({ family: f.cssName })}
            />
          );
        })}
      </ul>
      <FontUploadDialog open={upload !== null} presetFamily={upload?.family} onClose={() => setUpload(null)} onDone={done} />
      <GoogleFontDialog open={google} onClose={() => setGoogle(false)} onDone={done} />
    </div>
  );
}

function FontRow({
  font, open, onToggle, canWrite, isAdmin, onChanged, onReplace,
}: {
  font: FontListItem;
  open: boolean;
  onToggle: () => void;
  canWrite: boolean;
  isAdmin: boolean;
  onChanged: () => void;
  onReplace: () => void;
}) {
  const missingVi = font.faces.some((x) => x.warnings.includes('missing_vietnamese'));
  return (
    <li data-font-row={font.cssName} className={cn(ui.card, 'flex flex-col gap-3 p-4')}>
      <p className="text-[28px] leading-tight" style={{ fontFamily: `${cssString(font.cssName)}, system-ui` }}>{SAMPLE}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{font.cssName}</span>
        {font.tokens.map((t) => (
          <Badge key={t} size="sm"><code className="font-shell-mono">{t}</code></Badge>
        ))}
        <Badge tone={font.source === 'builtin' ? 'neutral' : 'accent'} size="sm">{SOURCE_LABEL[font.source]}</Badge>
        {font.unpublished && <Badge tone="warn" size="sm">Chưa publish</Badge>}
        {missingVi && <Badge tone="danger" size="sm">Thiếu dấu tiếng Việt</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-small text-shell-muted">
        <span>{weightsLabel(font)}</span>
        <span>
          {usedCount(font) ? `Dùng ở ${font.usage.pages.length} trang · ${font.usage.components.length} component` : 'Chưa dùng ở đâu'}
        </span>
        {font.source !== 'builtin' && (
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={onToggle}>
            {open ? 'Thu gọn' : 'Chi tiết'}
          </Button>
        )}
      </div>
      {open && font.id && (
        <FontDetails font={font} editable={canWrite} isAdmin={isAdmin} onChanged={onChanged} onReplace={onReplace} />
      )}
    </li>
  );
}

function FontDetails({
  font, editable, isAdmin, onChanged, onReplace,
}: {
  font: FontListItem;
  editable: boolean;
  isAdmin: boolean;
  onChanged: () => void;
  onReplace: () => void;
}) {
  const preset = Object.entries(FALLBACKS).find(([, v]) => v === font.fallback)?.[0] ?? 'custom';
  const [cssName, setCssName] = useState(font.cssName);
  const [mode, setMode] = useState(preset);
  const [custom, setCustom] = useState(preset === 'custom' ? font.fallback ?? '' : '');
  const [note, setNote] = useState(font.licenseNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const call = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    const res = await fetch(url, init);
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? `Lỗi ${res.status}`);
      return false;
    }
    onChanged();
    return true;
  };
  const save = () =>
    call(`/api/fonts/${font.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cssName, fallback: mode === 'custom' ? custom : mode, licenseNote: note || null }),
    });

  const where = [...font.usage.pages, ...font.usage.components];

  return (
    <div className="flex flex-col gap-3 border-t border-shell-line pt-3">
      <table className="text-small">
        <thead>
          <tr className="text-left text-shell-muted">
            <th className="py-1 font-medium">Weight</th>
            <th className="py-1 font-medium">Kiểu</th>
            <th className="py-1 font-medium">Bộ chữ</th>
            <th className="py-1 font-medium">Dung lượng</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {font.faces.map((x) => (
            <tr key={x.id ?? `${x.weight}-${x.style}-${x.subset}`}>
              <td className="py-1">{x.weight}</td>
              <td className="py-1">{x.style}</td>
              <td className="py-1">{x.subset || 'Latin + tiếng Việt'}</td>
              <td className="py-1">{x.bytes ? `${Math.round(x.bytes / 1024)} KB` : '—'}</td>
              <td className="py-1 text-right">
                {editable && x.id && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => call(`/api/fonts/${font.id}/faces/${x.id}`, { method: 'DELETE' })}>
                    Xoá
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editable && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Tên họ CSS" value={cssName} onChange={(e) => setCssName(e.target.value)} />
          <SelectField
            label="Fallback"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' },
              { value: 'mono', label: 'Mono' }, { value: 'custom', label: 'Tự gõ' },
            ]}
          />
          {mode === 'custom' && <TextField label="Chuỗi fallback" mono value={custom} onChange={(e) => setCustom(e.target.value)} />}
          <TextField
            label="Ghi chú giấy phép"
            value={note}
            hint={font.licenseConfirmedBy ? `Xác nhận bởi ${font.licenseConfirmedBy}` : undefined}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}

      {where.length > 0 && (
        <ul className="flex flex-col gap-1 text-small">
          {where.map((u) => (
            <li key={u.href}>
              <Link href={u.href} className="text-shell-accent hover:text-shell-ink">{u.label}</Link>
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-small text-shell-danger">{error}</p>}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={busy} onClick={save}>Lưu thay đổi</Button>
          <Button icon="upload" onClick={onReplace}>Thêm hoặc thay file</Button>
          {isAdmin && (
            <Button
              variant="danger"
              icon="trash"
              disabled={busy || where.length > 0}
              title={where.length ? 'Còn nơi đang dùng — đổi font ở những chỗ đó trước.' : undefined}
              onClick={() => setConfirmDelete(true)}
            >
              Xoá họ
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (await call(`/api/fonts/${font.id}`, { method: 'DELETE' })) setConfirmDelete(false);
        }}
        title={`Xoá họ "${font.cssName}"?`}
        consequence="Token và mọi file của họ này rời khỏi bản nháp. Site thật giữ font cũ tới lần Publish sau."
        confirmLabel="Xoá họ"
        busy={busy}
      />
    </div>
  );
}
```

Nút "Lưu thay đổi" khác tên với nút "Lưu" trong hộp tải lên, để `getByRole('button', { name: 'Lưu' })` ở e2e không trúng hai nút.

- [ ] **Step 8: Viết trang** — `src/app/(builder)/builder/settings/fonts/page.tsx`

```tsx
import { redirect } from 'next/navigation';

import { FontList } from '@/components/builder/fonts/FontList';
import { SettingsTabs } from '@/components/builder/SettingsTabs';
import { PageHeader, PageShell } from '@/components/builder/ui/Page';
import { getSession } from '@/lib/auth/guard';
import { listFonts } from '@/lib/fonts/list';

export const dynamic = 'force-dynamic';

export default async function FontsPage() {
  const session = await getSession();
  if (!session) redirect('/builder/login?next=/builder/settings/fonts');
  const { fonts, previewCss } = await listFonts();
  return (
    <PageShell>
      <PageHeader title="Font" />
      <SettingsTabs current="fonts" />
      <FontList
        fonts={fonts}
        previewCss={previewCss}
        canWrite={session.role !== 'viewer'}
        isAdmin={session.role === 'admin'}
      />
    </PageShell>
  );
}
```

- [ ] **Step 9: Link "Quản lý font →" trong Inspector**

Trong `src/components/builder/ExtraFields.tsx`:
- thêm `import Link from 'next/link';`;
- thay `case 'len':` bằng:

```tsx
    case 'len':
      if (meta.field === 'family') {
        return (
          <div className="flex flex-col gap-1">
            <LenControl {...common} tokens={tokens} tokenCategory={meta.tokenCategory} />
            <Link href="/builder/settings/fonts" className="self-end text-mini text-shell-accent hover:text-shell-ink">
              Quản lý font →
            </Link>
          </div>
        );
      }
      return <LenControl {...common} tokens={tokens} tokenCategory={meta.tokenCategory} />;
```

Trong `src/lib/builder/extra-fields.ts`, đổi `hint` của trường `family` thành:

```ts
      hint: 'CHỈ nhận token font: font-display, font-body, font-mono… và font-<tên> của họ tải lên ở Cài đặt › Font.',
```

- [ ] **Step 10: Chạy**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e:restart && pnpm e2e:test e2e/fonts.spec.ts e2e/page-transfer.spec.ts e2e/settings.spec.ts e2e/inspector.spec.ts`
Expected: PASS. `page-transfer.spec.ts` canh `ZipDropZone` sau khi tách; `settings.spec.ts` canh trang Cài đặt có thêm tab.

- [ ] **Step 11: Commit**

```bash
git add src/components/builder/SettingsTabs.tsx src/components/builder/FileDropZone.tsx src/components/builder/transfer/ZipDropZone.tsx src/components/builder/fonts "src/app/(builder)/builder/settings" src/components/builder/ExtraFields.tsx src/lib/builder/extra-fields.ts e2e/fonts.spec.ts
git commit -m "feat(fonts): man Cai dat > Font - danh sach, tai file, nhap Google Fonts, sua, xoa"
```

---

### Task 17: MCP — `list_fonts`, `upload_font`

**Files:**
- Create: `src/lib/ai/font-tools.ts`
- Modify: `src/lib/ai/tools.ts`, `mcp/server.mjs`, `mcp/contract.snapshot.json` (sinh tự động), `mcp/README.md`, `e2e/mcp.spec.ts`, `e2e/fonts.spec.ts`

**Interfaces:**
- Consumes: `listFonts` (Task 13), `importGoogleFont`, `uploadFontFromUrl` (Task 13), `ToolDef`, `ToolContext` (`src/lib/ai/tools.ts`).
- Produces: `FONT_TOOLS: ToolDef[]`.

- [ ] **Step 1: Viết e2e hỏng**

Thêm vào `e2e/mcp.spec.ts` (dùng `serviceToken` và `tool` sẵn có trong file):

```ts
test.describe('font qua MCP', () => {
  test('list_fonts thấy họ có sẵn; upload_font từ chối filePath phía server; service token chỉ POST được /api/fonts', async ({ request }) => {
    const me = await (await request.get('/api/auth/me')).json();
    const token = await serviceToken({ sub: me.id, email: me.email, role: me.role });

    const listed = await (await tool(request, token, 'list_fonts')).json();
    expect(listed.result.fonts.some((f: { cssName: string; source: string }) => f.cssName === 'gilroy' && f.source === 'builtin')).toBe(true);

    const viaServer = await (await tool(request, token, 'upload_font', { filePath: 'C:/x.ttf', licenseConfirmed: true })).json();
    expect(viaServer.result.ok).toBe(false);
    expect(viaServer.result.error).toContain('MCP server');

    // Đường mà proxy đi khi có filePath: multipart thẳng vào /api/fonts bằng Bearer.
    const dry = await request.post('/api/fonts', {
      headers: { authorization: `Bearer ${token}` },
      multipart: {
        file: { name: 'ny.ttf', mimeType: 'font/ttf', buffer: readFileSync('public/fonts/newyork-regular.ttf') },
        family: 'MCP Dry', dryRun: 'true',
      },
    });
    expect(dry.status()).toBe(200);

    expect((await request.get('/api/fonts', { headers: { authorization: `Bearer ${token}` } })).ok()).toBe(false);
    expect((await request.delete('/api/fonts/bat-ky', { headers: { authorization: `Bearer ${token}` } })).ok()).toBe(false);
  });
});
```

Thêm `import { readFileSync } from 'node:fs';` ở đầu `e2e/mcp.spec.ts`. Request trong describe này phải **không** mang cookie phiên khi gọi bằng Bearer; nếu file đặt `test.use({ storageState: … })` theo từng describe thì giữ mặc định (có phiên admin) để `/api/auth/me` chạy được, vì các lời gọi Bearer đã mang header riêng.

Thêm vào `e2e/fonts.spec.ts`:

```ts
test('gán font cho node bằng apply_ops thì bản nháp dùng token đó', async ({ request }) => {
  const family = `E2E Apply ${rand()}`;
  const { family: fam } = await uploadFont(request, family);
  const call = async (name: string, input: unknown) => {
    const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).result;
  };
  const pageId = (await call('list_pages', {})).pages[0].id as string;
  const nodeId = (await call('list_text_units', { pageId, limit: 1 })).units[0].nodeId as string;
  const op = (family: unknown) => ({ op: 'setStyle', nodeId, target: 'base', patch: { typography: { family } } });
  try {
    const w = await call('apply_ops', { pageId, label: 'e2e font — gán', ops: [op({ $token: fam.token })] });
    expect(w.ok, JSON.stringify(w)).toBe(true);
    const html = await (await request.get(`/render/${pageId}`)).text();
    expect(html).toContain(`var(--${fam.token})`);
    expect(html).toContain(`--${fam.token}:`);
    expect(html).toContain(`font-family: "${family}"`);
  } finally {
    await call('apply_ops', { pageId, label: 'e2e font — gỡ', ops: [op(null)] });
  }
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `pnpm e2e:test e2e/mcp.spec.ts e2e/fonts.spec.ts`
Expected: FAIL ở `list_fonts` ("Không có tool tên"). Test `apply_ops` có thể đã PASS từ Task 14; giữ nó làm test hồi quy.

- [ ] **Step 3: Viết `src/lib/ai/font-tools.ts`**

```ts
import { z } from 'zod';

import { listFonts } from '@/lib/fonts/list';
import { importGoogleFont, uploadFontFromUrl } from '@/lib/fonts/upload';

import type { ToolContext, ToolDef } from './tools';

const listFontsTool: ToolDef = {
  name: 'list_fonts',
  title: 'Danh sách font',
  description:
    'Mọi họ font dùng được: 4 họ có sẵn trong bản build và các họ tải lên ở Cài đặt › Font.\n\n' +
    'KIỂM Ở ĐÂY TRƯỚC khi tải font mới — họ đã có thì dùng lại.\n\n' +
    'Gán font cho một node bằng `apply_ops`: `{ op: "setStyle", nodeId, target: "base", ' +
    'patch: { typography: { family: { $token: "<token>" } } } }`.\n\n' +
    'Font mới hoặc vừa sửa chỉ lên site thật sau khi NGƯỜI DÙNG bấm Publish (`unpublished: true`).',
  input: z.object({}).strict(),
  readOnly: true,
  async run() {
    const { fonts } = await listFonts();
    return {
      ok: true,
      fonts: fonts.map((f) => ({
        cssName: f.cssName,
        token: f.tokens[0],
        tokens: f.tokens,
        source: f.source,
        fallback: f.fallback,
        faces: f.faces.map((x) => ({ weight: x.weight, style: x.style, subset: x.subset, warnings: x.warnings })),
        usage: { pages: f.usage.pages.length, components: f.usage.components.length },
        unpublished: f.unpublished,
      })),
    };
  },
};

const uploadFontTool: ToolDef = {
  name: 'upload_font',
  title: 'Tải font lên',
  description:
    'Thêm một file font (hoặc một họ Google Fonts) vào Cài đặt › Font. Trả về `family.token` để gán bằng apply_ops.\n\n' +
    'Nguồn — đúng MỘT trong ba:\n' +
    ' - `filePath`: file trên máy người dùng (.woff2/.woff/.ttf/.otf). ƯU TIÊN: MCP server đọc file tại chỗ, byte không đi qua hội thoại.\n' +
    ' - `sourceUrl`: link https tới một file font.\n' +
    ' - `google`: `{ family: "Be Vietnam Pro" | link specimen, weights?, italic? }` — tự kéo đủ weight + bộ tiếng Việt về kho.\n\n' +
    'Mỗi lần gọi MỘT file; cả bộ font (Regular, Bold…) thì gọi nhiều lần cùng `family`.\n\n' +
    'Chạy `dryRun: true` TRƯỚC, cho người dùng xem tên họ, weight và cảnh báo (thiếu dấu tiếng Việt, giấy phép cấm nhúng), rồi mới lưu.\n\n' +
    '`licenseConfirmed: true` BẮT BUỘC với filePath/sourceUrl. PHẢI HỎI người dùng có quyền dùng font này trên web không — KHÔNG tự điền.\n\n' +
    'Tên đọc được trùng font có sẵn hay font dự phòng (vd. "Inter", "New York") thì lỗi `name_reserved` — đặt `family` khác, vd. "Inter Web".\n\n' +
    'Font chỉ lên site thật sau khi người dùng bấm Publish.',
  input: z
    .object({
      filePath: z.string().optional().describe('Đường dẫn file font trên máy người dùng. Ưu tiên dùng.'),
      sourceUrl: z.string().url().optional().describe('Link https tới file font.'),
      google: z
        .object({
          family: z.string().min(1).max(200),
          weights: z.array(z.number().int().min(1).max(1000)).max(9).optional(),
          italic: z.boolean().optional(),
        })
        .strict()
        .optional()
        .describe('Nhập từ Google Fonts.'),
      family: z.string().max(64).optional().describe('Tên họ CSS, đè tên đọc từ file.'),
      weight: z.string().max(9).optional().describe('Đè weight đọc từ file: "700" hoặc "100 900".'),
      style: z.enum(['normal', 'italic']).optional(),
      fallback: z.string().max(200).optional().describe('sans | serif | mono | chuỗi font. Chỉ dùng khi tạo họ mới.'),
      licenseConfirmed: z.boolean().optional().describe('HỎI người dùng. Bắt buộc true với filePath/sourceUrl.'),
      licenseNote: z.string().max(500).optional(),
      dryRun: z.boolean().optional().describe('Chỉ đọc, không lưu.'),
    })
    .strict(),
  readOnly: false,
  async run(
    input: {
      filePath?: string; sourceUrl?: string;
      google?: { family: string; weights?: number[]; italic?: boolean };
      family?: string; weight?: string; style?: 'normal' | 'italic'; fallback?: string;
      licenseConfirmed?: boolean; licenseNote?: string; dryRun?: boolean;
    },
    ctx: ToolContext,
  ) {
    if ([input.filePath, input.sourceUrl, input.google].filter(Boolean).length !== 1) {
      return { ok: false, error: 'Cần đúng một trong: filePath, sourceUrl, google.' };
    }
    if (input.filePath) {
      // Tới đây là tool được gọi KHÔNG qua mcp/server.mjs. Server không có đĩa của người dùng,
      // và đọc đường dẫn tuỳ ý phía server là một lỗ đọc file — cùng lý do với upload_asset.
      return { ok: false, error: 'filePath chỉ dùng được qua MCP server chạy trên máy bạn. Ở đây hãy dùng sourceUrl hoặc google.' };
    }
    const common = {
      fallback: input.fallback ?? null,
      licenseNote: input.licenseNote ?? null,
      dryRun: input.dryRun ?? false,
      actor: { email: ctx.session.email, sub: ctx.session.sub },
    };
    const r = input.google
      ? await importGoogleFont({ ...common, google: input.google, cssName: input.family ?? null })
      : await uploadFontFromUrl({
          ...common,
          sourceUrl: input.sourceUrl!,
          overrides: { family: input.family ?? null, weight: input.weight ?? null, style: input.style ?? null },
          licenseConfirmed: input.licenseConfirmed ?? false,
        });
    if (!r.ok) return { ok: false, code: r.code, error: r.error };
    return {
      ...r,
      note: r.dryRun
        ? 'Chưa lưu gì. Cho người dùng xem tên họ, weight và cảnh báo, rồi gọi lại không có dryRun.'
        : `Gán bằng apply_ops: typography.family = { $token: "${r.family.token}" }. Font chỉ lên site thật sau khi người dùng bấm Publish.`,
    };
  },
};

export const FONT_TOOLS: ToolDef[] = [listFontsTool, uploadFontTool];
```

- [ ] **Step 4: Đăng ký tool và sửa mô tả** — `src/lib/ai/tools.ts`

- Thêm `import { FONT_TOOLS } from './font-tools';` cạnh `ASSET_TOOLS`.
- Thêm `...FONT_TOOLS,` ngay sau `...ASSET_TOOLS,` trong mảng `TOOLS`.
- Trong mô tả của `searchTokens`, ở chỗ liệt kê các `category`, thêm `font` (họ font — gán cho `typography.family`).

- [ ] **Step 5: Nhánh `filePath` trong `mcp/server.mjs`**

Ngay sau hàm `uploadBuffer`:

```js
/**
 * upload_font với `filePath`: đọc file trên MÁY NÀY rồi POST multipart vào `/api/fonts`.
 *
 * Cùng lý do với `uploadLocalFile`: byte font không được đi qua context của model. Và cùng
 * bài học `folder` ở `uploadBuffer`: nhánh này tự dựng multipart, tham số nào không append
 * tay là tham số biến mất — nên liệt kê đủ ở đây.
 */
async function uploadLocalFont(args) {
  const { readFile } = await import('node:fs/promises');
  const { basename } = await import('node:path');

  let bytes;
  try {
    bytes = await readFile(args.filePath);
  } catch (error) {
    throw new Error(`Không đọc được file ${args.filePath}. (${error.message})`);
  }
  const form = new FormData();
  form.append('file', new Blob([bytes]), basename(args.filePath));
  for (const k of ['family', 'weight', 'style', 'fallback', 'licenseNote']) {
    if (typeof args[k] === 'string' && args[k]) form.append(k, args[k]);
  }
  if (args.licenseConfirmed === true) form.append('licenseConfirmed', 'true');
  if (args.dryRun === true) form.append('dryRun', 'true');

  const response = await fetch(`${BASE}/api/fonts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'x-mm-client': String(CLIENT_VERSION) },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // Không phải JSON thì dùng nguyên văn.
    }
    throw new Error(`Tải font thất bại (${response.status}): ${message}`);
  }
  return JSON.parse(text);
}
```

Trong `callTool`, ngay sau khối `if (name === 'upload_asset' && args.filePath) { … }`:

```js
  if (name === 'upload_font' && args.filePath) {
    const result = await uploadLocalFont(args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ...result,
              note: result.dryRun
                ? 'Chưa lưu gì. Cho người dùng xem tên họ, weight và cảnh báo, rồi gọi lại không có dryRun.'
                : `Gán bằng apply_ops: typography.family = { $token: "${result.family.token}" }. Font chỉ lên site thật sau khi người dùng bấm Publish.`,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
```

- [ ] **Step 6: Sinh lại hợp đồng MCP và README**

Run: `pnpm mcp:snapshot`
Expected: `mcp/contract.snapshot.json` có thêm `list_fonts` và `upload_font`; hash đổi.

Trong `mcp/README.md`, ở bảng hoặc danh sách tool, thêm hai dòng:
- **`list_fonts`** — liệt kê họ font (có sẵn và tải lên) kèm token để gán bằng `apply_ops`.
- **`upload_font`** — thêm font từ file trên máy (`filePath`), link https hoặc Google Fonts; luôn chạy `dryRun` trước và hỏi người dùng về giấy phép.

- [ ] **Step 7: Chạy**

Run: `pnpm typecheck && pnpm test && pnpm e2e:restart && pnpm e2e:test e2e/mcp.spec.ts e2e/fonts.spec.ts e2e/agent-tools.spec.ts`
Expected: PASS. `src/lib/ai/contract.test.ts` xanh sau khi chạy snapshot.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/font-tools.ts src/lib/ai/tools.ts mcp/server.mjs mcp/contract.snapshot.json mcp/README.md e2e/mcp.spec.ts e2e/fonts.spec.ts
git commit -m "feat(mcp): tool list_fonts va upload_font (filePath doc tai may nguoi dung)"
```

---

### Task 18: Xuất/nhập trang mang theo họ font

**Files:**
- Modify:
  - `src/lib/transfer/manifest.ts`, `src/lib/transfer/fixtures.ts`;
  - `src/lib/transfer/export.ts`, `src/lib/transfer/target.ts`, `src/lib/transfer/import-plan.ts`, `src/lib/transfer/commit.ts`, `src/lib/transfer/guides.ts`.
- Test: `src/lib/transfer/manifest.test.ts`, `src/lib/transfer/import-plan.test.ts`

**Interfaces:**
- Produces:
  - `zBundleFont`, `type BundleFont`, `PageBundle.fonts: BundleFont[]` (mặc định `[]`);
  - `TargetSnapshot.fonts: { slug: string; cssName: string; hashes: string[] }[]`;
  - `interface FontPlanRow { slug: string; cssName: string; action: 'create'|'use-target'; differs: boolean }`, `ImportPlan.fonts: FontPlanRow[]`;
  - mã issue `'font-differs'` (C8) và `'font-name-conflict'` (G11).
- Consumes: `fontTokenName`, `fontTokenValue`, `isFontStack`, `isReservedFamily` (Task 3); `FONTS_TAG` (Task 9).

- [ ] **Step 1: Viết test hỏng**

`src/lib/transfer/manifest.test.ts`, thêm:

```ts
describe('fonts trong gói', () => {
  it('gói cũ không có fonts vẫn đọc được, mặc định []', () => {
    const r = parseBundle(sampleBundle());
    expect(r.ok && r.bundle.fonts).toEqual([]);
  });

  it('chặn fallback có thể tiêm CSS', () => {
    const r = parseBundle(sampleBundle({
      fonts: [{ slug: 'g', cssName: 'G', fallback: 'x; } body {', source: 'upload', googleFamily: null, licenseNote: null, faces: [] }],
    }));
    expect(r.ok).toBe(false);
  });
});
```

`src/lib/transfer/import-plan.test.ts`:
- thêm `fonts: [],` vào `snap()`;
- import `parseBundle` từ `./manifest` và `sampleBundle`, `SHA` từ `./fixtures` (nếu file chưa import);
- thêm:

```ts
describe('font', () => {
  const FONT_SHA = 'b'.repeat(64);
  const withFont = (over: Record<string, unknown> = {}) => {
    const raw = sampleBundle({
      doc: { schemaVersion: 2, rootId: 'root', nodes: { root: { id: 'root', type: 'Section', parentId: null, children: [], effects: [], style: { base: { typography: { family: { $token: 'font-gilroy-web' } } } } } } },
      assets: [{
        id: 'cfontasset000000000000001', key: 'public/builder/gilroy-web-700-normal-bbbbbbbb.woff2', name: 'gilroy-web-700-normal.woff2',
        kind: 'font', mime: 'font/woff2', bytes: 10, width: null, height: null, blurhash: null, alt: null,
        folder: 'fonts/gilroy-web', sha256: FONT_SHA, file: `files/${FONT_SHA}.woff2`,
      }],
      fonts: [{
        slug: 'gilroy-web', cssName: 'Gilroy Web', fallback: 'system-ui, sans-serif', source: 'upload', googleFamily: null, licenseNote: null,
        faces: [{ weight: '700', style: 'normal', unicodeRange: '', subset: '', assetId: 'cfontasset000000000000001' }],
      }],
      ...over,
    });
    const r = parseBundle(raw);
    if (!r.ok) throw new Error(r.error);
    return r.bundle;
  };

  it('đích chưa có: tạo, và token font của gói không bị coi là "builder quá cũ"', () => {
    const p = plan(withFont());
    expect(p.fonts).toEqual([{ slug: 'gilroy-web', cssName: 'Gilroy Web', action: 'create', differs: false }]);
    expect(codes(p)).not.toContain('block:builder-too-old');
  });

  it('đích có cùng file: dùng lại, không cảnh báo', () => {
    const p = plan(withFont(), snap({ fonts: [{ slug: 'gilroy-web', cssName: 'Gilroy Web', hashes: ['bbbbbbbb'] }] }));
    expect(p.fonts[0]).toMatchObject({ action: 'use-target', differs: false });
    expect(codes(p)).not.toContain('todo:font-differs');
  });

  it('đích có nhưng khác file: dùng bản ở đích, việc cần làm', () => {
    const p = plan(withFont(), snap({ fonts: [{ slug: 'gilroy-web', cssName: 'Gilroy Web', hashes: ['cccccccc'] }] }));
    expect(p.fonts[0]).toMatchObject({ action: 'use-target', differs: true });
    expect(codes(p)).toContain('todo:font-differs');
  });

  it('tên trùng họ khác ở đích hoặc tên dành riêng: chặn', () => {
    const clash = plan(withFont(), snap({ fonts: [{ slug: 'khac', cssName: 'gilroy web', hashes: [] }] }));
    expect(codes(clash)).toContain('block:font-name-conflict');
  });
});
```

Nếu `codes` chưa có trong file test, nó là helper sẵn có trả mảng `` `${level}:${code}` ``. Tìm bằng `grep -n "const codes" src/lib/transfer/import-plan.test.ts` và dùng đúng tên đó.

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `pnpm vitest run src/lib/transfer`
Expected: FAIL (`fonts` không có trong schema, plan và snapshot).

- [ ] **Step 3: Schema gói** — `src/lib/transfer/manifest.ts`

- Thêm `import { isFontStack } from '@/lib/fonts/names';`.
- Thêm sau `zBundleToken`:

```ts
export const zBundleFontFace = z.object({
  weight: z.string().regex(/^[1-9]\d{0,3}( [1-9]\d{0,3})?$/, 'weight không hợp lệ'),
  style: z.enum(['normal', 'italic']),
  unicodeRange: z.string().max(4000),
  subset: z.string().max(20),
  /** Id asset ở NGUỒN — trỏ vào `assets[]` của chính gói. */
  assetId: z.string().min(1).max(64),
});

export const zBundleFont = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, 'slug font không hợp lệ'),
  cssName: z.string().min(1).max(64),
  fallback: z.string().refine(isFontStack, 'fallback font không hợp lệ'),
  source: z.enum(['upload', 'google']),
  googleFamily: z.string().max(200).nullable(),
  licenseNote: z.string().max(500).nullable(),
  faces: z.array(zBundleFontFace).max(200),
});
```

- Trong `zPageBundle`, sau `tokens: …`: `fonts: z.array(zBundleFont).default([]),`. Gói xuất trước tính năng này không có khoá `fonts`, nên **không** tăng `BUNDLE_FORMAT_VERSION`.
- Thêm `export type BundleFont = z.infer<typeof zBundleFont>;`.

`src/lib/transfer/fixtures.ts`: thêm `fonts: [],` sau `tokens: [],` trong `sampleBundle`.

- [ ] **Step 4: Xuất** — `src/lib/transfer/export.ts`

- Import: `import { fontTokenName } from '@/lib/fonts/names';`.
- **Dời** khối `const customTokens = …` và `const tokenNames = …` lên **trước** `const assetRows = …`, rồi thêm ngay sau đó:

```ts
  // Họ font tải lên mà trang dùng — đi trong `fonts[]`, file của chúng đi chung `assets[]`.
  // Token của họ font KHÔNG xuất riêng trong `tokens[]`: nó sinh ra từ họ font.
  const fontFamilies = await prisma.fontFamily.findMany({ include: { faces: true } });
  const fontByToken = new Map(fontFamilies.map((f) => [fontTokenName(f.slug), f]));
  const usedFonts = [...tokenNames].map((n) => fontByToken.get(n)).filter((f): f is NonNullable<typeof f> => !!f);
  const fontAssetIds = usedFonts.flatMap((f) => f.faces.map((x) => x.assetId));
```

- Đổi `where: { id: { in: [...uses.keys()] } }` của `assetRows` thành `where: { id: { in: [...new Set([...uses.keys(), ...fontAssetIds])] } }`.
- Trong object `bundle`:

```ts
    tokens: customTokens.filter((t) => tokenNames.has(t.name) && !fontByToken.has(t.name)),
    fonts: usedFonts.map((f) => ({
      slug: f.slug, cssName: f.cssName, fallback: f.fallback,
      source: f.source === 'google' ? 'google' : 'upload',
      googleFamily: f.googleFamily, licenseNote: f.licenseNote,
      faces: f.faces.map((x) => ({
        weight: x.weight, style: x.style === 'italic' ? 'italic' : 'normal',
        unicodeRange: x.unicodeRange, subset: x.subset, assetId: x.assetId,
      })),
    })),
```

- [ ] **Step 5: Ảnh chụp đích** — `src/lib/transfer/target.ts`

- Trong `interface TargetSnapshot` (khai ở `import-plan.ts`), thêm:

```ts
  /** Họ font ở đích liên quan tới gói (cùng slug, hoặc cùng tên không phân biệt hoa thường). `hashes`: 8 hex trong khoá file. */
  fonts: { slug: string; cssName: string; hashes: string[] }[];
```

- Trong `loadTargetSnapshot`, trước `return`:

```ts
  const fontRows = bundle.fonts.length
    ? await prisma.fontFamily.findMany({
        where: {
          OR: [
            { slug: { in: bundle.fonts.map((f) => f.slug) } },
            ...bundle.fonts.map((f) => ({ cssName: { equals: f.cssName, mode: 'insensitive' as const } })),
          ],
        },
        select: { slug: true, cssName: true, faces: { select: { asset: { select: { key: true } } } } },
      })
    : [];
```

- Trong object trả về, thêm `fonts: fontRows.map((f) => ({ slug: f.slug, cssName: f.cssName, hashes: f.faces.map((x) => keyHash(x.asset.key)) })),`.
- Thêm helper ở cuối file (export để `import-plan` dùng chung):

```ts
/** `public/builder/ten-1a2b3c4d.woff2` → `1a2b3c4d` — khoá asset mang 8 hex đầu của sha256 nội dung. */
export function keyHash(key: string): string {
  return /-([0-9a-f]{8})\.[a-z0-9]+$/.exec(key)?.[1] ?? '';
}
```

`import-plan.ts` không được import từ `target.ts` nếu `target.ts` đã import `import-plan.ts` (tránh vòng). Kiểm bằng `grep -n "from './import-plan'" src/lib/transfer/target.ts`. Nếu có vòng, đặt `keyHash` trong `src/lib/transfer/collect.ts` và import từ đó ở cả hai nơi.

- [ ] **Step 6: Lập kế hoạch** — `src/lib/transfer/import-plan.ts`

- Import: `import { isReservedFamily } from '@/lib/fonts/names';` và `keyHash` (theo Step 5).
- Thêm type:

```ts
export interface FontPlanRow { slug: string; cssName: string; action: 'create' | 'use-target'; differs: boolean }
```

- Thêm `fonts: FontPlanRow[];` vào `interface ImportPlan`.
- Trong `buildImportPlan`, ngay sau khối `const tokens = bundle.tokens.map(…)`:

```ts
  const assetSha = new Map(bundle.assets.map((a) => [a.id, a.sha256.slice(0, 8)]));
  const fonts: FontPlanRow[] = bundle.fonts.map((f) => {
    const same = snap.fonts.find((t) => t.slug === f.slug);
    if (!same) {
      const clash = snap.fonts.find((t) => t.cssName.toLowerCase() === f.cssName.toLowerCase());
      if (clash || isReservedFamily(f.cssName)) {
        issues.push(issue('font-name-conflict', 'block', { vars: { name: f.cssName } }));
      }
      return { slug: f.slug, cssName: f.cssName, action: 'create', differs: false };
    }
    const want = f.faces.map((x) => assetSha.get(x.assetId) ?? '').sort();
    const have = [...same.hashes].sort();
    const differs = JSON.stringify(want) !== JSON.stringify(have);
    if (differs) {
      issues.push(issue('font-differs', 'todo', {
        vars: { name: same.cssName },
        detail: `Gói có ${want.length} file, ở đây có ${have.length} file.`,
        items: [{ label: 'Cài đặt › Font', href: '/builder/settings/fonts' }],
      }));
    }
    return { slug: f.slug, cssName: same.cssName, action: 'use-target', differs };
  });
```

- Ở phép kiểm token tĩnh (khối có `const own = new Set(bundle.tokens.map((t) => t.name));`), đổi thành:

```ts
    const own = new Set([...bundle.tokens.map((t) => t.name), ...bundle.fonts.map((f) => `font-${f.slug}`)]);
```

- Thêm `fonts` vào object trả về của `buildImportPlan`, cạnh `tokens`.

- [ ] **Step 7: Hướng dẫn** — `src/lib/transfer/guides.ts`

- Thêm `| 'font-name-conflict'` vào nhóm "Nhập — chặn (G)" và `| 'font-differs'` vào nhóm "việc cần làm (C)" của `TransferCode`.
- Trong `GUIDES`:

```ts
  'font-name-conflict': {
    tag: 'G11', title: 'Tên họ font trùng ở đây',
    why: 'Gói mang họ font "{name}", nhưng ở đây tên đó đã thuộc một họ khác, hoặc là tên font có sẵn của site.',
    steps: ['Ở môi trường nguồn, vào Cài đặt › Font, đổi tên họ "{name}" (vd. thêm "Web").', 'Xuất lại gói rồi nhập.'],
  },
  'font-differs': {
    tag: 'C8', title: 'Họ font ở đây khác bản trong gói',
    why: 'Trang dùng họ font "{name}" đang có ở đây, và các file của nó khác bản ở nguồn.',
    steps: ['Mở Cài đặt › Font (link).', 'Tải thêm hoặc thay file cho giống nguồn.', 'Publish khi đã kiểm.'],
  },
```

- [ ] **Step 8: Ghi** — `src/lib/transfer/commit.ts`

- Import:

```ts
import { fontTokenName, fontTokenValue } from '@/lib/fonts/names';
import { FONTS_TAG } from '@/lib/fonts/seal';
```

- Trong transaction, ngay sau vòng tạo `createdTokens`:

```ts
      const createdFonts: string[] = [];
      for (const row of plan.fonts.filter((x) => x.action === 'create')) {
        const src = bundle.fonts.find((x) => x.slug === row.slug)!;
        await tx.fontFamily.create({
          data: {
            slug: src.slug, cssName: src.cssName, fallback: src.fallback, source: src.source,
            googleFamily: src.googleFamily, licenseNote: src.licenseNote, licenseConfirmedBy: null,
            createdBy: session.email,
            faces: {
              create: src.faces.map((x) => ({
                weight: x.weight, style: x.style, unicodeRange: x.unicodeRange, subset: x.subset,
                assetId: assetMap.get(x.assetId)!,
              })),
            },
          },
        });
        await tx.token.create({
          data: {
            name: fontTokenName(src.slug), value: fontTokenValue(src.cssName, src.fallback),
            category: 'font', custom: true,
            aiDescription: `Họ font ${src.cssName} (nhập từ ${bundle.source.origin}). Gán bằng typography.family.`,
          },
        });
        createdFonts.push(src.slug);
      }
```

- Thêm `fonts: createdFonts` vào `created` của meta (và `fonts: string[]` vào kiểu `created` trong `ImportMeta`). Chỉ để truy vết; `undo.ts` **không** đọc nó.
- Trả `createdFonts` ra khỏi transaction cạnh `createdTokens`. Sau dòng `if (result.createdTokens.length) revalidateTag(CUSTOM_TOKENS_TAG);`, thêm:

```ts
    if (result.createdFonts.length) {
      revalidateTag(FONTS_TAG);
      revalidateTag(CUSTOM_TOKENS_TAG);
    }
```

- [ ] **Step 9: Chạy**

Run: `pnpm vitest run src/lib/transfer && pnpm typecheck && pnpm e2e:test e2e/page-transfer.spec.ts`
Expected: PASS. `page-transfer.spec.ts` canh gói cũ (không có `fonts`) vẫn nhập được.

- [ ] **Step 10: Commit**

```bash
git add src/lib/transfer
git commit -m "feat(transfer): goi xuat/nhap trang mang theo ho font tai len"
```

---

### Task 19: Kiểm trên image Docker (bản standalone)

**Files:** không sửa file nào, trừ khi bước kiểm lộ lỗi.

Lý do có task này: stack e2e chạy `next dev`, nên không bắt được trường hợp bản standalone thiếu `harfbuzz-subset.wasm`.

- [ ] **Step 1: Dựng và chạy image**

Run: `pnpm docker:build && pnpm docker:up`
Expected: container builder chạy, `pnpm docker:logs` không có lỗi khởi động.

- [ ] **Step 2: Kiểm file wasm có trong image**

Run: `docker compose exec builder sh -c "find / -name 'harfbuzz-subset.wasm' -not -path '*/proc/*' 2>/dev/null | head"`
Expected: ít nhất một đường dẫn trong thư mục app (`/app/node_modules/.pnpm/harfbuzzjs@…`). Nếu service trong `docker-compose.yml` không tên `builder`, dùng tên đúng (`docker compose ps`).

- [ ] **Step 3: Tải một font TTF thật qua màn hình**

Mở builder trong image (URL theo `scripts/docker-stack.mjs`), đăng nhập, vào **Cài đặt › Font › Tải file font**, chọn `public/fonts/newyork-regular.ttf`, đặt tên "Docker Check", tick giấy phép, bấm **Lưu**.

Expected: dòng "Docker Check" hiện ra, dung lượng face khoảng vài chục KB (đã cắt), có nhãn "Chưa publish". Nếu lỗi "Không cắt được font", kiểm `outputFileTracingIncludes` và `serverExternalPackages` (Task 1, Step 6), build lại.

- [ ] **Step 4: Dọn**

Xoá họ "Docker Check" ở màn Font (tài khoản admin), rồi `pnpm docker:down`.

- [ ] **Step 5: Báo kết quả cho user**

Ghi lại: đường dẫn wasm tìm thấy, dung lượng face sau khi cắt, và mọi chỉnh sửa phải làm ở `next.config.mjs` (nếu có, commit riêng: `fix(fonts): keo file wasm cua harfbuzz vao ban standalone`).

---

## Rà soát theo spec

| Mục spec | Task |
|---|---|
| §1 Mục tiêu (không build lại; Claude qua MCP; Publish mới đổi) | 13, 14, 17 |
| §4 Mô hình dữ liệu, token, tên dành riêng | 3, 7, 9 |
| §5 Họ font có sẵn (chỉ đọc), xếp lại hạng token | 3, 11, 16 |
| §6.1–6.3 Sinh CSS, bản nháp, niêm phong | 6, 9, 14 |
| §6.4 Nhãn "Chưa publish" | 6 (`unpublishedSlugs`), 13 (`list.ts`), 16 |
| §6.5 Token font trong `custom-tokens.ts` | 11 |
| §6.6 Route `/mm-font` | 6 (`isFontKey`), 12 |
| §7 Tải file (nhận diện, metadata, cảnh báo, cắt, ghép, dryRun, fallback) | 2, 4, 5, 8, 9, 13 |
| §8 Google Fonts | 10, 13 |
| §9 Giấy phép | 13 (`license_required`), 16 (ô tick), 17 (mô tả tool) |
| §10 API, quyền, mã lỗi, đếm chỗ dùng | 4, 9, 11, 13 |
| §11 Màn hình, Inspector | 16 |
| §12 MCP | 17 |
| §13 Xuất/nhập | 18 |
| §14 Rủi ro wasm/standalone | 1 (Step 6), 19 |
| §16 Kiểm thử | mỗi task + 13, 14, 16, 17 (e2e) |
