import { describe, expect, it } from 'vitest';

import type { FieldDef } from './field-def';
import { checkTaxonomyPicks, fieldOfTaxonomy, inPool, poolWhere, roleOf, taxonomyRole } from './taxonomy-fields';
import { VIRTUAL_KEYS } from './repeat';

/** Loại Tin tức sau 17/11/2026: Group của Strapi → `cats`, Category → `tags`. */
const news: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề' },
  { t: 'taxonomy', key: 'cats', label: 'Danh mục', required: true, multiple: true },
  { t: 'taxonomy', key: 'tags', label: 'Tag', role: 'tag', multiple: true },
];

describe('field phân loại', () => {
  it('fieldKey null = field phân loại đầu tiên (mọi hàng có từ trước)', () => {
    expect(fieldOfTaxonomy(news, null)?.key).toBe('cats');
    expect(fieldOfTaxonomy(news, 'tags')?.key).toBe('tags');
    expect(fieldOfTaxonomy(news, 'da-xoa')).toBeUndefined();
  });

  it('vai trò: mặc định Danh mục, `role: tag` là Tag', () => {
    expect(roleOf(news[1] as never)).toBe('category');
    expect(taxonomyRole(news, 'tags')).toBe('tag');
    expect(taxonomyRole(news, null)).toBe('category');
  });

  it('inPool phân đúng mục vào từng ô', () => {
    const cats = news[1] as never;
    expect(inPool(news, cats, null)).toBe(true);
    expect(inPool(news, cats, 'tags')).toBe(false);
  });

  it('poolWhere của danh mục gồm cả hàng cũ (fieldKey null), của tag thì không', () => {
    expect(poolWhere(news, (f) => roleOf(f) === 'category')).toEqual({
      OR: [{ fieldKey: { in: ['cats'] } }, { fieldKey: null }],
    });
    expect(poolWhere(news, (f) => roleOf(f) === 'tag')).toEqual({ OR: [{ fieldKey: { in: ['tags'] } }] });
    expect(poolWhere(news, (f) => f.key === 'khong-co')).toBeNull();
  });
});

describe('checkTaxonomyPicks — theo TỪNG field', () => {
  it('chỉ gắn tag thì ô Danh mục bắt buộc vẫn thiếu', () => {
    const r = checkTaxonomyPicks(news, [{ id: 't1', fieldKey: 'tags' }]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('Danh mục');
  });

  it('một danh mục là đủ, tag tuỳ chọn', () => {
    expect(checkTaxonomyPicks(news, [{ id: 'c1', fieldKey: null }]).ok).toBe(true);
  });

  it('`multiple: false` chặn chọn hai mục trong cùng ô', () => {
    const one: FieldDef[] = [{ t: 'taxonomy', key: 'place', label: 'Nơi tổ chức', multiple: false }];
    const r = checkTaxonomyPicks(one, ['a', 'b']);
    expect(r.ok === false && r.error).toContain('chỉ được chọn một');
  });
});

describe('khoá ảo danh mục / tag trên thẻ tin', () => {
  const item = {
    key: 'e1',
    data: {},
    taxonomies: [
      { key: 'dau-tu', name: 'Đầu tư', tag: true },
      { key: 'tin-tuc-thi-truong', name: 'Tin Tức Thị Trường' },
    ],
  };

  it('`taxonomy` bỏ qua tag, `tag` lấy tag', () => {
    expect(VIRTUAL_KEYS.taxonomy!.read(item)).toBe('Tin Tức Thị Trường');
    expect(VIRTUAL_KEYS.tag!.read(item)).toBe('Đầu tư');
    expect(VIRTUAL_KEYS.tags!.read(item)).toBe('Đầu tư');
    expect(VIRTUAL_KEYS.taxonomies!.read(item)).toBe('Tin Tức Thị Trường');
  });

  it('bài chưa có tag thì nhãn rơi về danh mục, không về chữ mẫu', () => {
    expect(VIRTUAL_KEYS.tag!.read({ key: 'e2', data: {}, taxonomies: [{ key: 'uu-dai', name: 'Ưu đãi' }] })).toBe('Ưu đãi');
  });
});
