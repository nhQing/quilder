/**
 * Dải thẻ cuộn ngang — autoplay, nút tạm dừng, hai mũi tên.
 *
 * Port từ ../new-website/js/effects/carousel.js. Viewport là một scroll
 * container thật, nên module này KHÔNG sở hữu trạng thái vị trí nào cả:
 *
 *   mũi tên     scrollBy(± một trang)
 *   autoplay    cùng scrollBy đó theo interval, tới cuối thì cuốn về 0
 *   nút toggle  bật/tắt interval
 *
 * Mọi thứ còn lại — dải đang ở đâu, snap, cảm ứng, trackpad, phím mũi tên,
 * scrollbar — thuộc về trình duyệt. Không có gì ở đây lệch được khỏi DOM vì
 * không có gì ở đây nhớ DOM đang ở đâu.
 *
 * ## Vì sao một TRANG chứ không phải một THẺ
 *
 * `scrollBy(clientWidth)` dịch đúng bằng thứ đang trên màn: một thẻ trên điện
 * thoại, ba thẻ ở section 8 khổ 1280. Cùng một cử chỉ đọc đúng ở cả hai mà
 * module không cần biết vừa mấy thẻ. Snap sau đó kéo về mép thẻ, nên một trang
 * rơi vào giữa thẻ tự sửa lại.
 *
 * ## Khác bản gốc
 *
 * - Bản gốc `querySelectorAll('[data-carousel]')` rồi giữ trạng thái ở cấp
 *   module. Ở đây mỗi lần gắn là một instance, tự sở hữu cleanup — xem
 *   `effects/types.ts`. Nhờ vậy hai carousel trên cùng trang không đụng nhau và
 *   React mount/unmount nhiều lần không rò rỉ gì.
 *
 * - `respectReducedMotion: false`. Không phải phớt lờ: effect TỰ xử lý. Bị chặn
 *   thẳng thì hai mũi tên và nút toggle không bao giờ được nối, tức là dải chỉ
 *   cuộn được bằng cách kéo — hỏng nặng hơn hẳn so với việc chạy mà không
 *   autoplay. Với reduced motion, autoplay không khởi động nhưng điều khiển vẫn
 *   sống.
 *
 * - Cuộn dùng `scrollBy` chứ không phải GSAP: dải là scroll container, và giành
 *   quyền cuộn với trình duyệt sẽ phá snap và phá cuộn bằng cảm ứng.
 */

import { z } from 'zod';

import { onReducedMotionChange, prefersReducedMotion } from '../reduced-motion';
import { defineEffect } from './types';
import { arrowState, atEnd, END_EPSILON } from './carousel-model';

const paramsSchema = z.object({
  /** Mỗi thẻ nằm bao lâu trước khi dải tiến, ms. 0 = không autoplay. */
  autoplayMs: z.number().min(0).max(30_000).default(4000),
  /** Tới cuối thì cuốn về đầu. Tắt thì autoplay dừng ở cuối. */
  loop: z.boolean().default(true),
});

type Params = z.infer<typeof paramsSchema>;

/**
 * Element bên trong, tìm bằng `data-part` chứ không bằng class.
 *
 * `data-part` do `NodeBase.part` phát ra và là hợp đồng với runtime — xem ghi
 * chú ở đó về việc vì sao không dùng class, vị trí, hay `htmlId`.
 *
 * Không có viewport thì effect không làm gì, và im lặng: một node gắn sai effect
 * không đáng làm sập cả trang. Builder có cảnh báo riêng cho chuyện đó.
 */
function parts(el: HTMLElement) {
  const find = (part: string) => el.querySelector<HTMLElement>(`[data-part="${part}"]`);
  return {
    viewport: find('viewport'),
    toggle: find('toggle'),
    prev: find('prev'),
    next: find('next'),
  };
}

