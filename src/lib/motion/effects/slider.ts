/**
 * Dải ngang, MỘT effect cho cả hai hành vi: nhảy từng trang, và chạy liên tục.
 *
 * Thay cả `marquee` lẫn `carousel`. Trước đây hai hành vi ấy là hai effect, và
 * mỗi cái thiếu đúng nửa của cái kia: `marquee` chạy liên tục và tự co giãn
 * theo nội dung nhưng không có điều khiển nào; `carousel` có mũi tên và nút
 * dừng nhưng nhảy từng trang. Một dải logo đối tác cần nửa đầu, một dải thẻ đánh
 * giá cần nửa sau, và về mặt người dùng chúng là cùng một khối. Swiper phủ cả
 * hai bằng THAM SỐ, nên builder còn một khái niệm "dải ngang" thay vì hai, và
 * tầng MCP học một bộ tham số thay vì hai.
 *
 * ## Bẫy đã làm hỏng `marquee`, và chỗ này tránh nó thế nào
 *
 * `marquee` ghi `--marquee-x` mỗi frame rồi để class preset `.marquee__track` lo
 * phần `transform` (`src/styles/effects/marquee.css`). Cây node dựng qua MCP
 * KHÔNG đặt được class — `NodeBase` có `part`, `htmlId`, `name`, không có
 * `class` — nên effect chạy đủ mọi bước mà không gì nhúc nhích, và bước clone
 * vẫn diễn ra nên DOM lặng lẽ phình gấp đôi. Swiper bám vào đúng khuôn đó:
 * `.swiper > .swiper-wrapper > .swiper-slide`.
 *
 * Nên effect này TỰ GẮN class, từ `data-part` mà tầng node đặt được:
 *
 *   part="viewport"   → .swiper            (Swiper khởi tạo trên element này)
 *   part="track"      → .swiper-wrapper
 *   part="slide"      → .swiper-slide      (mỗi con trực tiếp của track)
 *   part="prev"/"next"/"pagination" → truyền thẳng vào options
 *
 * Và nó gỡ hết class ấy khi dọn, nếu không React mount lần hai sẽ thấy một DOM
 * đã mang class của lần trước.
 *
 * ## Selector là `[data-part~="…"]`, KHÔNG phải `[data-part="…"]`
 *
 * `part` giữ được NHIỀU vai cách nhau bằng khoảng trắng (xem `NodeBase.part`), và
 * một node vừa là slide của dải vừa là nền tối cho `nav-invert` là chuyện bình
 * thường. `carousel.ts` so cả chuỗi (`[data-part="viewport"]`) và vì thế sẽ
 * TRƯỢT trên `part="viewport nav-dark"` — trượt im lặng. Ở đây dùng `~=`, cùng
 * quy ước với `rail-pin`, `menu-toggle`, `cursor` và `nav-invert`.
 *
 * ## Vì sao KHÔNG `import 'swiper/css'`
 *
 * Yêu cầu gốc đề nghị đúng câu lệnh đó, để CSS đi kèm chunk của effect. Nó sai ở
 * repo này, và sai theo kiểu chỉ lộ ra lúc deploy: `scripts/sync-effects.ts` chạy
 * bằng `tsx` trong Node và `import` từng module effect để đọc manifest, còn Node
 * không biết đọc `.css` — đã thử, `ERR_UNKNOWN_FILE_EXTENSION`. Một dòng import
 * CSS ở đây làm `pnpm effects:sync` chết cho CẢ 16 effect, tức bảng `Effect`
 * không sync được nữa và `list_effects` đứng lại ở ảnh chụp cũ.
 *
 * Còn một lý do nữa, nặng hơn: CSS của release được NIÊM PHONG bằng
 * `compileStaticCss`, hàm này đọc 22 dòng `@import` trong `src/styles/site.css`
 * từ đĩa và docblock của nó nói rõ điều kiện "ta sở hữu cả 14 file: không import
 * từ npm". CSS đến từ `node_modules` không vào được bó niêm phong, nên một
 * release cũ mở lại sau khi nâng Swiper sẽ đổi hình.
 *
 * Nên phần CSS cấu trúc của Swiper được chép vào `src/styles/effects/slider.css`
 * — file TA sở hữu, niêm phong được. Cái giá: nó là một bản chép tay và sẽ trôi
 * khi Swiper nâng major. Chốt chặn là `slider-model.test.ts`, nó ghim major của
 * `swiper` trong `package.json`; nâng major thì test đỏ và có người phải đối
 * chiếu lại file CSS.
 *
 * ## Bước lùi có thật so với `carousel`
 *
 * `carousel.ts` cố ý KHÔNG sở hữu trạng thái vị trí: viewport là một scroll
 * container thật, nên "không có gì ở đây lệch được khỏi DOM vì không có gì ở đây
 * nhớ DOM đang ở đâu". Swiper thì ngược lại — nó giữ vị trí, và ở chế độ `loop`
 * nó còn ĐỔI THỨ TỰ slide trong DOM (v11 bỏ cách nhân bản, chuyển sang dời slide
 * thật). `destroy(true, true)` gọi `loopDestroy()` để xếp lại đúng thứ tự cũ,
 * nên vòng đời mount/unmount của React vẫn sạch; nhưng trong lúc dải đang chạy
 * thì thứ tự DOM KHÔNG còn khớp thứ tự trong doc, và ai đọc devtools sẽ thấy
 * lệch. Đổi lại là `loop` liền mạch, `slidesPerView: 'auto'`, breakpoints và a11y
 * mà tự viết sẽ tốn nhiều hơn nhiều.
 *
 * ## `slider-begin` / `slider-end` nằm trên node CỦA EFFECT, không trên mũi tên
 *
 * Yêu cầu gốc hình dung hai state này để "làm mờ mũi tên ở hai đầu bằng
 * `style.states`". Không chạy được như thế: compiler sinh selector
 * `[data-n="<id>"][data-slider-end="true"]` — attribute và style phải ở CÙNG một
 * element — và validator chỉ nhận một state nếu effect ghi nó được gắn trên
 * CHÍNH node đó. Mũi tên là node khác và không mang effect, nên nó không dùng
 * được hai state ấy.
 *
 * Nên hai state được ghi lên node của effect, và có hai đường thật để làm mờ mũi
 * tên: `slider.css` đã cho `.swiper-button-disabled` mờ sẵn (không cần làm gì),
 * hoặc `customCss` trên node của effect với selector hậu duệ
 * `&[data-slider-end="true"] [data-part~="next"] { opacity: .3 }` —
 * `sanitize-css.ts` giữ selector hậu duệ, và `opacity` có trong allowlist của AI.
 */

