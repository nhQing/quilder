import { describe, expect, it } from 'vitest';

import { publicApiUrls, siteOrigin } from './api-urls';

describe('siteOrigin', () => {
  it('host trần của máy dev nhận http', () => {
    // `https://localhost:3001` không kết nối được, và người dùng sẽ kết luận API hỏng
    // chứ không kết luận scheme sai.
    expect(siteOrigin('localhost:3001')).toBe('http://localhost:3001');
  });

  it('tên miền thật nhận https', () => {
    expect(siteOrigin('stg.example.com')).toBe('https://stg.example.com');
  });

  it('đã có scheme thì giữ nguyên, không chồng thêm', () => {
    expect(siteOrigin('https://example.com')).toBe('https://example.com');
    expect(siteOrigin('http://localhost:3001')).toBe('http://localhost:3001');
  });

  it('cắt dấu / thừa ở cuối — nếu không sẽ ra //api/public/v1', () => {
    expect(siteOrigin('stg.example.com/')).toBe('https://stg.example.com');
  });

  it('127.0.0.1 và *.local cũng là máy nội bộ', () => {
    expect(siteOrigin('127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(siteOrigin('may-cua-toi.local')).toBe('http://may-cua-toi.local');
  });

  it('rỗng trả rỗng, không trả "https://"', () => {
    // Site chưa đặt domain là một trạng thái có thật. Trả `https://` làm mọi dòng URL
    // thành `https:///api/...` — một chuỗi trông như đúng và không bao giờ gọi được.
    expect(siteOrigin('')).toBe('');
    expect(siteOrigin('   ')).toBe('');
  });
});

const origin = 'https://stg.example.com';
const base = `${origin}/api/public/v1`;

describe('publicApiUrls', () => {
  it('luôn có dòng danh sách', () => {
    const rows = publicApiUrls({ origin, typeKey: 'news', fieldKeys: [] });
    expect(rows.map((r) => r.id)).toEqual(['list']);
    expect(rows[0]!.url).toBe(`${base}/news?pageSize=20&sort=publishedAt:desc`);
  });

  it('KHÔNG in dòng danh mục khi loại chưa có danh mục nào', () => {
    // In một `?taxonomy=` bịa ra là dạy người dùng một tham số trả danh sách rỗng —
    // và rỗng thì trông y hệt "API hỏng".
    const rows = publicApiUrls({ origin, typeKey: 'news', fieldKeys: [] });
    expect(rows.find((r) => r.id === 'taxonomy')).toBeUndefined();
    expect(rows.find((r) => r.id === 'taxonomies')).toBeUndefined();
  });

  it('có danh mục thì in cả dòng lọc lẫn cây danh mục, dùng KHOÁ thật', () => {
    const rows = publicApiUrls({
      origin, typeKey: 'news', taxonomyKey: 'tin-thi-truong', fieldKeys: [],
    });
    expect(rows.find((r) => r.id === 'taxonomy')!.url).toBe(
      `${base}/news?taxonomy=tin-thi-truong&pageSize=20`,
    );
    expect(rows.find((r) => r.id === 'taxonomies')!.url).toBe(`${base}/taxonomies/news`);
  });

  it('KHÔNG in endpoint chi tiết khi loại chưa có bài nào', () => {
    const rows = publicApiUrls({ origin, typeKey: 'news', fieldKeys: [] });
    expect(rows.find((r) => r.id === 'detail')).toBeUndefined();
  });

  it('có bài thì endpoint chi tiết dùng slug thật', () => {
    const rows = publicApiUrls({
      origin, typeKey: 'news', sampleSlug: 'lai-suat-thang-8', fieldKeys: [],
    });
    expect(rows.find((r) => r.id === 'detail')!.url).toBe(`${base}/news/lai-suat-thang-8`);
  });

  it('?fields= lấy tối đa hai field, và là field có thật', () => {
    const rows = publicApiUrls({
      origin, typeKey: 'news', fieldKeys: ['title', 'cover', 'body', 'sapo'],
    });
    expect(rows.find((r) => r.id === 'fields')!.url).toBe(
      `${base}/news?fields=title,cover&pageSize=100`,
    );
  });

  it('chỉ in dòng locale khi có ngôn ngữ khác mặc định', () => {
    const khong = publicApiUrls({ origin, typeKey: 'news', fieldKeys: [] });
    expect(khong.find((r) => r.id === 'locale')).toBeUndefined();

    const co = publicApiUrls({ origin, typeKey: 'news', fieldKeys: [], locale: 'en' });
    expect(co.find((r) => r.id === 'locale')!.url).toBe(
      `${base}/news?locale=en&pageSize=20`,
    );
  });

  it('mọi id là duy nhất — chúng là khoá React và là móc của e2e', () => {
    const rows = publicApiUrls({
      origin, typeKey: 'news', taxonomyKey: 'tin', sampleSlug: 'bai', fieldKeys: ['title'], locale: 'en',
    });
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows).toHaveLength(6);
  });
});
