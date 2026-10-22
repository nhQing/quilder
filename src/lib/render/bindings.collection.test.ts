import { describe, expect, it } from 'vitest';

import { formatBinding } from './bindings';

const scope = {
  site: { phone: '1900' },
  page: { title: 'Trang' },
  collection: {
    title: 'Lãi suất tháng 8',
    views: 1234,
    published_at: '2026-08-15T00:00:00.000Z',
    author: { name: 'Mads' },
    tags: ['a', 'b'],
  },
};

describe('formatBinding — nguồn collection', () => {
  it('đọc field của item đang lặp', () => {
    expect(formatBinding({ source: 'collection', path: 'title' }, 'thay thế', scope)).toBe(
      'Lãi suất tháng 8',
    );
  });

  it('bỏ tiền tố nguồn nếu tác giả viết kèm', () => {
    expect(formatBinding({ source: 'collection', path: 'collection.title' }, 'x', scope)).toBe(
      'Lãi suất tháng 8',
    );
  });

  it('đọc được đường dẫn lồng', () => {
    expect(formatBinding({ source: 'collection', path: 'author.name' }, 'x', scope)).toBe('Mads');
  });

  it('đọc được chỉ số mảng', () => {
    // `readPath` trước đây cố ý không hỗ trợ chỉ số mảng vì "collection chưa dùng
    // tới". Giờ dùng tới: một field `group` repeatable là một mảng.
    expect(formatBinding({ source: 'collection', path: 'tags.0' }, 'x', scope)).toBe('a');
    expect(formatBinding({ source: 'collection', path: 'tags.1' }, 'x', scope)).toBe('b');
  });

  it('chỉ số ngoài mảng trả fallback, không trả "undefined"', () => {
    expect(formatBinding({ source: 'collection', path: 'tags.9' }, 'thay thế', scope)).toBe('thay thế');
    expect(formatBinding({ source: 'collection', path: 'tags.x' }, 'thay thế', scope)).toBe('thay thế');
  });

  it('format số và ngày dùng đúng bộ có sẵn', () => {
    expect(formatBinding({ source: 'collection', path: 'views', format: 'number' }, 'x', scope)).toBe(
      '1.234',
    );
    expect(
      formatBinding({ source: 'collection', path: 'published_at', format: 'date' }, 'x', scope),
    ).toContain('2026');
  });

  it('không có ngữ cảnh collection thì trả fallback, không trả "undefined"', () => {
    expect(
      formatBinding({ source: 'collection', path: 'title' }, 'thay thế', { site: {}, page: {} }),
    ).toBe('thay thế');
  });

  it('field không tồn tại trả fallback', () => {
    expect(formatBinding({ source: 'collection', path: 'khong_co' }, 'thay thế', scope)).toBe(
      'thay thế',
    );
  });

  it('nguồn site và page vẫn chạy y như cũ', () => {
    expect(formatBinding({ source: 'site', path: 'phone' }, 'x', scope)).toBe('1900');
    expect(formatBinding({ source: 'page', path: 'title' }, 'x', scope)).toBe('Trang');
  });
});