import { z } from 'zod';
import Swiper from 'swiper';
import { A11y, Autoplay, FreeMode, Navigation, Pagination } from 'swiper/modules';

import { onReducedMotionChange, prefersReducedMotion } from '../reduced-motion';
import { defineEffect } from './types';
import {
  isContinuous,
  resolvePresetFields,
  resolveSliderConfig,
  SLIDER_PRESETS,
  type SliderParams,
} from './slider-model';

const zSlidesPerView = z.union([z.number().min(1).max(24), z.literal('auto')]);

const zBreakpointOverride = z
  .object({
    slidesPerView: zSlidesPerView.optional(),
    spaceBetween: z.number().min(0).max(400).optional(),
  })
  .strict();

/**
 * `.strict()`, khác mọi effect khác trong thư mục này.
 *
 * Schema mở bỏ qua key lạ trong im lặng, nên `autoPlayDelayMs` (hoa chữ P) hay
 * `spacing` được nhận, không báo gì, và dải chạy bằng mặc định trong khi người
 * gõ tin là mình đã đặt tham số. Bộ tham số ở đây đủ lớn để lỗi ấy thành chuyện
 * thường. `.strict()` biến nó thành một dòng cảnh báo trong console của
 * `EffectRuntime` kèm đúng tên key sai.
 *
 * Cái giá phải nói ra: một key lạ làm cả effect KHÔNG chạy (EffectRuntime bỏ qua
 * effect có params không parse được), chứ không phải chạy thiếu một tham số. Đổi
 * một hỏng-im-lặng lấy một hỏng-ồn-ào là đúng hướng của repo này, nhưng nó vẫn
 * là một hỏng.
 */
