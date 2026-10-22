import { describe, expect, it } from 'vitest';

import { rewriteViewportUnits } from './freeze-viewport';

describe('rewriteViewportUnits', () => {
  it('đổi vh, svh, dvh, lvh sang px theo chiều cao thiết bị', () => {
    expect(rewriteViewportUnits('100dvh', 900)).toBe('900px');
    expect(rewriteViewportUnits('50svh', 900)).toBe('450px');
    expect(rewriteViewportUnits('100lvh', 800)).toBe('800px');
    expect(rewriteViewportUnits('25vh', 1000)).toBe('250px');
  });

  it('giữ nguyên phần còn lại của giá trị, kể cả calc và nhiều đơn vị', () => {
    expect(rewriteViewportUnits('calc(100dvh - 4rem)', 900)).toBe('calc(900px - 4rem)');
    expect(rewriteViewportUnits('min(74.07407dvh, 600px)', 810)).toBe('min(600px, 600px)');
    expect(rewriteViewportUnits('clamp(20vh, 10vw, 50vh)', 1000)).toBe('clamp(200px, 10vw, 500px)');
  });

  it('số thập phân, số âm, và số bắt đầu bằng dấu chấm', () => {
    expect(rewriteViewportUnits('.5vh', 1000)).toBe('5px');
    expect(rewriteViewportUnits('-10vh', 900)).toBe('-90px');
  });

  it('không đụng vw, px hay chữ chứa "vh" mà không phải đơn vị', () => {
    expect(rewriteViewportUnits('10vw 20px', 900)).toBe('10vw 20px');
    expect(rewriteViewportUnits('var(--hvh)', 900)).toBe('var(--hvh)');
  });
});
