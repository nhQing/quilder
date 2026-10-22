import { describe, expect, it } from 'vitest';

import {
  availableRanges,
  navGeometry,
  normalizePoints,
  pointsInRange,
  zNavPayload,
  type NavPoint,
} from './nav-series';

/**
 * Chuỗi NAV — phần thuần.
 *
 * Đây là chỗ dễ sai nhất của cả composite, và mọi lỗi ở đây đều IM LẶNG: một mốc
 * lọc lệch một ngày cho ra biểu đồ ngắn hơn thật, còn chia cho 0 cho ra
 * `<polyline points="NaN,NaN">` — một đường biến mất mà không có lỗi nào.
 */

const p = (date: string, nav: number): NavPoint => ({ date, nav });

describe('zNavPayload — hợp đồng với backend', () => {
  it('nhận payload tối thiểu và điền currency', () => {
    const r = zNavPayload.safeParse({ points: [{ date: '2026-01-02', nav: 12345.6 }] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.currency).toBe('VND');
  });

  it('points rỗng là HỢP LỆ — quỹ mới chưa có lịch sử', () => {
    expect(zNavPayload.safeParse({ points: [] }).success).toBe(true);
  });

  it('từ chối date sai khuôn', () => {
    for (const bad of ['2026-1-2', '02/01/2026', '2026-01', 'hôm nay']) {
      expect(zNavPayload.safeParse({ points: [{ date: bad, nav: 1 }] }).success, bad).toBe(false);
    }
  });

  it('từ chối nav âm, NaN và chuỗi', () => {
    expect(zNavPayload.safeParse({ points: [{ date: '2026-01-02', nav: -1 }] }).success).toBe(false);
    expect(zNavPayload.safeParse({ points: [{ date: '2026-01-02', nav: NaN }] }).success).toBe(false);
    expect(zNavPayload.safeParse({ points: [{ date: '2026-01-02', nav: '1' }] }).success).toBe(false);
  });

  it('strict: field lạ bị từ chối, vì nó nghĩa là hợp đồng đã đổi', () => {
    expect(
      zNavPayload.safeParse({ points: [{ date: '2026-01-02', nav: 1, extra: true }] }).success,
    ).toBe(false);
    expect(zNavPayload.safeParse({ points: [], meta: {} }).success).toBe(false);
  });
});

describe('normalizePoints', () => {
  it('sắp theo ngày tăng dần', () => {
    // BE không hứa thứ tự, và chuỗi không sắp vẽ ra đường zigzag đi ngược —
    // trông như dữ liệu hỏng chứ không như lỗi sắp xếp.
    const out = normalizePoints([p('2026-03-01', 3), p('2026-01-01', 1), p('2026-02-01', 2)]);
    expect(out.map((x) => x.date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('ngày trùng thì giữ bản ghi SAU — dữ liệu tài chính thì bản sau là bản đã điều chỉnh', () => {
    const out = normalizePoints([p('2026-01-01', 1), p('2026-01-01', 9)]);
    expect(out).toEqual([p('2026-01-01', 9)]);
  });
});

describe('pointsInRange — tính từ điểm CUỐI, không từ hôm nay', () => {
  const series = [
    p('2020-06-01', 1), p('2022-06-01', 2), p('2024-06-01', 3),
    p('2025-06-01', 4), p('2026-01-01', 5), p('2026-06-01', 6),
  ];

  it('all trả toàn bộ', () => {
    expect(pointsInRange(series, 'all')).toHaveLength(6);
  });

  it('1y lấy 12 tháng gần nhất TÍNH TỪ ĐIỂM CUỐI', () => {
    // Nếu tính từ hôm nay thì BE ngừng cập nhật ba tháng sẽ làm biểu đồ lặng lẽ
    // ngắn đi ba tháng. Điểm cuối là 2026-06-01, nên mốc là 2025-06-01.
    expect(pointsInRange(series, '1y').map((x) => x.date))
      .toEqual(['2025-06-01', '2026-01-01', '2026-06-01']);
  });

  it('3y và 5y cắt đúng', () => {
    expect(pointsInRange(series, '3y')[0]!.date).toBe('2024-06-01');
    expect(pointsInRange(series, '5y')[0]!.date).toBe('2022-06-01');
  });

  it('29/02 không bị mất một ngày', () => {
    // Lùi năm trên CHUỖI: 2024-02-29 → 2023-02-29, một ngày không tồn tại nhưng
    // đúng làm mốc so chuỗi. Qua `Date` thì nó nhảy sang 2023-03-01 và điểm
    // 2023-02-28 bị loại oan.
    const leap = [p('2023-02-28', 1), p('2023-03-01', 2), p('2024-02-29', 3)];
    expect(pointsInRange(leap, '1y').map((x) => x.date))
      .toEqual(['2023-03-01', '2024-02-29']);
  });

  it('chuỗi rỗng không ném', () => {
    expect(pointsInRange([], '1y')).toEqual([]);
  });
});

describe('navGeometry', () => {
  it('toạ độ trong 0…100, và trục y ĐẢO (NAV cao nằm trên)', () => {
    const geo = navGeometry([p('2026-01-01', 10), p('2026-02-01', 20)]);
    expect(geo.polyline).toBe('0.00,100.00 100.00,0.00');
    expect(geo.min).toBe(10);
    expect(geo.max).toBe(20);
  });

  it('chuỗi PHẲNG vẽ ở giữa, không sinh NaN', () => {
    // `span === 0` là phép chia cho 0. `<polyline points="NaN,NaN">` là một đường
    // biến mất và không có lỗi nào — đúng loại im lặng tệ nhất.
    const geo = navGeometry([p('2026-01-01', 5), p('2026-02-01', 5)]);
    expect(geo.polyline).toBe('0.00,50.00 100.00,50.00');
    expect(geo.polyline).not.toContain('NaN');
  });

  it('MỘT điểm không sinh NaN', () => {
    const geo = navGeometry([p('2026-01-01', 5)]);
    expect(geo.polyline).toBe('0.00,50.00');
    expect(geo.polyline).not.toContain('NaN');
  });

  it('chuỗi rỗng trả hình học rỗng, không ném', () => {
    const geo = navGeometry([]);
    expect(geo.polyline).toBe('');
    expect(geo.first).toBeNull();
    expect(geo.changePct).toBeNull();
  });

  it('changePct tính từ điểm đầu tới điểm cuối', () => {
    expect(navGeometry([p('2026-01-01', 100), p('2026-02-01', 125)]).changePct).toBeCloseTo(25);
    expect(navGeometry([p('2026-01-01', 100), p('2026-02-01', 80)]).changePct).toBeCloseTo(-20);
  });

  it('điểm đầu bằng 0 thì changePct là null, không phải Infinity', () => {
    expect(navGeometry([p('2026-01-01', 0), p('2026-02-01', 5)]).changePct).toBeNull();
  });
});

describe('availableRanges — chỉ bày mốc CẮT được thật', () => {
  it('chuỗi 10 năm bày cả bốn', () => {
    const long = [p('2016-01-01', 1), p('2021-01-01', 2), p('2024-01-01', 3), p('2026-01-01', 4)];
    expect(availableRanges(long)).toEqual(['1y', '3y', '5y', 'all']);
  });

  it('chuỗi 6 tháng chỉ bày `all`', () => {
    // Bày cả bốn nút khi ba nút cho ra cùng một hình thì người dùng bấm rồi tưởng
    // biểu đồ hỏng.
    expect(availableRanges([p('2026-01-01', 1), p('2026-06-01', 2)])).toEqual(['all']);
  });

  it('chuỗi 2 năm bày 1y và all', () => {
    expect(availableRanges([p('2024-06-01', 1), p('2026-06-01', 2)])).toEqual(['1y', 'all']);
  });

  it('chuỗi rỗng vẫn có `all`', () => {
    expect(availableRanges([])).toEqual(['all']);
  });
});
