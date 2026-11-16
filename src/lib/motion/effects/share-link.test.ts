import { describe, expect, it } from 'vitest';

import { facebookShareUrl, shareUrl } from './share-link';

describe('shareUrl', () => {
  it('bỏ hash và utm_*, giữ tham số khác', () => {
    expect(shareUrl('https://maimoney.com/blogs/post/a?utm_source=fb&page=2#top')).toBe(
      'https://maimoney.com/blogs/post/a?page=2',
    );
  });
  it('URL sạch giữ nguyên', () => {
    expect(shareUrl('https://maimoney.com/blogs/post/a')).toBe('https://maimoney.com/blogs/post/a');
  });
});

describe('facebookShareUrl', () => {
  it('mã hoá URL vào tham số u', () => {
    expect(facebookShareUrl('https://maimoney.com/blogs/post/a?page=2')).toBe(
      'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fmaimoney.com%2Fblogs%2Fpost%2Fa%3Fpage%3D2',
    );
  });
});
