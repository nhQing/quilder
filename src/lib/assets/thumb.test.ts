import { describe, expect, it } from 'vitest';

import { pickWidth, thumbSrc } from './thumb';

describe('pickWidth', () => {
  it('lấy khổ hợp lệ nhỏ nhất không nhỏ hơn yêu cầu', () => {
    expect(pickWidth(96)).toBe(96);
    expect(pickWidth(200)).toBe(256);
    expect(pickWidth(520)).toBe(640);
  });
  it('vượt khổ lớn nhất thì dừng ở 3840', () => {
    expect(pickWidth(9000)).toBe(3840);
  });
});

describe('thumbSrc', () => {
  it('ảnh raster trên CDN đi qua optimizer, có 1x và 2x', () => {
    const r = thumbSrc('https://cdn.example.com/public/builder/hero-ab12.jpg', 260);
    const enc = encodeURIComponent('https://cdn.example.com/public/builder/hero-ab12.jpg');
    expect(r).toEqual({
      src: `/_next/image?url=${enc}&w=384&q=75`,
      srcSet: `/_next/image?url=${enc}&w=384&q=75 1x, /_next/image?url=${enc}&w=640&q=75 2x`,
    });
  });

  it('đường tương đối cùng origin cũng thu được, bỏ qua query khi xét đuôi', () => {
    expect(thumbSrc('/uploads/a.PNG?v=2', 96)?.src).toBe(`/_next/image?url=${encodeURIComponent('/uploads/a.PNG?v=2')}&w=96&q=75`);
  });

  it.each([
    ['SVG', 'https://cdn.example.com/logo.svg'],
    ['GIF động', 'https://cdn.example.com/anim.gif'],
    ['data:', 'data:image/png;base64,AAAA'],
    ['blob:', 'blob:http://localhost:3000/123'],
    ['đã là /_next/image', '/_next/image?url=%2Fa.png&w=96&q=75'],
    ['protocol-relative', '//cdn.example.com/a.png'],
    ['không có đuôi', 'https://cdn.example.com/file'],
  ])('%s → giữ gốc (null)', (_label, url) => {
    expect(thumbSrc(url, 200)).toBeNull();
  });
});
