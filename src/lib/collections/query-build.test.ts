import { describe, expect, it } from 'vitest';

import type { CollectionQuery } from '@/lib/doc/types';
import {
  buildEntryFindArgs, localizedSlugWheres, matchNothing, MAX_QUERY_LIMIT,
} from './query-build';

const NOW = new Date('2026-08-20T10:00:00.000Z');
const CTX = { now: NOW };

const BASE: CollectionQuery = { typeKey: 'news', limit: 10 };

/**
 * Khoá sắp PHỤ mà `buildEntryFindArgs` nối vào cuối mọi `orderBy`.
 *
 * Viết ra ở đây để các test dưới nói về khoá CHÍNH của chúng thay vì chép lại cái
 * đuôi này bảy lần. Vì sao có đuôi: xem `appendTieBreakers`.
 */
const TIE = [{ publishedAt: 'desc' }, { id: 'desc' }];

describe('buildEntryFindArgs', () => {
  it('luôn lọc typeKey, đã đăng, chưa lưu trữ, và publishedAt đã tới', () => {
    // Bốn điều kiện này KHÔNG được là tuỳ chọn: một trong bốn bị bỏ nghĩa là bài
    // nháp hoặc bài hẹn giờ lên sóng sớm, và không ai phát hiện cho tới khi thấy.
    const a = buildEntryFindArgs(BASE, CTX);
    expect(a.where).toMatchObject({
      typeKey: 'news',
      status: 'published',
      archivedAt: null,
      publishedAt: { not: null, lte: NOW },
    });
  });

  it('sắp mặc định là mới nhất trước khi query không nói gì', () => {
    expect(buildEntryFindArgs(BASE, CTX).orderBy).toEqual(TIE);
  });

  it('kẹp limit ở trần, không ném lỗi', () => {
    const a = buildEntryFindArgs({ ...BASE, limit: 5000 }, CTX);
    expect(a.take).toBe(MAX_QUERY_LIMIT);
  });

  it('sắp theo cột thật thì đi vào orderBy', () => {
    const a = buildEntryFindArgs({ ...BASE, sort: [{ field: 'updatedAt', dir: 'asc' }] }, CTX);
    expect(a.orderBy).toEqual([{ updatedAt: 'asc' }, ...TIE]);
  });

  it('sắp theo field KHÔNG phải cột thật thì bị bỏ, rơi về mặc định', () => {
    // Prisma không sắp được theo đường dẫn trong JSONB (`orderBy` chỉ nhận
    // SortOrder). Sinh ra `{ data: { path, sort } }` là sinh một đối số không hợp
    // lệ mà chỉ nổ ở tầng đọc DB — trong khi test shape ở đây vẫn xanh.
    const a = buildEntryFindArgs({ ...BASE, sort: [{ field: 'title', dir: 'asc' }] }, CTX);
    expect(a.orderBy).toEqual(TIE);
  });

  it('sắp theo slug được, vì slug là cột thật', () => {
    const a = buildEntryFindArgs({ ...BASE, sort: [{ field: 'slug', dir: 'asc' }] }, CTX);
    expect(a.orderBy).toEqual([{ slug: 'asc' }, ...TIE]);
  });

  it('trộn cột sắp được và không sắp được thì chỉ giữ cái sắp được', () => {
    const a = buildEntryFindArgs(
      { ...BASE, sort: [{ field: 'title', dir: 'asc' }, { field: 'updatedAt', dir: 'desc' }] },
      CTX,
    );
    expect(a.orderBy).toEqual([{ updatedAt: 'desc' }, ...TIE]);
  });

  it('lọc theo field eq đi vào điều kiện JSONB path', () => {
    const q: CollectionQuery = { ...BASE, filter: [{ k: 'field', field: 'pinned', op: 'eq', value: true }] };
    const a = buildEntryFindArgs(q, CTX);
    expect(a.where.AND).toEqual([{ data: { path: ['pinned'], equals: true } }]);
  });

  it('lọc contains dùng string_contains, không phải equals', () => {
    const q: CollectionQuery = { ...BASE, filter: [{ k: 'field', field: 'title', op: 'contains', value: 'lãi suất' }] };
    const a = buildEntryFindArgs(q, CTX);
    expect(a.where.AND).toEqual([{ data: { path: ['title'], string_contains: 'lãi suất' } }]);
  });

  it('lọc danh mục cố định thành điều kiện some trên bảng nối', () => {
    const q: CollectionQuery = { ...BASE, filter: [{ k: 'taxonomy', from: 'fixed', ids: ['t1', 't2'] }] };
    const a = buildEntryFindArgs(q, CTX);
    expect(a.where.AND).toEqual([{ taxonomies: { some: { taxonomyId: { in: ['t1', 't2'] } } } }]);
  });

  it('danh mục "của bài đang mở" lấy từ ngữ cảnh', () => {
    const q: CollectionQuery = { ...BASE, filter: [{ k: 'taxonomy', from: 'current-entry' }] };
    const a = buildEntryFindArgs(q, { now: NOW, currentTaxonomyIds: ['t9'] });
    expect(a.where.AND).toEqual([{ taxonomies: { some: { taxonomyId: { in: ['t9'] } } } }]);
  });

  it('không có ngữ cảnh danh mục thì BỎ điều kiện, không trả về rỗng', () => {
    // Trang danh sách dùng lại đúng thẻ của trang chi tiết là chuyện thường. Biến
    // "không có ngữ cảnh" thành "không khớp gì" làm cả khu trống mà không có lỗi.
    const q: CollectionQuery = { ...BASE, filter: [{ k: 'taxonomy', from: 'current-entry' }] };
    const a = buildEntryFindArgs(q, CTX);
    expect(a.where.AND).toEqual([]);
  });

  it('excludeCurrent loại chính bài đang mở', () => {
    const q: CollectionQuery = { ...BASE, filter: [{ k: 'excludeCurrent' }] };
    const a = buildEntryFindArgs(q, { now: NOW, currentEntryId: 'e1' });
    expect(a.where.AND).toEqual([{ id: { not: 'e1' } }]);
  });

  it('nhiều điều kiện nối bằng AND, giữ thứ tự', () => {
    const q: CollectionQuery = {
      ...BASE,
      filter: [
        { k: 'field', field: 'pinned', op: 'eq', value: true },
        { k: 'excludeCurrent' },
      ],
    };
    const a = buildEntryFindArgs(q, { now: NOW, currentEntryId: 'e1' });
    expect(a.where.AND).toHaveLength(2);
  });

  it('skip đi vào skip, mặc định 0', () => {
    expect(buildEntryFindArgs(BASE, CTX).skip).toBe(0);
    expect(buildEntryFindArgs({ ...BASE, skip: 20 }, CTX).skip).toBe(20);
  });
});

