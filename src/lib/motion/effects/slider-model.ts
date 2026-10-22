/**
 * Từ tham số của effect `slider` ra cấu hình Swiper. Số học thuần, không DOM.
 *
 * Tách khỏi `slider.ts` cùng lý do `carousel-model.ts` tách khỏi `carousel.ts`:
 * phần dễ sai nhất là phép ánh xạ tham số, và nó kiểm được mà không cần một
 * trình duyệt. Ở đây còn một lý do riêng: import `swiper` là import một thư
 * viện chạm `window`, nên một test đi qua nó sẽ kiểm cả Swiper thay vì kiểm ta.
 *
 * ## Vì sao PRESET phải thắng `.default()` của Zod, và giá phải trả
 *
 * Yêu cầu gốc nói `preset` "gói sẵn hai hành vi; các param dưới ghi đè từng
 * cái". Nghe đơn giản, nhưng nó KHÔNG biểu diễn được nếu mọi param đều có
 * `.default()`: sau `parse`, `{ preset: 'marquee' }` và
 * `{ preset: 'marquee', loop: true }` là hai object giống nhau từng byte — Zod
 * đã điền default và không để lại dấu vết nào cho biết ai gõ gì. Áp preset
 * TRƯỚC rồi phủ default lên là biến `preset: 'marquee'` thành một dải nhảy từng
 * trang, im lặng, vì `loop`/`freeMode`/`speedMs`/`autoplayDelayMs` mặc định đều
 * là giá trị của preset `slide`.
 *
 * Nên đúng bốn tham số phân biệt hai preset được khai `.optional()` — KHÔNG có
 * default — và giá trị hiệu lực là `giá trị gõ tay ?? bảng preset`. Cái giá là
 * thật và phải nói ra: `defaults` mà `scripts/sync-effects.ts` sinh ra (bằng
 * cách parse `{}`) sẽ KHÔNG chứa bốn tham số ấy, nên AI đọc `list_effects`
 * không thấy giá trị mặc định của chúng ở cột `defaults`. Bù lại bằng cách ghi
 * thẳng bảng preset vào `aiDescription` — xem `slider.ts`.
 *
 * ## Vì sao bảng preset khác tài liệu ở `loop`
 *
 * Bảng tham số của tài liệu yêu cầu ghi `loop` mặc định `true`, nhưng ví dụ cấu
 * hình của chính nó cho preset `slide` lại ghi `loop: false`. Hai chỗ trong một
 * tài liệu nói ngược nhau. Chọn theo ví dụ (`slide` → `loop: false`) vì hai
 * state `slider-begin`/`slider-end` mà tài liệu cũng yêu cầu chỉ có nghĩa khi
 * dải CÓ hai đầu — với `loop: true` thì không bao giờ ở đầu hay ở cuối, và hai
 * state ấy thành hai attribute chết.
 */

import { BREAKPOINT_PX } from '@/lib/design/breakpoints';

import type { SwiperOptions } from 'swiper/types';

export const SLIDER_PRESETS = ['slide', 'marquee'] as const;
export type SliderPreset = (typeof SLIDER_PRESETS)[number];

export type SlidesPerView = number | 'auto';

export interface SliderBreakpointOverride {
  slidesPerView?: SlidesPerView;
  spaceBetween?: number;
}

/** Bốn mốc của builder, không phải px tự do — xem `resolveBreakpoints`. */
export type SliderBreakpointKey = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Hình dạng tham số mà `resolveSliderConfig` cần.
 *
 * Khai lại ở đây thay vì import `z.infer` từ `slider.ts`: hướng phụ thuộc phải
 * là effect → model, không phải ngược lại (nếu ngược thì model kéo theo cả
 * `swiper` vào test). Hai bên không trôi được khỏi nhau vì `slider.ts` truyền
 * `z.infer<typeof paramsSchema>` vào đây, nên lệch một field là lỗi kiểu.
 */
export interface SliderParams {
  preset: SliderPreset;
  slidesPerView: SlidesPerView;
  spaceBetween: number;
  centeredSlides: boolean;
  grabCursor: boolean;
  autoplay: boolean;
  pauseOnHover: boolean;
  disableOnInteraction: boolean;
  reverseDirection: boolean;
  direction: 'horizontal' | 'vertical';
  breakpoints: Partial<Record<SliderBreakpointKey, SliderBreakpointOverride>>;
  a11yLabel?: string;

