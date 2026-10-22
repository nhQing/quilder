/**
 * Khoá field trong ĐIỀU KIỆN LỌC của khối lặp phải có thật.
 *
 * Anh em với `validate-repeat.test.ts` (khoá `map`) và hỏng theo đúng một kiểu,
 * nhưng nặng hơn: một khoá `map` sai cho ra thẻ mang chữ mẫu — xấu, mà nhìn là
 * biết. Một khoá `filter.field` sai cho ra `data.<khoá> = <giá trị>`, không hàng
 * nào khớp, và trang trả về DANH SÁCH RỖNG với đủ tiêu đề, đủ khung — tức là sai
 * mà trông như "chưa có bài nào".
 *
 * `filterToWhere` đọc `data: { path: [f.field] }`, tức CHỈ trong JSONB. Nên ở đây
 * KHÔNG có nhượng bộ `VIRTUAL_KEYS` như luật `map`: `slug`, `published_at`,
 * `taxonomy` là cột và bảng nối, `data.slug` không tồn tại.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    token: { findMany: vi.fn().mockResolvedValue([]) },
    collectionType: {
      findMany: vi.fn().mockResolvedValue([
        {
          key: 'news',
          schema: [
            { t: 'text', key: 'title', label: 'Tiêu đề' },
            { t: 'relation', key: 'category', label: 'Danh mục' },
          ],
        },
      ]),
    },
  },
}));

import { validateOps } from './validate';
import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

function doc(): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'Grid', parentId: null, children: ['inst'], effects: [], style: { base: {} } },
      inst: { id: 'inst', type: 'Instance', componentId: 'cmp1', overrides: {}, parentId: 'root', children: [], effects: [], style: { base: {} } },
    },
  } as unknown as Doc;
}

const withFilter = (filter: unknown) => [
  {
    op: 'setProps',
    nodeId: 'inst',
    props: {
      repeat: {
        source: { kind: 'query', query: { typeKey: 'news', limit: 10, filter } },
        map: { title: { nodeId: 'card__title', as: 'content' } },
      },
    },
  },
];

describe('validateOps — khoá field trong filter của khối lặp', () => {
  it('field có thật thì đi qua', async () => {
    const r = await validateOps(doc(), withFilter([{ k: 'field', field: 'title', op: 'eq', value: 'x' }]), 'human');
    expect(r.ok).toBe(true);
  });

  it('field ĐÃ BỊ XOÁ khỏi loại bị chặn — ca `taxonomy` của tin-tuc', async () => {
    const r = await validateOps(doc(), withFilter([{ k: 'field', field: 'taxonomy', op: 'eq', value: 'x' }]), 'human');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'repeat_filter_field')).toBe(true);
  });

  it('câu lỗi nêu field đang có, để người dựng sửa được ngay', async () => {
    const r = await validateOps(doc(), withFilter([{ k: 'field', field: 'taxonomy', op: 'eq', value: 'x' }]), 'human');
    const msg = (!r.ok && r.issues.find((i) => i.code === 'repeat_filter_field')?.message) || '';
    expect(msg).toContain('`title`');
    expect(msg).toContain('`category`');
  });

  it('lọc theo DANH MỤC (k: "taxonomy") không phải khoá field — vẫn đi qua', async () => {
    // `k` là discriminant của `zCollectionFilter`, không phải tên field. Nhầm hai
    // thứ này thì luật mới sẽ chặn đúng cách lọc danh mục mà /blogs/[slug] đang dùng.
    const r = await validateOps(doc(), withFilter([{ k: 'taxonomy', from: 'url' }]), 'human');
    expect(r.ok).toBe(true);
  });
});

/**
 * `sort.field` KHÔNG đối chiếu với field của collection — và đó là ĐÚNG.
 *
 * Báo cáo A2 đề nghị "kiểm trường có thật trong collection trước khi chấp nhận
 * `sort.field`". Làm thế sẽ từ chối MỌI khối lặp đang chạy, vì hai danh sách này
 * không phải một danh sách:
 *
 *   `SORTABLE_COLUMNS`   cột THẬT của bảng `Entry` — publishedAt, updatedAt,
 *                        createdAt, slug, viewCount
 *   `FieldDef[]`         field trong JSONB `Entry.data` — title, summary, …
 *
 * Prisma không `orderBy` được theo đường dẫn trong JSONB (đo trực tiếp, xem
 * docblock `SORTABLE_COLUMNS` ở `types.ts`), nên tập sắp-xếp-được BẮT BUỘC là tập
 * cột, và không cột nào trong đó có mặt trong schema của loại. Giao của hai tập là
 * RỖNG.
 *
 * Riêng `viewCount`: nó là cột thật — `prisma/schema.prisma` khai
 * `viewCount Int @default(0)` kèm index `[typeKey, status, viewCount(sort: Desc)]`,
 * và `entry-views.ts` ghi vào nó. Nó KHÔNG nullable. Triệu chứng "desc và asc cho
 * kết quả mâu thuẫn" là dấu hiệu của một tập dữ liệu mà mọi hàng đang bằng 0: khi
 * mọi khoá sắp bằng nhau, Postgres không hứa thứ tự nào cả, nên hai chiều trả về
 * hai thứ tự tuỳ ý. Đó là thiếu KHOÁ PHỤ trong `buildEntryFindArgs`
 * (`collections/query-build.ts`), không phải một lỗi của validator.
 *
 * Khoá phụ ấy ĐÃ được thêm ngày 14/09/2026 — xem `appendTieBreakers`. Kết luận ở
 * trên không đổi vì thế: `sort.field` vẫn không đối chiếu với field của collection,
 * và lý do vẫn là giao của hai tập rỗng.
 *
 * Test này tồn tại để lần sau không ai "sửa" A2 theo mô tả.
 */
