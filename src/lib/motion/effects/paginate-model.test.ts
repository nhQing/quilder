import { describe, expect, it } from 'vitest';

import { clampPage, hrefWithPage, onPage, pageCount, pageList } from './paginate-model';

describe('pageCount', () => {
  it('làm tròn lên, tối thiểu 1', () => {
    expect(pageCount(0, 12)).toBe(1);
    expect(pageCount(12, 12)).toBe(1);
    expect(pageCount(13, 12)).toBe(2);
    expect(pageCount(99, 12)).toBe(9);
  });
});

describe('clampPage', () => {
  it('số hợp lệ giữ nguyên', () => {
    expect(clampPage('3', 9)).toBe(3);
  });
  it('vượt trần → trang cuối', () => {
    expect(clampPage('20', 9)).toBe(9);
  });
  it('rỗng, chữ, số âm, thập phân → trang 1', () => {
    expect(clampPage(null, 9)).toBe(1);
    expect(clampPage('', 9)).toBe(1);
    expect(clampPage('abc', 9)).toBe(1);
    expect(clampPage('-2', 9)).toBe(1);
    expect(clampPage('2.5', 9)).toBe(1);
    expect(clampPage('0', 9)).toBe(1);
  });
});

describe('onPage', () => {
  it('chia đúng biên', () => {
    expect(onPage(0, 1, 12)).toBe(true);
    expect(onPage(11, 1, 12)).toBe(true);
    expect(onPage(12, 1, 12)).toBe(false);
    expect(onPage(12, 2, 12)).toBe(true);
  });
});

describe('pageList', () => {
  it('ít trang: in đủ', () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(2, 4)).toEqual([1, 2, 3, 4]);
  });
  it('nhiều trang: đầu, cuối, quanh trang hiện tại, "…" cho khoảng dài', () => {
    expect(pageList(1, 9)).toEqual([1, 2, 'gap', 9]);
    expect(pageList(5, 9)).toEqual([1, 'gap', 4, 5, 6, 'gap', 9]);
    expect(pageList(9, 9)).toEqual([1, 'gap', 8, 9]);
  });
  it('khoảng trống đúng một trang in số chứ không in "…"', () => {
    expect(pageList(4, 9)).toEqual([1, 2, 3, 4, 5, 'gap', 9]);
  });
});

describe('hrefWithPage', () => {
  const base = 'https://maimoney.com/blogs/dau-tu?page=3#top';
  it('đặt tham số', () => {
    expect(hrefWithPage(base, 'page', 4)).toBe('/blogs/dau-tu?page=4#top');
  });
  it('trang 1 gỡ tham số, giữ tham số khác', () => {
    expect(hrefWithPage('https://maimoney.com/blogs/dau-tu?page=3&x=1', 'page', 1)).toBe('/blogs/dau-tu?x=1');
  });
});
