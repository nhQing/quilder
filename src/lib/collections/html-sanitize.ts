/**
 * Làm sạch HTML của thân bài. File THUẦN — không prisma, không React, không I/O.
 *
 * ## Vì sao file này TỒN TẠI, và vì sao nó không được bỏ qua
 *
 * CKEditor trả về một **chuỗi HTML**, không phải cây có kiểu. Render nó lên trang
 * công khai nghĩa là `dangerouslySetInnerHTML`, tức mọi thứ trong chuỗi đó chạy với
 * quyền của domain thật: một `onerror`, một `<script>`, một `href="javascript:"` là
 * stored XSS trên chính site của bạn.
 *
 * Trước 04/09/2026 thân bài là `RichDoc` — một cây có kiểu, render bằng JSX, và React
 * tự escape mọi chuỗi. Không có chỗ nào cần làm sạch vì không có chỗ nào nhận HTML.
 * Đổi sang CKEditor bỏ mất lớp bảo vệ đó, nên nó phải được dựng lại BẰNG TAY, ở đây.
 *
 * ## Làm sạch ở ĐƯỜNG GHI, và lần nữa ở đường đọc
 *
 * Ghi: `entry-data.ts` gọi hàm này trước khi lưu, nên thứ vào database đã sạch.
 * Đọc: renderer gọi lại lần nữa. Không phải vì không tin đường ghi, mà vì database
 * còn nhận ghi từ MCP, từ HTTP API, và từ những hàng đã tồn tại trước khi file này
 * ra đời. Một tầng phòng vệ duy nhất là một tầng chưa từng được kiểm ở production.
 *
 * ## `dropped` không phải để trang trí
 *
 * Hàm trả kèm danh sách thẻ bị gỡ. Một bài mất nửa nội dung mà không ai biết là kết
 * cục tệ nhất của việc làm sạch — ô soạn hiện danh sách này để người viết thấy ngay
 * cái gì vừa không được nhận, thay vì phát hiện lúc bài đã lên site.
 */

import sanitizeHtml from 'sanitize-html';

/**
 * Thẻ được nhận. Danh sách TRẮNG, không phải danh sách đen.
 *
 * Danh sách đen luôn thiếu: mỗi thẻ HTML mới, mỗi thuộc tính `on*` mới là một lỗ
 * mà không ai nhớ thêm vào. Danh sách trắng thì thiếu theo chiều an toàn — mất một
 * thẻ hợp lệ, không mở một đường chạy code.
 */
const TAGS = [
  // Chữ
  'p', 'br', 'span', 'strong', 'em', 'u', 's', 'mark', 'sub', 'sup', 'code', 'a',
  /*
   * `h1` ĐƯỢC nhận, và đó là lựa chọn có ý thức của người dùng, không phải sơ suất.
   *
   * Trang chi tiết đã render `h1` là tiêu đề bài, nên một `h1` thứ hai trong thân
   * bài là lỗi SEO và a11y KHÔNG có triệu chứng nhìn thấy được. Ô soạn cảnh báo khi
   * gặp; nó không chặn.
   */
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Danh sách, trích dẫn, gạch ngang
  'ul', 'ol', 'li', 'blockquote', 'hr',
  /*
   * `div` được nhận, và nó KHÔNG phải một lỗ.
   *
   * CKEditor gói mỗi khối nhúng thành `<figure class="media"><div data-oembed-url="…">`
   * rồi mới tới `<iframe>`. Gỡ `div` thì `<iframe>` bên trong vẫn ở lại (`div` không
   * nằm trong `nonTextTags`), nhưng lần MỞ LẠI bài trong ô soạn, CKEditor không còn
   * nhận ra đó là một khối nhúng — nó thành một `iframe` trần chỉ sửa được ở chế độ
   * HTML. Nội dung không mất; cái mất là khả năng sửa nó bằng chuột.
   *
   * `div` không mang đường chạy code nào: mọi `on*` bị lọc ở `allowedAttributes`,
   * `style` bị lọc ở `allowedStyles`, và `class` bị lọc ở `transformTags`.
   */
  'div',
  // Bảng. CKEditor bọc bảng trong `<figure class="table">`.
  'figure', 'figcaption', 'table', 'caption', 'colgroup', 'col',
  'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  // Ảnh và nhúng
  'img', 'iframe',
] as const;