describe('lọc theo ngôn ngữ', () => {
  const now = new Date('2026-08-28T10:00:00.000Z');
  const q = { typeKey: 'news', limit: 10 } as CollectionQuery;

  it('không có locale thì lọc trên cột của Entry', () => {
    const w = buildEntryFindArgs(q, { now }).where;
    expect(w.status).toBe('published');
    expect(w.publishedAt).toEqual({ not: null, lte: now });
    expect(w.locales).toBeUndefined();
  });

  it('có locale thì lọc trên hàng EntryLocale của chính nó', () => {
    const w = buildEntryFindArgs(q, { now, locale: 'en' }).where;
    expect(w.locales).toEqual({
      some: { locale: 'en', status: 'published', publishedAt: { not: null, lte: now } },
    });
  });

  it('có locale thì KHÔNG kèm điều kiện nào lên Entry.status', () => {
    // Kèm vào là bản tiếng Anh đã duyệt biến mất ngay khi bản gốc bị tháo xuống —
    // tức "publish riêng từng locale" chỉ đúng một nửa.
    const w = buildEntryFindArgs(q, { now, locale: 'en' }).where;
    expect(w.status).toBeUndefined();
    expect(w.publishedAt).toBeUndefined();
  });

  it('archivedAt áp cho MỌI ngôn ngữ', () => {
    // Lưu trữ là của cả hàng Entry: một bản dịch còn sống của một bài đã lưu trữ là
    // một trang không ai quản.
    expect(buildEntryFindArgs(q, { now, locale: 'en' }).where.archivedAt).toBeNull();
    expect(buildEntryFindArgs(q, { now }).where.archivedAt).toBeNull();
  });
});

