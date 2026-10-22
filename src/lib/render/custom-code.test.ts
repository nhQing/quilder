import { describe, expect, it } from 'vitest';

import { buildSrcdoc } from './custom-code';

const ORIGINS = ['https://esm.sh', 'https://unpkg.com'];

describe('buildSrcdoc — bịt lối thoát thẻ', () => {
  it('JS chứa `</script>` KHÔNG đóng được thẻ', () => {
    const out = buildSrcdoc({ js: 'const s = "</script><img src=x onerror=alert(1)>";' }, { origins: [] });
    // Nếu lối thoát còn, `<img>` sẽ nằm ngay sau một thẻ script ĐÃ ĐÓNG — tức nó
    // thành HTML thật. Đó là chuỗi phải biến mất.
    expect(out).not.toContain('</script><img');
    expect(out).toContain('<\\/script><img');
  });

  it('bắt cả biến thể có khoảng trắng và hoa thường', () => {
    // Kèm mốc hai bên: tài liệu phát ra VỐN có `</script>` hợp lệ của chính nó,
    // nên `out.includes('</script>')` luôn đúng và không kiểm được gì. Thứ cần
    // kiểm là chuỗi của NGƯỜI DÙNG, trong đúng ngữ cảnh của nó.
    for (const bad of ['</script>', '</SCRIPT>', '</ script >', '</\tScRiPt>']) {
      const out = buildSrcdoc({ js: `x = "MỞ${bad}ĐÓNG"` }, { origins: [] });
      expect(out.includes(`MỞ${bad}`), bad).toBe(false);
      expect(out).toContain('MỞ<\\/script');
    }
  });

  it('CSS chứa `</style>` cũng bị bịt', () => {
    const out = buildSrcdoc({ css: 'a{}</style><script>alert(1)</script>' }, { origins: [] });
    expect(out).not.toContain('</style><script>');
  });
});

describe('buildSrcdoc — CSP', () => {
  it('mặc định chặn tất, rồi mở từng thứ', () => {
    const out = buildSrcdoc({}, { origins: [] });
    expect(out).toContain("default-src 'none'");
    expect(out).toContain("frame-src 'none'");
    expect(out).toContain("object-src 'none'");
    expect(out).toContain("form-action 'none'");
  });

  it('allowlist rỗng thì KHÔNG mở origin nào', () => {
    const out = buildSrcdoc({}, { origins: [] });
    // `connect-src` trần = không kết nối được đi đâu.
    expect(out).toContain('connect-src;');
    expect(out).not.toContain('https://');
  });

  it('origin được đưa vào script-src và connect-src', () => {
    const out = buildSrcdoc({}, { origins: ORIGINS });
    expect(out).toContain("script-src 'unsafe-inline' https://esm.sh https://unpkg.com");
    expect(out).toContain('connect-src https://esm.sh https://unpkg.com');
  });
});

describe('buildSrcdoc — hình dạng tài liệu', () => {
  it('JS đi vào module script, để `import` từ CDN chạy được', () => {
    const out = buildSrcdoc({ js: 'import x from "https://esm.sh/x"' }, { origins: ORIGINS });
    expect(out).toContain('<script type="module">');
  });

  it('không có js thì không phát thẻ module rỗng', () => {
    expect(buildSrcdoc({ html: '<p>a</p>' }, { origins: [] })).not.toContain('type="module"');
  });

  it('luôn có script báo chiều cao, kể cả khi người dùng không viết js', () => {
    const out = buildSrcdoc({ html: '<p>a</p>' }, { origins: [] });
    expect(out).toContain("__mm: 'resize'");
    expect(out).toContain('ResizeObserver');
  });

  it('nền trong suốt theo mặc định, tắt được', () => {
    expect(buildSrcdoc({}, { origins: [] })).toContain('background:transparent');
    expect(buildSrcdoc({}, { origins: [], transparent: false })).not.toContain('background:transparent');
  });

  it('KHÔNG tự escape — React lo phần thuộc tính', () => {
    // Escape ở đây nghĩa là escape hai lần, và người dùng thấy `&amp;lt;` trong trang.
    const out = buildSrcdoc({ html: '<p class="a">x & y</p>' }, { origins: [] });
    expect(out).toContain('<p class="a">x & y</p>');
  });
});
