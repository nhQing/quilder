import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lưu view: ba lớp kiểm chạy TRƯỚC khi ghi, và mỗi lần ghi có một dòng audit.
 */

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  audits: [] as { action: string }[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => {
  const apiView = {
    findUnique: vi.fn(async (args: { where: { key?: string; id?: string } }) =>
      state.rows.find((r) => (args.where.key ? r.key === args.where.key : r.id === args.where.id)) ?? null,
    ),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const row = { id: `v${state.rows.length + 1}`, updatedAt: new Date(), ...args.data };
      state.rows.push(row);
      return row;
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.rows.find((r) => r.id === args.where.id)!;
      Object.assign(row, args.data);
      return row;
    }),
  };
  const auditLog = {
    create: vi.fn(async (args: { data: { action: string } }) => {
      state.audits.push(args.data);
      return {};
    }),
  };
  return {
    prisma: {
      apiView,
      auditLog,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ apiView, auditLog })),
    },
  };
});

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

import { saveApiView } from './api-view-store';

const input = {
  key: 'mobile-news', name: 'Tin cho app', typeKey: 'news',
  query: '?fields=title,faq&populate[faq]=question', allow: ['page', 'locale', 'page'],
};

beforeEach(() => {
  state.rows = [];
  state.audits = [];
});

describe('saveApiView', () => {
  it('tạo: lưu query đã chuẩn hoá, bỏ trùng allow, ghi audit', async () => {
    const r = await saveApiView({ input, actorSub: 'u1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.query).toBe('fields=title%2Cfaq&populate%5Bfaq%5D=question');
    expect(r.view.allow).toEqual(['page', 'locale']);
    expect(state.audits.map((a) => a.action)).toEqual(['api-view.create']);
  });

  it('query không hợp với cấu trúc loại bị 400 và không ghi gì', async () => {
    const r = await saveApiView({ input: { ...input, query: 'populate[faq]=answer' }, actorSub: 'u1' });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(state.rows).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('tham số gõ sai tên bị 400', async () => {
    const r = await saveApiView({ input: { ...input, query: 'field=title' }, actorSub: 'u1' });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('khoá đã có view khác dùng thì 409', async () => {
    await saveApiView({ input, actorSub: 'u1' });
    const r = await saveApiView({ input: { ...input, name: 'Khác' }, actorSub: 'u1' });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it('sửa chính view đó, giữ nguyên khoá, không bị coi là trùng', async () => {
    const created = await saveApiView({ input, actorSub: 'u1' });
    if (!created.ok) throw new Error(created.error);
    const r = await saveApiView({ id: created.view.id, input: { ...input, name: 'Đổi tên' }, actorSub: 'u1' });
    expect(r.ok && r.view.name).toBe('Đổi tên');
    expect(state.audits.map((a) => a.action)).toEqual(['api-view.create', 'api-view.update']);
  });

  it('sửa view không tồn tại trả 404', async () => {
    const r = await saveApiView({ id: 'nope', input, actorSub: 'u1' });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
});
