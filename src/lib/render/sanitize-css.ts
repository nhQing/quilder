/**
 * Sanitize customCss.
 *
 * ## Vì sao sanitize lúc RENDER chứ không lúc lưu
 *
 * Nguyên tắc này viết cho CustomCode trong plan, và nó áp cho cả đây: siết luật
 * về sau vẫn bảo vệ được nội dung ĐÃ NẰM SẴN trong database. Sanitize lúc lưu
 * thì mọi thứ lọt qua trước ngày siết luật sẽ ở lại mãi mãi.
 *
 * ## Nó chặn cái gì, và vì sao
 *
 * Panel CSS là chỗ người dùng gõ CSS tự do vào một trang publish thẳng ra site
 * của công ty tài chính, và AI cũng ghi được vào đó (mức "Vừa"). Trước file này,
 * lớp chặn duy nhất là "không cho ký tự `<`" — đủ để ngăn thoát khỏi thẻ
 * `<style>`, không đủ cho bất cứ thứ gì khác.
 *
 *  - **Scope selector** về `[data-n="<id>"]`. Không có bước này thì gõ `body {}`
 *    trong panel của một node là sửa toàn site — và người gõ sẽ không hiểu vì sao.
 *  - **`position: fixed` → `absolute`.** fixed thoát khỏi mọi container và phủ
 *    lên cả trang, kể cả vùng nội dung tuân thủ pháp lý bị khoá.
 *  - **Bỏ `@import`.** Nó tải CSS từ domain ngoài vào trang production.
 *  - **Bỏ `url()` trỏ tới `javascript:`/`vbscript:`.** Cửa hậu chạy script cổ điển.
 *  - **Bỏ `expression()` và `behavior`.** Cùng lý do, cho IE cũ.
 *  - **Bỏ `<`.** Thoát khỏi thẻ `<style>`.
 *  - **Bỏ `!important`.** Không phải bảo mật — nó phá cả hệ thống lớp CSS, và
 *    người dùng sẽ dùng nó thay vì sửa đúng chỗ.
 *
 * ## Vì sao dùng postcss-safe-parser
 *
 * Người ta gõ CSS dở dang suốt (thiếu `}`, thiếu `;`). Parser thường sẽ ném lỗi
 * và cả trang trắng. Safe parser vá lỗi cú pháp rồi trả về cây dùng được — nên
 * CSS hỏng chỉ làm mất phần hỏng, không hạ cả trang.
 */

import postcss, { type ChildNode, type Root } from 'postcss';
import safeParser from 'postcss-safe-parser';

export interface SanitizeResult {
  css: string;
  /** Những gì đã bị đổi hoặc gỡ. Hiện lên cho người dùng thấy. */
  warnings: string[];
}

/** At-rule được giữ. Mọi thứ khác bị gỡ cùng nội dung bên trong. */
const ALLOWED_AT_RULES = new Set(['media', 'supports', 'container', 'layer']);