export default defineEffect<Params>({
  key: 'carousel',
  name: 'Dải trượt',
  paramsSchema,
  aiDescription:
    'CŨ — dùng "slider" (preset mặc định "slide") cho khối mới: nó phủ cả hành vi này ' +
    'lẫn hành vi chạy liên tục của "marquee", có slidesPerView "auto", loop liền mạch và ' +
    'breakpoints. Giữ lại cho các trang đã dùng nó. ' +
    'Dải thẻ cuộn ngang có hai mũi tên, nút tạm dừng và autoplay. Node con phải đặt ' +
    'part: "viewport" cho vùng cuộn, và "prev" / "next" / "toggle" cho các nút — và LƯU Ý ' +
    'effect này so cả chuỗi `part`, nên một node có nhiều vai (part: "viewport nav-dark") ' +
    'sẽ không được tìm thấy. "slider" dùng `~=` nên không có giới hạn đó.',
  runtimeCost: 'light',
  // Xem `marquee.ts`: quan hệ phải hai chiều, `registry.test.ts` canh.
  conflicts: ['slider', 'marquee'],
  // `data-carousel-ready`, KHÔNG phải 'carouselReady'.
  //
  // `el.dataset.carouselReady = 'true'` ghi ra attribute `data-carousel-ready` —
  // DOM tự chuyển camelCase thành kebab. Còn `statesWritten` là danh sách mà
  // validator ngữ nghĩa đối chiếu với `style.states`, và compiler sinh selector
  // `[data-<tên>]` từ đúng chuỗi này.
  //
  // Khai camelCase làm sai CẢ HAI CHIỀU, im lặng: tên đúng (`carousel-ready`) bị
  // validator TỪ CHỐI, còn tên sai (`carouselReady`) thì ĐƯỢC nhận rồi sinh
  // `[data-carouselReady]` — một selector không bao giờ khớp. `marquee.css` dùng
  // `[data-marquee-ready]`, tức kebab là quy ước; đây là chỗ duy nhất lệch.
  statesWritten: ['carousel-ready'],
  // Xem ghi chú đầu file: effect tự xử lý reduced motion bằng cách không chạy
  // autoplay nhưng vẫn nối điều khiển.
  gates: { respectReducedMotion: false },

  init(el, params) {
    const { viewport, toggle, prev, next } = parts(el);
    if (!viewport) return;

    // `viewport` được thu hẹp kiểu bởi lệnh return trên, nhưng `function play()`
    // là khai báo được hoist nên TypeScript không giữ được phép thu hẹp đó bên
    // trong. Gán lại vào một const là cách nói "đã kiểm rồi" mà không cần `!`.
    const vp = viewport;

    let timer: number | null = null;
    let userPaused = false;
    let hovered = false;
    let focused = false;
    const offs: Array<() => void> = [];

    const syncArrows = () => {
      const { prevDisabled, nextDisabled } = arrowState(vp);
      // `aria-disabled` chứ không phải `disabled`: nút giữ được chỗ trong thứ tự
      // tab. Một điều khiển biến mất khỏi chuỗi tab khi đang dùng thì tệ hơn một
      // điều khiển nói rằng nó không còn gì để làm.
      prev?.setAttribute('aria-disabled', String(prevDisabled));
      next?.setAttribute('aria-disabled', String(nextDisabled));
    };

    const syncToggle = () => {
      if (!toggle) return;
      const playing = timer !== null;
      toggle.setAttribute('aria-pressed', String(!playing));
      toggle.setAttribute(
        'aria-label',
        playing ? 'Tạm dừng tự động chuyển' : 'Tiếp tục tự động chuyển',
      );
    };

    const pageBy = (direction: 1 | -1) => {
      vp.scrollBy({ left: direction * vp.clientWidth });
    };

    const advance = () => {
      if (atEnd(vp)) {
        // Autoplay dừng im lặng ở cuối trông như hỏng, và dải là một vòng các
        // mục tương đương nhau nên cuốn về đầu là hợp lý.
        if (params.loop) vp.scrollTo({ left: 0 });
        else stop();
        return;
      }
      pageBy(1);
    };

    function stop() {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
      syncToggle();
    }

    /** Gọi lại bao nhiêu lần cũng được. Mọi điều kiện chặn nằm ở đây. */
    function play() {
      if (timer !== null) return;
      if (!params.autoplayMs) return;
      if (userPaused || hovered || focused) return;
      if (document.hidden || prefersReducedMotion()) return;
      // Không có gì để cuộn: một interval chạy mà dải không nhúc nhích chỉ tốn
      // pin và làm nút toggle nói dối.
      if (vp.scrollWidth - vp.clientWidth <= END_EPSILON) return;

      timer = window.setInterval(advance, params.autoplayMs);
      syncToggle();
    }

    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Document,
      type: K | string,
      handler: (event: Event) => void,
    ) => {
      target.addEventListener(type, handler);
      offs.push(() => target.removeEventListener(type, handler));
    };

    on(el, 'click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest('button');
      if (!button) return;

      if (button === toggle) {
        userPaused = !userPaused;
        if (userPaused) stop();
        else play();
        syncToggle();
        return;
      }

      // Mũi tên mờ là bất hoạt, nhưng nó vẫn là một <button> thật, nên cú bấm
      // phải bị nuốt ở đây chứ không có gì trong DOM chặn nó.
      if (button.getAttribute('aria-disabled') === 'true') return;

      if (button === prev) pageBy(-1);
      if (button === next) pageBy(1);
    });

    // Dừng khi con trỏ ở trên hoặc focus ở trong: đó là thứ ngăn dải trượt khỏi
    // dưới con trỏ giữa lúc người ta đang đọc.
    on(el, 'pointerenter', () => { hovered = true; stop(); });
    on(el, 'pointerleave', () => { hovered = false; play(); });
    on(el, 'focusin', () => { focused = true; stop(); });
    on(el, 'focusout', () => {
      // focusout bắn TRƯỚC khi target mới nhận focus, nên phải kiểm lại ở tick sau.
      requestAnimationFrame(() => {
        focused = el.contains(document.activeElement);
        if (!focused) play();
      });
    });

    on(vp, 'scroll', syncArrows);

    on(document, 'visibilitychange', () => {
      if (document.hidden) { stop(); return; }
      // Trở lại hiển thị là thời điểm đầu tiên một trang mở trong tab nền có
      // layout thật để đo — xem ghi chú ResizeObserver bên dưới.
      syncArrows();
      play();
    });

    /**
     * Có gì để cuộn hay không phụ thuộc bề rộng ĐÃ LAYOUT của dải, và lúc init
     * thì chưa biết: webfont chưa swap, ảnh trong thẻ chưa decode.
     *
     * Đọc một lần sẽ để cả hai mũi tên khoá `aria-disabled` và autoplay không
     * khởi động, vì đúng khoảnh khắc đó scrollWidth bằng clientWidth.
     *
     * ResizeObserver trên cả vp VÀ track bắt được mọi lần layout ổn định,
     * kể cả những lần `resize` của window không bao giờ bắn. Nhưng nó KHÔNG đủ
     * một mình: ResizeObserver do vòng lặp render dẫn, và document bị ẩn thì
     * không có vòng lặp render — trang mở trong tab nền không nhận callback nào.
     * Vì thế có cả lần gọi trực tiếp dưới đây và `visibilitychange` ở trên.
     */
    const observer = new ResizeObserver(() => {
      syncArrows();
      play();
    });
    observer.observe(vp);
    const track = vp.firstElementChild;
    if (track) observer.observe(track);
    offs.push(() => observer.disconnect());

    offs.push(
      onReducedMotionChange((reduced) => {
        if (reduced) stop();
        else play();
        syncToggle();
      }),
    );

    syncArrows();
    syncToggle();
    play();
    el.dataset.carouselReady = 'true';

    return () => {
      stop();
      offs.forEach((off) => off());
      prev?.removeAttribute('aria-disabled');
      next?.removeAttribute('aria-disabled');
      delete el.dataset.carouselReady;
    };
  },
});