const paramsSchema = z
  .object({
    preset: z.enum(SLIDER_PRESETS).default('slide'),
    slidesPerView: zSlidesPerView.default('auto'),
    spaceBetween: z.number().min(0).max(400).default(0),
    centeredSlides: z.boolean().default(false),
    grabCursor: z.boolean().default(false),
    autoplay: z.boolean().default(true),
    pauseOnHover: z.boolean().default(true),
    disableOnInteraction: z.boolean().default(false),
    reverseDirection: z.boolean().default(false),
    direction: z.enum(['horizontal', 'vertical']).default('horizontal'),
    breakpoints: z
      .object({
        sm: zBreakpointOverride.optional(),
        md: zBreakpointOverride.optional(),
        lg: zBreakpointOverride.optional(),
        xl: zBreakpointOverride.optional(),
      })
      .strict()
      .default({}),
    a11yLabel: z.string().max(120).optional(),

    /*
     * Bốn tham số KHÔNG có `.default()` — preset quyết định giá trị.
     *
     * Đây là điều kiện để `preset: 'marquee'` không bị default của preset `slide`
     * phủ lên trong im lặng. Lý lẽ đầy đủ ở đầu `slider-model.ts`; hệ quả cần
     * biết ở đây là `defaults` trong bảng `Effect` sẽ không có bốn key này, nên
     * bảng preset được ghi thẳng vào `aiDescription` dưới đây.
     */
    loop: z.boolean().optional(),
    freeMode: z.boolean().optional(),
    speedMs: z.number().min(0).max(20_000).optional(),
    autoplayDelayMs: z.number().min(0).max(30_000).optional(),
  })
  .strict();

type Params = z.infer<typeof paramsSchema>;

/** Class Swiper đòi, gắn theo `data-part`. Gỡ sạch khi dọn. */
const CLASS_SWIPER = 'swiper';
const CLASS_WRAPPER = 'swiper-wrapper';
const CLASS_SLIDE = 'swiper-slide';
const CLASS_PAGINATION = 'swiper-pagination';