describe('localizedSlugWheres', () => {
  const now = new Date('2026-08-28T00:00:00Z');
  const published = { status: 'published', publishedAt: { not: null, lte: now } };

  it('bước 1 tra SLUG RIÊNG của ngôn ngữ đó', () => {
    const [own] = localizedSlugWheres('news', 'august-rates-en', 'en', now);
    expect(own).toEqual({
      typeKey: 'news',
      archivedAt: null,
      locales: { some: { locale: 'en', slug: 'august-rates-en', ...published } },
    });
  });

  it('bước 2 rơi về slug gốc, và CHỈ khi ngôn ngữ đó chưa đặt slug riêng', () => {
    // Bỏ `slug: null` là để một bài có HAI URL cùng phục vụ một ngôn ngữ — nội dung
    // trùng lặp do chính ta sinh ra, và Google chọn giúp ta cái nào là canonical.
    const [, fallback] = localizedSlugWheres('news', 'lai-suat-thang-8', 'en', now);
    expect(fallback).toEqual({
      typeKey: 'news',
      slug: 'lai-suat-thang-8',
      archivedAt: null,
      locales: { some: { locale: 'en', slug: null, ...published } },
    });
  });

  it('KHÔNG bước nào kèm điều kiện lên Entry.status', () => {
    // Bản tiếng Anh đã duyệt phải hiện kể cả khi bản gốc đã bị tháo xuống.
    for (const w of localizedSlugWheres('news', 'x', 'en', now)) {
      expect((w as Record<string, unknown>).status).toBeUndefined();
    }
  });

  it('hai bước, đúng thứ tự — slug riêng thắng slug gốc', () => {
    const wheres = localizedSlugWheres('news', 'x', 'en', now);
    expect(wheres).toHaveLength(2);
    expect((wheres[0] as { slug?: string }).slug).toBeUndefined();
    expect((wheres[1] as { slug?: string }).slug).toBe('x');
  });
});

/* ────────────────────────────────────────────────────────────────────────
   "Không phân giải được" KHÁC "không có ngữ cảnh"

   Hai ca này trước đây gộp làm một và cùng BỎ điều kiện. Hậu quả đo được trên
   stg.example.com: mọi trang `/blogs/<danh-mục>` trả CÙNG một danh sách không
   lọc, vì một URL danh mục sai bị đối xử như "đang render ở nơi không có URL".
   ──────────────────────────────────────────────────────────────────────── */