  /* Bốn cái dưới đây KHÔNG có default — preset quyết định. Xem đầu file. */
  loop?: boolean;
  freeMode?: boolean;
  speedMs?: number;
  autoplayDelayMs?: number;
}

interface PresetBase {
  loop: boolean;
  freeMode: boolean;
  speedMs: number;
  autoplayDelayMs: number;
}

/**
 * Hai hành vi, bốn con số.
 *
 * `marquee`: `autoplayDelayMs: 0` là thứ làm nó chạy LIÊN TỤC — Swiper nối
 * transition kế tiếp ngay khi transition trước xong, và `speedMs` lớn biến mỗi
 * transition thành một quãng trôi dài thay vì một cú nhảy. Thiếu `freeMode` thì
 * nó vẫn snap vào mép slide và dải giật từng nấc; thiếu `loop` thì nó chạy hết
 * bộ slide rồi đứng.
 */
export const SLIDER_PRESET_BASE: Record<SliderPreset, PresetBase> = {
  slide: { loop: false, freeMode: false, speedMs: 400, autoplayDelayMs: 4000 },
  marquee: { loop: true, freeMode: true, speedMs: 5000, autoplayDelayMs: 0 },
};

/** Giá trị hiệu lực của bốn tham số do preset chi phối. */
export function resolvePresetFields(p: SliderParams): PresetBase {
  const base = SLIDER_PRESET_BASE[p.preset];
  return {
    loop: p.loop ?? base.loop,
    freeMode: p.freeMode ?? base.freeMode,
    speedMs: p.speedMs ?? base.speedMs,
    autoplayDelayMs: p.autoplayDelayMs ?? base.autoplayDelayMs,
  };
}

/**
 * Dải chạy LIÊN TỤC (kiểu băng logo) chứ không nhảy từng trang.
 *
 * `delay === 0` là điều kiện duy nhất, và nó đọc được từ ngoài vì hai thứ khác
 * phải bám theo nó: timing function phải là `linear` (ease-out giữa hai quãng
 * trôi liên tiếp tạo ra một nhịp thở mà mắt thấy rõ), và `freeMode.momentum`
 * phải tắt (momentum sau khi nhả tay sẽ đẩy dải vượt qua rồi kéo về).
 */
export function isContinuous(p: SliderParams): boolean {
  return resolvePresetFields(p).autoplayDelayMs === 0;
}

/**
 * Breakpoint của builder → `min-width` px mà Swiper nhận.
 *
 * Swiper nhận px thô, và đó chính là chỗ dễ hỏng: một người gõ `{ 900: … }` thì
 * dải đổi số cột ở 900 trong khi mọi thứ khác trên trang đổi ở 768 và 1024, nên
 * có một dải bề rộng mà trang nửa nọ nửa kia. Nên tham số chỉ nhận bốn KHOÁ
 * (`sm`/`md`/`lg`/`xl`) và px suy ra từ `BREAKPOINT_PX` — đổi thang breakpoint
 * thì dải đi theo, không phải rà lại từng trang.
 *
 * `breakpointsBase` để mặc định (`window`): trong builder mỗi khổ canvas là một
 * iframe riêng, nên `window` của iframe LÀ bề rộng khung đang xem, và dải đổi
 * cột đúng chỗ ngay trên canvas.
 */
export function resolveBreakpoints(
  breakpoints: Partial<Record<SliderBreakpointKey, SliderBreakpointOverride>>,
): SwiperOptions['breakpoints'] {
  const out: NonNullable<SwiperOptions['breakpoints']> = {};
  for (const [key, override] of Object.entries(breakpoints)) {
    if (!override) continue;
    const px = BREAKPOINT_PX[key as SliderBreakpointKey];
    out[px] = {
      ...(override.slidesPerView !== undefined ? { slidesPerView: override.slidesPerView } : {}),
      ...(override.spaceBetween !== undefined ? { spaceBetween: override.spaceBetween } : {}),
    };
  }
  return out;
}

export interface SliderEnvironment {
  /**
   * Người dùng tắt chuyển động.
   *
   * Vào tham số chứ không đọc `prefersReducedMotion()` bên trong: hàm này phải
   * kiểm được, và nó cũng được gọi LẠI khi người dùng đổi cài đặt giữa phiên.
   */
  reducedMotion: boolean;
  prevEl?: Element | null;
  nextEl?: Element | null;
  paginationEl?: Element | null;
}

