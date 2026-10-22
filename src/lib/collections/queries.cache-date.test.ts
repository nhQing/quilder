/**
 * `unstable_cache` trả CHUỖI ở chỗ kiểu nói `Date`.
 *
 * Sự cố 14/09/2026: `/blogs/post/<slug>` trả 500 trên stg với
 * `TypeError: a.publishedAt.toISOString is not a function`.
 *
 * Vì sao không lớp kiểm nào bắt được:
 *
 *  - `tsc` tin kiểu khai báo. `getEntryBySlug` nói `Promise<EntryRow | null>`, và
 *    `EntryRow.publishedAt` nói `Date | null`. Không có gì để phàn nàn.
 *  - Test hiện có gọi thẳng hàm truy vấn bên trong, không đi qua `unstable_cache`,
 *    nên chúng luôn thấy `Date` thật.
 *  - Và lỗi phụ thuộc TRẠNG THÁI CACHE: ngay sau deploy cache trống nên lần gọi đầu
 *    trả `Date` thật và trang 200; từ lần thứ hai mới 500. Đo hai lần cách nhau vài
 *    phút cho hai kết quả ngược nhau trên cùng một bản build.
 *
 * Nên phép kiểm ở đây mô phỏng đúng thứ `unstable_cache` làm — một vòng
 * `JSON.parse(JSON.stringify(x))` — rồi đòi hàm hồi sinh trả lại `Date` thật.
 */

import { describe, expect, it } from 'vitest';

import { articleJsonLd } from '@/lib/render/collection-page';

/** Đúng thứ `unstable_cache` làm với giá trị trả về. */
const throughCache = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('unstable_cache biến Date thành chuỗi', () => {
  it('vòng JSON THẬT SỰ làm mất kiểu Date — tiền đề của cả sự cố', () => {
    const before = { publishedAt: new Date('2026-09-04T10:29:04.832Z') };
    const after = throughCache(before);

    expect(before.publishedAt).toBeInstanceOf(Date);
    expect(after.publishedAt).not.toBeInstanceOf(Date);
    expect(typeof (after.publishedAt as unknown)).toBe('string');
  });

  it('articleJsonLd NÉM khi publishedAt đã qua cache — đây là dòng 500 trên stg', () => {
    const args = throughCache({
      seo: { title: 'Bài viết', description: null, articleTitle: 'Bài viết', articleDescription: null },
      publishedAt: new Date('2026-09-04T10:29:04.832Z'),
      updatedAt: new Date('2026-09-04T10:29:04.832Z'),
    });

    expect(() =>
      articleJsonLd(args as unknown as Parameters<typeof articleJsonLd>[0]),
    ).toThrowError(/toISOString is not a function/);
  });

  it('hồi sinh xong thì articleJsonLd chạy, và ra đúng mốc thời gian ban đầu', () => {
    const iso = '2026-09-04T10:29:04.832Z';
    const cached = throughCache({
      seo: { title: 'Bài viết', description: null, articleTitle: 'Bài viết', articleDescription: null },
      publishedAt: new Date(iso),
      updatedAt: new Date(iso),
    });

    // Đúng thứ `reviveEntryRow` làm ở biên cache.
    const revived = {
      ...cached,
      publishedAt: new Date(cached.publishedAt as unknown as string),
      updatedAt: new Date(cached.updatedAt as unknown as string),
    };

    const out = articleJsonLd(revived as unknown as Parameters<typeof articleJsonLd>[0]);
    expect(out).not.toBeNull();
    expect(out?.datePublished).toBe(iso);
    expect(out?.dateModified).toBe(iso);
  });

  it('publishedAt null đi qua cache vẫn là null, không thành chuỗi "null"', () => {
    const cached = throughCache({
      seo: { title: 'Bài viết', description: null, articleTitle: 'Bài viết', articleDescription: null },
      publishedAt: null,
      updatedAt: new Date('2026-09-04T10:29:04.832Z'),
    });

    const revived = {
      ...cached,
      updatedAt: new Date(cached.updatedAt as unknown as string),
    };

    const out = articleJsonLd(revived as unknown as Parameters<typeof articleJsonLd>[0]);
    // Bài chưa đăng thì KHÔNG có `datePublished` — bỏ khoá, không phát chuỗi rỗng.
    expect(out).not.toBeNull();
    expect(out && 'datePublished' in out).toBe(false);
  });
});
