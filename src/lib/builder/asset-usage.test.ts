import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `listAssetsWithUsage` — nửa ĐI TỚI NGƯỜI DÙNG của phép đếm asset.
 *
 * ## Vì sao có test này khi `asset-refs.test.ts` đã đếm đúng
 *
 * `asset-refs.test.ts` chứng minh `assetUsesInDoc(doc, components)` đếm được ảnh nằm
 * trong cây component. Nó KHÔNG chứng minh được điều người dùng thật sự thấy, vì chỗ
 * gọi duy nhất (`listAssetsWithUsage`) từng bỏ quên tham số thứ hai — phép duyệt đúng,
 * màn `/builder/assets` vẫn nói sai.
 *
 * Và đây là nửa nguy hiểm nhất của phép đếm: một ảnh CHỈ dùng bên trong một component
 * thì không doc nào mang id của nó, nên nó bị kê "không ai dùng" trên MỌI trang — rồi
 * có người tin con số đó và bấm xoá. Mất dữ liệu, không khôi phục được.
 *
 * Nên test này đi qua hàm thật, với Prisma giả, và đo đúng hai con số mà màn ảnh hiện:
 * `useCount` của từng ảnh và `unused` của cả kho.
 */

type Args = Record<string, unknown>;

const ALL_ASSET_IDS = ['logo-trong-component', 'that-su-khong-ai-dung'];

const asset = (id: string) => ({
  id,
  key: `k/${id}`,
  url: `/u/${id}`,
  mime: 'image/png',
  width: 10,
  height: 10,
  bytes: 100,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  folder: null,
});

const base = (id: string, extra: Record<string, unknown>) => ({
  id,
  parentId: null,
  children: [],
  effects: [],
  style: { base: {} },
  ...extra,
});

/**
 * Trang KHÔNG mang id ảnh nào. Ảnh duy nhất nó hiện nằm trong cây component `card`.
 * Đây đúng là hình dạng mà bản cũ báo "không ai dùng".
 */
const pageDoc = () => ({
  schemaVersion: 1,
  rootId: 'root',
  nodes: {
    root: base('root', { type: 'Section', children: ['i1'] }),
    i1: base('i1', { type: 'Instance', componentId: 'card', overrides: {}, children: [] }),
  },
});

const presetFindMany = vi.fn(async (_a: Args): Promise<unknown> => [
  {
    id: 'card',
    tree: {
      rootId: 'c-root',
      nodes: {
        'c-root': base('c-root', { type: 'Section', children: ['c-logo'] }),
        'c-logo': base('c-logo', { type: 'Image', assetId: 'logo-trong-component' }),
      },
    },
  },
]);

const pageFindMany = vi.fn(async (_a: Args): Promise<unknown> => [
  {
    id: 'p1',
    slug: 'trang-chu',
    title: 'Trang chủ',
    draftVersion: { doc: pageDoc() },
  },
]);

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    asset: {
      findMany: vi.fn(async () => ALL_ASSET_IDS.map(asset)),
      aggregate: vi.fn(async () => ({ _count: { _all: 2 }, _sum: { bytes: 200 } })),
      // Đếm THẬT theo `notIn`, không trả hằng số: con số `unused` là thứ đang được
      // kiểm, nên một mock trả sẵn sẽ làm test xanh dù hàm sai.
      //
      // Tìm nhánh `notIn` bằng thuộc tính `id`, không bằng chỉ số cố định: `AND` giờ
      // gồm folder + tìm kiếm + notIn (ba nhánh), và số nhánh trước `notIn` có thể
      // đổi mà không ảnh hưởng gì tới thứ test này đang kiểm.
      count: vi.fn(async (a: { where: { AND: unknown[] } }) => {
        const clause = a.where.AND.find(
          (c): c is { id: { notIn: string[] } } =>
            typeof c === 'object' && c !== null && 'id' in c,
        );
        const notIn = clause!.id.notIn;
        return ALL_ASSET_IDS.filter((id) => !notIn.includes(id)).length;
      }),
    },
    page: { findMany: (a: Args) => pageFindMany(a) },
    preset: { findMany: (a: Args) => presetFindMany(a) },
  },
}));

import { listAssetsWithUsage } from './asset-usage';

beforeEach(() => {
  presetFindMany.mockClear();
  pageFindMany.mockClear();
});

describe('listAssetsWithUsage — ảnh chỉ nằm trong component', () => {
  it('đếm được, không bị kê là "không ai dùng"', async () => {
    const out = await listAssetsWithUsage();
    const logo = out.assets.find((a) => a.id === 'logo-trong-component')!;

    expect(logo.useCount).toBe(1);
    expect(logo.usedBy.map((u) => u.slug)).toEqual(['trang-chu']);
    // Node trỏ tới ảnh là node INSTANCE trên trang — đó là thứ người dùng bấm được,
    // không phải node bên trong cây component (id của nó không tồn tại trong doc).
    expect(logo.usedBy[0]!.nodeIds).toEqual(['i1']);
  });

  it('`unused` chỉ đếm ảnh thật sự không ai dùng', async () => {
    const out = await listAssetsWithUsage();
    expect(out.unused).toBe(1);
  });

  it('ảnh không ai dùng vẫn là 0 — test này phải đỏ nếu phép đếm nhận nhầm mọi thứ', async () => {
    const out = await listAssetsWithUsage();
    const orphan = out.assets.find((a) => a.id === 'that-su-khong-ai-dung')!;
    expect(orphan.useCount).toBe(0);
    expect(orphan.usedBy).toEqual([]);
  });
});

describe('hiệu năng: cây component nạp MỘT lượt cho mỗi tập id', () => {
  it('hai trang dùng cùng một component chỉ tốn một lượt đọc', async () => {
    pageFindMany.mockImplementationOnce(async () => [
      { id: 'p1', slug: 'trang-chu', title: 'Trang chủ', draftVersion: { doc: pageDoc() } },
      { id: 'p2', slug: 'gioi-thieu', title: 'Giới thiệu', draftVersion: { doc: pageDoc() } },
    ]);

    const out = await listAssetsWithUsage();

    expect(out.assets.find((a) => a.id === 'logo-trong-component')!.useCount).toBe(2);
    // `asset-usage` duyệt MỌI trang. Một lượt đọc component cho mỗi trang là N truy
    // vấn cho một kho vài trăm trang; gom theo tập id giữ nó ở một.
    expect(presetFindMany).toHaveBeenCalledTimes(1);
  });
});