/**
 * Cấu hình Swiper đầy đủ.
 *
 * ## Vì sao reduced motion tắt autoplay mà KHÔNG chặn cả effect
 *
 * Đúng lý lẽ `carousel.ts` đã viết và `gates: { respectReducedMotion: false }`
 * dựa vào: chặn thẳng thì hai mũi tên và pagination không bao giờ được nối, nên
 * dải chỉ đi được bằng cách kéo tay — hỏng nặng hơn hẳn một dải không tự chạy.
 * Ở đây `autoplay: false` là toàn bộ khác biệt; mọi điều khiển vẫn sống.
 *
 * ## `navigation`/`pagination` chỉ bật khi CÓ element
 *
 * Truyền `navigation: true` với `prevEl: null` làm Swiper tự đi tìm
 * `.swiper-button-prev` — một class mà cây node không đặt được — rồi không tìm
 * thấy và không nói gì. Nên chúng bật theo sự có mặt của `part="prev"` /
 * `"next"` / `"pagination"`, và `slider.ts` là chỗ cảnh báo khi thiếu.
 */
export function resolveSliderConfig(p: SliderParams, env: SliderEnvironment): SwiperOptions {
  const { loop, freeMode, speedMs, autoplayDelayMs } = resolvePresetFields(p);
  const continuous = autoplayDelayMs === 0;
  const autoplayOn = p.autoplay && !env.reducedMotion;

  return {
    direction: p.direction,
    slidesPerView: p.slidesPerView,
    spaceBetween: p.spaceBetween,
    centeredSlides: p.centeredSlides,
    grabCursor: p.grabCursor,
    loop,
    speed: speedMs,

    /*
     * `momentum: false` khi chạy liên tục.
     *
     * Momentum là quán tính sau khi nhả tay. Với một dải nhảy từng trang nó là
     * hành vi đúng; với một băng đang trôi đều thì cú vuốt nào cũng ném dải
     * vượt qua vị trí rồi autoplay kéo về, và mắt thấy một cú giật.
     */
    freeMode: freeMode ? { enabled: true, momentum: !continuous } : false,

    autoplay: autoplayOn
      ? {
          delay: autoplayDelayMs,
          disableOnInteraction: p.disableOnInteraction,
          pauseOnMouseEnter: p.pauseOnHover,
          reverseDirection: p.reverseDirection,
          // Không `loop` thì tới cuối là hết; để autoplay tiếp tục chạy interval
          // trên một dải không nhúc nhích chỉ tốn pin.
          stopOnLastSlide: !loop,
        }
      : false,

    /*
     * `observer` bắt thay đổi DOM bên trong slide.
     *
     * Với `slidesPerView: 'auto'` bề rộng slide đến từ nội dung, và nội dung
     * chưa ổn định lúc init: webfont chưa swap, ảnh chưa decode. Đọc một lần thì
     * Swiper tính `virtualSize` theo bề rộng lúc chưa có ảnh, và dải trôi lệch
     * một quãng bằng đúng phần thiếu. `resizeObserver` mặc định của Swiper chỉ
     * canh container; ba cờ này canh phần bên trong.
     */
    observer: true,
    observeParents: true,
    observeSlideChildren: true,

    ...(env.prevEl || env.nextEl
      ? {
          navigation: {
            ...(env.prevEl ? { prevEl: env.prevEl as HTMLElement } : {}),
            ...(env.nextEl ? { nextEl: env.nextEl as HTMLElement } : {}),
          },
        }
      : {}),

    ...(env.paginationEl
      ? { pagination: { el: env.paginationEl as HTMLElement, clickable: true } }
      : {}),

    /*
     * Thông báo tiếng Việt, không phải mặc định tiếng Anh của Swiper.
     *
     * Đây là chuỗi mà screen reader ĐỌC RA, tức là nội dung hiển thị — để nguyên
     * "Previous slide" trên một site tiếng Việt là một lỗi nhìn thấy được, chỉ
     * là nhìn bằng tai.
     */
    a11y: {
      enabled: true,
      prevSlideMessage: 'Mục trước',
      nextSlideMessage: 'Mục sau',
      firstSlideMessage: 'Đây là mục đầu',
      lastSlideMessage: 'Đây là mục cuối',
      paginationBulletMessage: 'Tới mục {{index}}',
      ...(p.a11yLabel ? { containerMessage: p.a11yLabel } : {}),
    },

    breakpoints: resolveBreakpoints(p.breakpoints),
  };
}
