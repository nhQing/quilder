import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `setTranslation` — xoá bản dịch của một đơn vị chữ ĐÃ BIẾN MẤT.
 *
 * Bỏ ô 0 của một form hai ô: ô còn lại lùi về chỉ số 0, và hàng `param:fields.1.label`
 * không còn đơn vị nào trong doc. Nếu đường xoá cũng đòi đơn vị tồn tại thì hàng đó ở lại
 * mãi — rồi ô mới thêm vào chỉ số 1 "thừa kế" nhãn tiếng Anh của một ô đã bị bỏ.
 */

vi.mock('server-only', () => ({}));
const { prisma, getDraftPage } = vi.hoisted(() => ({
  prisma: {
    locale: { findUnique: vi.fn() },
    translation: { deleteMany: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  getDraftPage: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/builder/queries', () => ({ getDraftPage }));
vi.mock('@/lib/render/components', () => ({ loadComponents: vi.fn(async () => new Map()) }));

import { setTranslation } from './set-translation';

const base = { children: [] as string[], effects: [], style: { base: {} } };
const doc = (locked = false) => ({
  schemaVersion: 1,
  rootId: 'root',
  nodes: {
    root: { ...base, id: 'root', parentId: null, type: 'Section', tag: 'main', children: ['f'] },
    f: {
      ...base, id: 'f', parentId: 'root', type: 'Composite', composite: 'Form', slots: {},
      ...(locked ? { locked: { reason: 'pháp lý' } } : {}),
      params: { fields: [{ name: 'tel', kind: 'tel', label: 'Số điện thoại' }] },
    },
  },
});

const actor = { actorEmail: 'a@b.c', actorSub: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.locale.findUnique.mockResolvedValue({ code: 'en', isDefault: false });
  prisma.translation.deleteMany.mockResolvedValue({ count: 1 });
  getDraftPage.mockResolvedValue({ title: 'T', slug: 't', seo: {}, doc: doc() });
});

describe('setTranslation — xoá', () => {
  it('xoá được hàng của đơn vị không còn trong doc (ô đã bị bỏ)', async () => {
    const r = await setTranslation({
      pageId: 'p', locale: 'en', nodeId: 'f', field: 'param:fields.1.label', value: null, ...actor,
    });
    expect(r).toEqual({ ok: true, deleted: true });
    expect(prisma.translation.deleteMany).toHaveBeenCalledWith({
      where: { locale: 'en', pageId: 'p', nodeId: 'f', field: 'param:fields.1.label' },
    });
  });

  it('GHI vào đơn vị không còn trong doc vẫn bị từ chối (404)', async () => {
    const r = await setTranslation({
      pageId: 'p', locale: 'en', nodeId: 'f', field: 'param:fields.1.label', value: 'Phone', ...actor,
    });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(prisma.translation.upsert).not.toHaveBeenCalled();
  });

  it('node bị khoá: xoá vẫn bị từ chối khi đơn vị còn đó', async () => {
    getDraftPage.mockResolvedValue({ title: 'T', slug: 't', seo: {}, doc: doc(true) });
    const r = await setTranslation({
      pageId: 'p', locale: 'en', nodeId: 'f', field: 'param:fields.0.label', value: null, ...actor,
    });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(prisma.translation.deleteMany).not.toHaveBeenCalled();
  });

  it('ngôn ngữ gốc vẫn không xoá được', async () => {
    prisma.locale.findUnique.mockResolvedValue({ code: 'vi', isDefault: true });
    const r = await setTranslation({
      pageId: 'p', locale: 'vi', nodeId: 'f', field: 'param:fields.1.label', value: null, ...actor,
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});
