import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Đếm truy vấn là TIÊU CHÍ NGHIỆM THU của mốc 3, không phải chuyện tối ưu về sau.
 *
 * Cách nghiệm thu mà kế hoạch mô tả — bật `DEBUG="prisma:query"` rồi mở `/faq` và đếm
 * bằng mắt — chỉ chạy được một lần, trên một máy, với một bộ dữ liệu. Một test đếm
 * chính lượt gọi Prisma thì chạy trong mỗi lần `pnpm test`, và nó ĐỎ vào đúng ngày có
 * ai đó thêm một lượt `taxonomyGroups` vào vòng lặp.
 */

const q = vi.hoisted(() => ({ taxonomy: 0, entry: 0, count: 0 }));

vi.mock('next/cache', () => ({
  // `unstable_cache` bọc rồi gọi — ở test nó phải trong suốt, nếu không lượt gọi thứ
  // hai sẽ bị cache che đi và phép đếm nói dối theo hướng có lợi.
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    taxonomy: {
      findMany: vi.fn(async () => {
        q.taxonomy += 1;
        return [
          { id: 't1', key: 'chung', name: 'Chung' },
          { id: 't2', key: 'phi', name: 'Phí' },
        ];
      }),
    },
    entry: {
      findMany: vi.fn(async () => {
        q.entry += 1;
        return [
          row('e1', 'cau-1', 't1'),
          row('e2', 'cau-2', 't2'),
          row('e3', 'cau-3', 't1'),
        ];
      }),
      findFirst: vi.fn(async () => null),
    },
    entryTaxonomy: {
      groupBy: vi.fn(async () => {
        q.count += 1;
        return [
          { taxonomyId: 't1', _count: { entryId: 2 } },
          { taxonomyId: 't2', _count: { entryId: 1 } },
        ];
      }),
    },
    page: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    // `getEntryBySlug` hỏi mốc hẹn giờ của CẢ bản gốc lẫn bản dịch trước khi tra slug.
    entryLocale: { findFirst: vi.fn(async () => null) },
    site: { findFirst: vi.fn(async () => null) },
    releaseEntry: { findFirst: vi.fn(async () => null) },
    collectionType: { findMany: vi.fn(async () => []) },
    // `expandAllRelations` gọi `getCollectionTypes`, hàm này gọi `loadGroupTable`.
    fieldGroupDef: { findMany: vi.fn(async () => []) },
  },
}));

function row(id: string, slug: string, taxonomyId: string) {
  return {
    id,
    slug,
    typeKey: 'faq',
    data: { title: `Câu ${id}` },
    i18n: null,
    publishedAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    // Khớp `SELECT` của queries.ts: bảng nối mang cả tên danh mục, vì huy hiệu
    // danh mục trên thẻ đọc tới nó.
    taxonomies: [{ taxonomyId, taxonomy: { key: taxonomyId, name: `Danh mục ${taxonomyId}`, order: 0 } }],
    // Khớp `SELECT`: tác giả join qua `createdBy → User.email`.
    author: { email: 'bien-tap@example.com', name: 'Biên tập', avatarAssetId: null, lockedAt: null },
  };
}

import { resolveAllRepeats, parsePageCollection, templateBase } from './collection-page';
import { CURRENT_SCHEMA_VERSION, type Doc } from '@/lib/doc/types';

/** Cây "FAQ theo danh mục": cấp ngoài lặp theo danh mục, cấp trong lặp theo bài. */
function faqDoc(): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'Stack', parentId: null, children: ['outer'], effects: [], style: { base: {} } },
      outer: {
        id: 'outer', type: 'Instance', componentId: 'cmp_group', overrides: {},
        parentId: 'root', children: ['inner'], effects: [], style: { base: {} },
        repeat: { source: { kind: 'taxonomy', typeKey: 'faq' }, map: { name: { nodeId: 'g__title', as: 'content' } } },
      },
      inner: {
        id: 'inner', type: 'Instance', componentId: 'cmp_q', overrides: {},
        parentId: 'outer', children: [], effects: [], style: { base: {} },
        repeat: { source: { kind: 'group-entries', limit: 5 }, map: { title: { nodeId: 'q__title', as: 'content' } } },
      },
    },
  } as unknown as Doc;
}

beforeEach(() => {
  q.taxonomy = 0;
  q.entry = 0;
  q.count = 0;
});

