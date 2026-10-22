/**
 * Dựng tài liệu HTML cho `CustomCode` chạy trong iframe.
 *
 * Hàm thuần, không chạm DB, không chạm React — vì đây là **mặt bảo mật** của cả
 * tính năng và nó phải test được từng luật một.
 *
 * ## Ba tầng, và vì sao cần cả ba
 *
 * 1. **`sandbox="allow-scripts"` KHÔNG kèm `allow-same-origin`** (đặt ở component,
 *    không ở đây). Hai cờ đó đi cùng nhau thì iframe **tự gỡ được sandbox của
 *    chính nó** — nó truy cập được `parent` và mọi thứ sandbox định chặn. Thiếu
 *    `allow-same-origin` nghĩa là iframe có origin mờ: không cookie, không
 *    localStorage của site, không đọc được DOM cha.
 * 2. **CSP trong tài liệu.** Sandbox chặn iframe chạm TRANG; CSP chặn nó gọi ra
 *    NGOÀI. Không có CSP thì một đoạn JS dán vào vẫn tải được script từ domain
 *    bất kỳ và gửi dữ liệu đi đâu nó muốn.
 * 3. **Bịt `</script>` và `</style>`.** Đây là tầng dễ quên nhất và là tầng duy
 *    nhất nằm ở đây. JS của người dùng đi vào giữa hai thẻ `<script>`; một chuỗi
 *    `</script>` trong đó — kể cả nằm trong một string literal — **đóng thẻ sớm**
 *    và phần còn lại trở thành HTML. Đó là escape thật, không phải giả thuyết.
 *
 * ## Vì sao KHÔNG tự escape thuộc tính
 *
 * Chuỗi này được truyền cho React qua `srcDoc={...}`, và React escape giá trị
 * thuộc tính. Escape thêm ở đây là escape hai lần — người dùng sẽ thấy `&amp;lt;`
 * trong trang của họ.
 */

export interface CustomCodeDoc {
  html?: string;
  css?: string;
  js?: string;
}

/**
 * Origin được phép tải script / kết nối tới.
 *
 * Không có mặc định `*`: một allowlist rỗng nghĩa là JS chỉ chạy được với thứ nó
 * tự viết, và đó là mặc định đúng. Nới ra là một quyết định có người bấm.
 */
export interface SrcdocOptions {
  origins: readonly string[];
  /** Nền trong suốt để khối hoà vào trang. Đặt `false` khi cần nền riêng. */
  transparent?: boolean;
}

/**
 * Chặn chuỗi đóng thẻ.
 *
 * Case-insensitive và cho phép khoảng trắng (`</ SCRIPT >` vẫn đóng thẻ trong
 * HTML), vì parser của trình duyệt dễ tính hơn regex ngây thơ.
 */
function neutralize(code: string, tag: 'script' | 'style'): string {
  return code.replace(new RegExp(`</\\s*${tag}`, 'gi'), `<\\/${tag}`);
}

/** CSP cho tài liệu con. `default-src 'none'` rồi mở từng thứ một. */
function csp(origins: readonly string[]): string {
  const list = origins.length ? ' ' + origins.join(' ') : '';
  return [
    "default-src 'none'",
    // 'unsafe-inline' là bắt buộc: JS của người dùng nằm inline. Đó chính là lý do
    // sandbox tồn tại — CSP ở đây giới hạn nó GỌI RA ĐÂU, không giới hạn nó chạy.
    `script-src 'unsafe-inline'${list}`,
    "style-src 'unsafe-inline'",
    `img-src data: blob:${list}`,
    `font-src data:${list}`,
    `connect-src${list}`,
    // Không cho khối tự mở iframe con: một tầng nữa là một tầng không ai soát.
    "frame-src 'none'",
    "object-src 'none'",
    // Chặn form gửi đi đâu đó — khối này không phải chỗ thu dữ liệu người dùng.
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * Script gắn sẵn: báo chiều cao lên cha.
 *
 * `ResizeObserver` chứ không phải đo một lần: nội dung động (ảnh về muộn, canvas
 * đổi cỡ, chữ wrap lại) đổi chiều cao SAU khi load, và đo một lần cho ra một
 * khối bị cắt mà không ai hiểu vì sao.
 *
 * Gửi `'*'` làm targetOrigin vì iframe có origin mờ — nó không biết origin cha là
 * gì. An toàn vì thông điệp chỉ chứa một con số, và phía cha kiểm `event.source`.
 */
const RESIZE_BOOTSTRAP = `
(function () {
  var last = 0;
  function post() {
    var h = Math.ceil(document.documentElement.scrollHeight);
    if (h === last) return;
    last = h;
    parent.postMessage({ __mm: 'resize', height: h }, '*');
  }
  new ResizeObserver(post).observe(document.documentElement);
  addEventListener('load', post);
  post();
})();
`.trim();

export function buildSrcdoc(code: CustomCodeDoc, opts: SrcdocOptions): string {
  const css = neutralize(code.css ?? '', 'style');
  const js = neutralize(code.js ?? '', 'script');
  const html = code.html ?? '';

  return [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${csp(opts.origins)}">`,
    '<style>',
    // `margin:0` vì khối phải khít với hộp của nó; nền trong suốt để nó hoà vào
    // trang cha thay vì thành một ô trắng trên nền tối.
    `html,body{margin:0;padding:0;${opts.transparent === false ? '' : 'background:transparent;'}}`,
    css,
    '</style>',
    '</head><body>',
    html,
    `<script>${RESIZE_BOOTSTRAP}</script>`,
    // `type="module"` cho JS người dùng: nó cho `import` từ CDN hoạt động, và
    // module tự có scope riêng nên hai khối trên cùng một trang không đụng nhau.
    js ? `<script type="module">${js}</script>` : '',
    '</body></html>',
  ].join('');
}
