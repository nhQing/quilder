import { describe, expect, it } from 'vitest';

import { htmlPlainText, isBlankHtml, sanitizeArticleHtml, unsupportedTags } from './html-sanitize';

const clean = (s: string, hosts?: string[]) =>
  sanitizeArticleHtml(s, hosts ? { iframeHosts: hosts } : {}).html;

/*
 * Đây là bộ test chịu lực nhất của cả tính năng CKEditor.
 *
 * Từ 04/09/2026 thân bài là một chuỗi HTML đi thẳng vào `dangerouslySetInnerHTML`.
 * Trước đó nó là cây có kiểu và React tự escape mọi chuỗi — không có gì để tấn công.
 * Mỗi test dưới đây tương ứng một đường đã từng được dùng thật trên web.
 */
describe('chặn đường chạy code', () => {
  it('gỡ <script>, kể cả nội dung bên trong', () => {
    const out = clean('<p>a</p><script>alert(1)</script><p>b</p>');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('script');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('gỡ mọi thuộc tính on*', () => {
    for (const bad of [
      '<img src="https://x/y.png" onerror="alert(1)">',
      '<p onclick="alert(1)">x</p>',
      '<div onmouseover="alert(1)">x</div>',
      '<iframe onload="alert(1)"></iframe>',
    ]) {
      const out = clean(bad);
      expect(out.toLowerCase(), bad).not.toMatch(/on[a-z]+\s*=/);
    }
  });

  it('gỡ href/src dùng scheme chạy được', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'vbscript:msgbox', 'data:text/html;base64,x']) {
      const out = clean(`<a href="${bad}">x</a>`);
      expect(out, bad).not.toContain('href=');
      // Chữ vẫn ở lại: gỡ đường dẫn không có nghĩa là xoá câu.
      expect(out).toContain('x');
    }
  });

  /*
   * `data:image/svg+xml` là một tài liệu SVG đầy đủ, và SVG chạy được script. Nó
   * trông như một ảnh và đi qua mọi phép kiểm chỉ nhìn "đây có phải img không".
   */
  it('gỡ data: ở img, kể cả khi trông như ảnh', () => {
    const out = clean('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">');
    expect(out).not.toContain('data:');
  });

  it('gỡ khai báo style chạy được, giữ khai báo hợp lệ', () => {
    const out = clean('<p style="color:#e11; background:url(javascript:alert(1)); position:fixed">x</p>');
    expect(out).toContain('color:#e11');
    expect(out).not.toContain('javascript');
    expect(out).not.toContain('position');
  });

  it('gỡ <style> — một stylesheet trong thân bài đổi được cả trang', () => {
    const out = clean('<style>body{display:none}</style><p>x</p>');
    expect(out).not.toContain('display:none');
  });
});

describe('iframe: đóng theo mặc định', () => {
  const yt = '<iframe src="https://www.youtube.com/embed/abc"></iframe>';

  it('không khai host thì KHÔNG nhận iframe nào', () => {
    expect(clean(yt)).not.toContain('iframe');
  });

  it('khai host thì nhận đúng host đó', () => {
    expect(clean(yt, ['www.youtube.com'])).toContain('youtube.com/embed/abc');
  });

  it('host khác trong danh sách vẫn bị gỡ', () => {
    expect(clean('<iframe src="https://evil.example/x"></iframe>', ['www.youtube.com']))
      .not.toContain('iframe');
  });

  it('iframe đường dẫn tương đối bị gỡ — nó trỏ vào chính site', () => {
    expect(clean('<iframe src="/builder/settings"></iframe>', ['www.youtube.com']))
      .not.toContain('iframe');
  });
});