describe('resolveAllRepeats — FAQ theo danh mục', () => {
  it('ba truy vấn TỔNG, không N+1 theo số danh mục', async () => {
    // Ba chứ không hai kể từ khi `taxonomyGroups` đếm bài bằng một `groupBy` riêng.
    // Con số đó phải THẬT: `entries` đã bị cắt hai lần, nên đếm từ nó sẽ ẩn mất một
    // danh mục có bài (bộ lọc `minEntries`) và sắp sai chiều `count`.
    //
    // Điều test này canh vẫn không đổi: SỐ truy vấn không phụ thuộc số danh mục.
    await resolveAllRepeats(faqDoc(), {});
    expect(q.taxonomy).toBe(1);
    expect(q.count).toBe(1);
    expect(q.entry).toBe(1);
  });

  it('cấp ngoài là danh mục, cấp trong là bài của đúng danh mục đó', async () => {
    const out = await resolveAllRepeats(faqDoc(), {});

    const groups = out.groups.get('outer');
    expect(groups?.map((g) => g.taxonomyId)).toEqual(['t1', 't2']);
    expect(groups?.[0]?.item.data.name).toBe('Chung');

    const byTax = out.groupEntries.get('inner');
    expect(byTax?.get('t1')?.map((i) => i.key)).toEqual(['e1', 'e3']);
    expect(byTax?.get('t2')?.map((i) => i.key)).toEqual(['e2']);
  });

  it('cấp trong KHÔNG có mặt trong `items` — nó không được resolve lượt riêng', async () => {
    // Nếu một ngày nào đó nó xuất hiện ở đây, nghĩa là ai đó đã cho `group-entries`
    // đi qua `resolveRepeat`, và phép đếm ở test đầu tiên sẽ là 4 chứ không phải 2.
    const out = await resolveAllRepeats(faqDoc(), {});
    expect(out.items.has('inner')).toBe(false);
  });
});

describe('resolveAllRepeats — nguồn query', () => {
  it('một khối lặp theo truy vấn là ĐÚNG một truy vấn', async () => {
    const doc = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'Grid', parentId: null, children: ['card'], effects: [], style: { base: {} } },
        card: {
          id: 'card', type: 'Instance', componentId: 'cmp_card', overrides: {},
          parentId: 'root', children: [], effects: [], style: { base: {} },
          repeat: {
            source: { kind: 'query', query: { typeKey: 'news', limit: 10 } },
            map: { title: { nodeId: 'card__title', as: 'content' } },
          },
        },
      },
    } as unknown as Doc;

    const out = await resolveAllRepeats(doc, {});
    expect(q.entry).toBe(1);
    expect(out.items.get('card')?.length).toBe(3);
  });

  it('doc không có khối lặp nào thì KHÔNG chạm database', async () => {
    const doc = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'Stack', parentId: null, children: [], effects: [], style: { base: {} } },
      },
    } as unknown as Doc;
    await resolveAllRepeats(doc, {});
    expect(q.entry + q.taxonomy).toBe(0);
  });
});

describe('parsePageCollection', () => {
  it('nhận đúng hình dạng, từ chối mọi thứ khác', () => {
    expect(parsePageCollection({ typeKey: 'news', param: 'list' })).toEqual({
      typeKey: 'news',
      param: 'list',
    });
    expect(parsePageCollection({ typeKey: 'news', param: 'taxonomy' })).toEqual({
      typeKey: 'news',
      param: 'taxonomy',
    });
    expect(parsePageCollection(null)).toBeNull();
    expect(parsePageCollection({ typeKey: 'news' })).toBeNull();
    expect(parsePageCollection({ typeKey: '', param: 'entry' })).toBeNull();
    expect(parsePageCollection({ typeKey: 'news', param: 'archive' })).toBeNull();
    // Hình dạng CŨ (`{mode}`) phải bị từ chối, không được im lặng đi qua: nó không
    // nói được đoạn động trỏ vào entry hay vào danh mục.
    expect(parsePageCollection({ typeKey: 'news', mode: 'detail' })).toBeNull();
  });
});

describe('templateBase', () => {
  it('bỏ đoạn động, giữ nguyên phần tĩnh', () => {
    expect(templateBase('blogs/post/[slug]')).toBe('/blogs/post');
    expect(templateBase('blogs/[category]')).toBe('/blogs');
  });

  it('trang không có đoạn động thì gốc là chính nó', () => {
    expect(templateBase('blogs')).toBe('/blogs');
  });
});

/* ── Vai `relation`: đoạn động mang slug của một BẢN GHI ──────────────── */

/**
 * Loại đích của vai này đọc từ SCHEMA, không từ một tên loại chép trong
 * `Page.collection`.
 *
 * Đây là chỗ quyết định `/blogs/<danh-mục>` tra vào bảng nào. Sai ở đây thì mẫu vẫn
 * khớp URL, vẫn render, chỉ là không lọc gì — đúng lỗi "mọi trang danh mục cùng một
 * danh sách" mà cả đợt sửa này tồn tại để đóng.
 */
