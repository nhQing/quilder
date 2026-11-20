import { describe, expect, it } from 'vitest';

import type { FieldDef } from './field-def';
import {
  assetIdOf,
  availableColumns,
  columnFieldKeys,
  defaultColumnIds,
  formatCell,
  imageFieldKeys,
  pickEntryImage,
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
  it('mỗi field taxonomy một cột, rồi field đơn giản, trạng thái, ngôn ngữ, ngày tạo, cập nhật', () => {
    expect(cols.map((c) => c.id)).toEqual([
      'tax:cats',
      'tax:tags',
      'field:author_name',
      'field:price',
      'field:pinned',
      'field:level',
      'status',
      'locale:en',
      'created',
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
    expect(defaultColumnIds(cols)).toEqual(['tax:cats', 'tax:tags', 'status', 'locale:en', 'created', 'updated']);
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

describe('cột ảnh', () => {
  const fields = [
    { t: 'text', key: 'title', label: 'Tiêu đề' },
    { t: 'image', key: 'cover', label: 'Ảnh bìa' },
    { t: 'image', key: 'background', label: 'Ảnh nền' },
    { t: 'image', key: 'thumbnail', label: 'Ảnh thu nhỏ' },
  ] as FieldDef[];
  const assets = {
    a1: { url: 'https://cdn/x/cover.jpg', mime: 'image/jpeg' },
    a2: { url: 'https://cdn/x/thumb.webp', mime: 'image/webp' },
    v1: { url: 'https://cdn/x/clip.mp4', mime: 'video/mp4' },
  };

  it('field ảnh, thumbnail lên trước, còn lại theo thứ tự khai', () => {
    expect(imageFieldKeys(fields)).toEqual(['thumbnail', 'cover', 'background']);
  });

  it('loại không có field ảnh thì không có cột', () => {
    expect(imageFieldKeys([{ t: 'text', key: 'title', label: 'T' }] as FieldDef[])).toEqual([]);
  });

  it('assetIdOf đọc { assetId } và bỏ qua giá trị khác', () => {
    expect(assetIdOf({ assetId: 'a1', alt: 'x' })).toBe('a1');
    expect(assetIdOf('a1')).toBeNull();
    expect(assetIdOf(null)).toBeNull();
    expect(assetIdOf({ assetId: '' })).toBeNull();
  });

  it('lấy ảnh đầu tiên có file, ưu tiên thumbnail', () => {
    const row = { cover: { assetId: 'a1', alt: 'Bìa' }, thumbnail: { assetId: 'a2', alt: 'Nhỏ' } };
    expect(pickEntryImage(row, imageFieldKeys(fields), assets)).toEqual({
      url: 'https://cdn/x/thumb.webp', mime: 'image/webp', alt: 'Nhỏ',
    });
  });

  it('thumbnail trống thì rơi về ảnh bìa', () => {
    expect(pickEntryImage({ cover: { assetId: 'a1' } }, imageFieldKeys(fields), assets)?.url).toBe('https://cdn/x/cover.jpg');
  });

  it('bỏ qua video và asset đã xoá, sang field kế tiếp', () => {
    const row = { thumbnail: { assetId: 'gone' }, cover: { assetId: 'v1' }, background: { assetId: 'a1' } };
    expect(pickEntryImage(row, imageFieldKeys(fields), assets)?.url).toBe('https://cdn/x/cover.jpg');
  });

  it('không có ảnh nào thì null', () => {
    expect(pickEntryImage({}, imageFieldKeys(fields), assets)).toBeNull();
  });
});
