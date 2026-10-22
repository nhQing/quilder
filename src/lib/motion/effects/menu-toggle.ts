/**
 * Trình đơn mobile — mở, đóng, và giữ bàn phím ở đúng chỗ.
 *
 * Nút burger trong bản builder là một nút CHẾT cho tới 07/09/2026: markup có,
 * `part` có, không effect nào nối chúng lại. Module này là phần nối, và nó quyết
 * định đúng một chuyện — trình đơn đang mở hay đóng. Mọi khác biệt thị giác
 * (panel trượt vào, burger thành dấu X, nền mờ) nằm ở CSS qua
 * `[data-menu-open="true"]`.
 *
 * ## Vì sao là effect chứ không phải composite
 *
 * DOM của trình đơn là cây node do người dùng dựng: một Stack chứa các Button
 * link, và họ phải sửa được danh sách link đó. Khác `SavingsSimulator`, nơi DOM
 * được TÍNH RA. Cùng lằn ranh mà `panel-stack` đã kẻ.
 *
 * ## Ba thứ CSS không làm được, nên chúng ở đây
 *
 * Một trình đơn mở ra mà không có ba thứ dưới đây là một cái bẫy accessibility,
 * không phải một trình đơn:
 *
 *  1. **`aria-expanded` trên nút.** Không có nó, screen reader đọc "nút" và
 *     không nói được nút đó đang mở hay đóng.
 *  2. **Bẫy focus.** Tab từ link cuối trong panel phải quay về link đầu, không
 *     được đi tiếp xuống nội dung nằm SAU panel — nội dung mà mắt không thấy vì
 *     panel đang phủ lên. Người dùng bàn phím sẽ "mất" con trỏ focus.
 *  3. **`Escape` để đóng, và focus TRẢ VỀ nút.** Đóng mà bỏ focus lơ lửng ở một
 *     element vừa bị ẩn thì lần Tab sau bắt đầu lại từ đầu trang.
 *
 * ## Khoá cuộn đi qua `scroll.lock()`
 *
 * Không tự ghi `overflow: hidden`. Lenis sở hữu vị trí cuộn (xem `motion/scroll.ts`),
 * nên khoá bằng CSS mà không dừng Lenis thì trang vẫn cuộn dưới panel. Ghi chú ở
 * `scroll.lock()` nói thẳng nó được giữ lại cho "modal/menu mobile" — đây là ca đó.
 */

import { z } from 'zod';

import { BREAKPOINT_PX, BREAKPOINTS } from '@/lib/design/breakpoints';
import * as scroll from '../scroll';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Vai của nút bật/tắt, trong `part`. */
  triggerPart: z.string().min(1).max(40).default('burger'),
  /** Vai của khối chứa trình đơn. */
  panelPart: z.string().min(1).max(40).default('menu-panel'),
  /**
   * Đóng khi bấm một link bên trong panel.
   *
   * Mặc định `true`, và nó cần thiết cả với link cùng trang: anchor đi qua Lenis
   * (`bindAnchors`) nên trang KHÔNG tải lại, và một panel còn mở sẽ phủ lên đúng
   * chỗ vừa cuộn tới.
   */
  closeOnNavigate: z.boolean().default(true),
  /**
   * Vai của những thứ bấm vào là ĐÓNG: nút X trong panel, lớp mờ phủ trang. Trang chủ
   * (13/10/2026) có hai burger — một trên thanh nav mở, một trong ngăn kéo đóng — và
   * một lớp mờ bấm ra ngoài là đóng. Mọi node mang `triggerPart` đều BẬT/TẮT; node
   * mang vai này chỉ đóng.
   */
  closePart: z.string().min(1).max(40).default('menu-close'),
  /**
   * Nút xổ một nhóm con trong panel (vd "Sản phẩm" → ba thẻ). Bấm thì đảo state
   * `menu-sub-open` trên node gắn effect và `aria-expanded` trên chính nút; style
   * nhóm con theo state đó bằng customCss của node này. Đóng trình đơn là gập lại.
   */
  subTogglePart: z.string().min(1).max(40).default('menu-sub-toggle'),
  /**
   * Tự đóng khi khổ màn đạt breakpoint này (trình đơn đầy đủ đã vừa). Không đặt thì
   * không tự đóng. Trang chủ: `md` (1024px), đúng mốc thanh nav đổi dạng.
   */
  closeFrom: z.enum(BREAKPOINTS).optional(),
});

type Params = z.infer<typeof paramsSchema>;

