import { describe, expect, it } from 'vitest';

import type { FieldDef } from './field-def';
import {
  describeFilter,
  filterableFields,
  MAX_FILTERS,
  parseFilters,
  serializeFilter,
  type FilterField,
} from './entry-filters';
import { entryFilterWhere } from './entry-filter-where';

const FIELDS: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề', required: true },
  { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
  { t: 'html', key: 'body', label: 'Nội dung' },
  { t: 'image', key: 'thumbnail', label: 'Ảnh nhỏ' },
  { t: 'number', key: 'views', label: 'Lượt xem' },
  { t: 'date', key: 'eventDate', label: 'Ngày diễn ra' },
  { t: 'boolean', key: 'featured', label: 'Nổi bật' },
  { t: 'enum', key: 'kind', label: 'Loại', options: [{ value: 'a', label: 'Loại A' }] },
  { t: 'taxonomy', key: 'category', label: 'Danh mục' },
  { t: 'taxonomy', key: 'tags', label: 'Tag', multiple: true },
  { t: 'seo', key: 'seo', label: 'SEO' },
] as FieldDef[];

const CTX = {
  taxonomies: [
    { id: 't1', name: 'Thị trường', parentId: null, fieldKey: null },
    { id: 't2', name: 'Cổ phiếu', parentId: 't1', fieldKey: 'category' },
    { id: 't3', name: 'quỹ mở', parentId: null, fieldKey: 'tags' },
  ],
  writers: [{ email: 'a@x.vn', name: 'An' }],
};

const ff = filterableFields(FIELDS, CTX);
const byId = (id: string) => ff.find((f) => f.id === id) as FilterField;

describe('filterableFields — thứ lọc được suy từ cấu trúc', () => {
  it('field hệ thống đứng trước, seo bị bỏ', () => {
    expect(ff.slice(0, 5).map((f) => f.id)).toEqual([
      'sys:author', 'sys:editor', 'sys:created', 'sys:updated', 'sys:published',
    ]);
    expect(ff.some((f) => f.fieldKey === 'seo')).toBe(false);
  });

  it('mỗi kiểu field ra đúng loại bộ lọc', () => {
    expect(byId('field:title').kind).toBe('text');
    expect(byId('field:body').kind).toBe('longtext');
    expect(byId('field:thumbnail').kind).toBe('presence');
    expect(byId('field:views').kind).toBe('number');
    expect(byId('field:eventDate').kind).toBe('date');
    expect(byId('field:featured').kind).toBe('boolean');
    expect(byId('field:kind').options).toEqual([{ value: 'a', label: 'Loại A' }]);
  });

  it('mục phân loại fieldKey null thuộc field taxonomy ĐẦU TIÊN', () => {
    expect(byId('tax:category').options?.map((o) => o.value)).toEqual(['t1', 't2']);
    expect(byId('tax:tags').options?.map((o) => o.value)).toEqual(['t3']);
  });

  it('không có tài khoản nào thì không có bộ lọc tác giả', () => {
    expect(filterableFields(FIELDS, { ...CTX, writers: [] }).some((f) => f.kind === 'person')).toBe(false);
  });
});

describe('parseFilters — đọc URL, bỏ điều kiện hỏng', () => {
  it('đọc và ghi lại được, giá trị chứa | vẫn nguyên', () => {
    const raw = serializeFilter({ id: 'field:title', op: 'contains', value: 'a|b' });
    expect(parseFilters(raw, ff)).toEqual([{ id: 'field:title', op: 'contains', value: 'a|b' }]);
  });

  it('bỏ field lạ, phép không hợp loại, giá trị sai; giữ cái đúng', () => {
    const got = parseFilters(
      [
        'field:gone|eq|x',
        'field:views|contains|1',
        'field:views|gt|abc',
        'field:eventDate|gte|23/11/2026',
        'field:kind|eq|z',
        'sys:author|eq|la@x.vn',
        'field:title|contains|',
        'field:views|gt|10',
      ],
      ff,
    );
    expect(got).toEqual([{ id: 'field:views', op: 'gt', value: '10' }]);
  });

  it('phép không cần giá trị thì bỏ giá trị; trùng thì giữ một', () => {
    expect(parseFilters(['field:thumbnail|empty|rác', 'field:thumbnail|empty|'], ff)).toEqual([
      { id: 'field:thumbnail', op: 'empty', value: '' },
    ]);
  });

  it(`tối đa ${MAX_FILTERS} điều kiện`, () => {
    const many = Array.from({ length: 15 }, (_, i) => `field:title|contains|${i}`);
    expect(parseFilters(many, ff)).toHaveLength(MAX_FILTERS);
  });

  it('không có tham số thì không có điều kiện', () => {
    expect(parseFilters(undefined, ff)).toEqual([]);
  });
});