const TIN_TUC_TYPE = {
  id: 'ct_tin_tuc',
  key: 'tin-tuc',
  name: 'Tin tức',
  namePlural: 'Tin tức',
  icon: null,
  schema: [
    { t: 'text', key: 'title', label: 'Tiêu đề' },
    { t: 'relation', key: 'category', label: 'Danh mục', typeKey: 'danh-muc', cardinality: 'one' },
  ],
  titleField: 'title',
  slugField: 'slug',
  singleton: false,
  _count: { entries: 3 },
};

const REL = { typeKey: 'tin-tuc', param: 'relation' as const, field: 'category' };

import { prisma } from '@/lib/db';
import { previewBinding, relationEntryBySlug, relationTargetType } from './collection-page';
import type { PageCollection } from '@/lib/builder/page-collection';

type Mocked = { mockResolvedValueOnce: (v: unknown) => void; mock: { calls: unknown[][] } };
const asMock = (fn: unknown) => fn as unknown as Mocked;

function withTypes() {
  asMock(prisma.collectionType.findMany).mockResolvedValueOnce([TIN_TUC_TYPE]);
}

describe('relationTargetType', () => {
  it('field relation → loại ĐÍCH của field đó', async () => {
    withTypes();
    expect(await relationTargetType(REL)).toBe('danh-muc');
  });

  it('field có thật nhưng KHÔNG phải relation → null', async () => {
    // Trỏ vào một field `text` thì đoạn động so slug với một ô chữ: không bao giờ
    // khớp, và trang trả danh sách rỗng dưới một tiêu đề còn nguyên.
    withTypes();
    expect(await relationTargetType({ ...REL, field: 'title' })).toBeNull();
  });

  it('field không có thật, và vai khác → null, KHÔNG đọc DB', async () => {
    withTypes();
    expect(await relationTargetType({ ...REL, field: 'khong-co' })).toBeNull();
    expect(await relationTargetType({ typeKey: 'tin-tuc', param: 'taxonomy' })).toBeNull();
  });
});

describe('relationEntryBySlug', () => {
  it('không phân giải được loại đích thì KHÔNG tra entry nào', async () => {
    withTypes();
    const before = asMock(prisma.entry.findFirst).mock.calls.length;
    expect(await relationEntryBySlug({ ...REL, field: 'title' }, 'lai-suat')).toBeNull();
    expect(asMock(prisma.entry.findFirst).mock.calls.length).toBe(before);
  });

  it('tra slug trong loại ĐÍCH, không trong loại của trang', async () => {
    withTypes();
    const before = asMock(prisma.entry.findFirst).mock.calls.length;
    await relationEntryBySlug(REL, 'lai-suat');
    const wheres = asMock(prisma.entry.findFirst)
      .mock.calls.slice(before)
      .map((c) => (c[0] as { where?: Record<string, unknown> })?.where ?? {});
    expect(wheres).toContainEqual(expect.objectContaining({ typeKey: 'danh-muc', slug: 'lai-suat' }));
  });
});

describe('previewBinding — vai relation', () => {
  it('lấy bản ghi mới nhất của loại đích và đặt urlRelationId', async () => {
    withTypes();
    asMock(prisma.entry.findFirst).mockResolvedValueOnce(row('dm1', 'lai-suat', 't1'));
    const b = await previewBinding({ collection: REL as PageCollection });
    expect(b.urlRelationId).toBe('dm1');
    expect(b.label).toContain('lai-suat');
  });

  /*
   * Không có bản ghi nào thì KHÔNG được im lặng trả một ngữ cảnh trống: đó là màn
   * xem trước nói dối, cái bẫy đã tốn một buổi ngày 08/09/2026 (xem docblock của
   * `previewBinding`).
   */
  it('chưa có bản ghi nào thì nói ra, không đặt urlRelationId', async () => {
    withTypes();
    const b = await previewBinding({ collection: REL as PageCollection });
    expect(b.urlRelationId).toBeUndefined();
    expect(b.label).toBeTruthy();
  });
});

import { entryBodies } from './collection-page';
import type { FieldDef } from '@/lib/collections/field-def';

describe('entryBodies — field ảnh', () => {
  const fields = [{ t: 'image', key: 'cover', label: 'Ảnh bìa' }] as unknown as FieldDef[];

  it('ảnh có assetId thành ô cắm kind image, và assetId được nạp', () => {
    const out = entryBodies(fields, { cover: { assetId: 'a1', alt: 'Bìa' } }, []);
    expect(out.bodies.get('cover')).toEqual({ kind: 'image', assetId: 'a1', alt: 'Bìa' });
    expect(out.assetIds).toContain('a1');
  });

  it('thiếu assetId thì bỏ qua, để ô ảnh giữ ảnh mẫu', () => {
    const out = entryBodies(fields, { cover: { alt: 'Bìa' } }, []);
    expect(out.bodies.has('cover')).toBe(false);
  });
});