describe('điều kiện lấy từ URL: thiếu ngữ cảnh vs. không phân giải được', () => {
  const taxUrl: CollectionQuery = { ...BASE, filter: [{ k: 'taxonomy', from: 'url' }] };

  it('có ngữ cảnh và phân giải được → lọc đúng danh mục ấy', () => {
    const a = buildEntryFindArgs(taxUrl, { now: NOW, urlTaxonomyId: 'tx1' });
    expect(a.where.AND).toEqual([{ taxonomies: { some: { taxonomyId: { in: ['tx1'] } } } }]);
  });

  it('KHÔNG có ngữ cảnh URL (undefined) → bỏ điều kiện, giữ nguyên hành vi cũ', () => {
    // Ca mà docblock cũ bảo vệ: một thẻ của trang chi tiết dùng lại ở trang danh
    // sách. Biến nó thành "không khớp gì" là làm cả khu trống.
    const a = buildEntryFindArgs(taxUrl, { now: NOW });
    expect(a.where.AND).toEqual([]);
  });

  it('CÓ ngữ cảnh URL nhưng không phân giải được (null) → KHÔNG KHỚP GÌ', () => {
    const a = buildEntryFindArgs(taxUrl, { now: NOW, urlTaxonomyId: null });
    expect(a.where.AND).toEqual([matchNothing()]);
  });

  it('matchNothing trả một object MỚI mỗi lần, không phải hằng dùng chung', () => {
    expect(matchNothing()).not.toBe(matchNothing());
    expect(matchNothing()).toEqual({ id: { in: [] } });
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Lọc theo field `relation` — đường cho trang danh mục kiểu mới
   ──────────────────────────────────────────────────────────────────────── */

describe('lọc theo field relation', () => {
  const relUrl: CollectionQuery = {
    ...BASE,
    filter: [{ k: 'relation', field: 'category', from: 'url' }],
  };

  it('id cố định khớp CẢ cardinality one lẫn many', () => {
    // `one` lưu một chuỗi, `many` lưu mảng chuỗi — và một field vừa đổi
    // cardinality để lại hàng cũ mang hình dạng cũ trong JSONB.
    const q: CollectionQuery = {
      ...BASE,
      filter: [{ k: 'relation', field: 'category', from: 'fixed', ids: ['c1', 'c2'] }],
    };
    expect(buildEntryFindArgs(q, CTX).where.AND).toEqual([
      {
        OR: [
          { data: { path: ['category'], equals: 'c1' } },
          { data: { path: ['category'], array_contains: 'c1' } },
          { data: { path: ['category'], equals: 'c2' } },
          { data: { path: ['category'], array_contains: 'c2' } },
        ],
      },
    ]);
  });

  it('từ URL, phân giải được → lọc theo đúng bản ghi ấy', () => {
    const a = buildEntryFindArgs(relUrl, { now: NOW, urlRelationId: 'c9' });
    expect(a.where.AND).toEqual([
      {
        OR: [
          { data: { path: ['category'], equals: 'c9' } },
          { data: { path: ['category'], array_contains: 'c9' } },
        ],
      },
    ]);
  });

  it('KHÔNG có ngữ cảnh URL → bỏ điều kiện', () => {
    expect(buildEntryFindArgs(relUrl, CTX).where.AND).toEqual([]);
  });

  it('CÓ ngữ cảnh URL nhưng slug không phân giải được → KHÔNG KHỚP GÌ', () => {
    const a = buildEntryFindArgs(relUrl, { now: NOW, urlRelationId: null });
    expect(a.where.AND).toEqual([matchNothing()]);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Khoá sắp phụ
   ──────────────────────────────────────────────────────────────────────── */

describe('khoá sắp phụ tất định', () => {
  it('mặc định vẫn mới nhất trước, nhưng có khoá chốt phía sau', () => {
    expect(buildEntryFindArgs(BASE, CTX).orderBy).toEqual([
      { publishedAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('khoá chính hay bằng nhau (viewCount) vẫn cho MỘT thứ tự duy nhất', () => {
    // Mọi hàng `viewCount = 0` → khoá chính bằng nhau → Postgres không hứa thứ tự
    // nào, nên `asc` và `desc` trả hai thứ tự tuỳ ý. Đây là chỗ chốt nó lại.
    const a = buildEntryFindArgs({ ...BASE, sort: [{ field: 'viewCount', dir: 'desc' }] }, CTX);
    expect(a.orderBy).toEqual([
      { viewCount: 'desc' },
      { publishedAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('không thêm publishedAt lần thứ hai nếu người dùng đã sắp theo nó', () => {
    const a = buildEntryFindArgs({ ...BASE, sort: [{ field: 'publishedAt', dir: 'asc' }] }, CTX);
    expect(a.orderBy).toEqual([{ publishedAt: 'asc' }, { id: 'desc' }]);
  });

  it('field không sắp được bị bỏ rồi MỚI thêm khoá phụ — không sinh orderBy rỗng', () => {
    const a = buildEntryFindArgs({ ...BASE, sort: [{ field: 'title', dir: 'asc' }] }, CTX);
    expect(a.orderBy).toEqual([{ publishedAt: 'desc' }, { id: 'desc' }]);
  });
});