/**
 * `style` inline được nhận, nhưng CHỈ những thuộc tính này và CHỈ những giá trị này.
 *
 * `sanitize-html` khớp giá trị bằng regex và bỏ khai báo nào không khớp. Đây là chỗ
 * chặn `style="background: url(javascript:…)"` và `expression()` — hai đường cũ nhưng
 * vẫn sống trong các trình duyệt cũ mà khách của bạn có thể đang dùng.
 *
 * Màu chấp nhận hex và `rgb()/rgba()`, KHÔNG chấp nhận tên màu CSS: `red` hợp lệ về
 * cú pháp nhưng nó không thuộc bảng token nào, và mục đích của phép giới hạn này là
 * giữ màu trong thân bài gần với design system.
 */
const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\(\s*[\d.\s,%/]+\)$/i;
const LENGTH = /^\d+(?:\.\d+)?(?:px|em|rem|%|ch)$/;

const STYLES: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': {
    color: [COLOR],
    'background-color': [COLOR],
    'text-align': [/^(?:left|right|center|justify)$/],
    // Bảng: người soạn kéo cột. Chỉ bề rộng, không cho `position` hay `transform`.
    width: [LENGTH],
    height: [LENGTH],
    'border-color': [COLOR],
    'border-style': [/^(?:none|solid|dashed|dotted|double)$/],
    'border-width': [LENGTH],
    'vertical-align': [/^(?:top|middle|bottom)$/],
  },
};

const ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'srcset', 'sizes', 'loading', 'decoding'],
  iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'title', 'loading'],
  td: ['colspan', 'rowspan', 'style'],
  th: ['colspan', 'rowspan', 'scope', 'style'],
  col: ['span', 'style'],
  // `class` cho các thẻ CKEditor tự sinh (`figure.table`, `figure.media`). Giá trị
  // được lọc riêng ở `transformTags` — một `class` tự do là đường tác động vào CSS
  // của site từ trong thân bài.
  figure: ['class', 'style'],
  table: ['class', 'style'],
  /*
   * `data-oembed-url` là thứ DUY NHẤT cho CKEditor biết một `div` là khối nhúng.
   *
   * Không lọc giá trị của nó, có chủ đích: nó không đi vào `src`, không đi vào `href`,
   * và trên trang công khai không dòng JS nào đọc nó — khối nhúng render bằng chính
   * `<iframe>` bên trong, đã qua `allowedIframeHostnames`. Nó chỉ có nghĩa với ô soạn.
   */
  div: ['class', 'data-oembed-url', 'style'],
  // `class` của `mark` mang MÀU bút dạ (`marker-yellow`…). Gỡ nó thì chữ vẫn được
  // đánh dấu nhưng mất màu — một cách im lặng làm bài khác đi so với lúc soạn.
  mark: ['class'],
  '*': ['style'],
};

/**
 * `class` được phép. Ngoài tập này thì gỡ khỏi thuộc tính.
 *
 * Danh sách trắng vì `class` là một đường tác động vào CSS của SITE từ trong thân
 * bài: một `class="fixed inset-0 z-50"` (Tailwind của chính site) là một lớp phủ kín
 * màn hình, đặt được bởi bất cứ ai sửa được một bài viết. Không có script nào chạy,
 * nhưng trang thì không dùng được nữa.
 *
 * Mọi tên ở đây là tên do CKEditor tự sinh — không có tên nào do tác giả gõ.
 */
const CLASSES = new Set([
  // Khối do CKEditor bọc
  'table', 'media', 'image', 'image-inline',
  // Kiểu và cỡ ảnh
  'image-style-block-align-left', 'image-style-block-align-right',
  'image-style-align-center', 'image-style-side', 'image_resized',
  // Bảng đã kéo cột
  'ck-table-resized',
  // Bút dạ của `Highlight` — bốn màu nền, hai màu bút.
  'marker-yellow', 'marker-green', 'marker-pink', 'marker-blue',
  'pen-red', 'pen-green',
]);

