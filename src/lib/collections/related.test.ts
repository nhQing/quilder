import { describe, expect, it } from 'vitest';

import { rankRelated } from './queries';

const d = (s: string) => new Date(s);

describe('rankRelated', () => {
  it('nhiều danh mục trùng hơn thì lên trước, kể cả khi cũ hơn', () => {
    const out = rankRelated(
      [
        { id: 'moi-nhung-it-trung', shared: 1, publishedAt: d('2026-08-19') },
        { id: 'cu-nhung-trung-nhieu', shared: 3, publishedAt: d('2026-01-01') },
      ],
      2,
    );
    expect(out[0]).toBe('cu-nhung-trung-nhieu');
  });

  it('trùng bằng nhau thì bài mới hơn lên trước', () => {
    const out = rankRelated(
      [
        { id: 'cu', shared: 2, publishedAt: d('2026-01-01') },
        { id: 'moi', shared: 2, publishedAt: d('2026-08-01') },
      ],
      2,
    );
    expect(out).toEqual(['moi', 'cu']);
  });

  it('cắt đúng limit', () => {
    const out = rankRelated(
      [1, 2, 3, 4, 5].map((n) => ({ id: `e${n}`, shared: 1, publishedAt: d('2026-08-0' + n) })),
      3,
    );
    expect(out).toHaveLength(3);
  });

  it('publishedAt null xuống cuối, không làm sập phép so', () => {
    const out = rankRelated(
      [
        { id: 'khong-co-moc', shared: 1, publishedAt: null },
        { id: 'co-moc', shared: 1, publishedAt: d('2026-01-01') },
      ],
      2,
    );
    expect(out).toEqual(['co-moc', 'khong-co-moc']);
  });

  it('danh sách rỗng trả rỗng', () => {
    expect(rankRelated([], 3)).toEqual([]);
  });
});