describe('giữ đúng những gì người soạn cần', () => {
  it('mark, u, s, sup, sub', () => {
    const out = clean('<p><u>a</u><s>b</s><mark>c</mark><sup>d</sup><sub>e</sub></p>');
    for (const t of ['u', 's', 'mark', 'sup', 'sub']) expect(out, t).toContain(`<${t}>`);
  });

  it('bảng kèm colspan và figure bọc ngoài của CKEditor', () => {
    const out = clean(
      '<figure class="table"><table><tbody><tr><th colspan="2">a</th></tr></tbody></table></figure>',
    );
    expect(out).toContain('<table>');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('class="table"');
  });

  it('canh lề và màu chữ', () => {
    const out = clean('<p style="text-align:center"><span style="color:#ff4d2e">x</span></p>');
    expect(out).toContain('text-align:center');
    expect(out).toContain('color:#ff4d2e');
  });

  it('h1 ĐƯỢC nhận — cảnh báo là việc của ô soạn, không phải của phép làm sạch', () => {
    expect(clean('<h1>x</h1>')).toContain('<h1>');
  });

  it('target="_blank" luôn kèm rel chống reverse tabnabbing', () => {
    const out = clean('<a href="https://x.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('class lạ bị gỡ, class của CKEditor được giữ', () => {
    const out = clean('<figure class="table ck-evil"><table></table></figure>');
    expect(out).toContain('class="table"');
    expect(out).not.toContain('ck-evil');
  });
});

describe('dropped', () => {
  it('nói ra thẻ nào vừa mất', () => {
    const r = sanitizeArticleHtml('<p>a</p><script>x</script><form><input></form>');
    expect(r.dropped).toContain('script');
    expect(r.dropped).toContain('form');
    expect(r.dropped).toContain('input');
  });

  it('rỗng khi không mất gì', () => {
    expect(sanitizeArticleHtml('<p><strong>a</strong></p>').dropped).toEqual([]);
  });
});

/*
 * Vòng tròn CKEditor → làm sạch → CKEditor.
 *
 * Mất một thẻ ở vòng này không phải lỗ bảo mật, nó là một tính năng âm thầm hỏng:
 * tác giả chèn video bằng chuột, lưu, mở lại và thấy một khung không sửa được.
 */
describe('giữ được hình dạng CKEditor sinh ra', () => {
  it('khối nhúng giữ cả figure.media, div[data-oembed-url] và iframe', () => {
    const embed =
      '<figure class="media"><div data-oembed-url="https://www.youtube.com/watch?v=abc">' +
      '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen title="v"></iframe></div></figure>';
    const out = clean(embed, ['www.youtube.com']);
    expect(out).toContain('class="media"');
    expect(out).toContain('data-oembed-url="https://www.youtube.com/watch?v=abc"');
    expect(out).toContain('<iframe');
  });

  it('div giữ lại nhưng class lạ thì gỡ', () => {
    const out = clean('<div class="fixed inset-0 z-50">x</div>');
    expect(out).toContain('<div>');
    expect(out).not.toContain('inset-0');
    expect(out).toContain('x');
  });

  it('mark giữ màu bút dạ của Highlight', () => {
    expect(clean('<p><mark class="marker-yellow">x</mark></p>')).toContain('class="marker-yellow"');
    expect(clean('<p><mark class="ck-hack">x</mark></p>')).toContain('<mark>');
  });

  it('ảnh đã kéo cỡ giữ figure.image_resized và style width', () => {
    const out = clean(
      '<figure class="image image_resized" style="width:42%"><img src="https://x/y.png" alt="a"></figure>',
    );
    expect(out).toContain('image_resized');
    expect(out).toContain('width:42%');
  });

  it('bảng đã kéo cột giữ colgroup và bề rộng cột', () => {
    const out = clean(
      '<figure class="table"><table class="ck-table-resized"><colgroup><col style="width:30%"></colgroup>' +
      '<tbody><tr><td>a</td></tr></tbody></table></figure>',
    );
    expect(out).toContain('ck-table-resized');
    expect(out).toContain('width:30%');
  });
});

describe('htmlPlainText', () => {
  it('bỏ thẻ, gộp khoảng trắng, không dính chữ hai đoạn', () => {
    expect(htmlPlainText('<p>một</p><p>hai</p>')).toBe('một hai');
  });

  it('bỏ cả RUỘT của script và style', () => {
    expect(htmlPlainText('<p>a</p><script>alert(1)</script><style>p{}</style>')).toBe('a');
  });

  it('giải các entity hay gặp', () => {
    expect(htmlPlainText('<p>a&nbsp;&amp;&nbsp;b</p>')).toBe('a & b');
  });
});

describe('isBlankHtml', () => {
  it('ô soạn vừa mở là RỖNG, dù CKEditor để lại thẻ', () => {
    for (const s of ['', '<p></p>', '<p>&nbsp;</p>', '<p><br></p>', '<p>   </p>']) {
      expect(isBlankHtml(s), JSON.stringify(s)).toBe(true);
    }
  });

  it('có chữ thì không rỗng', () => {
    expect(isBlankHtml('<p>a</p>')).toBe(false);
  });

  it('bài chỉ có ảnh hoặc chỉ có bảng KHÔNG rỗng', () => {
    expect(isBlankHtml('<figure class="image"><img src="https://x/y.png" alt="a"></figure>')).toBe(false);
    expect(isBlankHtml('<table><tbody><tr><td></td></tr></tbody></table>')).toBe(false);
  });
});

describe('unsupportedTags', () => {
  it('kể tên thẻ không bao giờ được nhận', () => {
    expect(unsupportedTags('<p>a</p><form><input></form><script>x</script>'))
      .toEqual(['form', 'input', 'script']);
  });

  it('rỗng với HTML mà CKEditor sinh ra', () => {
    const ck =
      '<h2>T</h2><p><mark class="marker-yellow">a</mark></p>' +
      '<figure class="media"><div data-oembed-url="u"><iframe src="https://x/y"></iframe></div></figure>' +
      '<figure class="table"><table><tbody><tr><td>x</td></tr></tbody></table></figure>';
    expect(unsupportedTags(ck)).toEqual([]);
  });

  it('KHÔNG nói gì về iframe — nó phụ thuộc host, và host nằm trong database', () => {
    // Đây là giới hạn có chủ đích của hàm này: ô soạn ở client không biết bảng
    // `EmbedOrigin`, nên báo "iframe sẽ bị gỡ" là báo bừa một nửa số lần.
    expect(unsupportedTags('<iframe src="https://evil/x"></iframe>')).toEqual([]);
  });
});