/**
 * Thẻ được nhận, dạng tra cứu. Xuất ra để ô soạn CẢNH BÁO TRƯỚC khi lưu.
 *
 * Ô soạn chạy ở client và không biết danh sách host của `<iframe>` (nó nằm trong
 * database), nên nó không gọi được `sanitizeArticleHtml` để biết trước cái gì sẽ mất.
 * Nhưng "thẻ này không bao giờ được nhận" thì KHÔNG phụ thuộc host — nên đó là phần
 * cảnh báo được, và `unsupportedTags` là phần đó.
 */
export const ALLOWED_TAGS: ReadonlySet<string> = new Set<string>(TAGS);

/**
 * Thẻ trong một chuỗi HTML mà danh sách trắng KHÔNG nhận, mỗi tên một lần, đã sắp.
 *
 * Regex, không parser: đây là một cảnh báo cho người đang gõ, không phải một phép
 * bảo vệ. Sai sót của nó là một cảnh báo thiếu hoặc thừa, không phải một thẻ lọt.
 * Xem ghi chú ở `tagNames`.
 */
export function unsupportedTags(html: string): string[] {
  const out = new Set<string>();
  for (const t of tagNames(html)) if (!ALLOWED_TAGS.has(t)) out.add(t);
  return [...out].sort();
}

export interface SanitizeResult {
  html: string;
  /** Tên thẻ đã bị gỡ, mỗi tên một lần, đã sắp. Rỗng nghĩa là không mất gì. */
  dropped: string[];
}

export interface SanitizeOptions {
  /**
   * Host được phép cho `<iframe src>`, ví dụ `['www.youtube.com']`.
   *
   * Tham số chứ không đọc database ở đây: file này THUẦN để test được mà không dựng
   * gì, và danh sách thật nằm ở bảng `EmbedOrigin` (`render/embed-origins.ts`, đã
   * dùng cho CSP của khối `CustomCode`). Chỗ gọi truyền vào.
   *
   * Bỏ trống = KHÔNG nhận iframe nào. Mặc định đóng, không mặc định mở.
   */
  iframeHosts?: readonly string[];
}

export function sanitizeArticleHtml(input: string, opts: SanitizeOptions = {}): SanitizeResult {
  const dropped = new Set<string>();
  const hosts = opts.iframeHosts ?? [];

  const html = sanitizeHtml(input, {
    allowedTags: [...TAGS],
    allowedAttributes: ATTRS,
    allowedStyles: STYLES,
    /*
     * Không có `javascript`, `data`, `vbscript`.
     *
     * `data:` bị loại kể cả cho `img`: một `data:image/svg+xml` là một tài liệu SVG
     * đầy đủ, và SVG chạy được script. Ảnh trong bài đi qua kho asset, nơi `sniff()`
     * đọc kiểu thật từ byte đầu file.
     */
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'srcset'],
    // Bỏ trống thì thư viện chặn MỌI iframe — xem docblock của `iframeHosts`.
    allowedIframeHostnames: [...hosts],
    allowIframeRelativeUrls: false,
    // Nội dung của thẻ bị gỡ thì GIỮ (chữ trong một `<div>` lạ không nên mất theo
    // cái div), trừ những thẻ mà nội dung chính là code.
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'option'],
    transformTags: {
      a: (tagName, attribs) => {
        const out: Record<string, string> = { ...attribs };
        // `target="_blank"` không kèm `rel` là lỗ reverse tabnabbing: tab mới giữ
        // `window.opener` và ghi được `location` của tab gốc.
        if (out['target'] === '_blank') out['rel'] = 'noopener noreferrer';
        else delete out['target'];
        return { tagName, attribs: out };
      },
      figure: (tagName, attribs) => keepKnownClass(tagName, attribs),
      table: (tagName, attribs) => keepKnownClass(tagName, attribs),
      div: (tagName, attribs) => keepKnownClass(tagName, attribs),
      mark: (tagName, attribs) => keepKnownClass(tagName, attribs),
    },
    /*
     * Gỡ HẲN thẻ khi đường dẫn của nó vừa bị lọc mất — đừng để lại vỏ rỗng.
     *
     * `allowedIframeHostnames` và `allowedSchemes` chỉ gỡ THUỘC TÍNH `src`, thẻ thì
     * ở lại. Đo trên `sanitize-html` 2.17.7: một `<iframe src="https://evil/x">` ra
     * `<iframe></iframe>` — vô hại nhưng là một khung trắng giữa bài, và một
     * `<img>` mất `src` là biểu tượng ảnh-lỗi của trình duyệt. Cả hai đều tệ hơn
     * việc không có gì.
     *
     * `<a>` thì NGƯỢC LẠI, cố ý: gỡ `href` nhưng giữ thẻ và chữ bên trong. Câu văn
     * của tác giả không được biến mất chỉ vì cái link họ dán không hợp lệ.
     */
    exclusiveFilter: (frame) =>
      (frame.tag === 'iframe' || frame.tag === 'img') && !frame.attribs['src'],
  });

  /*
   * Đếm thẻ bị gỡ bằng cách so tập thẻ TRƯỚC và SAU.
   *
   * `sanitize-html` không có callback "vừa gỡ thẻ X", nên đây là cách duy nhất biết
   * cái gì đã mất. Regex chỉ dùng để LIỆT KÊ tên thẻ cho người đọc — nó không tham
   * gia vào việc làm sạch, nên nó không phải là chỗ chịu lực bảo mật.
   */
  const before = tagNames(input);
  const after = tagNames(html);
  for (const t of before) if (!after.has(t)) dropped.add(t);

  return { html, dropped: [...dropped].sort() };
}