describe('describeFilter — chữ trên chip', () => {
  it('tên mục / người thay cho id, ngày theo kiểu Việt Nam', () => {
    expect(describeFilter({ id: 'tax:category', op: 'has', value: 't2' }, ff)).toBe('Danh mục có Cổ phiếu');
    expect(describeFilter({ id: 'sys:created', op: 'gte', value: '2026-11-01' }, ff)).toBe(
      'Ngày tạo từ ngày 01/11/2026',
    );
    expect(describeFilter({ id: 'field:thumbnail', op: 'empty', value: '' }, ff)).toBe('Ảnh nhỏ trống');
    expect(describeFilter({ id: 'field:title', op: 'contains', value: 'quỹ' }, ff)).toBe('Tiêu đề chứa "quỹ"');
  });
});

describe('entryFilterWhere — điều kiện ra truy vấn', () => {
  it('tác giả và ngày đi vào where Prisma; ngày tính theo giờ Việt Nam, "đến ngày" trọn ngày', () => {
    const w = entryFilterWhere(
      [
        { id: 'sys:author', op: 'eq', value: 'a@x.vn' },
        { id: 'sys:editor', op: 'ne', value: 'a@x.vn' },
        { id: 'sys:created', op: 'gte', value: '2026-11-01' },
        { id: 'sys:published', op: 'lte', value: '2026-11-23' },
      ],
      ff,
      'category',
    );
    expect(w.sql).toEqual([]);
    expect(w.and).toEqual([
      { createdBy: 'a@x.vn' },
      { updatedBy: { not: 'a@x.vn' } },
      { createdAt: { gte: new Date('2026-10-31T17:00:00Z') } },
      { publishedAt: { lt: new Date('2026-11-23T17:00:00Z') } },
    ]);
  });

  it('taxonomy: "trống" ở field đầu tiên tính cả mục fieldKey null', () => {
    const w = entryFilterWhere(
      [
        { id: 'tax:category', op: 'empty', value: '' },
        { id: 'tax:tags', op: 'has', value: 't3' },
      ],
      ff,
      'category',
    );
    expect(w.and).toEqual([
      { taxonomies: { none: { taxonomy: { OR: [{ fieldKey: 'category' }, { fieldKey: null }] } } } },
      { taxonomies: { some: { taxonomyId: 't3' } } },
    ]);
  });

  it('giá trị người gõ đi vào SQL dưới dạng THAM SỐ, ký tự đại diện LIKE bị thoát', () => {
    const w = entryFilterWhere([{ id: 'field:title', op: 'contains', value: "50%_'; DROP" }], ff, null);
    expect(w.sql).toHaveLength(1);
    const q = w.sql[0]!;
    expect(q.text).not.toContain('DROP');
    expect(q.values).toContain('title');
    expect(q.values).toContain("%50\\%\\_'; DROP%");
  });

  it('slug đọc cột slug; số chỉ so giá trị kiểu số; ảnh trống nhìn assetId', () => {
    const w = entryFilterWhere(
      [
        { id: 'field:slug', op: 'eq', value: 'abc' },
        { id: 'field:views', op: 'gt', value: '10' },
        { id: 'field:thumbnail', op: 'empty', value: '' },
        { id: 'field:thumbnail', op: 'filled', value: '' },
      ],
      ff,
      null,
    );
    const [slug, views, empty, filled] = w.sql.map((s) => s.text);
    expect(slug).toMatch(/lower\(btrim\(slug\)\)/);
    expect(views).toMatch(/jsonb_typeof\(data -> \$\d\) = 'number'/);
    expect(views).toMatch(/\) > \$\d/);
    expect(w.sql[1]!.values).toContain(10);
    expect(empty).toMatch(/assetId/);
    expect(filled).toMatch(/^NOT /);
  });
});
