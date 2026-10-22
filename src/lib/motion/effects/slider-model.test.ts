/**
 * Bộ kiểm cho phép ánh xạ tham số → cấu hình Swiper.
 *
 * Cùng tinh thần với `registry.test.ts`: nó không kiểm dải có đẹp không, nó canh
 * những chỗ mà một thay đổi vô hại sẽ làm hỏng IM LẶNG. Có ba chỗ như thế:
 *
 *  1. `preset: 'marquee'` trôi thành một dải nhảy từng trang, vì ai đó thêm
 *     `.default()` cho `loop`/`freeMode`/`speedMs`/`autoplayDelayMs`.
 *  2. `breakpoints` sinh ra px không khớp thang của builder, nên dải đổi cột
 *     lệch pha với mọi thứ khác trên trang.
 *  3. Bản chép tay `slider.css` trôi khỏi Swiper sau một lần nâng major.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BREAKPOINT_PX } from '@/lib/design/breakpoints';
import {
  isContinuous,
  resolveBreakpoints,
  resolvePresetFields,
  resolveSliderConfig,
  SLIDER_PRESET_BASE,
  type SliderParams,
} from './slider-model';

function params(over: Partial<SliderParams> = {}): SliderParams {
  return {
    preset: 'slide',
    slidesPerView: 'auto',
    spaceBetween: 0,
    centeredSlides: false,
    grabCursor: false,
    autoplay: true,
    pauseOnHover: true,
    disableOnInteraction: false,
    reverseDirection: false,
    direction: 'horizontal',
    breakpoints: {},
    ...over,
  };
}

describe('preset marquee', () => {
  /**
   * Đây là phép kiểm mà tài liệu yêu cầu đích danh. Lý do nó đáng có: cả ba
   * điều kiện dưới đây đều hỏng theo kiểu "dải vẫn chạy, chỉ là chạy sai", và
   * không có gì trong runtime báo ra.
   */
  it('chạy liên tục: delay 0, freeMode bật, loop bật, timing linear được phép', () => {
    const cfg = resolveSliderConfig(params({ preset: 'marquee' }), { reducedMotion: false });

    expect(cfg.autoplay).toMatchObject({ delay: 0 });
    expect(cfg.freeMode).toMatchObject({ enabled: true });
    expect(cfg.loop).toBe(true);
    expect(isContinuous(params({ preset: 'marquee' }))).toBe(true);
  });

  it('momentum TẮT khi chạy liên tục', () => {
    // Momentum sau khi nhả tay ném dải vượt qua vị trí rồi autoplay kéo về — một
    // cú giật thấy được ở mọi lần vuốt.
    const cfg = resolveSliderConfig(params({ preset: 'marquee' }), { reducedMotion: false });
    expect(cfg.freeMode).toMatchObject({ momentum: false });
  });

  it('preset slide KHÔNG chạy liên tục và KHÔNG nối vòng', () => {
    const p = params();
    expect(isContinuous(p)).toBe(false);
    const cfg = resolveSliderConfig(p, { reducedMotion: false });
    expect(cfg.loop).toBe(false);
    expect(cfg.autoplay).toMatchObject({ delay: SLIDER_PRESET_BASE.slide.autoplayDelayMs });
  });
});

describe('tham số gõ tay ghi đè preset', () => {
  it.each([
    ['loop', { loop: false }, (c: ReturnType<typeof resolveSliderConfig>) => c.loop, false],
    ['speedMs', { speedMs: 111 }, (c: ReturnType<typeof resolveSliderConfig>) => c.speed, 111],
  ] as const)('%s', (_name, over, read, expected) => {
    const cfg = resolveSliderConfig(params({ preset: 'marquee', ...over }), {
      reducedMotion: false,
    });
    expect(read(cfg)).toBe(expected);
  });

  it('autoplayDelayMs gõ tay biến marquee thành dải nhảy từng trang', () => {
    const p = params({ preset: 'marquee', autoplayDelayMs: 3000 });
    expect(isContinuous(p)).toBe(false);
    expect(resolveSliderConfig(p, { reducedMotion: false }).autoplay).toMatchObject({
      delay: 3000,
    });
  });

  it('freeMode: false gỡ hẳn free mode khỏi cấu hình', () => {
    const cfg = resolveSliderConfig(params({ preset: 'marquee', freeMode: false }), {
      reducedMotion: false,
    });
    expect(cfg.freeMode).toBe(false);
  });

  it('giá trị KHÔNG gõ vẫn lấy từ preset', () => {
    // Chốt chặn cho chuyện ngược lại: ghi đè một cái không được kéo theo ba cái kia.
    expect(resolvePresetFields(params({ preset: 'marquee', speedMs: 1 }))).toEqual({
      loop: true,
      freeMode: true,
      speedMs: 1,
      autoplayDelayMs: 0,
    });
  });
});

