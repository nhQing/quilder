import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { compileStaticCss, hashCss, STATIC_CSS_ENTRY } from './static-css';

/**
 * Gộp CSS tĩnh — đây là thứ NIÊM PHONG hiển thị của một release.
 *
 * Hai tính chất chịu lực, và cả hai đều thuộc loại "sai thì không có lỗi nào":
 *
 *  - XÁC ĐỊNH: cùng input phải ra cùng hash. Không thì mỗi lần publish sinh một
 *    `StyleBundle` mới, và cả cơ chế dùng chung theo nội dung mất ý nghĩa — 56
 *    release sẽ thành 56 bó 137 KB.
 *  - GIỮ THỨ TỰ: `@layer base, doc, doc-custom;` phải đứng đầu, và các file phải
 *    vào đúng thứ tự khai. Sai thứ tự thì rule cấp element của reset đè lên toàn
 *    bộ `@layer doc`, tức mọi style người dùng đặt đều mất — xem docblock trong
 *    `src/styles/site.css`.
 */

const FILES: Record<string, string> = {
  'src/styles/site.css': [
    '@layer base, doc, doc-custom;',
    "@import './base/reset.css' layer(base);",
    "@import './tokens.css' layer(base);",
  ].join('\n'),
  'src/styles/base/reset.css': '*{margin:0}',
  'src/styles/tokens.css': ':root{--space-l:24px}',
};

const read = (p: string) => {
  const hit = FILES[p.replace(/\\/g, '/')];
  if (hit === undefined) throw new Error(`test thiếu file: ${p}`);
  return hit;
};

describe('compileStaticCss', () => {
  it('dòng khai @layer đứng đầu, và không còn @import nào', () => {
    const css = compileStaticCss(read);
    expect(css.indexOf('@layer base, doc, doc-custom;')).toBe(0);
    // Còn @import nghĩa là trình duyệt sẽ tải một URL không tồn tại — bó này được
    // phát inline, nên đường tương đối không còn ý nghĩa gì.
    expect(css).not.toContain('@import');
  });

  it('giữ đúng thứ tự khai: reset trước tokens', () => {
    const css = compileStaticCss(read);
    expect(css.indexOf('*{margin:0}')).toBeLessThan(css.indexOf('--space-l'));
  });

  it('bọc nội dung mỗi file trong đúng layer mà @import khai', () => {
    expect(compileStaticCss(read)).toContain('@layer base {\n*{margin:0}\n}');
  });

  it('xác định — gọi hai lần ra chuỗi y hệt', () => {
    expect(compileStaticCss(read)).toBe(compileStaticCss(read));
  });

  it('ném khi thiếu file, không âm thầm bỏ qua', () => {
    const missing = (p: string) => {
      if (p === STATIC_CSS_ENTRY) return "@import './khong-co.css' layer(base);";
      throw new Error('ENOENT');
    };
    // Bỏ qua im lặng ở đây nghĩa là publish một release thiếu CSS mà không ai
    // biết, và nó chỉ lộ ra khi có người mở site.
    expect(() => compileStaticCss(missing)).toThrow();
  });

  it('lược comment — chúng là 60% khối lượng và người dùng không nhận được gì', () => {
    const withComments: Record<string, string> = {
      'src/styles/site.css': "/* ghi chú dài */\n@import './a.css' layer(base);",
      'src/styles/a.css': '/* nữa */a{color:red}/* và nữa */',
    };
    const css = compileStaticCss((p) => withComments[p]!);
    expect(css).not.toContain('ghi chú');
    expect(css).toContain('a{color:red}');
  });

  it('ném khi comment lệch, thay vì cắt xén CSS im lặng', () => {
    // Một `/*` trong chuỗi làm phép thay thế ăn mất CSS thật. Publish một bó bị
    // cắt xén thì chỉ lộ ra khi có người mở site.
    const broken: Record<string, string> = {
      'src/styles/site.css': "@import './a.css' layer(base);",
      'src/styles/a.css': 'a::before{content:"/*"}',
    };
    expect(() => compileStaticCss((p) => broken[p]!)).toThrow(/comment lệch/);
  });

  it('lược comment SAU khi ghép — @import trong comment vẫn được thay thế trước', () => {
    // Nếu lược trước, dòng @import bị comment sẽ biến mất và CSS đó âm thầm không
    // vào bó. Thứ tự đúng là ghép rồi mới lược.
    const files: Record<string, string> = {
      'src/styles/site.css': "/* @import './a.css' layer(base); */",
      'src/styles/a.css': 'a{}',
    };
    // Dòng bị comment VẪN được thay thế (regex không biết comment), rồi cả khối
    // comment bị lược — nên kết quả rỗng, không phải một @import treo lại.
    expect(compileStaticCss((p) => files[p]!)).not.toContain('@import');
  });

  it('đường dẫn có ../ được ghép đúng', () => {
    const nested: Record<string, string> = {
      'src/styles/site.css': "@import '../vendor/x.css' layer(base);",
      'src/vendor/x.css': 'a{color:red}',
    };
    expect(compileStaticCss((p) => nested[p]!)).toBe('@layer base {\na{color:red}\n}');
  });
});

