import { describe, expect, it } from 'vitest';

import type { FieldDef } from './field-def';
import {
  availableColumns,
  columnFieldKeys,
  defaultColumnIds,
  formatCell,
  serializeColumnIds,
  visibleColumnIds,
} from './entry-columns';

const fields: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề' },
  { t: 'slug', key: 'slug', label: 'Slug', from: 'title' },
  { t: 'taxonomy', key: 'cats', label: 'Danh mục' },
  { t: 'taxonomy', key: 'tags', label: 'Tag', role: 'tag', multiple: true },
  { t: 'text', key: 'excerpt', label: 'Tóm tắt', multiline: true },
  { t: 'text', key: 'author_name', label: 'Tác giả' },
  { t: 'number', key: 'price', label: 'Giá', format: 'currencyVND' },
  { t: 'boolean', key: 'pinned', label: 'Ghim' },
  { t: 'enum', key: 'level', label: 'Mức', options: [{ value: 'a', label: 'Cơ bản' }] },
  { t: 'richtext', key: 'body', label: 'Thân bài' },
];

const cols = availableColumns(fields, { titleField: 'title', slugField: 'slug', locales: ['en'] });

describe('availableColumns', () => {
  it('mỗi field taxonomy một cột, rồi field đơn giản, trạng thái, ngôn ngữ, cập nhật', () => {
    expect(cols.map((c) => c.id)).toEqual([
      'tax:cats',
      'tax:tags',
      'field:author_name',
      'field:price',
      'field:pinned',
      'field:level',
      'status',
      'locale:en',
      'updated',
    ]);
    expect(cols.find((c) => c.id === 'tax:tags')).toMatchObject({ label: 'Tag', role: 'tag' });
  });

  it('không có tiêu đề, slug, chữ nhiều dòng hay richtext', () => {
    const ids = cols.map((c) => c.id);
    for (const k of ['title', 'slug', 'excerpt', 'body']) expect(ids).not.toContain(`field:${k}`);
  });

  it('chỉ kéo field của cột field', () => {
    expect(columnFieldKeys(cols)).toEqual(['author_name', 'price', 'pinned', 'level']);
  });
});

describe('visibleColumnIds', () => {
  it('chưa chọn → mặc định: mọi cột trừ cột field', () => {
    expect(visibleColumnIds(cols, undefined)).toEqual(defaultColumnIds(cols));
    expect(defaultColumnIds(cols)).toEqual(['tax:cats', 'tax:tags', 'status', 'locale:en', 'updated']);
  });

  it('giữ thứ tự của bảng, bỏ id lạ', () => {
    expect(visibleColumnIds(cols, serializeColumnIds(['updated', 'tax:tags', 'field:gone']))).toEqual([
      'tax:tags',
      'updated',
    ]);
  });

  it('chỉ còn id lạ → mặc định; tắt hết có chủ ý → không cột nào', () => {
    expect(visibleColumnIds(cols, 'field%3Agone')).toEqual(defaultColumnIds(cols));
    expect(visibleColumnIds(cols, serializeColumnIds([]))).toEqual([]);
  });

  it('cookie hỏng → mặc định', () => {
    expect(visibleColumnIds(cols, '%E0%A4%A')).toEqual(defaultColumnIds(cols));
  });
});

describe('formatCell', () => {
  const f = (k: string) => fields.find((x) => x.key === k)!;
  it('trống, có/không, tiền, lựa chọn', () => {
    expect(formatCell(f('author_name'), '')).toBe('—');
    expect(formatCell(f('pinned'), true)).toBe('Có');
    expect(formatCell(f('pinned'), false)).toBe('Không');
    expect(formatCell(f('price'), 1500000)).toMatch(/^1\.500\.000 ₫$/);
    expect(formatCell(f('level'), 'a')).toBe('Cơ bản');
  });
});
