import { describe, expect, it } from 'vitest';

/**
 * Bộ thẻ chia sẻ.
 *
 * Mọi thứ ở đây hỏng theo cùng một kiểu: thẻ vẫn phát ra, trang vẫn 200, và chỉ
 * người dán link vào Zalo mới thấy. Nên chúng phải có test, không phải có comment.
 */

import { shareImageWarning, shareMeta, type ShareMetaInput } from './share-meta';

const base: ShareMetaInput = {
  title: 'Trang chủ',
  description: 'Mô tả ngắn',
  path: '/trang-chu',
  siteName: 'Quilder Demo',
  locale: { code: 'vi', isDefault: true },
  otherLocaleCodes: ['en'],
  kind: 'website',
};

const img = { url: '/og.png', width: 1200, height: 630, mime: 'image/png', alt: 'Ảnh' };

describe('og:locale', () => {
  it('đổi mã ngôn ngữ sang dạng xx_XX mà Facebook đòi', () => {
    // `${code}_${code.toUpperCase()}` cho ra `vi_VI` — không tồn tại, và Facebook
    // bỏ qua thẻ sai mà không báo gì.
    const { openGraph } = shareMeta(base);
    expect(openGraph.locale).toBe('vi_VN');
    expect(openGraph.alternateLocale).toEqual(['en_US']);
  });

  it('mã lạ thì BỎ HẲN thẻ, không đoán', () => {
    // Thiếu `og:locale` vô hại; sai là một thẻ nói dối.
    const { openGraph } = shareMeta({
      ...base,
      locale: { code: 'xx', isDefault: false },
      otherLocaleCodes: ['zz'],
    });
    expect(openGraph.locale).toBeUndefined();
    expect(openGraph.alternateLocale).toBeUndefined();
  });
});

describe('ảnh', () => {
  it('khai width và height — đây là thứ làm lần chia sẻ ĐẦU ra ảnh', () => {
    // Không có hai số này thì Facebook và Zalo phải tải ảnh về để đo, và thẻ đầu
    // tiên thường ra không ảnh.
    const { openGraph } = shareMeta({ ...base, image: img });
    expect(openGraph.images).toEqual([
      { url: '/og.png', width: 1200, height: 630, alt: 'Ảnh', type: 'image/png' },
    ]);
  });

  it('thiếu MỘT chiều thì bỏ cả hai', () => {
    // Một chiều lẻ loi làm scraper tính sai tỉ lệ — tệ hơn không khai gì.
    const { openGraph } = shareMeta({
      ...base,
      image: { url: '/og.png', width: 1200, height: null },
    });
    expect(openGraph.images).toEqual([{ url: '/og.png' }]);
  });

  it('twitter card là summary_large_image CHỈ khi có ảnh', () => {
    expect(shareMeta({ ...base, image: img }).twitter.card).toBe('summary_large_image');
    // Khai large mà không có ảnh cho ra một thẻ dành chỗ rồi để trống.
    expect(shareMeta(base).twitter.card).toBe('summary');
  });

  it('không có ảnh thì KHÔNG khai images rỗng', () => {
    expect(shareMeta(base).openGraph.images).toBeUndefined();
    expect(shareMeta(base).twitter.images).toBeUndefined();
  });
});

describe('og:url và site name', () => {
  it('dùng đúng path truyền vào, để tương đối cho metadataBase lo', () => {
    // Ghép tay `SITE_URL` ở đây là bản thứ hai của cùng một gốc.
    expect(shareMeta(base).openGraph.url).toBe('/trang-chu');
  });

  it('không có tên site thì bỏ thẻ, không phát chuỗi rỗng', () => {
    const { openGraph } = shareMeta({ ...base, siteName: undefined });
    expect(openGraph.siteName).toBeUndefined();
  });
});

describe('article:*', () => {
  const at = new Date('2026-08-15T03:00:00.000Z');

  it('chỉ phát khi type là article', () => {
    const { openGraph } = shareMeta({ ...base, kind: 'article', publishedAt: at, updatedAt: at });
    expect(openGraph.publishedTime).toBe(at.toISOString());
    expect(openGraph.modifiedTime).toBe(at.toISOString());
  });

  it('website thì KHÔNG phát, dù có mốc thời gian', () => {
    // Thẻ không ai đọc, và nó làm người soát tưởng trang chủ là một bài viết.
    const { openGraph } = shareMeta({ ...base, publishedAt: at, updatedAt: at });
    expect(openGraph.publishedTime).toBeUndefined();
    expect(openGraph.modifiedTime).toBeUndefined();
  });
});

describe('shareImageWarning', () => {
  it('không có ảnh là cảnh báo đầu tiên', () => {
    expect(shareImageWarning(undefined)).toContain('Chưa có ảnh');
  });

  it('không biết kích thước thì vẫn nói ra', () => {
    // SVG không có kích thước pixel, và hàng Asset cũ có thể chưa đo.
    expect(shareImageWarning({ url: '/a.svg' })).toContain('width/height');
  });

  it('dưới 200px bị Facebook và Zalo bỏ qua', () => {
    expect(shareImageWarning({ url: '/a.png', width: 150, height: 150 })).toContain('quá nhỏ');
  });

  it('dưới 600×315 ra thẻ vuông nhỏ, không phải thẻ ảnh lớn', () => {
    expect(shareImageWarning({ url: '/a.png', width: 400, height: 300 })).toContain('vuông nhỏ');
  });

  it('ảnh vuông bị CẮT, không bị co', () => {
    const w = shareImageWarning({ url: '/a.png', width: 1200, height: 1200 });
    expect(w).toContain('CẮT');
  });

  it('1200×630 là sạch', () => {
    expect(shareImageWarning({ url: '/a.png', width: 1200, height: 630 })).toBeNull();
  });

  it('lệch nhẹ vẫn sạch — ngưỡng theo hậu quả, không theo con số tròn', () => {
    // 1200×675 (16:9) lệch ~7%, phần cắt còn nằm ở lề.
    expect(shareImageWarning({ url: '/a.png', width: 1200, height: 675 })).toBeNull();
  });
});