describe('reduced motion', () => {
  it('tắt autoplay nhưng KHÔNG tắt gì khác', () => {
    const el = { nodeType: 1 } as unknown as Element;
    const cfg = resolveSliderConfig(params({ preset: 'marquee' }), {
      reducedMotion: true,
      prevEl: el,
      nextEl: el,
    });

    expect(cfg.autoplay).toBe(false);
    // Điều khiển vẫn được nối — đây là toàn bộ lý do `gates.respectReducedMotion`
    // là false thay vì để runtime chặn thẳng effect.
    expect(cfg.navigation).toMatchObject({ prevEl: el, nextEl: el });
    expect(cfg.loop).toBe(true);
  });

  it('autoplay: false của người dùng cũng tắt, không cần reduced motion', () => {
    expect(
      resolveSliderConfig(params({ autoplay: false }), { reducedMotion: false }).autoplay,
    ).toBe(false);
  });
});

describe('navigation và pagination chỉ bật khi có element', () => {
  it('không có part nào thì không khai gì', () => {
    const cfg = resolveSliderConfig(params(), { reducedMotion: false });
    // `undefined` chứ không phải `true`: `navigation: true` làm Swiper đi tìm
    // `.swiper-button-prev` — class mà cây node không đặt được — rồi im lặng.
    expect(cfg.navigation).toBeUndefined();
    expect(cfg.pagination).toBeUndefined();
  });
});

describe('breakpoints bám thang của builder', () => {
  it('khoá sm/md/lg/xl ra đúng px trong BREAKPOINT_PX', () => {
    const out = resolveBreakpoints({
      sm: { slidesPerView: 2 },
      lg: { slidesPerView: 4, spaceBetween: 24 },
    });

    expect(Object.keys(out!).map(Number).sort((a, b) => a - b)).toEqual([
      BREAKPOINT_PX.sm,
      BREAKPOINT_PX.lg,
    ].sort((a, b) => a - b));
    expect(out![BREAKPOINT_PX.lg]).toEqual({ slidesPerView: 4, spaceBetween: 24 });
  });

  it('không sinh ra mốc 560 hay 900', () => {
    // Thang cũ của site cũ. Tài liệu nào còn ghi 560/900 là đã cũ — xem docblock
    // trong `src/lib/design/breakpoints.ts`.
    const out = resolveBreakpoints({ sm: { slidesPerView: 2 }, md: { slidesPerView: 3 } });
    expect(Object.keys(out!)).not.toContain('560');
    expect(Object.keys(out!)).not.toContain('900');
  });

  it('override rỗng không sinh key rác', () => {
    expect(resolveBreakpoints({ sm: {} })).toEqual({ [BREAKPOINT_PX.sm]: {} });
  });
});

describe('bản chép tay của swiper.css', () => {
  /**
   * `src/styles/effects/slider.css` là CSS cấu trúc của Swiper chép tay — lý do
   * đầy đủ ở đầu file đó và ở đầu `slider.ts`. Bản chép thì trôi, và nó trôi
   * lặng lẽ: dải vẫn dựng được, chỉ là hình sai.
   *
   * Ghim MAJOR chứ không ghim bản đầy đủ: Swiper vá minor gần như hàng tuần và
   * một test đỏ mỗi tuần là một test bị tắt. Major là ranh giới mà upstream tự
   * hứa là có breaking change.
   */
  const CHECKED_AGAINST_MAJOR = 14;

  it('swiper vẫn ở major đã đối chiếu', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const range = pkg.dependencies.swiper ?? '';
    expect(range, 'swiper phải nằm trong dependencies').toBeTruthy();

    const major = Number(range.replace(/^[^\d]*/, '').split('.')[0]);
    expect(
      major,
      `swiper lên major ${major}. Mở node_modules/swiper/swiper.css đối chiếu với ` +
        'src/styles/effects/slider.css rồi sửa con số này.',
    ).toBe(CHECKED_AGAINST_MAJOR);
  });

  it('giữ đúng những selector mà slider.ts gắn class vào', () => {
    const css = readFileSync('src/styles/effects/slider.css', 'utf8');
    for (const selector of ['.swiper', '.swiper-wrapper', '.swiper-slide', '.swiper-pagination']) {
      expect(css, `slider.css thiếu ${selector}`).toContain(`${selector} {`);
    }
    // Chỗ này là cố ý khác upstream và dễ bị "sửa lại cho giống": khai bề rộng
    // slide làm `slidesPerView: 'auto'` mất nghĩa.
    expect(css).not.toMatch(/\.swiper-slide\s*\{[^}]*\binline-size:\s*100%/);
  });
});
