import { describe, expect, it } from 'vitest';

import { resolveHiddenValue } from './form-hidden';

const scope = {
  collection: { title: 'The Money Date Hà Nội', slug: 'the-money-date-ha-noi' },
  page: { slug: 'events/[slug]' },
};

describe('resolveHiddenValue', () => {
  it('thay tên và slug của bài đang mở', () => {
    expect(resolveHiddenValue('{entry.title}', scope)).toBe('The Money Date Hà Nội');
    expect(resolveHiddenValue('su-kien:{entry.slug}', scope)).toBe('su-kien:the-money-date-ha-noi');
  });
  it('đường dẫn trang thay đoạn động bằng slug bài', () => {
    expect(resolveHiddenValue('{page.path}', scope)).toBe('/events/the-money-date-ha-noi');
  });
  it('trang thường không có bài → chỗ giữ chỗ thành rỗng, chữ khác giữ nguyên', () => {
    expect(resolveHiddenValue('website {entry.title}', { page: { slug: 'gioi-thieu' } })).toBe('website ');
    expect(resolveHiddenValue('{page.path}', { page: { slug: 'gioi-thieu' } })).toBe('/gioi-thieu');
  });
  it('rỗng / vắng → rỗng', () => {
    expect(resolveHiddenValue(undefined, scope)).toBe('');
  });
});

/*
 * 20/11/2026: form đăng ký trên `/en/events/the-art-of-wealth` gửi `page` =
 * `/events/the-art-of-wealth`, mất tiền tố `/en`. Gói MaiMoney suy ngôn ngữ từ ô này,
 * nên câu báo lỗi và email xác nhận ra tiếng Việt cho khách ở trang tiếng Anh.
 */
describe('{page.path} theo ngôn ngữ đang phục vụ', () => {
  const en = { code: 'en', isDefault: false, codes: ['vi', 'en'], defaultCode: 'vi' };
  const vi = { code: 'vi', isDefault: true, codes: ['vi', 'en'], defaultCode: 'vi' };

  it('trang tiếng Anh mang tiền tố /en', () => {
    expect(resolveHiddenValue('{page.path}', { ...scope, locale: en })).toBe('/en/events/the-money-date-ha-noi');
  });

  it('ngôn ngữ mặc định không có tiền tố', () => {
    expect(resolveHiddenValue('{page.path}', { ...scope, locale: vi })).toBe('/events/the-money-date-ha-noi');
  });

  it('trang chủ tiếng Anh là /en, không phải /en/', () => {
    expect(resolveHiddenValue('{page.path}', { page: { slug: '' }, locale: en })).toBe('/en');
  });

  it('chỉ {page.path} đổi theo ngôn ngữ, {entry.slug} giữ nguyên', () => {
    expect(resolveHiddenValue('{entry.slug}', { ...scope, locale: en })).toBe('the-money-date-ha-noi');
  });
});
