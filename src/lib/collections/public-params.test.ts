import { describe, expect, it } from 'vitest';

import type { FieldDef } from './field-def';
import { MAX_PAGE_SIZE, parsePublicParams } from './public-params';
import { SORTABLE_COLUMNS } from './query-build';

const FIELDS: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề' },
  { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
  { t: 'boolean', key: 'pinned', label: 'Ghim' },
  { t: 'number', key: 'views', label: 'Lượt xem' },
  { t: 'relation', key: 'author', label: 'Tác giả', typeKey: 'team', cardinality: 'one' },
  { t: 'taxonomy', key: 'cats', label: 'Danh mục', multiple: true },
];

const p = (qs: string) => parsePublicParams(new URLSearchParams(qs), 'news', FIELDS);

describe('parsePublicParams', () => {
  it('mặc định: trang 1, 20 mục, sắp mới nhất trước, format json', () => {
    const r = p('');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.page).toBe(1);
    expect(r.params.pageSize).toBe(20);
    expect(r.params.query.sort).toEqual([{ field: 'publishedAt', dir: 'desc' }]);
    expect(r.params.format).toBe('json');
  });

  it('kẹp pageSize ở trần, không trả lỗi', () => {
    // Trả lỗi cho `pageSize=1000` làm một client gõ sai bị chặn hẳn; kẹp thì nó
    // vẫn chạy và vẫn không làm sập DB.
    const r = p('pageSize=1000');
    expect(r.ok && r.params.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('page và pageSize không phải số thì về mặc định', () => {
    const r = p('page=abc&pageSize=-5');
    expect(r.ok && r.params.page).toBe(1);
    expect(r.ok && r.params.pageSize).toBe(20);
  });

  it('skip tính từ page, không nhận trực tiếp từ client', () => {
    const r = p('page=3&pageSize=10');
    expect(r.ok && r.params.query.skip).toBe(20);
    expect(r.ok && r.params.query.limit).toBe(10);
  });

  it('client gửi skip thì nó bị BỎ QUA — chỉ page quyết định vị trí', () => {
    const r = p('page=1&pageSize=10&skip=500');
    expect(r.ok && r.params.query.skip).toBe(0);
  });

  it('sort CHỈ nhận cột thật, không nhận field trong schema', () => {
    // Prisma không `orderBy` được theo đường dẫn bên trong JSONB — đo trực tiếp ra
    // "Argument `data`: Invalid value provided. Expected SortOrder, provided
    // Object". `where` làm được, `orderBy` thì không; xem `query-build.ts`
    // `SORTABLE_COLUMNS`. Nên field khai trong schema (như `title`) không sắp
    // được, dù client tưởng hợp lý — phải TỪ CHỐI, không phải âm thầm bỏ qua.
    const bad = p('sort=title:asc');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('publishedAt');
    expect(p('sort=updatedAt:desc').ok).toBe(true);
    expect(p('sort=slug:asc').ok).toBe(true);
    const badPath = p('sort=data->>"x":asc');
    expect(badPath.ok).toBe(false);
  });

  it('danh sách cột sắp xếp được LẤY TỪ query-build, không phải bản sao thứ ba', () => {
    // Ba danh sách trắng cho một khái niệm nghĩa là nới một bên thì hai bên kia từ
    // chối im lặng. Test này đỏ ngay nếu có người chép lại danh sách vào file này.
    for (const col of SORTABLE_COLUMNS) {
      expect(p(`sort=${col}:asc`).ok, `${col} phải sắp được`).toBe(true);
    }
  });

  it('sort sai chiều thì bị từ chối, không âm thầm dùng desc', () => {
    expect(p('sort=title:sideways').ok).toBe(false);
  });

  it('filter[field][op]=value thành CollectionFilter có thẻ', () => {
    const r = p('filter[pinned][eq]=true');
    expect(r.ok && r.params.query.filter).toEqual([
      { k: 'field', field: 'pinned', op: 'eq', value: true },
    ]);
  });

  it('ép kiểu giá trị theo kiểu field, không phải theo hình dạng chuỗi', () => {
    // 'true' cho field text phải là CHỮ "true", không phải boolean.
    const r = p('filter[title][eq]=true');
    expect(r.ok && r.params.query.filter?.[0]).toEqual({ k: 'field', field: 'title', op: 'eq', value: 'true' });
    const n = p('filter[views][gte]=100');
    expect(n.ok && n.params.query.filter?.[0]).toEqual({ k: 'field', field: 'views', op: 'gte', value: 100 });
  });

  it('từ chối field không có trong schema', () => {
    const r = p('filter[khong_co][eq]=1');
    expect(r.ok).toBe(false);
  });

  it('từ chối toán tử lạ — bỏ qua nó là trả về NHIỀU HƠN yêu cầu', () => {
    // `filterToWhere` trả `null` cho op lạ và `buildEntryFindArgs` lọc bỏ `null`,
    // nên một op lọt qua đây làm điều kiện biến mất chứ không làm truy vấn hỏng.
    // Ở API công khai, "nhiều hơn yêu cầu" là rò dữ liệu.
    const r = p('filter[title][regex]=.*');
    expect(r.ok).toBe(false);
  });

  it('taxonomy đi bằng KHOÁ, không phải id — id là cuid, không ai gõ được', () => {
    const r = p('taxonomy=tin-thi-truong');
    expect(r.ok && r.params.taxonomyKey).toBe('tin-thi-truong');
    expect(r.ok && r.params.query.filter).toEqual([{ k: 'taxonomy', from: 'url' }]);
  });

  it('populate là danh sách trắng theo field relation — CHỈ relation', () => {
    expect(p('populate=author').ok).toBe(true);
    expect(p('populate=author,title').ok).toBe(false);
  });

  it('populate một field taxonomy bị TỪ CHỐI, không phải nhận rồi không làm gì', () => {
    // Đo ngày 28/08/2026: `?populate=cats` trả 200 và không đổi gì, vì `applyPopulate`
    // chỉ xử lý `relation`. "Nhận rồi im lặng bỏ qua" là đúng thứ mà luật của file này
    // cấm với `sort` và `filter` — không có lý do để taxonomy là ngoại lệ.
    const bad = p('populate=cats');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('relation');
  });

  it('populate quá 5 mục bị từ chối', () => {
    expect(p('populate=author,author,author,author,author,author').ok).toBe(false);
  });

  it('fields là danh sách trắng theo schema', () => {
    const r = p('fields=title,views');
    expect(r.ok && r.params.fields).toEqual(['title', 'views']);
    expect(p('fields=title,khong-co').ok).toBe(false);
  });

  it('không có fields thì là undefined — nghĩa là MỌI field', () => {
    const r = p('');
    expect(r.ok && r.params.fields).toBeUndefined();
  });

  it('fields chỉ gồm khoá hệ thống thành mảng RỖNG, khác hẳn undefined', () => {
    // `?fields=id,slug` là "chỉ xin khoá hệ thống" — một client đồng bộ danh sách id
    // không cần nội dung. Biến nó thành `undefined` là trả về cả thân bài.
    const r = p('fields=id,slug');
    expect(r.ok && r.params.fields).toEqual([]);
  });

  it('fields KHÔNG nhận field taxonomy — nó không có khoá trong data', () => {
    const bad = p('fields=title,cats');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('taxonomies');
  });

  it('populate một field không nằm trong fields là mâu thuẫn, phải 400', () => {
    // Tự thêm vào `fields` là trả nhiều hơn client hỏi; bỏ qua là trả ít hơn, im lặng.
    const bad = p('fields=title&populate=author');
    expect(bad.ok).toBe(false);
    expect(p('fields=title,author&populate=author').ok).toBe(true);
  });

  it('format chỉ nhận json hoặc html', () => {
    expect(p('format=html').ok).toBe(true);
    expect(p('format=xml').ok).toBe(false);
  });

  it('mã ngôn ngữ đi qua danh sách hình dạng, không phải chuỗi tuỳ ý', () => {
    expect(p('locale=vi').ok).toBe(true);
    expect(p('locale=en-US').ok).toBe(true);
    expect(p('locale=../../etc').ok).toBe(false);
  });

  it('filter theo field slug bị TỪ CHỐI — nó chỉ đúng một phần', () => {
    // Slug hiệu lực ở CỘT `Entry.slug`; `data.slug` chỉ có khi người ta gõ tay. Nên
    // filter JSONB khớp một số bài và bỏ sót số còn lại — loại lỗi không ai phát hiện,
    // vì nó luôn trả về "một ít" kết quả.
    const bad = p('filter[slug][eq]=lai-suat-thang-8');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('sort=slug');
  });

  it('nhiều filter nối AND, giữ thứ tự khai báo', () => {
    const r = p('filter[pinned][eq]=true&filter[views][gt]=10');
    expect(r.ok && r.params.query.filter).toHaveLength(2);
  });
});
