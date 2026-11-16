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