describe('sort.field — cột của Entry, KHÔNG phải field của collection', () => {
  const withSort = (field: string) => [
    {
      op: 'setProps',
      nodeId: 'inst',
      props: {
        repeat: {
          source: {
            kind: 'query',
            query: { typeKey: 'news', limit: 10, sort: [{ field, dir: 'desc' }] },
          },
          map: { title: { nodeId: 'card__title', as: 'content' } },
        },
      },
    },
  ];

  it('viewCount đi qua — nó là cột thật của Entry, có index riêng', async () => {
    const r = await validateOps(doc(), withSort('viewCount'), 'human');
    expect(r.ok).toBe(true);
  });

  it('publishedAt đi qua dù loại `news` không khai field nào tên vậy', async () => {
    const r = await validateOps(doc(), withSort('publishedAt'), 'human');
    expect(r.ok).toBe(true);
  });

  it('`title` — field CÓ THẬT của loại — vẫn bị từ chối ở tầng enum', async () => {
    // Sắp theo một field trong JSONB là bất khả với Prisma, nên enum chặn từ đầu.
    // Đây là chiều ngược của cùng một luật: hai danh sách rời nhau hoàn toàn.
    const r = await validateOps(doc(), withSort('title'), 'human');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'repeat_shape')).toBe(true);
  });
});

/**
 * `k: 'relation'` — field phải có thật VÀ phải đúng là một `relation`.
 *
 * Cùng gốc với luật `k: 'field'` ở đầu file, nhưng nó cần một phép kiểm thứ hai:
 * điều kiện này sinh `data.<field>` so bằng một ID bản ghi, nên trỏ nó vào một
 * field `text` cho ra một `where` không hàng nào khớp — lại là danh sách RỖNG
 * dưới một tiêu đề còn nguyên, đúng hình dạng lỗi mà cả file này tồn tại để chặn.
 */
describe('validateOps — filter k:"relation"', () => {
  it('field relation có thật thì đi qua', async () => {
    const r = await validateOps(
      doc(), withFilter([{ k: 'relation', field: 'category', from: 'url' }]), 'human',
    );
    expect(r.ok).toBe(true);
  });

  it('field không tồn tại bị chặn', async () => {
    const r = await validateOps(
      doc(), withFilter([{ k: 'relation', field: 'chuyen_muc', from: 'url' }]), 'human',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'repeat_filter_field')).toBe(true);
  });

  it('field có thật nhưng KHÔNG phải relation bị chặn, và câu lỗi nói đúng lý do', async () => {
    const r = await validateOps(
      doc(), withFilter([{ k: 'relation', field: 'title', from: 'url' }]), 'human',
    );
    expect(r.ok).toBe(false);
    const msg = (!r.ok && r.issues.find((i) => i.code === 'repeat_filter_field')?.message) || '';
    expect(msg).toContain('`title`');
    expect(msg).toContain('relation');
  });

  it('from:"fixed" mà không có ids bị zod từ chối', async () => {
    const r = await validateOps(
      doc(), withFilter([{ k: 'relation', field: 'category', from: 'fixed' }]), 'human',
    );
    expect(r.ok).toBe(false);
  });

  it('from:"fixed" kèm ids đi qua', async () => {
    const r = await validateOps(
      doc(), withFilter([{ k: 'relation', field: 'category', from: 'fixed', ids: ['c1'] }]), 'human',
    );
    expect(r.ok).toBe(true);
  });
});
