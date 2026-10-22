import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lọc và sắp dải danh mục — mục F của bản yêu cầu từ Website-MM.
 *
 * Hai thứ ở đây dễ hỏng im lặng, nên chúng có test riêng thay vì trông vào test
 * đếm truy vấn ở `collection-page.test.ts`:
 *
 *  1. `minEntries` đếm từ `groupBy` chứ không từ `entries` đã nạp. Đếm nhầm nguồn
 *     thì một danh mục có 40 bài bị ẩn vì khối lặp chỉ nạp về 0 bài của nó.
 *  2. Mọi chiều sắp đều có khoá phụ. Không có nó thì hai danh mục cùng số bài đổi
 *     chỗ giữa hai lần tải trang, và không ai tái hiện được.
 */

const state = vi.hoisted(() => ({
  taxonomies: [] as { id: string; key: string; name: string }[],
  counts: [] as { taxonomyId: string; _count: { entryId: number } }[],
  /** `where` mà `taxonomy.findMany` nhận — để kiểm bộ lọc `published`. */
  lastTaxonomyWhere: null as unknown,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    taxonomy: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        state.lastTaxonomyWhere = args.where;
        return state.taxonomies;
      }),
    },
    entryTaxonomy: { groupBy: vi.fn(async () => state.counts) },
    entry: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));

import { taxonomyGroups } from './queries';

beforeEach(() => {
  state.taxonomies = [
    { id: 't1', key: 'chung', name: 'Chung' },
    { id: 't2', key: 'phi', name: 'Phí' },
    { id: 't3', key: 'uu-dai', name: 'Ưu đãi' },
  ];
  state.counts = [
    { taxonomyId: 't1', _count: { entryId: 5 } },
    { taxonomyId: 't2', _count: { entryId: 2 } },
    // t3 không có hàng nào — đúng hình dạng `groupBy` trả về cho một danh mục 0 bài.
  ];
  state.lastTaxonomyWhere = null;
});

const keys = (gs: { taxonomy: { key: string } }[]) => gs.map((g) => g.taxonomy.key);

describe('taxonomyGroups — lọc', () => {
  it('vắng bộ lọc thì KHÔNG lọc status — mọi khối đang chạy giữ nguyên hình dạng', async () => {
    const gs = await taxonomyGroups('faq', 5);
    expect(keys(gs)).toEqual(['chung', 'phi', 'uu-dai']);
    expect(state.lastTaxonomyWhere).toEqual({ typeKey: 'faq' });
  });

  it('published: true thêm điều kiện status vào truy vấn', async () => {
    await taxonomyGroups('faq', 5, undefined, { filter: { published: true } });
    expect(state.lastTaxonomyWhere).toEqual({ typeKey: 'faq', status: 'published' });
  });

  it('minEntries: 1 bỏ danh mục chưa có bài — "Ưu đãi" hiện tiêu đề với vùng thẻ trống', async () => {
    const gs = await taxonomyGroups('faq', 5, undefined, { filter: { minEntries: 1 } });
    expect(keys(gs)).toEqual(['chung', 'phi']);
  });

  it('đếm bằng groupBy, KHÔNG bằng số entry nạp về', async () => {
    // `entry.findMany` mock trả rỗng, nên `entries.length` là 0 cho mọi danh mục.
    // Đếm từ đó thì `minEntries: 1` sẽ ẩn cả ba — kể cả danh mục có 5 bài thật.
    const gs = await taxonomyGroups('faq', 5, undefined, { filter: { minEntries: 1 } });
    expect(gs.map((g) => g.entryCount)).toEqual([5, 2]);
    expect(gs.every((g) => g.entries.length === 0)).toBe(true);
  });
});

describe('taxonomyGroups — thứ tự', () => {
  it('count giảm dần: nhiều bài nhất lên trước', async () => {
    const gs = await taxonomyGroups('faq', 5, undefined, { sort: { field: 'count', dir: 'desc' } });
    expect(keys(gs)).toEqual(['chung', 'phi', 'uu-dai']);
  });

  it('count tăng dần đảo đúng chiều', async () => {
    const gs = await taxonomyGroups('faq', 5, undefined, { sort: { field: 'count', dir: 'asc' } });
    expect(keys(gs)).toEqual(['uu-dai', 'phi', 'chung']);
  });

  it('cùng số bài thì tên làm khoá phụ, không phải thứ tự tuỳ lượt', async () => {
    state.counts = [];
    const gs = await taxonomyGroups('faq', 5, undefined, { sort: { field: 'count', dir: 'desc' } });
    expect(keys(gs)).toEqual(['chung', 'phi', 'uu-dai']);
  });

  it('order giảm dần đảo đúng thứ tự người dựng kéo tay', async () => {
    const gs = await taxonomyGroups('faq', 5, undefined, { sort: { field: 'order', dir: 'desc' } });
    expect(keys(gs)).toEqual(['uu-dai', 'phi', 'chung']);
  });

  it('name dùng so sánh tiếng Việt, không phải thứ tự mã ký tự', async () => {
    // 'Ưu đãi' đứng sau 'Phí' theo bảng chữ cái tiếng Việt. So bằng mã ký tự thì
    // mọi chữ có dấu rơi xuống cuối, và danh sách trông như chưa được sắp.
    const gs = await taxonomyGroups('faq', 5, undefined, { sort: { field: 'name', dir: 'asc' } });
    expect(keys(gs)).toEqual(['chung', 'phi', 'uu-dai']);
  });
});
