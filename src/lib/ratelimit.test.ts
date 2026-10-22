import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { peekRateLimit, rateLimit, resetRateLimits } from './ratelimit';

describe('rateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('cho qua đúng `limit` lượt rồi chặn', () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit('a', 5, 60_000).ok, `lượt ${i + 1}`).toBe(true);
    }
    expect(rateLimit('a', 5, 60_000).ok).toBe(false);
  });

  it('mỗi key có gáo riêng', () => {
    for (let i = 0; i < 5; i++) rateLimit('a', 5, 60_000);
    expect(rateLimit('a', 5, 60_000).ok).toBe(false);
    expect(rateLimit('b', 5, 60_000).ok).toBe(true);
  });

  it('đổ lại dần theo thời gian, không reset một cục', () => {
    for (let i = 0; i < 5; i++) rateLimit('a', 5, 60_000);
    expect(rateLimit('a', 5, 60_000).ok).toBe(false);

    // 1/5 cửa sổ → đúng 1 token.
    vi.advanceTimersByTime(12_000);
    expect(rateLimit('a', 5, 60_000).ok).toBe(true);
    expect(rateLimit('a', 5, 60_000).ok).toBe(false);
  });

  it('không cho dồn 2× quanh ranh giới cửa sổ', () => {
    // Đây là lý do dùng gáo token thay vì bộ đếm theo cửa sổ cố định: với cửa sổ
    // cố định, 5 lượt cuối cửa sổ này cộng 5 lượt đầu cửa sổ sau cho ra 10 lượt
    // trong một khoảnh khắc.
    for (let i = 0; i < 5; i++) rateLimit('a', 5, 60_000);
    vi.advanceTimersByTime(60_000);

    let allowed = 0;
    for (let i = 0; i < 10; i++) if (rateLimit('a', 5, 60_000).ok) allowed++;
    expect(allowed).toBe(5);
  });

  it('không tích luỹ quá trần dù để lâu', () => {
    vi.advanceTimersByTime(10 * 60_000);
    let allowed = 0;
    for (let i = 0; i < 20; i++) if (rateLimit('a', 5, 60_000).ok) allowed++;
    expect(allowed).toBe(5);
  });

  it('dọn gáo theo cửa sổ của chính nó, không theo cửa sổ của lời gọi khác', () => {
    // Gáo chậm (5 lượt/giờ) vừa cạn. Một lời gọi ở key khác với cửa sổ 1 phút
    // kích hoạt lượt dọn. Nếu lượt dọn đo bằng cửa sổ 1 phút, gáo chậm bị xoá và
    // nhận lại đủ 5 lượt ngay — đúng lỗ mà login rate limit không được có.
    for (let i = 0; i < 5; i++) rateLimit('slow', 5, 60 * 60_000);
    vi.advanceTimersByTime(25 * 60_000);
    rateLimit('fast', 5, 60_000);

    // 25 phút của cửa sổ 60 phút → đổ lại khoảng 2 lượt, không phải 5.
    let allowed = 0;
    for (let i = 0; i < 5; i++) if (rateLimit('slow', 5, 60 * 60_000).ok) allowed++;
    expect(allowed).toBe(2);
  });

  it('peekRateLimit hỏi mà không tiêu lượt', () => {
    expect(peekRateLimit('a', 2, 60_000).ok).toBe(true);
    for (let i = 0; i < 10; i++) peekRateLimit('a', 2, 60_000);
    // Hỏi mười lần vẫn còn đủ hai lượt.
    expect(rateLimit('a', 2, 60_000).ok).toBe(true);
    expect(rateLimit('a', 2, 60_000).ok).toBe(true);
    const blocked = peekRateLimit('a', 2, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('retryAfter là số giây dương khi bị chặn', () => {
    for (let i = 0; i < 5; i++) rateLimit('a', 5, 60_000);
    const blocked = rateLimit('a', 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });
});
