/**
 * Bất biến "một vòng lặp animation duy nhất".
 *
 * Đây là rủi ro R2 của kế hoạch. Test ở đây canh phần logic thuần; phần khó
 * hơn — StrictMode double-mount và client navigation — cần Playwright trên
 * trình duyệt thật và nằm ở bài test riêng.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as raf from './raf';
import type { GsapTickerLike } from './raf';

afterEach(() => {
  raf.destroy();
  raf.configure(null);
});

/** gsap.ticker giả, đủ để raf.ts dùng làm clock. */
function fakeGsap() {
  const listeners: Array<(e: number, d: number, f: number) => void> = [];
  let lagSmoothingCalledWith: number | null = null;
  const gsap: GsapTickerLike = {
    ticker: {
      add: (fn) => { listeners.push(fn); },
      remove: (fn) => {
        const i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
      },
      lagSmoothing: (v) => { lagSmoothingCalledWith = v; },
    },
  };
  return {
    gsap,
    listeners,
    tick: (elapsedSec: number, deltaMs: number) => {
      for (const l of [...listeners]) l(elapsedSec, deltaMs, 0);
    },
    get lagSmoothing() { return lagSmoothingCalledWith; },
  };
}

describe('raf — đăng ký', () => {
  it('add trả về hàm huỷ và count phản ánh đúng', () => {
    expect(raf.count()).toBe(0);
    const off = raf.add(() => {});
    expect(raf.count()).toBe(1);
    off();
    expect(raf.count()).toBe(0);
  });

  it('add cùng một hàm hai lần không tạo subscriber trùng', () => {
    const fn = () => {};
    raf.add(fn);
    raf.add(fn);
    expect(raf.count()).toBe(1);
  });

  it('add với thứ không phải hàm thì ném lỗi', () => {
    expect(() => raf.add(null as never)).toThrow(TypeError);
  });
});

describe('raf — thứ tự priority', () => {
  it('chạy theo priority tăng dần: scroll → effect → renderer', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);

    const order: string[] = [];
    // Đăng ký ngược thứ tự để chứng minh sort thật sự chạy.
    raf.add(() => order.push('renderer'), raf.PRIORITY.renderer);
    raf.add(() => order.push('effect'), raf.PRIORITY.effect);
    raf.add(() => order.push('scroll'), raf.PRIORITY.scroll);

    raf.start();
    g.tick(1, 16);

    expect(order).toEqual(['scroll', 'effect', 'renderer']);
  });
});

describe('raf — một vòng lặp duy nhất', () => {
  it('start hai lần chỉ gắn MỘT listener lên ticker', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);

    raf.start();
    raf.start();
    raf.start();

    // Nhiều listener nghĩa là mỗi frame dispatch nhiều lần — chính là bug
    // mà cả kiến trúc này tồn tại để tránh.
    expect(g.listeners).toHaveLength(1);
  });

  it('stop gỡ listener khỏi ticker', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);
    raf.start();
    expect(g.listeners).toHaveLength(1);
    raf.stop();
    expect(g.listeners).toHaveLength(0);
  });

  it('tắt lagSmoothing — nếu không Lenis lệch khỏi thời gian thực', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);
    raf.start();
    expect(g.lagSmoothing).toBe(0);
  });

  it('dùng driver gsap khi có gsap, và rơi về rAF gốc khi không', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);
    raf.start();
    expect(raf.getDriver()).toBe('gsap');
    raf.destroy();

    raf.configure(null);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    raf.start();
    expect(raf.getDriver()).toBe('raf');

    // Dọn TRƯỚC khi gỡ stub: afterEach gọi destroy() → stop(), và ở driver 'raf'
    // stop() cần cancelAnimationFrame. Gỡ stub trước là tự gây lỗi trong dọn dẹp.
    raf.destroy();
    vi.unstubAllGlobals();
  });
});

describe('raf — độ bền', () => {
  it('subscriber ném lỗi thì bị gỡ, các subscriber khác vẫn chạy', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let goodRan = 0;
    raf.add(() => { throw new Error('bùm'); });
    raf.add(() => { goodRan += 1; });

    raf.start();
    g.tick(1, 16);

    expect(raf.count()).toBe(1);
    expect(goodRan).toBe(1);

    // Frame sau: cái hỏng đã biến mất, cái tốt vẫn chạy.
    g.tick(2, 16);
    expect(goodRan).toBe(2);
    spy.mockRestore();
  });

  it('delta bị chặn trên — khoảng trống dài không làm giá trị damped nhảy vọt', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);

    const deltas: number[] = [];
    raf.add((f) => deltas.push(f.deltaMs));

    raf.start();
    g.tick(1, 16);
    g.tick(6, 5000); // tab quay lại sau 5 giây

    expect(deltas[0]).toBe(16);
    expect(deltas[1]).toBe(100); // MAX_DELTA_MS
  });

  it('subscriber tự gỡ mình giữa frame không làm hỏng vòng lặp', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);

    let ranAfter = 0;
    const off = raf.add(() => off());
    raf.add(() => { ranAfter += 1; });

    raf.start();
    expect(() => g.tick(1, 16)).not.toThrow();
    expect(ranAfter).toBe(1);
    expect(raf.count()).toBe(1);
  });
});

describe('raf — destroy trả về trạng thái sạch', () => {
  it('xoá mọi subscriber và dừng vòng lặp', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);
    raf.add(() => {});
    raf.add(() => {});
    raf.start();

    raf.destroy();

    expect(raf.count()).toBe(0);
    expect(raf.isRunning()).toBe(false);
    expect(g.listeners).toHaveLength(0);
  });

  it('mount–destroy lặp lại không tích luỹ subscriber (chống rò rỉ điều hướng)', () => {
    const g = fakeGsap();
    raf.configure(g.gsap);

    for (let i = 0; i < 5; i += 1) {
      raf.add(() => {});
      raf.add(() => {});
      raf.start();
      raf.destroy();
      raf.configure(g.gsap);
    }

    expect(raf.count()).toBe(0);
    expect(g.listeners).toHaveLength(0);
  });
});