function findPart(root: ParentNode, role: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-part~="${role}"]`);
}

/**
 * Tìm cấu trúc, và KÊU TO khi không thấy.
 *
 * Không có nhánh fallback nào. `marquee` có một (`el.firstElementChild` khi
 * không thấy track) và đó là ca tốn nhiều thời gian nhất trong cả buổi dựng
 * `/about-us`: gắn effect vào chính hàng logo thì `firstElementChild` là logo
 * THỨ NHẤT, nên clone bị nhồi vào trong một mắt logo và chúng xếp thành cột dọc.
 * Không lỗi, không cảnh báo, chỉ là một khối sai hình. Đoán một element là tệ
 * hơn không làm gì, miễn là "không làm gì" có nói ra.
 */
function structure(el: HTMLElement): {
  viewport: HTMLElement;
  track: HTMLElement;
  slides: HTMLElement[];
} | null {
  const viewport = el.matches('[data-part~="viewport"]') ? el : findPart(el, 'viewport');
  if (!viewport) {
    console.warn(
      '[slider] không thấy part="viewport". Cần một node bọc vùng cuộn mang ' +
        'part: "viewport", bên trong nó là part: "track", và mỗi mục là part: "slide".',
      el,
    );
    return null;
  }

  const track = findPart(viewport, 'track');
  if (!track) {
    console.warn('[slider] không thấy part="track" bên trong viewport.', viewport);
    return null;
  }

  // `:scope >` là bắt buộc, không phải cho gọn: Swiper chỉ đo con TRỰC TIẾP của
  // wrapper, nên một node `part="slide"` lồng sâu hơn sẽ được gắn class
  // `.swiper-slide` rồi bị Swiper phớt lờ — và dải đứng yên mà không ai biết vì
  // sao.
  const slides = [...track.querySelectorAll<HTMLElement>(':scope > [data-part~="slide"]')];
  if (!slides.length) {
    console.warn(
      '[slider] track không có con trực tiếp nào mang part="slide". Slide phải là ' +
        'con TRỰC TIẾP của track — Swiper không đo node lồng sâu hơn.',
      track,
    );
    return null;
  }

  return { viewport, track, slides };
}

export default defineEffect<Params>({
  key: 'slider',
  name: 'Dải ngang',
  paramsSchema,
  aiDescription:
    'Dải ngang cho cả hai hành vi: preset "slide" nhảy từng trang (dải thẻ đánh giá, ' +
    'dải tin), preset "marquee" chạy liên tục không điểm đầu cuối (dải logo đối tác, ' +
    'trust bar). THAY marquee và carousel — dùng cái này cho khối mới. ' +
    'Cây node phải có: một node part: "viewport" (vùng cuộn, effect gắn vào node bọc ' +
    'nó hoặc vào chính nó), bên trong là part: "track", và mỗi mục là part: "slide" — ' +
    'slide phải là con TRỰC TIẾP của track. Thêm part: "prev" / "next" cho hai mũi tên ' +
    'và part: "pagination" cho hàng chấm; thiếu thì không có điều khiển, effect vẫn chạy. ' +
    'ĐỪNG đặt layout.display trên track (phải là flex) hay flex.shrink trên slide (phải là 0). ' +
    'Bốn tham số loop, freeMode, speedMs, autoplayDelayMs KHÔNG có mặc định cố định — ' +
    'preset quyết định: slide = {loop:false, freeMode:false, speedMs:400, autoplayDelayMs:4000}, ' +
    'marquee = {loop:true, freeMode:true, speedMs:5000, autoplayDelayMs:0}. Gõ tay một ' +
    'trong bốn thì nó ghi đè preset. autoplayDelayMs: 0 là thứ làm dải chạy liên tục. ' +
    'breakpoints nhận khoá sm/md/lg/xl (768/1024/1200/1560), không nhận px tự do. ' +
    'reverseDirection chỉ có tác dụng khi autoplay bật.',
  runtimeCost: 'medium',
  // Kebab-case, chữ thường. Khai camelCase sai CẢ HAI CHIỀU mà không báo gì —
  // xem ghi chú dài trong `carousel.ts` và test trong `registry.test.ts`.
  //
  // Cả ba ghi trên node CỦA EFFECT, không trên mũi tên. Xem đầu file.
  statesWritten: ['slider-ready', 'slider-begin', 'slider-end'],
  // Ba effect này tranh nhau cùng một track: hai cái cùng dời nó sẽ triệt tiêu
  // nhau, và thứ tự gắn quyết định ai thắng — tức là không xác định.
  conflicts: ['marquee', 'carousel'],
  // Tự xử lý reduced motion: tắt autoplay, vẫn nối mũi tên và pagination. Chặn
  // thẳng thì dải chỉ đi được bằng cách kéo tay. Xem `resolveSliderConfig`.
  gates: { respectReducedMotion: false },

  init(el, params) {
    const found = structure(el);
    if (!found) return;
    const { viewport, track, slides } = found;

    const prevEl = findPart(el, 'prev');
    const nextEl = findPart(el, 'next');
    const paginationEl = findPart(el, 'pagination');

    const { loop } = resolvePresetFields(params);
    if (isContinuous(params) && !loop) {
      // Dải chạy liên tục mà không nối vòng thì trôi hết một lượt rồi đứng im ở
      // cuối — trông y như effect hỏng.
      console.warn(
        '[slider] autoplayDelayMs = 0 (chạy liên tục) nhưng loop = false: dải sẽ trôi ' +
          'một lượt rồi đứng. Bỏ loop: false đi, hoặc đặt autoplayDelayMs > 0.',
        el,
      );
    }

    viewport.classList.add(CLASS_SWIPER);
    track.classList.add(CLASS_WRAPPER);
    for (const slide of slides) slide.classList.add(CLASS_SLIDE);
    paginationEl?.classList.add(CLASS_PAGINATION);

    let swiper: Swiper | null = null;

    const syncEdges = (instance: Swiper) => {
      // `loop` thì không bao giờ ở đầu hay ở cuối, nên cả hai state luôn 'false'.
      // Ghi ra thay vì bỏ trống: một attribute vắng mặt và một attribute bằng
      // 'false' phân biệt được "chưa ai ghi" với "đã ghi, và câu trả lời là
      // không".
      el.dataset.sliderBegin = String(instance.isBeginning);
      el.dataset.sliderEnd = String(instance.isEnd);
    };

    const mount = () => {
      swiper = new Swiper(viewport, {
        ...resolveSliderConfig(params as SliderParams, {
          reducedMotion: prefersReducedMotion(),
          prevEl,
          nextEl,
          paginationEl,
        }),
        modules: [A11y, Autoplay, FreeMode, Navigation, Pagination],
        on: {
          // `init` chạy trong lòng constructor, nên `swiper` ở scope ngoài chưa
          // được gán — dùng tham số `instance` chứ không dùng biến.
          init: syncEdges,
          slideChange: syncEdges,
          toEdge: syncEdges,
          fromEdge: syncEdges,
          update: syncEdges,
          resize: syncEdges,
        },
      });

      /*
       * `linear` cho dải chạy liên tục, đặt bằng custom property trên element.
       *
       * `slider.css` viết
       * `transition-timing-function: var(--swiper-wrapper-transition-timing-function, …)`
       * ở cả rule thường và rule free-mode, nên một dòng inline ở đây thắng cả
       * hai. Ghi thẳng `track.style.transitionTimingFunction` thì hỏng: Swiper
       * ghi `transition-duration` lên cùng element mỗi lượt và ta sẽ giành chỗ
       * với nó. Không có dòng này thì mỗi quãng trôi 5 giây có một nhịp
       * chậm–nhanh–chậm, và mắt thấy rõ đó là các lượt nhảy chứ không phải một
       * băng đang trôi.
       */
      if (isContinuous(params)) {
        viewport.style.setProperty('--swiper-wrapper-transition-timing-function', 'linear');
      }
    };

    const unmount = () => {
      // `destroy(true, true)`: tham số thứ hai dọn class và inline style Swiper
      // đã ghi, và `loopDestroy()` bên trong xếp lại thứ tự slide trong DOM.
      swiper?.destroy(true, true);
      swiper = null;
    };

    mount();

    /*
     * Đổi cài đặt reduced motion giữa phiên: dựng lại, không vá.
     *
     * Cách rẻ hơn là `swiper.autoplay.start()`. Nó chạy, nhưng chỉ một nửa: các
     * listener `pauseOnMouseEnter` được module Autoplay nối trong `init` và CHỈ
     * khi autoplay đang bật, nên một dải bật lại bằng `start()` sẽ không dừng
     * khi con trỏ đi vào — một hỏng im lặng đúng loại repo này sợ nhất.
     *
     * Cái giá của dựng lại: dải nhảy về mục đầu. Đổi cài đặt hệ điều hành giữa
     * lúc đang xem một dải là chuyện rất ít gặp, và một dải nhảy về đầu thì thấy
     * ngay chứ không âm thầm.
     */
    const offReducedMotion = onReducedMotionChange(() => {
      unmount();
      mount();
    });

    el.dataset.sliderReady = 'true';

    return () => {
      offReducedMotion();
      unmount();
      viewport.style.removeProperty('--swiper-wrapper-transition-timing-function');
      viewport.classList.remove(CLASS_SWIPER);
      track.classList.remove(CLASS_WRAPPER);
      for (const slide of slides) slide.classList.remove(CLASS_SLIDE);
      paginationEl?.classList.remove(CLASS_PAGINATION);
      delete el.dataset.sliderReady;
      delete el.dataset.sliderBegin;
      delete el.dataset.sliderEnd;
    };
  },
});
