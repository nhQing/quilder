import { createHash } from 'node:crypto';

/**
 * Gộp CSS tĩnh thành MỘT chuỗi xác định, để niêm phong vào một release.
 *
 * ## Vì sao phải niêm phong
 *
 * `src/styles/site.css` đi qua bundler lúc build, tức nó nằm trong CODE. Với mô
 * hình "mỗi domain một bản builder, và các bản đó nâng cấp được", mỗi lần nâng
 * cấp là một lần đổi CSS dưới chân release đang chạy. Đây đúng ca đã cắn Plasmic:
 * có người redeploy đúng bản published cũ mà layout vẫn vỡ, vì reset CSS của họ
 * nằm ngoài snapshot. Xem docs/BENCHMARK.md §1.5.
 *
 * ## Vì sao không dùng bundler ở đây
 *
 * Route publish chạy trong Node runtime, không có Turbopack. Và ta CẦN kết quả
 * xác định: cùng input phải ra cùng hash, nếu không thì mỗi lần publish sinh một
 * `StyleBundle` mới và cơ chế dùng chung theo nội dung mất ý nghĩa.
 *
 * ## Vì sao gộp thẳng là ĐỦ — đã đo, không đoán
 *
 * `site.css` chỉ gồm một dòng khai `@layer` và 14 dòng
 * `@import './x.css' layer(base)`. Ta sở hữu cả 14 file: không import từ npm,
 * không nesting sâu.
 *
 * Dự án CÓ `postcss.config.mjs` với Tailwind v4, nên câu hỏi "bundler có biến đổi
 * gì không" là câu hỏi thật. Đo ngày 18/08/2026, so CSS bundler phát cho
 * `(site)/layout` với 14 file nguồn:
 *
 *   - tiền tố vendor: **15 trong nguồn, 15 trong bản build** — không thêm gì
 *   - `@media`: **13 và 13**
 *   - khai báo custom property: **450 và 452** (lệch 2 vì bản build đã minify nên
 *     nhiều khai báo nằm cùng dòng)
 *   - byte: nguồn thô 137 KB, nguồn bỏ comment 56 KB, bản build 58 KB
 *
 * Tức chênh lệch với nguồn là **toàn bộ comment**, không phải biến đổi. Tailwind
 * chỉ chạm vỏ builder qua `@source` trong `builder.css` — file đó KHÔNG nằm trong
 * 14 file này.
 *
 * Nếu về sau `src/styles/` dùng cú pháp cần prefix, phép đo trên sẽ lệch và phải
 * thêm autoprefixer VÀO HÀM NÀY — không phải ở chỗ gọi, vì tính xác định là tính
 * chất của hàm này chứ không phải của người dùng nó.
 *
 * ## Vì sao nhận `readFile` thay vì tự đọc đĩa
 *
 * Test được mà không cần fixture trên đĩa, và không phụ thuộc cwd.
 */

/** Điểm vào, tương đối gốc repo. */
export const STATIC_CSS_ENTRY = 'src/styles/site.css';

/** `@import './base/reset.css' layer(base);` → đường dẫn + tên layer. */
const IMPORT_RE = /@import\s+['"]([^'"]+)['"]\s*layer\(([^)]+)\)\s*;/g;

/**
 * Ghép đường dẫn tương đối của `@import` với thư mục của file đang đọc.
 *
 * Tự viết thay vì `node:path`: hàm này phải cho ra cùng chuỗi trên mọi hệ điều
 * hành, và `path.join` trên Windows trả `\` — đủ để hash khác nhau giữa máy dev
 * và máy build, tức cùng CSS mà ra hai bó.
 */
function resolveFrom(dir: string, rel: string): string {
  const out: string[] = [];
  for (const part of `${dir}/${rel}`.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Bỏ comment CSS.
 *
 * Vì sao đáng làm: `src/styles/` mang docblock tiếng Việt rất dày, và chúng là
 * **60% khối lượng** — đo được 129 KB có comment so với 56 KB không comment. Đó là
 * byte người dùng cuối phải tải mà không nhận được gì. Bundler của Next vẫn lược
 * chúng, nên giữ lại ở đây là để hàm này TỆ HƠN thứ nó thay thế.
 *
 * Vì sao thay thế bằng regex là an toàn ở ĐÂY, dù nói chung là không: điều kiện
 * duy nhất làm nó sai là một `/*` nằm trong chuỗi hoặc `url()`. Ta sở hữu cả 14
 * file và đã kiểm ngày 18/08/2026 — không có, và số `/*` khớp đúng số `*​/` (499).
 * Chốt chặn dưới đây biến giả định đó thành một điều kiện được kiểm mỗi lần chạy
 * thay vì một ghi chú trong tài liệu.
 */
function stripComments(css: string): string {
  const opens = (css.match(/\/\*/g) ?? []).length;
  const closes = (css.match(/\*\//g) ?? []).length;
  if (opens !== closes) {
    // Lệch nghĩa là có `/*` hoặc `*​/` nằm trong chuỗi, và lúc đó phép thay thế
    // dưới đây sẽ ăn mất CSS thật. Ném còn hơn publish một bó đã bị cắt xén: bó
    // hỏng chỉ lộ ra khi có người mở site.
    throw new Error(
      `CSS tĩnh có comment lệch: ${opens} lần mở, ${closes} lần đóng. ` +
        'Nếu một `/*` nằm trong chuỗi hoặc url(), phải bỏ bước lược comment.',
    );
  }
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Một điểm vào: thay mọi `@import … layer()` bằng nội dung file, giữ nguyên phần còn lại. */
function inlineEntry(readFile: (path: string) => string, entryPath: string): string {
  const entry = readFile(entryPath);
  const dir = entryPath.split('/').slice(0, -1).join('/');
  return entry.replace(IMPORT_RE, (_all, rel: string, layer: string) => {
    const body = readFile(resolveFrom(dir, rel));
    return `@layer ${layer.trim()} {\n${body}\n}`;
  });
}

/**
 * `extraEntries`: điểm vào CSS của gói dự án (`projects/<tên>/styles/index.css`), nối SAU
 * `site.css` bằng cùng thuật toán. Không có gói = mảng rỗng = bó y hệt trước (cùng hash).
 *
 * Gói phải tự đặt CSS vào layer (`@import … layer(base)` hoặc `@layer base { … }`): CSS
 * ngoài layer thắng cả `@layer doc` của từng trang và làm đổi giao diện.
 */
export function compileStaticCss(
  readFile: (path: string) => string,
  extraEntries: readonly string[] = [],
): string {
  const inlined = [STATIC_CSS_ENTRY, ...extraEntries].map((e) => inlineEntry(readFile, e)).join('\n');

  // Lược comment SAU khi ghép, không phải trước: `@import` có thể nằm trong một
  // comment, và lược trước sẽ làm nó biến mất trước khi được thay thế — CSS đó âm
  // thầm không bao giờ vào bó.
  return stripComments(inlined).replace(/\n{3,}/g, '\n\n').trimStart();
}

/**
 * sha256 hex — danh tính của một bó LÀ nội dung của nó.
 *
 * Đây là lý do `StyleBundle.hash` là khoá chính: "đã có bó này chưa" trở thành
 * một phép tra khoá chính, không phải một truy vấn tìm trùng.
 */
export function hashCss(css: string): string {
  return createHash('sha256').update(css, 'utf8').digest('hex');
}