const BAD_URL_RE = /url\(\s*['"]?\s*(javascript|vbscript|data:text\/html)/i;
const EXPRESSION_RE = /expression\s*\(/i;

/** Property không bao giờ được phép, kể cả từ người. */
const BANNED_PROPS = new Set(['behavior', '-moz-binding']);

function scopeSelector(selector: string, scope: string): string {
  return selector
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return '';

      // `&` là chính node đó — cú pháp quen thuộc và là cách duy nhất viết được
      // `&:hover` mà không phải lặp lại selector.
      if (trimmed.includes('&')) return trimmed.replace(/&/g, scope);

      // Selector bắt đầu bằng tổ hợp (`> .x`, `+ p`) là nói về con/anh em.
      if (/^[>+~]/.test(trimmed)) return `${scope} ${trimmed}`;

      // Pseudo gắn thẳng vào chính node: `:hover` → `[data-n="x"]:hover`.
      if (trimmed.startsWith(':')) return `${scope}${trimmed}`;

      // Còn lại là hậu duệ.
      return `${scope} ${trimmed}`;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Gom khai báo "trần" (không có selector bao ngoài) vào một rule của chính node.
 *
 * Đây là cách dùng THƯỜNG GẶP NHẤT — người ta gõ thẳng `opacity: .8;`. Và nó
 * xảy ra ở cả hai chỗ: mức gốc, và bên trong `@media`. Bản đầu chỉ xử lý mức
 * gốc, nên `@media (…) { opacity: .5 }` cho ra `@media (…) { opacity: .5 }` —
 * CSS không hợp lệ, không báo lỗi, chỉ đơn giản là không có tác dụng. Test bắt
 * được, chứ nhìn code thì không thấy.
 */
function wrapBareDecls(container: Root | ChildNode): void {
  if (!('nodes' in container) || !container.nodes) return;

  const bare = container.nodes.filter((n) => n.type === 'decl');
  if (!bare.length) return;

  const rule = postcss.rule({ selector: '&' });
  for (const decl of bare) {
    decl.remove();
    rule.append(decl);
  }
  container.prepend(rule);
}

function walk(container: Root | ChildNode, scope: string, warnings: string[], depth = 0): void {
  if (!('nodes' in container) || !container.nodes) return;

  // Duyệt ngược để remove() không làm lệch chỉ số.
  for (let i = container.nodes.length - 1; i >= 0; i--) {
    const node = container.nodes[i]!;

    if (node.type === 'atrule') {
      const name = node.name.toLowerCase();
      if (!ALLOWED_AT_RULES.has(name)) {
        warnings.push(`Đã gỡ @${name} — không cho phép trong CSS tuỳ chỉnh.`);
        node.remove();
        continue;
      }
      if (depth > 3) {
        warnings.push('Đã gỡ at-rule lồng quá sâu.');
        node.remove();
        continue;
      }
      // Khai báo trần bên trong @media cũng phải được bọc, y như ở mức gốc.
      wrapBareDecls(node);
      walk(node, scope, warnings, depth + 1);
      // At-rule rỗng sau khi dọn thì không cần giữ.
      if (!node.nodes?.length) node.remove();
      continue;
    }

    if (node.type === 'rule') {
      node.selector = scopeSelector(node.selector, scope);
      if (!node.selector) {
        node.remove();
        continue;
      }
      walk(node, scope, warnings, depth + 1);
      if (!node.nodes?.length) node.remove();
      continue;
    }

    if (node.type === 'decl') {
      const prop = node.prop.toLowerCase();
      const value = node.value;

      if (BANNED_PROPS.has(prop)) {
        warnings.push(`Đã gỡ "${node.prop}".`);
        node.remove();
        continue;
      }
      if (BAD_URL_RE.test(value) || EXPRESSION_RE.test(value)) {
        warnings.push(`Đã gỡ "${node.prop}" — giá trị chứa mã thực thi được.`);
        node.remove();
        continue;
      }
      if (prop === 'position' && value.trim().toLowerCase() === 'fixed') {
        node.value = 'absolute';
        warnings.push('position: fixed đã đổi thành absolute — fixed phủ lên cả trang.');
        continue;
      }
      if (node.important) {
        node.important = false;
        warnings.push(`Đã bỏ !important ở "${node.prop}".`);
      }
      continue;
    }

    // Còn lại chỉ có thể là `comment` — ba nhánh trên đã phủ hết union. Comment
    // được giữ: nó không mang được gì nguy hiểm sau khi '<' đã bị gỡ, và người
    // dùng ghi chú trong CSS của mình là chuyện bình thường.
  }
}

/**
 * Selector mà customCss của một node TRÊN TRANG được scope về.
 *
 * Hàm chứ không phải template rải rác: bốn chỗ từng tự ghép chuỗi này, và ngày
 * scope của một loại node khác đi thì bốn chỗ đó phải cùng đổi.
 */
export function nodeScope(nodeId: string): string {
  return `[data-n="${nodeId}"]`;
}

/**
 * Scope cho một node nằm TRONG cây component.
 *
 * `data-cn` chứ không `data-n`, và có `[data-c]` bao ngoài: một trang mang mười
 * instance của cùng component thì `data-n` phải là duy nhất, nên node component
 * phát `data-cn` và rule scope theo component để mười instance dùng chung một
 * khối. Xem `selIn` trong `render/css.ts` và `InstanceChild` trong `NodeRenderer`.
 */
export function componentNodeScope(componentId: string, localId: string): string {
  return `[data-c="${componentId}"] [data-cn="${localId}"]`;
}

/**
 * Scope cho customCss của node TRONG component: MỘT compound, không phải hai.
 *
 * customCss thay `&` bằng scope. Với `componentNodeScope` (hai compound nối bằng dấu
 * cách) một selector có ngữ cảnh tổ tiên — `[data-collapsed="true"] &`, rất thường gặp
 * khi style con theo trạng thái effect ghi trên header — thành
 * `[data-collapsed] [data-c=…] [data-cn=…]`, tức đòi wrapper của component nằm BÊN
 * TRONG header: không bao giờ khớp (clone trang chủ 13/10/2026, header thu gọn đứng im).
 *
 * `[data-cn=…]:is([data-c=…] *)` là một compound mang cùng nghĩa ở MỌI vị trí trong
 * selector, và cùng độ ưu tiên (0,2,0) với dạng hai compound.
 */
export function componentCustomScope(componentId: string, localId: string): string {
  return `[data-cn="${localId}"]:is([data-c="${componentId}"] *)`;
}

/**
 * @param css   CSS thô do người hoặc AI viết.
 * @param nodeId Node mà CSS này thuộc về.
 * @param scope Selector scope, khi nó KHÔNG suy được từ `nodeId`.
 *
 * Tham số thứ ba tồn tại vì node trong cây component scope theo
 * `[data-c] [data-cn]`, không theo `[data-n]`. Trước 07/09/2026 hàm này tự ghép
 * scope từ `nodeId` và không có đường nào truyền cái khác, nên `compileDoc` không
 * thể phát customCss cho node component — nó chỉ đơn giản bỏ qua chúng, và chuỗi
 * CSS nằm đúng trong database mà xuất hiện 0 lần trong HTML.
 */
export function sanitizeCustomCss(
  css: string,
  nodeId: string,
  scopeOverride?: string,
): SanitizeResult {
  const warnings: string[] = [];

  if (!css.trim()) return { css: '', warnings };

  // Bỏ '<' TRƯỚC khi parse: output cuối đi vào một thẻ <style>, nên bất kỳ '<'
  // nào cũng là đường thoát ra khỏi thẻ và biến CSS thành HTML injection. Làm ở
  // đây chứ không tin vào việc parser sẽ nuốt nó.
  let input = css;
  if (input.includes('<')) {
    input = input.replace(/</g, '');
    warnings.push("Đã gỡ ký tự '<' — nó thoát được ra khỏi thẻ <style>.");
  }

  const scope = scopeOverride ?? nodeScope(nodeId);

  let root: Root;
  try {
    // `.root` khai kiểu `Root | Document`; ta không dùng plugin nào sinh
    // Document, nên ép về Root là đúng với thực tế chạy.
    root = postcss().process(input, { parser: safeParser, from: undefined }).root as Root;
  } catch {
    // Safe parser gần như không bao giờ ném, nhưng nếu có thì bỏ toàn bộ khối
    // này còn hơn để một trang production hỏng.
    return { css: '', warnings: [...warnings, 'CSS không phân tích được — đã bỏ qua.'] };
  }

  wrapBareDecls(root);
  walk(root, scope, warnings, 0);

  // `cleanRaws()` TRƯỚC khi in ra, và đây là bước chịu lực chứ không phải làm đẹp.
  //
  // postcss giữ nguyên khoảng trắng và phần thừa của input trong `raws`, kể cả
  // đoạn rác mà safe-parser không phân tích nổi — và `toString()` in lại chúng
  // NGUYÊN VĂN, đi vòng qua toàn bộ phép dọn ở trên. Với input
  // `opacity: .5 }</style><script>…`, phần đuôi còn sót lại chứa một dấu `}` thừa;
  // dấu đó đóng sớm khối `@layer doc-custom {` bao ngoài, và CSS của những node
  // sau đó rơi ra ngoài layer. Một node gõ sai làm hỏng node khác.
  //
  // Phụ: output thành chuẩn hoá, nên cùng input luôn ra cùng bytes và hash CSS
  // ổn định.
  root.cleanRaws();

  const output = root.toString().trim();

  // Chốt cuối: số ngoặc phải cân. Nếu không, thà bỏ cả khối còn hơn phát ra thứ
  // phá vỡ cấu trúc của stylesheet.
  const open = (output.match(/\{/g) ?? []).length;
  const close = (output.match(/\}/g) ?? []).length;
  if (open !== close) {
    return {
      css: '',
      warnings: [...new Set([...warnings, 'CSS không cân ngoặc — đã bỏ toàn bộ khối.'])],
    };
  }

  return { css: output, warnings: [...new Set(warnings)] };
}

/* ── Đọc xem customCss khai property nào ──────────────────────────────── */

export interface DeclaredProperty {
  /** Tên property, đã thường hoá. */
  prop: string;
  /**
   * Áp vô điều kiện lên chính node — tức là nó ĐANG đè giá trị của inspector
   * ngay lúc này. Rule trong `@media` hay có pseudo (`&:hover`) thì không: chúng
   * chỉ đè trong một số hoàn cảnh, và cảnh báo cho chúng sẽ thành tiếng ồn.
   */
  always: boolean;
  /** Selector sau khi scope, để hiện trong tooltip. */
  selector: string;
}

/**
 * Những property mà customCss của một node đang khai.
 *
 * Dùng để cảnh báo trong inspector: kéo một ô số mà trang không nhúc nhích vì
 * customCss đang đè là lỗi khó chịu nhất của cả panel — không có thông báo nào,
 * và chỗ gây ra nằm cách đó vài trăm pixel.
 *
 * Chạy đúng đường ống của `sanitizeCustomCss` để thấy CSS sau khi scope, nên
 * kết quả khớp với thứ thật sự được phát ra chứ không phải thứ người dùng gõ.
 */
export function declaredProperties(
  css: string,
  nodeId: string,
  scopeOverride?: string,
): DeclaredProperty[] {
  if (!css.trim()) return [];

  // Cùng scope mà `sanitizeCustomCss` dùng, nếu không `always` sẽ luôn false cho
  // node component: nó so `selector === scope`, và scope sai thì không khớp gì.
  const scope = scopeOverride ?? nodeScope(nodeId);
  const { css: safe } = sanitizeCustomCss(css, nodeId, scopeOverride);
  if (!safe) return [];

  let root: Root;
  try {
    root = postcss().process(safe, { parser: safeParser, from: undefined }).root as Root;
  } catch {
    return [];
  }

  const out: DeclaredProperty[] = [];

  root.walkDecls((decl) => {
    const rule = decl.parent;
    if (!rule || rule.type !== 'rule') return;

    // Trong at-rule (@media/@supports/@container) thì có điều kiện.
    const inAtRule = rule.parent?.type === 'atrule';
    // Selector đúng bằng chính node, không pseudo, không hậu duệ.
    const selector = (rule as { selector: string }).selector;
    const exact = selector
      .split(',')
      .some((part) => part.trim() === scope);

    out.push({
      prop: decl.prop.toLowerCase(),
      always: exact && !inAtRule,
      selector: selector.trim(),
    });
  });

  return out;
}
