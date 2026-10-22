import { describe, expect, it } from 'vitest';

import { IMAGE_KINDS, UPLOAD_ACCEPT, assetKind, dbKind, extOf } from './kind';

describe('extOf', () => {
  it('lấy đuôi, hạ chữ thường', () => {
    expect(extOf('public/builder/hero-a1b2.PNG')).toBe('png');
    expect(extOf('a/b/tai-lieu.pdf')).toBe('pdf');
  });

  it('không có đuôi thì trả rỗng', () => {
    expect(extOf('public/builder/khong-co-duoi')).toBe('');
    // Dotfile: dấu chấm ở vị trí 0 KHÔNG phải đuôi file.
    expect(extOf('public/.gitkeep')).toBe('');
  });
});

describe('assetKind', () => {
  it('SVG là hạng riêng, không gộp vào image', () => {
    expect(assetKind('image/svg+xml').kind).toBe('svg');
    expect(assetKind('image/png').kind).toBe('image');
  });

  it('phân hạng theo họ MIME', () => {
    expect(assetKind('video/mp4').kind).toBe('video');
    expect(assetKind('audio/mpeg').kind).toBe('audio');
    expect(assetKind('application/pdf').kind).toBe('pdf');
    expect(assetKind('font/woff2').kind).toBe('font');
    expect(assetKind('application/json').kind).toBe('data');
    expect(assetKind('text/csv').kind).toBe('doc');
  });

  /*
   * Nhánh này phục vụ hàng CŨ: mọi asset tải lên trước khi có bảng hạng đều được
   * ghi `kind: 'image'` bất kể là gì (xem `upload-asset.ts`), nên `mime` của chúng
   * vẫn đúng — nhưng nếu một hàng nào đó có `mime` rỗng thì đuôi file là thứ duy
   * nhất còn lại.
   */
  it('không đọc được MIME thì rơi về đuôi file', () => {
    expect(assetKind('', 'a/b/phim.mp4').kind).toBe('video');
    expect(assetKind(null, 'a/b/bao-cao.docx').kind).toBe('doc');
    expect(assetKind(undefined, 'a/b/anh.jpeg').kind).toBe('image');
  });

  it('không biết gì thì nói KHÔNG BIẾT, không đoán', () => {
    const info = assetKind('application/octet-stream', 'a/b/file.xyz');
    expect(info.kind).toBe('file');
    expect(info.previewable).toBe(false);
  });

  it('chỉ ảnh mới previewable — đây là luật vẽ `<img>` hay không', () => {
    expect(assetKind('image/png').previewable).toBe(true);
    expect(assetKind('image/svg+xml').previewable).toBe(true);
    for (const m of ['application/pdf', 'video/mp4', 'audio/mpeg', 'font/woff2']) {
      expect(assetKind(m).previewable, m).toBe(false);
    }
  });

  it('mọi hạng đều có nhãn và ký tự để vẽ', () => {
    for (const m of ['image/png', 'image/svg+xml', 'video/mp4', 'audio/wav',
      'application/pdf', 'text/plain', 'font/woff', 'application/json', 'x/y']) {
      const i = assetKind(m);
      expect(i.label, m).toBeTruthy();
      expect(i.glyph, m).toBeTruthy();
    }
  });
});

describe('dbKind', () => {
  it('trả đúng chuỗi ghi vào cột Asset.kind', () => {
    expect(dbKind('image/svg+xml', 'a/logo.svg')).toBe('svg');
    expect(dbKind('application/pdf', 'a/x.pdf')).toBe('pdf');
  });
});

describe('IMAGE_KINDS', () => {
  /*
   * Tập này là hàng rào của bộ chọn ảnh. Thêm một hạng vào đây nghĩa là cho phép
   * gắn nó vào một node ảnh, và trình duyệt sẽ vẽ nó bằng `<img>` trên site thật.
   */
  it('chỉ gồm image và svg', () => {
    expect([...IMAGE_KINDS].sort()).toEqual(['image', 'svg']);
  });
});

describe('UPLOAD_ACCEPT', () => {
  it('không mời người dùng chọn HTML', () => {
    expect(UPLOAD_ACCEPT).not.toContain('html');
  });

  it('mọi mime trong danh sách đều phân hạng ra thứ khác `file`', () => {
    for (const m of UPLOAD_ACCEPT.split(',')) {
      expect(assetKind(m).kind, m).not.toBe('file');
    }
  });
});
