import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENTRY_SORT,
  entrySortFromPrefs,
  entrySortOrderBy,
  isEntrySort,
  withEntrySort,
} from './entry-sort';

describe('entrySortFromPrefs', () => {
  it('chưa chọn gì → mặc định là ngày tạo', () => {
    expect(DEFAULT_ENTRY_SORT).toBe('created');
    expect(entrySortFromPrefs(undefined)).toBe('created');
    expect(entrySortFromPrefs(null)).toBe('created');
    expect(entrySortFromPrefs({})).toBe('created');
  });

  it('đọc lựa chọn đã lưu', () => {
    expect(entrySortFromPrefs({ entrySort: 'updated' })).toBe('updated');
    expect(entrySortFromPrefs({ entrySort: 'created' })).toBe('created');
  });

  it('giá trị lạ hoặc prefs hỏng → mặc định, không ném lỗi', () => {
    expect(entrySortFromPrefs({ entrySort: 'title' })).toBe('created');
    expect(entrySortFromPrefs('updated')).toBe('created');
    expect(entrySortFromPrefs([])).toBe('created');
  });
});

describe('isEntrySort', () => {
  it('chỉ nhận hai giá trị', () => {
    expect(isEntrySort('created')).toBe(true);
    expect(isEntrySort('updated')).toBe(true);
    expect(isEntrySort('publishedAt')).toBe(false);
    expect(isEntrySort(undefined)).toBe(false);
  });
});

describe('entrySortOrderBy', () => {
  it('mới nhất trước, id làm khoá phụ để thứ tự ổn định', () => {
    expect(entrySortOrderBy('created')).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(entrySortOrderBy('updated')).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
  });
});

describe('withEntrySort', () => {
  it('ghi đè đúng một khoá, giữ các tuỳ chọn khác', () => {
    expect(withEntrySort({ other: 1, entrySort: 'created' }, 'updated')).toEqual({ other: 1, entrySort: 'updated' });
  });

  it('prefs không phải object → bắt đầu từ object rỗng', () => {
    expect(withEntrySort(null, 'updated')).toEqual({ entrySort: 'updated' });
    expect(withEntrySort('x', 'created')).toEqual({ entrySort: 'created' });
    expect(withEntrySort([1], 'created')).toEqual({ entrySort: 'created' });
  });
});