function keepKnownClass(tagName: string, attribs: Record<string, string>) {
  const out: Record<string, string> = { ...attribs };
  const kept = (out['class'] ?? '')
    .split(/\s+/)
    .filter((c) => CLASSES.has(c))
    .join(' ');
  if (kept) out['class'] = kept;
  else delete out['class'];
  return { tagName, attribs: out };
}

/** Tên thẻ xuất hiện trong một chuỗi HTML. Chỉ để báo cáo — xem ghi chú trên. */
function tagNames(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/<\s*([a-z][a-z0-9]*)\b/gi)) out.add(m[1]!.toLowerCase());
  return out;
}

/* ── Đọc chữ ra khỏi HTML ─────────────────────────────────────────────── */

/**
 * Chữ thuần của một chuỗi HTML. Dùng để ĐẾM và để BÁO, không để render.
 *
 * ## Vì sao regex ở đây là đủ, trong khi ở phép làm sạch thì không
 *
 * Làm sạch phải đúng với cách TRÌNH DUYỆT đọc chuỗi — mọi chỗ mà một parser thật
 * và một regex đọc khác nhau là một lỗ. Hàm này thì ngược: nó chỉ cần một con số
 * xấp xỉ cho trần `maxChars` và một câu trả lời có/không cho "bài này rỗng chưa".
 * Sai vài ký tự không mở đường nào; nó chỉ làm trần rộng hoặc chặt hơn một chút.
 *
 * Quan trọng: hàm này KHÔNG bao giờ được dùng để sinh HTML. Kết quả của nó là chữ
 * thuần, và chỗ nào đưa nó ra trang thì phải escape như mọi chuỗi người dùng khác.
 */
export function htmlPlainText(html: string): string {
  return html
    // Nội dung của `script`/`style` là code, không phải chữ — bỏ cả ruột.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Thẻ khối thành khoảng trắng để hai đoạn liền nhau không dính chữ vào nhau.
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bài RỖNG. Một ô soạn vừa mở nhưng chưa gõ gì phải đếm là rỗng, không phải "đã điền".
 *
 * CKEditor trả `''` cho tài liệu trống, nhưng chỉ khi thật sự trống: một lần bấm
 * Enter rồi xoá để lại `<p>&nbsp;</p>`, và một cú dán rồi Ctrl+Z có thể để lại
 * `<p><br></p>`. Cả hai đều "có nội dung" theo phép đo độ dài chuỗi, nên
 * `required` và `localeCoverage` sẽ nói dối — bản dịch tiếng Anh của một bài hiện
 * 100% đã dịch trong khi không có chữ nào.
 *
 * Ảnh và nhúng thì KHÔNG rỗng dù không có chữ nào: một bài chỉ có một biểu đồ là
 * một bài hợp lệ.
 */
export function isBlankHtml(html: string): boolean {
  if (/<(?:img|iframe|hr|table)\b/i.test(html)) return false;
  return htmlPlainText(html) === '';
}
