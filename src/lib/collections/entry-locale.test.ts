import { describe, expect, it } from 'vitest';

import {
  isLocalePublished,
  localePublishState,
  localeSlug,
  type EntryBaseState,
  type EntryLocaleRow,
} from './entry-locale';

const now = new Date('2026-08-28T10:00:00.000Z');

const base: EntryBaseState = {
  slug: 'lai-suat-thang-8',
  status: 'published',
  publishedAt: new Date('2026-08-20T00:00:00.000Z'),
};

const en = (over: Partial<EntryLocaleRow> = {}): EntryLocaleRow => ({
  locale: 'en',
  slug: 'august-interest-rates',
  status: 'published',
  publishedAt: new Date('2026-08-21T00:00:00.000Z'),
  ...over,
});

describe('localeSlug', () => {
  it('không truyền locale thì dùng slug gốc', () => {
    expect(localeSlug(base, [en()])).toBe('lai-suat-thang-8');
  });

  it('có slug riêng thì dùng slug riêng', () => {
    expect(localeSlug(base, [en()], 'en')).toBe('august-interest-rates');
  });

  it('ngôn ngữ chưa có hàng thì rơi về slug gốc, KHÔNG phải rỗng', () => {
    // Đây là trạng thái của mọi bài ngay sau migration. Trả rỗng ở đây là biến mọi
    // URL đang chạy thành 404 cùng một lúc.
    expect(localeSlug(base, [], 'en')).toBe('lai-suat-thang-8');
  });

  it('có hàng nhưng chưa đặt slug riêng thì rơi về slug gốc', () => {
    expect(localeSlug(base, [en({ slug: null })], 'en')).toBe('lai-suat-thang-8');
  });
});

describe('isLocalePublished', () => {
  it('bản gốc đã đăng và đã tới mốc', () => {
    expect(isLocalePublished(base, [], undefined, now)).toBe(true);
  });

  it('bản gốc còn nháp', () => {
    expect(isLocalePublished({ ...base, status: 'draft' }, [], undefined, now)).toBe(false);
  });

  it('bản gốc đã đăng nhưng KHÔNG có mốc thì không hiện', () => {
    // Cùng luật với `publishedAt: { not: null, lte: now }` ở query-build: không có
    // ngày để so thì không khớp.
    expect(isLocalePublished({ ...base, publishedAt: null }, [], undefined, now)).toBe(false);
  });

  it('bản dịch đã đăng thì hiện', () => {
    expect(isLocalePublished(base, [en()], 'en', now)).toBe(true);
  });

  it('chưa có hàng cho ngôn ngữ đó thì KHÔNG hiện', () => {
    // Khác `localeSlug`: thiếu slug thì rơi về gốc được, còn thiếu trạng thái đăng
    // thì không được suy ra "đã đăng" — suy như vậy là công bố mọi bản dịch chưa
    // ai duyệt ngay lúc bật một ngôn ngữ mới.
    expect(isLocalePublished(base, [], 'en', now)).toBe(false);
  });

  it('bản dịch hẹn giờ chưa tới thì chưa hiện', () => {
    const row = en({ publishedAt: new Date('2026-08-29T00:00:00.000Z') });
    expect(isLocalePublished(base, [row], 'en', now)).toBe(false);
  });

  it('bản dịch đã đăng vẫn hiện khi BẢN GỐC còn nháp', () => {
    // Đây là điểm khác biệt cốt lõi của publish-theo-locale. Nếu test này đỏ thì
    // tính năng chỉ đúng một nửa: không thể tháo bản gốc xuống mà giữ bản dịch.
    const draftBase: EntryBaseState = { ...base, status: 'draft', publishedAt: null };
    expect(isLocalePublished(draftBase, [en()], 'en', now)).toBe(true);
  });

  it('bản gốc đã đăng KHÔNG kéo bản dịch lên sóng theo', () => {
    expect(isLocalePublished(base, [en({ status: 'draft' })], 'en', now)).toBe(false);
  });
});

describe('localePublishState', () => {
  it('chưa có hàng → missing', () => {
    expect(localePublishState(base, [], 'en', now)).toBe('missing');
  });

  it('nháp → draft', () => {
    expect(localePublishState(base, [en({ status: 'draft' })], 'en', now)).toBe('draft');
  });

  it('đã đăng nhưng không có mốc → draft', () => {
    expect(localePublishState(base, [en({ publishedAt: null })], 'en', now)).toBe('draft');
  });

  it('mốc ở tương lai → scheduled, KHÔNG phải live', () => {
    // "Đã hẹn giờ" và "đã lên sóng" cùng status='published'. Gộp chúng làm người
    // biên tập mở URL ra thấy 404 mà không hiểu vì sao.
    const row = en({ publishedAt: new Date('2026-08-29T00:00:00.000Z') });
    expect(localePublishState(base, [row], 'en', now)).toBe('scheduled');
  });

  it('mốc đã qua → live', () => {
    expect(localePublishState(base, [en()], 'en', now)).toBe('live');
  });

  it('không truyền locale thì đọc trạng thái của bản gốc', () => {
    expect(localePublishState(base, [], undefined, now)).toBe('live');
    expect(localePublishState({ ...base, status: 'draft' }, [], undefined, now)).toBe('draft');
  });
});
