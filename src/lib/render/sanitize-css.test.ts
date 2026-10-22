import { describe, expect, it } from 'vitest';

/**
 * Sanitize customCss.
 *
 * Panel CSS là chỗ người dùng gõ CSS tự do vào một trang publish thẳng ra site
 * của công ty tài chính, và AI cũng ghi được vào đó. Mỗi test dưới đây là một
 * thứ đã lọt qua được lớp chặn cũ (vốn chỉ cấm ký tự '<').
 */

import { declaredProperties, sanitizeCustomCss } from './sanitize-css';

const N = '[data-n="abc"]';
const run = (css: string) => sanitizeCustomCss(css, 'abc');

describe('scope selector', () => {
  it('khai báo trần được bọc vào chính node', () => {
    const { css } = run('opacity: .8; border-radius: 12px;');
    expect(css).toContain(N);
    expect(css).toContain('opacity: .8');
  });

  it('selector trần trở thành hậu duệ, không chạm node khác', () => {
    // Không có bước này, gõ `body {}` trong panel của một node là sửa toàn site.
    const { css } = run('body { background: red }');
    expect(css).toContain(`${N} body`);
    expect(css).not.toMatch(/^\s*body\s*\{/m);
  });

  it('& trỏ về chính node', () => {
    const { css } = run('&:hover { opacity: 1 }');
    expect(css).toContain(`${N}:hover`);
  });

  it('pseudo trần gắn thẳng vào node', () => {
    const { css } = run(':hover { opacity: 1 }');
    expect(css).toContain(`${N}:hover`);
    expect(css).not.toContain(`${N} :hover`);
  });

  it('tổ hợp con và anh em giữ đúng nghĩa', () => {
    expect(run('> p { margin: 0 }').css).toContain(`${N} > p`);
    expect(run('+ div { margin: 0 }').css).toContain(`${N} + div`);
  });

  it('mỗi selector trong danh sách đều được scope', () => {
    // Chỉ scope cái đầu là để lọt cái thứ hai ra toàn cục — lỗi kinh điển.
    const { css } = run('h1, h2 { color: red }');
    expect(css).toContain(`${N} h1`);
    expect(css).toContain(`${N} h2`);
  });

  it('selector toàn cục nguy hiểm cũng bị giam', () => {
    for (const sel of ['*', 'html', ':root', '[data-n]']) {
      const { css } = run(`${sel} { display: none }`);
      expect(css.startsWith(N), `${sel} thoát ra ngoài scope`).toBe(true);
    }
  });
});

describe('chặn mã thực thi', () => {
  it('gỡ url(javascript:)', () => {
    const { css, warnings } = run('background: url(javascript:alert(1))');
    expect(css).not.toContain('javascript');
    expect(warnings.join()).toMatch(/thực thi/);
  });

  it('gỡ url("vbscript:") và data:text/html', () => {
    expect(run('background: url("vbscript:msgbox")').css).not.toContain('vbscript');
    expect(run('background: url(data:text/html,<script>)').css).not.toContain('data:text/html');
  });

  it('gỡ expression()', () => {
    expect(run('width: expression(alert(1))').css).not.toContain('expression');
  });

  it('gỡ behavior và -moz-binding', () => {
    expect(run('behavior: url(x.htc)').css).not.toContain('behavior');
    expect(run('-moz-binding: url(x.xml)').css).not.toContain('binding');
  });

  it("gỡ '<' — đường thoát khỏi thẻ <style>", () => {
    const { css, warnings } = run('opacity: 1 } </style><script>alert(1)</script><style> a {');
    expect(css).not.toContain('<');
    expect(warnings.join()).toMatch(/<style>/);
  });

  it('url ảnh bình thường vẫn giữ', () => {
    const { css } = run('background-image: url(/anh/hero.png)');
    expect(css).toContain('/anh/hero.png');
  });
});

describe('at-rule', () => {
  it('gỡ @import — nó tải CSS từ domain ngoài vào production', () => {
    const { css, warnings } = run('@import url("//evil.example/x.css"); opacity: 1;');
    expect(css).not.toContain('@import');
    expect(css).toContain('opacity');
    expect(warnings.join()).toContain('@import');
  });

  it('giữ @media và scope bên trong nó', () => {
    const { css } = run('@media (min-width: 900px) { opacity: .5 }');
    expect(css).toContain('@media');
    expect(css).toContain(N);
  });

  it('giữ @supports và @container', () => {
    expect(run('@supports (display: grid) { display: grid }').css).toContain('@supports');
    expect(run('@container (min-width: 40rem) { gap: 1rem }').css).toContain('@container');
  });

  it('gỡ @font-face và @page', () => {
    expect(run('@font-face { font-family: x; src: url(x.woff2) }').css).not.toContain('@font-face');
    expect(run('@page { margin: 0 }').css).not.toContain('@page');
  });
});

describe('luật bố cục', () => {
  it('position: fixed thành absolute', () => {
    // fixed thoát khỏi mọi container và phủ lên cả trang, kể cả vùng nội dung
    // pháp lý bị khoá.
    const { css, warnings } = run('position: fixed; inset: 0;');
    expect(css).toContain('absolute');
    expect(css).not.toContain('fixed');
    expect(warnings.join()).toMatch(/fixed/);
  });

  it('sticky và absolute không bị đụng', () => {
    expect(run('position: sticky').css).toContain('sticky');
    expect(run('position: absolute').css).toContain('absolute');
  });

  it('bỏ !important', () => {
    const { css, warnings } = run('opacity: 0 !important;');
    expect(css).not.toContain('!important');
    expect(warnings.join()).toContain('!important');
  });
});

describe('CSS hỏng không hạ cả trang', () => {
  it('thiếu dấu đóng ngoặc vẫn ra kết quả dùng được', () => {
    // Người ta gõ CSS dở dang suốt. Parser thường sẽ ném lỗi và cả trang trắng.
    const { css } = run('opacity: .5; color: red');
    expect(css).toContain('opacity');
  });

  it('rác hoàn toàn thì trả về rỗng chứ không ném', () => {
    expect(() => run('}}}{{{ ;;; ')).not.toThrow();
  });

  it('chuỗi rỗng ra rỗng', () => {
    expect(run('').css).toBe('');
    expect(run('   ').css).toBe('');
  });
});

describe('deterministic', () => {
  it('cùng input ra cùng bytes — điều kiện để hash CSS ổn định', () => {
    const input = '@media (min-width: 900px) { &:hover { opacity: .5 } } color: red;';
    expect(run(input).css).toBe(run(input).css);
  });
});

describe('khai báo trần trong @media', () => {
  it('được bọc vào node, không rơi ra CSS vô nghĩa', () => {
    // Bản đầu chỉ bọc khai báo trần ở mức GỐC, nên `@media { opacity: .5 }` cho
    // ra CSS không hợp lệ: không lỗi, không cảnh báo, chỉ là không có tác dụng.
    const { css } = run('@media (min-width: 900px) { opacity: .5 }');
    expect(css).toContain('@media');
    expect(css).toContain(N);
    expect(css).toMatch(/@media[^{]+\{\s*\[data-n="abc"\]\s*\{/);
  });

  it('trộn khai báo trần và rule lồng trong cùng @media', () => {
    const { css } = run('@media (min-width: 900px) { gap: 1rem; > p { margin: 0 } }');
    expect(css).toContain(`${N} > p`);
    expect(css).toContain('gap: 1rem');
  });
});

describe('raws của postcss không được đi vòng qua phép dọn', () => {
  it('rác không phân tích được KHÔNG lọt ra output', () => {
    // postcss giữ nguyên phần input nó không phân tích nổi trong `raws`, và
    // `toString()` in lại nguyên văn — đi vòng qua toàn bộ phép dọn. Với payload
    // này, phần sót lại chứa một `}` thừa, và dấu đó đóng sớm khối
    // `@layer doc-custom {` bao ngoài: CSS của những node SAU đó rơi ra ngoài
    // layer. Một node gõ sai làm hỏng node khác.
    const { css } = run('opacity: .5 }</style><script>alert(1)</script>');
    expect(css).not.toContain('script');
    expect(css).not.toContain('/style');
  });

  it('số ngoặc luôn cân', () => {
    for (const input of [
      'opacity: .5 }</style><script>x</script>',
      'opacity: 1 } } }',
      '} } } opacity: 1',
      '@media (x) { a { b: c }',
    ]) {
      const { css } = run(input);
      const open = (css.match(/\{/g) ?? []).length;
      const close = (css.match(/\}/g) ?? []).length;
      expect(open, `lệch ngoặc với: ${input}`).toBe(close);
    }
  });
});

describe('declaredProperties — nền cho cảnh báo "customCss đang đè ô này"', () => {
  const read = (css: string) => declaredProperties(css, 'abc');

  it('khai báo trần áp vô điều kiện lên chính node', () => {
    const props = read('padding-top: 40px; opacity: .5;');
    expect(props.map((d) => d.prop)).toEqual(['padding-top', 'opacity']);
    expect(props.every((d) => d.always)).toBe(true);
  });

  it('rule có pseudo KHÔNG phải vô điều kiện', () => {
    // Cảnh báo cho `&:hover` là tiếng ồn — nó chỉ đè khi rê chuột. Và tiếng ồn
    // thì người ta học cách phớt lờ, kể cả lúc nó đúng.
    const props = read('&:hover { color: red }');
    expect(props).toHaveLength(1);
    expect(props[0]!.always).toBe(false);
  });

  it('rule trong @media KHÔNG phải vô điều kiện', () => {
    const props = read('@media (min-width: 900px) { gap: 4px }');
    expect(props).toHaveLength(1);
    expect(props[0]!.prop).toBe('gap');
    expect(props[0]!.always).toBe(false);
  });

  it('rule nhắm vào hậu duệ KHÔNG đè chính node', () => {
    const props = read('> p { margin: 0 }');
    expect(props[0]!.always).toBe(false);
  });

  it('trộn nhiều loại, phân biệt đúng từng cái', () => {
    const props = read(
      'opacity: .5; &:hover { opacity: 1 } @media (min-width: 900px) { gap: 4px }',
    );
    const always = props.filter((d) => d.always).map((d) => d.prop);
    expect(always).toEqual(['opacity']);
  });

  it('thấy property SAU khi sanitize, không phải thứ người dùng gõ', () => {
    // `position: fixed` bị đổi thành `absolute`, nhưng property vẫn là position
    // và nó vẫn đang đè ô position của inspector.
    const props = read('position: fixed;');
    expect(props.map((d) => d.prop)).toContain('position');
  });

  it('CSS bị sanitizer bỏ hẳn thì không khai gì', () => {
    expect(read('@import url("//evil.example/x.css");')).toEqual([]);
    expect(read('')).toEqual([]);
    expect(read('   ')).toEqual([]);
  });

  it('tên property thường hoá', () => {
    expect(read('PADDING-TOP: 1px;')[0]!.prop).toBe('padding-top');
  });
});
