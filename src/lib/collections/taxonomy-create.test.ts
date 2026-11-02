import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tạo danh mục với khoá và thứ tự đặt tay.
 *
 * Khoá là đoạn URL của trang danh mục (`/blogs/<khoá>`) và BẤT BIẾN sau khi tạo. Suy
 * từ tên thì không ra được khoá của site đang chạy khi tên và khoá khác nhau ("Đầu Tư"
 * ở `/blogs/maimoney-dau-tu`) — chuyển site sang mà đổi URL là mất thứ hạng tìm kiếm.
 * Nên khoá đặt tay phải được dùng NGUYÊN VĂN: không hậu tố `-2` âm thầm, trùng thì từ
 * chối để người gọi biết.
 */

const state = vi.hoisted(() => ({
  keys: [] as string[],
  created: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => {
  const tx = {
    taxonomy: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.created.push(args.data);
        return { id: 'new', key: args.data.key };
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return {
    prisma: {
      collectionType: { findUnique: vi.fn(async () => ({ id: 'ct' })) },
      taxonomy: {
        findMany: vi.fn(async () => state.keys.map((key) => ({ key }))),
        findUnique: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('./cache', () => ({ revalidateCollection: vi.fn() }));

import { createTaxonomy } from './taxonomy-write';

const base = { typeKey: 'news', actorSub: 'u1' };

beforeEach(() => {
  state.keys = ['dau-tu'];
  state.created = [];
});

describe('createTaxonomy — khoá đặt tay', () => {
  it('dùng nguyên văn khoá và thứ tự được truyền', async () => {
    const r = await createTaxonomy({ ...base, name: 'Đầu Tư', key: 'maimoney-dau-tu', order: 10 });
    expect(r).toEqual({ ok: true, taxonomy: { id: 'new', key: 'maimoney-dau-tu' } });
    expect(state.created[0]).toMatchObject({ key: 'maimoney-dau-tu', name: 'Đầu Tư', order: 10 });
  });

  it('khoá đã có thì từ chối, KHÔNG tự thêm hậu tố', async () => {
    const r = await createTaxonomy({ ...base, name: 'Đầu Tư', key: 'dau-tu' });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(state.created).toHaveLength(0);
  });

  it('khoá không phải dạng đường dẫn thì từ chối', async () => {
    const r = await createTaxonomy({ ...base, name: 'Đầu Tư', key: 'Đầu Tư' });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(state.created).toHaveLength(0);
  });

  it('không truyền khoá thì vẫn suy từ tên và thêm hậu tố khi trùng', async () => {
    const r = await createTaxonomy({ ...base, name: 'Đầu Tư' });
    expect(r).toEqual({ ok: true, taxonomy: { id: 'new', key: 'dau-tu-2' } });
    expect(state.created[0]).not.toHaveProperty('order');
  });
});
