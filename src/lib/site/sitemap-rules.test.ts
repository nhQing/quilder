import { describe, expect, it } from 'vitest';

import { applySitemapRules, checkSitemapRules, parseSitemapRules } from './sitemap-rules';

const O = 'https://vd.vn';
const e = (path: string) => ({ url: `${O}${path}` });

describe('parseSitemapRules', () => {
  it('bỏ phần tử sai dạng, không ném', () => {
    expect(parseSitemapRules({ include: ['/a', 3, ''], exclude: ['/b', 'khong-gach'] })).toEqual({
      include: ['/a'],
      exclude: ['/b'],
    });
    expect(parseSitemapRules(null)).toEqual({ include: [], exclude: [] });
  });

  it('trần 200 dòng', () => {
    expect(parseSitemapRules({ include: Array(300).fill('/x') }).include).toHaveLength(200);
  });
});

describe('applySitemapRules', () => {
  it('loại theo ĐOẠN, không theo chuỗi trần', () => {
    const out = applySitemapRules([e(''), e('/tin-tuc'), e('/tin-tuc/a'), e('/tin-tuc-cu')], { include: [], exclude: ['/tin-tuc/'] }, O);
    expect(out.map((x) => x.url)).toEqual([O, `${O}/tin-tuc-cu`]);
  });

  it('thêm đường dẫn tương đối và URL tuyệt đối cùng origin, bỏ trùng', () => {
    const out = applySitemapRules([e('/a')], { include: ['/a', '/b', 'https://vd.vn/c', 'https://khac.vn/d'], exclude: [] }, O);
    expect(out.map((x) => x.url)).toEqual([`${O}/a`, `${O}/b`, `${O}/c`]);
  });

  it('luật loại áp cả URL có tiền tố ngôn ngữ — /blogs/test loại luôn /en/blogs/test/…', () => {
    const list = [e('/blogs/test/a'), e('/en/blogs/test/a'), e('/en/blogs/khac'), e('/en')];
    const out = applySitemapRules(list, { include: [], exclude: ['/blogs/test'] }, O, ['en']);
    expect(out.map((x) => x.url)).toEqual([`${O}/en/blogs/khac`, `${O}/en`]);
    // Luật viết thẳng tiền tố ngôn ngữ vẫn chỉ loại đúng ngôn ngữ đó.
    const onlyEn = applySitemapRules(list, { include: [], exclude: ['/en/blogs/test'] }, O, ['en']);
    expect(onlyEn.map((x) => x.url)).toEqual([`${O}/blogs/test/a`, `${O}/en/blogs/khac`, `${O}/en`]);
  });

  it('luật rỗng: giữ nguyên', () => {
    const list = [e('/a'), e('/b')];
    expect(applySitemapRules(list, { include: [], exclude: [] }, O)).toEqual(list);
  });
});

describe('checkSitemapRules', () => {
  it('báo từng dòng sai', () => {
    const errs = checkSitemapRules({ include: ['https://khac.vn/x', '/ok'], exclude: ['sai', '/ok'] }, O);
    expect(errs).toHaveLength(2);
  });
});
