import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f }));

const AT = new Date('2026-10-14T08:00:00.000Z');
const META = { title: 'ABC', description: 'Mô tả', canonical: null, noindex: false, jsonLd: { '@type': 'Thing', name: 'x' }, ogImageId: null };
const stamp = (over: Record<string, unknown> = {}) => ({
  createdAt: AT, importedVersionId: 'v-imported', importedMeta: META, importedTranslations: 2, ...over,
});
const probe = (over: Record<string, unknown> = {}) => ({
  draftVersionId: 'v-imported', meta: { ...META }, translations: { count: 2, lastUpdatedAt: AT }, ...over,
});

describe('undoRefusal', () => {
  it('chưa ai sửa: được hoàn tác (bản dịch đúng mốc giờ lần nhập, jsonLd khác thứ tự khoá vẫn là một)', async () => {
    const { undoRefusal } = await import('./undo');
    expect(undoRefusal(stamp(), probe({ meta: { ...META, jsonLd: { name: 'x', '@type': 'Thing' } } }))).toBeNull();
  });

  it('bố cục đã sửa (con trỏ nháp dời) → thông báo dùng Lịch sử', async () => {
    const { undoRefusal } = await import('./undo');
    expect(undoRefusal(stamp(), probe({ draftVersionId: 'v-sau' }))).toContain('Lịch sử');
  });

  it('bản dịch sửa sau lần nhập, hoặc bị xoá bớt → từ chối (bản dịch hoặc SEO)', async () => {
    const { undoRefusal, EDITED_AFTER } = await import('./undo');
    expect(undoRefusal(stamp(), probe({ translations: { count: 2, lastUpdatedAt: new Date(AT.getTime() + 1) } }))).toBe(EDITED_AFTER);
    expect(undoRefusal(stamp(), probe({ translations: { count: 1, lastUpdatedAt: AT } }))).toBe(EDITED_AFTER);
  });

  it('tiêu đề / mô tả / canonical / noindex / ảnh chia sẻ / jsonLd đổi sau lần nhập → từ chối', async () => {
    const { undoRefusal, EDITED_AFTER } = await import('./undo');
    for (const change of [{ title: 'Tên mới' }, { description: null }, { canonical: 'https://x.vn' }, { noindex: true }, { ogImageId: 'c1' }, { jsonLd: null }]) {
      expect(undoRefusal(stamp(), probe({ meta: { ...META, ...change } }))).toBe(EDITED_AFTER);
    }
  });

  it('log cũ thiếu importedMeta: không đoán là chưa sửa', async () => {
    const { undoRefusal, EDITED_AFTER } = await import('./undo');
    expect(undoRefusal(stamp({ importedMeta: undefined, importedTranslations: undefined }), probe())).toBe(EDITED_AFTER);
  });
});

describe('pickUndoable', () => {
  it('chỉ lần nhập MỚI NHẤT của trang, và chỉ khi trang chưa bị sửa theo cả ba nghĩa', async () => {
    const { pickUndoable } = await import('./undo');
    const logs = [
      { id: 'L4', targetId: 'p3', ...stamp() },
      { id: 'L3', targetId: 'p1', ...stamp() },
      { id: 'L2', targetId: 'p2', ...stamp({ importedVersionId: 'v-old' }) },
      { id: 'L1', targetId: 'p1', ...stamp({ importedVersionId: 'v-older' }) },
    ];
    const probes = new Map([
      ['p1', probe()],
      ['p2', probe({ draftVersionId: 'v-edited-after' })],
      ['p3', probe({ meta: { ...META, description: 'SEO sửa sau' } })],
    ]);
    expect(pickUndoable(logs, probes)).toEqual(new Map([['p1', 'L3']]));
  });

  it('meta hỏng hoặc thiếu importedVersionId thì bỏ qua, không ném lỗi', async () => {
    const { pickUndoable } = await import('./undo');
    const logs = [
      { id: 'L2', targetId: 'p1', ...stamp({ importedVersionId: null }) },
      { id: 'L1', targetId: 'p1', ...stamp({ importedVersionId: 5 }) },
    ];
    expect(pickUndoable(logs, new Map([['p1', probe({ draftVersionId: null })]])).size).toBe(0);
  });
});

describe('undoImport - trang tạo bởi lần nhập', () => {
  const session = { sub: 'u1', email: 'a@b.c' } as never;

  async function setup(published: number, purge: { ok: boolean; status?: number; error?: string }, page: Record<string, unknown> = {}) {
    vi.resetModules();
    const archivePage = vi.fn(async () => ({ ok: true }));
    const purgePage = vi.fn(async () => purge);
    vi.doMock('server-only', () => ({}));
    vi.doMock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f }));
    vi.doMock('@/lib/builder/delete-page', () => ({ archivePage, purgePage }));
    vi.doMock('@/lib/db', () => ({
      prisma: {
        auditLog: { findUnique: async () => ({ action: 'page.import', targetId: 'p1', createdAt: AT, meta: { importedVersionId: 'v1', createdPage: true, importedMeta: META, importedTranslations: 0 } }) },
        page: { findMany: async () => [{ id: 'p1', draftVersionId: 'v1', ...META, ...page }] },
        translation: { groupBy: async () => [] },
        releaseEntry: { count: async () => published },
      },
    }));
    const { undoImport } = await import('./undo');
    return { undoImport, archivePage, purgePage };
  }

  it('đã publish thì 409 và KHÔNG lưu trữ trang', async () => {
    const { undoImport, archivePage } = await setup(1, { ok: true });
    const r = await undoImport({ importId: 'L', session });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(archivePage).not.toHaveBeenCalled();
  });

  it('SEO sửa sau lần nhập → 409, KHÔNG xoá trang', async () => {
    const { undoImport, archivePage } = await setup(0, { ok: true }, { description: 'sửa tay' });
    const r = await undoImport({ importId: 'L', session });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as { error: string }).error).toContain('bản dịch hoặc SEO');
    expect(archivePage).not.toHaveBeenCalled();
  });

  it('purge hỏng sau khi đã lưu trữ thì nói rõ trang đang ở lưu trữ', async () => {
    const { undoImport, archivePage } = await setup(0, { ok: false, status: 409, error: 'lý do' });
    const r = await undoImport({ importId: 'L', session });
    expect(archivePage).toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as { error: string }).error).toContain('Đã đưa trang vào lưu trữ');
    expect((r as { error: string }).error).toContain('lý do');
  });

  it('không publish, purge được thì purged = true', async () => {
    const { undoImport } = await setup(0, { ok: true });
    expect(await undoImport({ importId: 'L', session })).toEqual({ ok: true, pageId: 'p1', purged: true });
  });
});
