import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { ROLLBACK_KEEP_DAYS, ROLLBACK_KEEP_RELEASES, rollbackWindowIds } from './rollback-window';

const NOW = new Date('2026-10-08T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/** `n` release, cách nhau `gapDays` ngày, mới nhất là r0. */
function releases(n: number, gapDays: number, startDaysAgo = 0) {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, createdAt: daysAgo(startDaysAgo + i * gapDays) }));
}

describe('rollbackWindowIds', () => {
  it('publish dồn dập: mọi bản trong 90 ngày vẫn trong cửa sổ, dù quá 30 bản', () => {
    const list = releases(120, 0.5); // 120 bản trong 60 ngày
    expect(rollbackWindowIds(list, [], NOW).size).toBe(120);
  });

  it('ít publish: 30 bản gần nhất vẫn trong cửa sổ dù đã quá 90 ngày', () => {
    const list = releases(40, 10); // mỗi 10 ngày một bản → bản thứ 10 trở đi đã quá 90 ngày
    const inside = rollbackWindowIds(list, [], NOW);
    expect(inside.size).toBe(ROLLBACK_KEEP_RELEASES);
    expect(inside.has('r29')).toBe(true);
    expect(inside.has('r30')).toBe(false);
  });

  it('bản ngoài cả hai luật thì ngoài cửa sổ', () => {
    const list = [...releases(ROLLBACK_KEEP_RELEASES, 0), { id: 'cu', createdAt: daysAgo(ROLLBACK_KEEP_DAYS + 1) }];
    expect(rollbackWindowIds(list, [], NOW).has('cu')).toBe(false);
  });

  it('release đang chạy luôn trong cửa sổ, kể cả khi vừa lùi về bản rất cũ', () => {
    const list = [...releases(ROLLBACK_KEEP_RELEASES, 0), { id: 'cu', createdAt: daysAgo(400) }];
    expect(rollbackWindowIds(list, ['cu', null], NOW).has('cu')).toBe(true);
  });

  it('không phụ thuộc thứ tự đầu vào', () => {
    const list = releases(40, 10);
    const a = rollbackWindowIds(list, [], NOW);
    const b = rollbackWindowIds([...list].reverse(), [], NOW);
    expect([...a].sort()).toEqual([...b].sort());
  });
});
