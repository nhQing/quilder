import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ghi tên danh mục theo ngôn ngữ. Luật cần canh: khoá locale phải có trong bảng
 * `Locale` và không phải ngôn ngữ mặc định (tên gốc sửa ở cột `name`), và các bản
 * dịch khác của cùng danh mục còn nguyên.
 */

const state = vi.hoisted(() => ({
  taxonomy: null as { id: string; typeKey: string; key: string; i18n: unknown } | null,
  locales: [] as { code: string; isDefault: boolean }[],
  updates: [] as { where: unknown; data: { i18n: unknown } }[],
  audits: [] as { action: string; meta: unknown }[],
  revalidated: [] as string[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => {
  const tx = {
    taxonomy: {
      update: vi.fn(async (args: { where: unknown; data: { i18n: unknown } }) => {
        state.updates.push(args);
        return {};
      }),
    },
    auditLog: {
      create: vi.fn(async (args: { data: { action: string; meta: unknown } }) => {
        state.audits.push(args.data);
        return {};
      }),
    },
  };
  return {
    prisma: {
      taxonomy: { findUnique: vi.fn(async () => state.taxonomy) },
      locale: {
        findUnique: vi.fn(async (args: { where: { code: string } }) =>
          state.locales.find((l) => l.code === args.where.code) ?? null,
        ),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('./cache', () => ({
  revalidateCollection: vi.fn((typeKey: string) => state.revalidated.push(typeKey)),
}));

import { setTaxonomyLocaleName } from './taxonomy-write';

beforeEach(() => {
  state.taxonomy = { id: 't1', typeKey: 'news', key: 'dau-tu', i18n: { ja: { name: '投資' } } };
  state.locales = [
    { code: 'vi', isDefault: true },
    { code: 'en', isDefault: false },
    { code: 'ja', isDefault: false },
  ];
  state.updates = [];
  state.audits = [];
  state.revalidated = [];
});

const call = (locale: string, name: string | null) =>
  setTaxonomyLocaleName({ id: 't1', locale, name, actorSub: 'se1@maimoney.com' });

describe('setTaxonomyLocaleName', () => {
  it('ghi tên tiếng Anh, giữ bản tiếng Nhật, ghi audit và làm mới cache của loại', async () => {
    const r = await call('en', 'Investing');
    expect(r).toEqual({ ok: true, i18n: { ja: { name: '投資' }, en: { name: 'Investing' } } });
    expect(state.updates[0]!.data.i18n).toEqual({ ja: { name: '投資' }, en: { name: 'Investing' } });
    expect(state.audits[0]!.action).toBe('taxonomy.locale.set');
    expect(state.revalidated).toEqual(['news']);
  });

  it('name null gỡ bản dịch', async () => {
    state.taxonomy!.i18n = { en: { name: 'Investing' } };
    const r = await call('en', null);
    expect(r).toEqual({ ok: true, i18n: {} });
    expect(state.audits[0]!.action).toBe('taxonomy.locale.clear');
  });

  it('ngôn ngữ không khai trong bảng Locale bị từ chối, không ghi gì', async () => {
    const r = await call('fr', 'Investir');
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(state.updates).toEqual([]);
  });

  it('ngôn ngữ mặc định bị từ chối — tên gốc nằm ở cột name', async () => {
    const r = await call('vi', 'Đầu tư mới');
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(state.updates).toEqual([]);
  });

  it('danh mục không tồn tại trả 404', async () => {
    state.taxonomy = null;
    expect(await call('en', 'Investing')).toMatchObject({ ok: false, status: 404 });
  });

  it('tên quá dài bị từ chối', async () => {
    const r = await call('en', 'x'.repeat(121));
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(state.updates).toEqual([]);
  });

  it('không đổi gì thì không ghi, không audit', async () => {
    const r = await call('ja', '投資');
    expect(r).toEqual({ ok: true, i18n: { ja: { name: '投資' } } });
    expect(state.updates).toEqual([]);
    expect(state.audits).toEqual([]);
  });
});