/**
 * Kiểm trên FILE THẬT, không chỉ fixture.
 *
 * Fixture chứng minh hàm đúng; nhóm này chứng minh `src/styles/` vẫn ở hình dạng
 * mà hàm giả định. Hai chuyện khác nhau, và chuyện thứ hai là chuyện sẽ vỡ —
 * người sau thêm một `@import` không có `layer()`, hoặc đặt một rule trước dòng
 * khai `@layer`, và không có gì báo.
 */
describe('trên src/styles thật', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('không còn @import nào sau khi gộp', () => {
    expect(compileStaticCss(read)).not.toContain('@import');
  });

  it('dòng khai @layer là RULE đầu tiên — comment ở trước thì không sao', () => {
    const css = compileStaticCss(read);
    const decl = css.indexOf('@layer base, doc, doc-custom;');
    expect(decl).toBeGreaterThanOrEqual(0);

    // Bỏ comment rồi mới xét, vì `site.css` mở đầu bằng docblock. Thứ phải đứng
    // đầu là rule đầu tiên: khai layer sau một rule khác nghĩa là rule đó vào
    // layer ẩn danh và THẮNG mọi layer có tên — mất sạch style người dùng.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').trimStart();
    expect(bare.startsWith('@layer base, doc, doc-custom;')).toBe(true);
  });

  it('mọi file được import đều vào layer, không sót file nào ngoài layer', () => {
    const entry = read(STATIC_CSS_ENTRY);
    const withLayer = entry.match(/@import\s+['"][^'"]+['"]\s*layer\([^)]+\)\s*;/g) ?? [];
    const allImports = entry.match(/@import\s/g) ?? [];
    // Một `@import` không có `layer()` sẽ KHÔNG được hàm này thay thế, nên nó còn
    // lại trong bó và trỏ tới một URL tương đối không tồn tại — CSS đó im lặng
    // không bao giờ tải.
    expect(withLayer.length).toBe(allImports.length);
    expect(compileStaticCss(read).match(/@layer base \{/g)?.length).toBe(withLayer.length);
  });

  it('xác định trên file thật', () => {
    expect(hashCss(compileStaticCss(read))).toBe(hashCss(compileStaticCss(read)));
  });
});

describe('hashCss', () => {
  it('cùng nội dung ra cùng hash, khác nội dung ra khác hash', () => {
    expect(hashCss('a{}')).toBe(hashCss('a{}'));
    expect(hashCss('a{}')).not.toBe(hashCss('b{}'));
  });

  it('trả về sha256 hex 64 ký tự', () => {
    expect(hashCss('a{}')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('compileStaticCss — CSS của gói dự án', () => {
  const PACK: Record<string, string> = {
    ...FILES,
    'projects/abc/styles/index.css': "@import './section.css' layer(base);\n@layer base { .x { color: red } }",
    'projects/abc/styles/section.css': '.sec{gap:1rem}',
  };
  const readPack = (p: string) => {
    const hit = PACK[p.replace(/\\/g, '/')];
    if (hit === undefined) throw new Error(`test thiếu file: ${p}`);
    return hit;
  };

  it('không có gói: y hệt trước, cùng hash', () => {
    expect(compileStaticCss(read, [])).toBe(compileStaticCss(read));
  });

  it('CSS của gói nối SAU site.css, @import của gói resolve theo thư mục gói', () => {
    const css = compileStaticCss(readPack, ['projects/abc/styles/index.css']);
    expect(css.indexOf('.sec{gap:1rem}')).toBeGreaterThan(css.indexOf('--space-l'));
    expect(css).toContain('@layer base {\n.sec{gap:1rem}\n}');
    expect(css).toContain('.x { color: red }');
    expect(css).not.toContain('@import');
    expect(hashCss(css)).not.toBe(hashCss(compileStaticCss(read)));
  });
});
