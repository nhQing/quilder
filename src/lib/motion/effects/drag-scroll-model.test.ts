/**
 * Test cho đà quán tính của cú kéo chuột — port từ dragScroll.test.mjs.
 * Chỉ phủ phần số học; listener và vòng rAF thuộc về trình duyệt.
 */

import { describe, expect, it } from 'vitest';

import {
  FLICK_BLEND,
  IDLE_MS,
  MAX_DURATION,
  MIN_DURATION,
  MIN_FLICK,
  PROJECTION_MS,
  blendVelocity,
  easeOutCubic,
  glideDuration,
  nearestSnap,
  planGlide,
  reachDistance,
} from './drag-scroll-model';

/** Mốc snap một dải thẻ rộng 589 + khe 32, đo ở 1706px. */
const CARDS = [0, 621, 1242, 1863, 2484];

/** Một cú vẩy khoẻ từ đầu dải. */
const flick = { scrollLeft: 0, max: 1565, velocity: 2, idleMs: 0, snaps: CARDS };

describe('blendVelocity', () => {
  it('mẫu đầu kéo vận tốc về phía chính nó theo đúng trọng số', () => {
    expect(blendVelocity(0, 10, 10)).toBe(FLICK_BLEND);
  });
  it('nhiều mẫu cùng chiều thì tiến dần tới vận tốc tức thời', () => {
    let v = 0;
    for (let i = 0; i < 12; i += 1) v = blendVelocity(v, 20, 10);
    expect(v).toBeGreaterThan(1.9);
    expect(v).toBeLessThanOrEqual(2);
  });
  it('một khung 0px không xoá sạch đà của đoạn trước', () => {
    let v = 0;
    for (let i = 0; i < 12; i += 1) v = blendVelocity(v, 20, 10);
    expect(blendVelocity(v, 0, 10)).toBeGreaterThan(v * 0.5);
  });
  it('mẫu dài 0ms bị bỏ qua thay vì ra Infinity', () => {
    expect(blendVelocity(1.5, 8, 0)).toBe(1.5);
    expect(blendVelocity(1.5, 8, -1)).toBe(1.5);
  });
});

describe('nearestSnap', () => {
  it('chọn mốc gần nhất ở cả hai phía', () => {
    expect(nearestSnap(CARDS, 500)).toBe(621);
    expect(nearestSnap(CARDS, 1000)).toBe(1242);
  });
  it('không có mốc nào thì trả chính vị trí đã chiếu', () => {
    expect(nearestSnap([], 731)).toBe(731);
  });
});

describe('glideDuration / reachDistance / easeOutCubic', () => {
  it('thời lượng khớp vận tốc đầu: 3·d/v', () => {
    expect(glideDuration(500, 2)).toBe(750);
  });
  it('vận tốc đầu của easeOutCubic đúng bằng vận tốc lúc thả', () => {
    const distance = 500;
    const velocity = 2;
    const duration = glideDuration(distance, velocity);
    const dt = 0.5;
    const measured = (distance * easeOutCubic(dt / duration)) / dt;
    expect(Math.abs(measured - velocity)).toBeLessThan(0.02);
  });
  it('thời lượng bị kẹp hai đầu', () => {
    expect(glideDuration(4000, 0.1)).toBe(MAX_DURATION);
    expect(glideDuration(2, 5)).toBe(MIN_DURATION);
  });
  it('tầm cú vẩy đúng bằng quãng mà MAX_DURATION còn khớp vận tốc', () => {
    const reach = reachDistance(2);
    expect(glideDuration(reach, 2)).toBe(MAX_DURATION);
    expect(glideDuration(reach + 10, 2)).toBe(MAX_DURATION);
  });
  it('tầm không phụ thuộc chiều vẩy', () => {
    expect(reachDistance(-2)).toBe(reachDistance(2));
  });
  it('đường cong chạy 0 → 1 và không vượt ngoài', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(1.4)).toBe(1);
    expect(easeOutCubic(-0.2)).toBe(0);
  });
  it('giảm tốc: nửa đầu đi được hơn nửa quãng', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
  });
});

describe('planGlide', () => {
  it('vẩy khoẻ thì hạ cánh đúng một mốc thẻ', () => {
    const plan = planGlide(flick);
    expect(plan).not.toBeNull();
    expect(plan!.to).toBe(621);
    expect(plan!.from).toBe(0);
  });
  it('vẩy càng mạnh càng đi xa', () => {
    expect(planGlide({ ...flick, velocity: 2 })!.to).toBe(621);
    expect(planGlide({ ...flick, velocity: 5 })!.to).toBe(1242);
  });
  it('vẩy chưa đủ sức qua một thẻ thì để trình duyệt tự snap', () => {
    expect(planGlide({ ...flick, velocity: 1 })).toBeNull();
  });
  it('mốc ngoài tầm bị loại thay vì kẹp thời lượng', () => {
    const reached = planGlide({ ...flick, velocity: 1.6 });
    expect(reached!.to).toBe(621);
    expect(reached!.duration).toBeLessThan(MAX_DURATION);
    expect(planGlide({ ...flick, velocity: 1.5 })).toBeNull();
  });
  it('giữ tay một nhịp rồi nhả thì không trôi', () => {
    expect(planGlide({ ...flick, idleMs: IDLE_MS + 1 })).toBeNull();
  });
  it('vẩy quá nhẹ thì không trôi', () => {
    expect(planGlide({ ...flick, velocity: MIN_FLICK / 2 })).toBeNull();
  });
  it('mốc gần nhất ngược chiều vẩy thì để trình duyệt tự snap', () => {
    expect(planGlide({ ...flick, scrollLeft: 40, velocity: 0.2 })).toBeNull();
  });
  it('đã ở đúng mốc thì không trôi', () => {
    expect(planGlide({ ...flick, scrollLeft: 621, velocity: 0.1 })).toBeNull();
  });
  it('không trôi ra ngoài hai đầu dải', () => {
    expect(planGlide({ ...flick, scrollLeft: 1400, velocity: 6 })!.to).toBe(1565);
    expect(planGlide({ ...flick, scrollLeft: 400, velocity: -6 })!.to).toBe(0);
  });
  it('vẩy ngược lại cũng hạ cánh đúng mốc', () => {
    expect(planGlide({ ...flick, scrollLeft: 1242, velocity: -2 })!.to).toBe(621);
  });
  it('dải không có mốc snap thì trôi tới đúng chỗ đã chiếu', () => {
    expect(planGlide({ ...flick, snaps: [] })!.to).toBe(flick.velocity * PROJECTION_MS);
  });
});
