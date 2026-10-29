import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/public/v1/views/<khoá>`: tra view, gộp tham số client, rồi đi ĐÚNG đường đọc
 * công khai của loại — không một đường đọc thứ hai.
 */

const state = vi.hoisted(() => ({
  view: null as null | { key: string; typeKey: string; query: string; allow: string[] },
  listCalls: [] as { typeKey: string; qs: string }[],
  oneCalls: [] as { typeKey: string; slug: string; qs: string }[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  prisma: {
    apiView: {
      findUnique: vi.fn(async (args: { where: { key: string } }) =>
        state.view?.key === args.where.key ? state.view : null,
      ),
    },
  },
}));

vi.mock('./queries', () => ({
  getCollectionTypes: async () => [
    {
      key: 'news', titleField: 'title',
      schema: [
        { t: 'text', key: 'title', label: 'Tiêu đề' },
        { t: 'relation', key: 'faq', label: 'FAQ', typeKey: 'faq', cardinality: 'many' },
      ],
    },
    { key: 'faq', titleField: 'question', schema: [{ t: 'text', key: 'question', label: 'Câu hỏi' }] },
  ],
}));

vi.mock('./public-read', () => ({
  readPublicList: vi.fn(async (typeKey: string, sp: URLSearchParams) => {
    state.listCalls.push({ typeKey, qs: sp.toString() });
    return { ok: true, payload: { data: [], meta: {} } };
  }),
  readPublicOne: vi.fn(async (typeKey: string, slug: string, sp: URLSearchParams) => {
    state.oneCalls.push({ typeKey, slug, qs: sp.toString() });
    return { ok: true, payload: { data: {} } };
  }),
}));

import { readPublicView } from './public-view';

beforeEach(() => {
  state.view = {
    key: 'mobile-news', typeKey: 'news',
    query: 'fields=title%2Cfaq&populate%5Bfaq%5D=question&pageSize=20',
    allow: ['page', 'locale'],
  };
  state.listCalls = [];
  state.oneCalls = [];
});

describe('readPublicView', () => {
  it('khoá không có trả 404 unknown_view', async () => {
    const r = await readPublicView('khong-co', new URLSearchParams());
    expect(r).toMatchObject({ ok: false, status: 404, code: 'unknown_view' });
  });

  it('khoá sai hình dạng trả 404 mà không truy vấn', async () => {
    const r = await readPublicView('../news', new URLSearchParams());
    expect(r).toMatchObject({ ok: false, status: 404, code: 'unknown_view' });
  });

  it('bung query đã lưu + tham số client vào đường đọc danh sách của loại', async () => {
    const r = await readPublicView('mobile-news', new URLSearchParams('page=2&locale=en'));
    expect(r.ok).toBe(true);
    expect(state.listCalls).toEqual([
      { typeKey: 'news', qs: 'fields=title%2Cfaq&populate%5Bfaq%5D=question&pageSize=20&page=2&locale=en' },
    ]);
  });

  it('có slug thì đi đường đọc một bài', async () => {
    await readPublicView('mobile-news', new URLSearchParams('locale=en'), 'bai-1');
    expect(state.oneCalls).toEqual([
      { typeKey: 'news', slug: 'bai-1', qs: 'fields=title%2Cfaq&populate%5Bfaq%5D=question&pageSize=20&locale=en' },
    ]);
  });

  it('tham số không được phép trả 400 bad_param, không đọc gì', async () => {
    const r = await readPublicView('mobile-news', new URLSearchParams('fields=title'));
    expect(r).toMatchObject({ ok: false, status: 400, code: 'bad_param' });
    expect(state.listCalls).toEqual([]);
  });

  it('query đã lưu không còn hợp với cấu trúc loại thì là lỗi CỦA VIEW, không phải của client', async () => {
    // Field `faq` của loại đích không có `answer` — như sau khi ai đó xoá field đó.
    state.view!.query = 'populate%5Bfaq%5D=answer';
    const r = await readPublicView('mobile-news', new URLSearchParams());
    expect(r).toMatchObject({ ok: false, status: 500, code: 'view_invalid' });
    expect(state.listCalls).toEqual([]);
  });

  it('loại của view đã bị xoá cũng là view_invalid', async () => {
    state.view!.typeKey = 'events';
    const r = await readPublicView('mobile-news', new URLSearchParams());
    expect(r).toMatchObject({ ok: false, status: 500, code: 'view_invalid' });
  });
});