/** Element nhận được focus, theo thứ tự tab. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default defineEffect<Params>({
  key: 'menu-toggle',
  name: 'Trình đơn mobile',
  paramsSchema,
  aiDescription:
    'Nút burger mở/đóng trình đơn mobile. Đánh dấu nút bằng part "burger" (mọi node mang vai này đều bật/tắt) và khối trình đơn bằng part "menu-panel" (setProps part). Node mang part "menu-close" (nút X, lớp mờ phủ trang) chỉ đóng. Nút part "menu-sub-toggle" đảo state "menu-sub-open" để xổ một nhóm con. Param closeFrom (breakpoint) tự đóng khi màn đủ rộng. Ghi state "menu-open" để style panel và nút. Tự lo aria-expanded, bẫy focus, Escape và khoá cuộn.',
  runtimeCost: 'light',
  statesWritten: ['menu-open', 'menu-sub-open'],
  appliesTo: ['Section'],
  // Đây là đổi TRẠNG THÁI, không phải chuyển động — cùng lý lẽ như nav-collapse.
  // Transition nằm ở CSS và chính CSS đã tắt nó khi người dùng yêu cầu.
  gates: { respectReducedMotion: false },

  init(el, params) {
    // `~=` chứ không `=`: `part` giữ nhiều vai cách nhau bằng khoảng trắng, nên
    // một node vừa là slot của composite vừa là burger là chuyện bình thường.
    const triggers = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.triggerPart}"]`)];
    const trigger = triggers[0];
    const panel = el.querySelector<HTMLElement>(`[data-part~="${params.panelPart}"]`);
    const closers = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.closePart}"]`)];
    const subToggles = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.subTogglePart}"]`)];

    // Thiếu một trong hai thì KHÔNG làm gì và không ném: cây node có thể đang
    // được dựng dở trong builder, và một effect ném sẽ làm trắng cả canvas.
    if (!trigger || !panel) return;

    let open = false;

    /**
     * `aria-controls` cần một id. Dùng `htmlId` nếu tác giả đã đặt, nếu không thì
     * sinh một id ổn định theo node.
     *
     * Không bỏ qua khi thiếu id: `aria-expanded` không có `aria-controls` vẫn hợp
     * lệ nhưng screen reader không nói được nó điều khiển CÁI GÌ.
     */
    if (!panel.id) panel.id = `mm-menu-${el.dataset.n ?? 'x'}`;
    for (const t of triggers) {
      t.setAttribute('aria-controls', panel.id);
      t.setAttribute('aria-expanded', 'false');
    }
    for (const t of subToggles) t.setAttribute('aria-expanded', 'false');

    const setSub = (next: boolean) => {
      if (next) el.dataset.menuSubOpen = 'true';
      else delete el.dataset.menuSubOpen;
      for (const t of subToggles) t.setAttribute('aria-expanded', String(next));
    };

    const focusables = (): HTMLElement[] =>
      [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // `offsetParent === null` bắt cả `display:none` của tổ tiên — một link
        // trong nhóm đang gập không nên nhận focus.
        (node) => node.offsetParent !== null || node === document.activeElement,
      );

    const apply = (next: boolean) => {
      open = next;
      for (const t of triggers) t.setAttribute('aria-expanded', String(next));

      if (next) {
        el.dataset.menuOpen = 'true';
        scroll.lock();
        // Focus vào phần tử đầu TRONG panel, không vào chính panel: panel không
        // nhận focus nên trình đọc sẽ không đọc gì.
        focusables()[0]?.focus();
      } else {
        delete el.dataset.menuOpen;
        setSub(false);
        scroll.unlock();
      }
    };

    const close = (returnFocus = true) => {
      if (!open) return;
      apply(false);
      // Trả focus về nút. Bỏ bước này thì focus lơ lửng ở một link vừa bị ẩn, và
      // lần Tab sau bắt đầu lại từ đầu trang.
      if (returnFocus) trigger.focus();
    };

    const onTriggerClick = (event: Event) => {
      event.preventDefault();
      if (open) close();
      else apply(true);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!open) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== 'Tab') return;

      // Bẫy focus. Chỉ vòng lại ở HAI MÉP — giữa panel thì để trình duyệt lo, nên
      // thứ tự tab tự nhiên (kể cả `tabindex` tác giả đặt) vẫn đúng.
      const items = focusables();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onPanelClick = (event: Event) => {
      if (!params.closeOnNavigate) return;
      const target = event.target;
      if (target instanceof Element && target.closest('a[href]')) {
        // KHÔNG trả focus về nút ở đây: người dùng vừa điều hướng, và kéo focus
        // ngược lên header là lấy đi thứ họ vừa chọn.
        close(false);
      }
    };

    const onCloserClick = (event: Event) => {
      event.preventDefault();
      close();
    };

    const onSubToggle = (event: Event) => {
      event.preventDefault();
      setSub(el.dataset.menuSubOpen !== 'true');
    };

    // Khổ màn rộng lên tới mức trình đơn đầy đủ hiện ra: đóng ngăn kéo, không thì
    // trang còn khoá cuộn sau một ngăn kéo đã bị CSS ẩn.
    const wide = params.closeFrom
      ? window.matchMedia(`(min-width: ${BREAKPOINT_PX[params.closeFrom]}px)`)
      : null;
    const onWide = () => {
      if (wide?.matches) close(false);
    };

    for (const t of triggers) t.addEventListener('click', onTriggerClick);
    for (const c of closers) c.addEventListener('click', onCloserClick);
    for (const t of subToggles) t.addEventListener('click', onSubToggle);
    wide?.addEventListener('change', onWide);
    document.addEventListener('keydown', onKeyDown);
    panel.addEventListener('click', onPanelClick);

    return () => {
      for (const t of triggers) t.removeEventListener('click', onTriggerClick);
      for (const c of closers) c.removeEventListener('click', onCloserClick);
      for (const t of subToggles) t.removeEventListener('click', onSubToggle);
      wide?.removeEventListener('change', onWide);
      document.removeEventListener('keydown', onKeyDown);
      panel.removeEventListener('click', onPanelClick);
      // Dọn phải trả trang về trạng thái dùng được, kể cả khi tháo trong lúc đang
      // mở: một trang bị khoá cuộn vĩnh viễn là lỗi tệ nhất mà module này gây ra được.
      if (open) scroll.unlock();
      delete el.dataset.menuOpen;
      delete el.dataset.menuSubOpen;
      for (const t of triggers) {
        t.removeAttribute('aria-expanded');
        t.removeAttribute('aria-controls');
      }
      for (const t of subToggles) t.removeAttribute('aria-expanded');
    };
  },
});
