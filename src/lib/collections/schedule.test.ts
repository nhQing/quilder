import { describe, expect, it } from 'vitest';

import { nextRevalidateSeconds } from './schedule';

const now = new Date('2026-08-20T10:00:00.000Z');

describe('nextRevalidateSeconds', () => {
  it('không có bài hẹn giờ thì dùng trần mặc định', () => {
    expect(nextRevalidateSeconds([new Date('2026-08-01')], now)).toBe(3600);
  });

  it('bài hẹn giờ trong 10 phút thì cache hết hạn sau 10 phút', () => {
    // Không có bước này thì bài hẹn 9h sáng chỉ xuất hiện khi có người tình cờ làm
    // cache miss — tức bài đã duyệt vẫn không lên đúng giờ.
    expect(nextRevalidateSeconds([new Date('2026-08-20T10:10:00.000Z')], now)).toBe(600);
  });

  it('lấy mốc gần nhất trong tương lai, bỏ qua mốc xa hơn', () => {
    const out = nextRevalidateSeconds(
      [new Date('2026-08-20T12:00:00.000Z'), new Date('2026-08-20T10:05:00.000Z')],
      now,
    );
    expect(out).toBe(300);
  });

  it('mốc quá xa bị kẹp về trần', () => {
    expect(nextRevalidateSeconds([new Date('2027-01-01')], now)).toBe(3600);
  });

  it('không bao giờ trả 0 hay số âm — 0 nghĩa là KHÔNG cache', () => {
    expect(nextRevalidateSeconds([new Date('2026-08-20T10:00:00.500Z')], now)).toBeGreaterThan(0);
  });

  it('bỏ qua null và undefined', () => {
    expect(nextRevalidateSeconds([null, undefined], now)).toBe(3600);
  });

  it('trần đặt riêng vẫn được tôn trọng', () => {
    expect(nextRevalidateSeconds([], now, 60)).toBe(60);
  });
});
