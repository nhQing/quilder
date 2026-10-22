import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Xoá hẳn một trang ĐÃ TỪNG PUBLISH: gỡ khỏi release cũ rồi mới xoá (21/10/2026).
 *
 * Thứ tự trong transaction là thứ test này khoá. `ReleaseEntry.versionId` không cascade,
 * nên `page.delete` đứng trước `releaseEntry.deleteMany` thì Postgres chặn cascade
 * `Page → PageVersion` và cả transaction lùi lại — trang không xoá được, y như trước.
 * Mock Prisma không có khoá ngoại để báo lỗi đó, nên thứ tự phải được kiểm thẳng.
 */

const calls: string[] = [];

/** Mỗi lời gọi Prisma trả về một nhãn, để `$transaction` ghi lại thứ tự. */
const op = (name: string, value: unknown = undefined) =>
  vi.fn(() => {
    calls.push(name);
    return value;
  });

const page = { id: 'p1', slug: 'trang-chu-v2', title: 'Trang chủ v2', archivedAt: new Date(), fixture: false, system: null };

const prisma = {
  page: { findUnique: vi.fn(async () => page), update: op('page.update'), delete: op('page.delete') },
  pageVersion: { count: op('pageVersion.count', 12) },
  redirect: { count: op('redirect.count', 1), deleteMany: op('redirect.deleteMany') },
  releaseEntry: { count: op('releaseEntry.count', 3), deleteMany: op('releaseEntry.deleteMany') },
  auditLog: { create: vi.fn((args: unknown) => { calls.push('auditLog.create'); return args; }) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
};

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));

const { purgePage } = await import('./delete-page');

beforeEach(() => {
  calls.length = 0;
  prisma.page.findUnique.mockResolvedValue(page);
});

describe('purgePage', () => {
  it('xoá được trang đã từng publish, và báo số release đã gỡ', async () => {
    const r = await purgePage({ pageId: 'p1', actorSub: 'u1' });
    expect(r).toEqual({ ok: true, purged: true, slug: 'trang-chu-v2', versions: 12, redirects: 1, releases: 3 });
  });

  it('gỡ ReleaseEntry TRƯỚC khi xoá trang, trong cùng một transaction', async () => {
    await purgePage({ pageId: 'p1', actorSub: 'u1' });
    const write = calls.filter((c) => !c.endsWith('.count'));
    expect(write.indexOf('releaseEntry.deleteMany')).toBeGreaterThanOrEqual(0);
    expect(write.indexOf('releaseEntry.deleteMany')).toBeLessThan(write.indexOf('page.delete'));
    expect(prisma.releaseEntry.deleteMany).toHaveBeenCalledWith({ where: { pageId: 'p1' } });
  });

  it('ghi số release đã gỡ vào nhật ký', async () => {
    await purgePage({ pageId: 'p1', actorSub: 'u1' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'page.purge', meta: expect.objectContaining({ releases: 3 }) }),
      }),
    );
  });

  it('vẫn đòi trang đã ở trong lưu trữ', async () => {
    prisma.page.findUnique.mockResolvedValue({ ...page, archivedAt: null as unknown as Date });
    const r = await purgePage({ pageId: 'p1', actorSub: 'u1' });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(calls).not.toContain('releaseEntry.deleteMany');
    expect(calls).not.toContain('page.delete');
  });
});
