import { describe, expect, it, vi } from 'vitest';

/**
 * `baseSeq` — bản đang nằm trong release đang chạy.
 *
 * Ba nhánh đều trả `null` và cả ba nghĩa là "trang này chưa publish lần nào", nhưng
 * chúng đến từ ba tình huống khác nhau và mỗi tình huống đều xảy ra thật: site chưa
 * bootstrap, site có nhưng chưa publish lần nào, và site đã publish nhưng release
 * đang chạy không chứa trang này (trang mới tạo sau lần publish gần nhất).
 *
 * Mock ở lần gọi Prisma đầu tiên, cùng cách `collections/type-write.test.ts` làm —
 * không cần DB thật.
 */

const findFirst = vi.fn();
const findUnique = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    site: { findFirst: () => findFirst() },
    releaseEntry: { findUnique: (a: unknown) => findUnique(a) },
  },
}));

const { publishedSeq } = await import('./queries');

describe('publishedSeq', () => {
  it('chưa có site → null', async () => {
    findFirst.mockResolvedValueOnce(null);
    expect(await publishedSeq('p1')).toBeNull();
  });

  it('có site nhưng chưa publish lần nào (activeReleaseId = null) → null', async () => {
    findFirst.mockResolvedValueOnce({ activeReleaseId: null });
    expect(await publishedSeq('p1')).toBeNull();
  });

  it('release đang chạy không chứa trang này → null', async () => {
    findFirst.mockResolvedValueOnce({ activeReleaseId: 'r1' });
    findUnique.mockResolvedValueOnce(null);
    expect(await publishedSeq('p1')).toBeNull();
  });

  it('release đang chạy có trang này → seq của bản đã publish', async () => {
    findFirst.mockResolvedValueOnce({ activeReleaseId: 'r1' });
    findUnique.mockResolvedValueOnce({ version: { seq: 41 } });
    expect(await publishedSeq('p1')).toBe(41);
  });

  it('tìm bằng khoá kép releaseId+pageId, không quét cả bảng', async () => {
    findFirst.mockResolvedValueOnce({ activeReleaseId: 'r1' });
    findUnique.mockResolvedValueOnce({ version: { seq: 7 } });
    await publishedSeq('p9');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { releaseId_pageId: { releaseId: 'r1', pageId: 'p9' } },
      }),
    );
  });
});
