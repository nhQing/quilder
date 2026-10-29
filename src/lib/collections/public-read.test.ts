import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `populate[field]=a,b` ở đường đọc: bản ghi đích ra TÓM TẮT + đúng các field đã xin,
 * đã qua phép chiếu công khai (ảnh thành URL, không lộ `assetId`) và đã phủ bản dịch.
 *
 * Mock ở ranh giới DB: hai lượt `entry.findMany` (danh sách, rồi bản ghi đích) phân biệt
 * bằng `where.id.in` — chỉ lượt tra bản ghi đích có điều kiện đó.
 */

const state = vi.hoisted(() => ({
  list: [] as unknown[],
  targets: [] as unknown[],
  assets: [] as unknown[],
  assetQueries: [] as string[][],
}));

vi.mock('server-only', () => ({}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    entry: {
      findMany: vi.fn(async (args: { where: { id?: { in: string[] } } }) =>
        args.where.id?.in ? state.targets : state.list,
      ),
      count: vi.fn(async () => state.list.length),
    },
    asset: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        state.assetQueries.push(args.where.id.in);
        return state.assets;
      }),
    },
  },
}));

vi.mock('@/lib/render/embed-origins', () => ({ allowedEmbedHostnames: async () => [] }));
vi.mock('./group-table', () => ({ loadGroupTable: async () => ({}) }));

vi.mock('./queries', () => ({
  getCollectionTypes: async () => [
    {
      key: 'news', name: 'Tin', titleField: 'title', slugField: 'slug',
      schema: [
        { t: 'text', key: 'title', label: 'Tiêu đề' },
        { t: 'relation', key: 'faq', label: 'FAQ', typeKey: 'faq', cardinality: 'many' },
      ],
    },
    {
      key: 'faq', name: 'FAQ', titleField: 'question', slugField: 'slug',
      schema: [
        { t: 'text', key: 'question', label: 'Câu hỏi' },
        { t: 'richtext', key: 'answer', label: 'Trả lời' },
        { t: 'image', key: 'icon', label: 'Icon' },
        { t: 'text', key: 'secret', label: 'Ghi chú nội bộ' },
      ],
    },
  ],
}));

import { readPublicList } from './public-read';

const AT = new Date('2026-09-01T00:00:00.000Z');

beforeEach(() => {
  state.list = [
    {
      id: 'n1', slug: 'bai-1', status: 'published', publishedAt: AT, updatedAt: AT,
      data: { title: 'Bài 1', faq: ['f1', 'f-gone'] }, i18n: {},
      locales: [], taxonomies: [],
    },
  ];
  state.targets = [
    {
      id: 'f1', slug: 'phi-la-gi', status: 'published', typeKey: 'faq', publishedAt: AT,
      data: {
        question: 'Phí là gì?',
        answer: [{ t: 'text', v: 'Không phí.' }],
        icon: { assetId: 'a1', alt: 'icon' },
        secret: 'không được lộ',
      },
      i18n: { en: { question: 'What fees?' } },
      locales: [{ locale: 'en', slug: 'what-fees', status: 'published', publishedAt: AT }],
    },
  ];
  state.assets = [{ id: 'a1', url: 'https://cdn/x.png', width: 10, height: 10, blurhash: null, mime: 'image/png' }];
  state.assetQueries = [];
});

const run = async (qs: string) => {
  const r = await readPublicList('news', new URLSearchParams(qs));
  if (!r.ok) throw new Error(r.error);
  return r.payload.data[0]!;
};

describe('readPublicList — populate[field]=…', () => {
  it('ra tóm tắt + đúng field đã xin, không kèm field không xin', async () => {
    const row = await run('populate[faq]=question,icon');
    expect(row.faq).toEqual([
      {
        question: 'Phí là gì?',
        icon: { url: 'https://cdn/x.png', width: 10, height: 10, blurhash: null, mime: 'image/png', alt: 'icon' },
        id: 'f1', slug: 'phi-la-gi', title: 'Phí là gì?', publishedAt: AT.toISOString(),
      },
    ]);
  });

  it('ảnh của bản ghi đích được tra trong bảng Asset, cùng một lượt với ảnh của danh sách', async () => {
    await run('populate[faq]=icon');
    expect(state.assetQueries).toEqual([['a1']]);
  });

  it('field không xin thì ảnh của nó không bị tra', async () => {
    await run('populate[faq]=question');
    expect(state.assetQueries).toEqual([]);
  });

  it('richtext đi theo format=html', async () => {
    const row = await run('populate[faq]=answer&format=html');
    expect((row.faq as { answer: unknown }[])[0]!.answer).toBe('Không phí.');
  });

  it('locale phủ bản dịch lên field đã xin, slug là slug của ngôn ngữ đó', async () => {
    const row = await run('populate[faq]=question&locale=en');
    const f = (row.faq as Record<string, unknown>[])[0]!;
    expect(f.question).toBe('What fees?');
    expect(f.title).toBe('What fees?');
    expect(f.slug).toBe('what-fees');
  });

  it('dạng phẳng cũ giữ nguyên tóm tắt bốn khoá', async () => {
    const row = await run('populate=faq');
    expect(row.faq).toEqual([
      { id: 'f1', slug: 'phi-la-gi', title: 'Phí là gì?', publishedAt: AT.toISOString() },
    ]);
  });
});
