/**
 * Hộp thoại dùng chung — FAQ, tiểu sử đội ngũ, danh sách chờ.
 *
 * Port từ home-v2/effects/useModalPanel.js và ba modal dựng trên nó (FaqModal,
 * TeamModal, S8Modal). Cả ba lặp lại cùng một vòng đời; ở đây nó là MỘT effect
 * điều khiển bằng dữ liệu, để tác giả dựng modal từ node.
 *
 * ## Cấu trúc node
 *
 *   Section (mang effect, có htmlId = "faq-modal")        ← gốc, position: fixed
 *     ├ scrim            part "modal-scrim"   (tuỳ chọn, bấm là đóng)
 *     ├ link menu        href="#faq-q2" ...   (chuyển tấm, tuỳ chọn)
 *     └ panel × N        part "modal-panel" + htmlId riêng ("faq-q1" ...)
 *          ├ nút đóng    part "modal-close"
 *          └ thân cuộn   part "modal-body"
 *
 * MỌI link trong trang có `href="#<id gốc>"` hoặc `href="#<id panel>"` mở modal
 * và bật tấm tương ứng. Link bên trong modal trỏ sang tấm khác thì đổi tấm.
 *
 * ## Vòng đời mở/đóng (lấy nguyên của bản thiết kế)
 *
 * Mở: hiện (`data-modal-visible`) → ÉP tính lại bố cục → bật `data-modal-open`.
 * Bước ép layout là để trình duyệt ghi nhận trạng thái mờ trước khi class đổi —
 * không thì hai thay đổi gộp vào một lần vẽ và không còn gì để nội suy. CỐ Ý
 * không dùng `requestAnimationFrame`: tab ẩn hoặc khung xem trước bị tiết chế có
 * thể không chạy frame nào và popup kẹt ở opacity 0 (và repo chỉ cho phép một
 * vòng rAF, trong raf.ts). Đóng thì ngược lại: bỏ `data-modal-open`, đợi mờ xong
 * mới bỏ `data-modal-visible`, không thì lớp phủ biến mất đột ngột.
 *
 * Phần ĂN CLICK của lớp phủ là chỗ bản port đầu từng sai: một tấm `fixed; inset:0`
 * trong suốt nằm đè lên trang nuốt mọi click và hover. Vì thế trạng thái đóng là
 * `display: none`, không phải chỉ opacity 0 (xem modal.css).
 */

import { z } from 'zod';

import { prefersReducedMotion } from '../reduced-motion';
import * as scroll from '../scroll';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Vai của từng tấm nội dung. Mỗi tấm cần htmlId riêng để link `#id` trỏ tới. */
  panelPart: z.string().min(1).max(40).default('modal-panel'),
  /** Vai của nút đóng (có thể có nhiều: mỗi tấm một nút). */
  closePart: z.string().min(1).max(40).default('modal-close'),
  /** Vai của lớp phủ; bấm vào là đóng. Bấm thẳng vào nền của gốc cũng đóng. */
  scrimPart: z.string().min(1).max(40).default('modal-scrim'),
  /** Vai của khối cuộn bên trong; được gắn data-lenis-prevent để Lenis buông trục dọc. */
  bodyPart: z.string().min(1).max(40).default('modal-body'),
  /** Selector của thanh header toàn trang; bị `inert` trong lúc modal mở. */
  headerSelector: z.string().min(1).max(120).default('[data-header]'),
  /** ms của quãng mờ đổi tấm. Nguồn: 120 (= --dur-instant). */
  swapMs: z.number().min(0).max(1000).default(120),
  /**
   * ms chờ trước khi ẩn hẳn sau khi đóng. Bỏ trống thì đọc từ transition-duration
   * thực của gốc (mặc định --dur-fast = 280ms), nên đổi CSS là timer đổi theo.
   * Nguồn cố định 200ms trong khi token là 0.28s — hai con số lệch nhau.
   */
  fadeMs: z.number().min(0).max(2000).optional(),
});

type Params = z.infer<typeof paramsSchema>;

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const DEFAULT_FADE_MS = 280;

/** Lớn nhất trong danh sách "0.28s, 0.12s" / "120ms", ra ms. NaN nếu không đọc được. */
function parseMaxDurationMs(value: string): number {
  const parts = value.split(',').map((part) => {
    const text = part.trim();
    if (text.endsWith('ms')) return parseFloat(text);
    if (text.endsWith('s')) return parseFloat(text) * 1000;
    return NaN;
  });
  return Math.max(...parts);
}

export default defineEffect<Params>({
  key: 'modal',
  name: 'Hộp thoại',
  paramsSchema,
  aiDescription:
    'Hộp thoại dùng chung (FAQ, tiểu sử, form chờ). Gắn vào Section gốc của modal (position fixed, có htmlId). Bên trong: các tấm nội dung part "modal-panel" mỗi tấm có htmlId riêng (chỉ tấm đang bật hiện ra; tấm đầu bật mặc định), nút đóng part "modal-close", lớp phủ part "modal-scrim" (tuỳ chọn), khối cuộn part "modal-body". BẤT KỲ link nào trên trang có href="#<htmlId của modal>" hoặc "#<htmlId của một tấm>" đều mở modal (không cuộn, không đổi hash) và bật tấm tương ứng; link bên trong modal trỏ sang tấm khác thì đổi tấm với quãng mờ 120ms (đặt cột menu là các link "#id-tấm"; link đang ở tấm hiện tại được gắn aria-current). Tự lo bẫy focus, Esc, trả focus về nơi bấm, khoá cuộn, inert cho header. Ghi state "modal-open" (đang mở), "modal-visible" (đang hiển thị kể cả lúc mờ dần), "modal-swapping", "modal-panel" (id tấm đang bật). Style trạng thái MỞ đặt thẳng trên node; trạng thái đóng do CSS của effect lo.',
  runtimeCost: 'light',
  statesWritten: ['modal-open', 'modal-visible', 'modal-swapping', 'modal-panel'],
  appliesTo: ['Section'],
  // Mở/đóng là đổi trạng thái; quãng mờ tự tắt trong CSS khi reduced motion nên
  // modal vẫn dùng được.
  gates: { respectReducedMotion: false },

  init(el, params) {
    const sel = (part: string) => `[data-part~="${part}"]`;
    const panels = () => [...el.querySelectorAll<HTMLElement>(sel(params.panelPart))];

    let open = false;
    let opener: HTMLElement | null = null;
    let hideTimer: number | null = null;
    let swapTimers: number[] = [];
    let headerEl: HTMLElement | null = null;
    let headerWasInert = false;

    // Những gì effect tự thêm vào, để dọn đúng chúng và không dọn nhầm của tác giả.
    const addedRole = !el.hasAttribute('role');
    const addedModal = !el.hasAttribute('aria-modal');
    if (addedRole) el.setAttribute('role', 'dialog');
    if (addedModal) el.setAttribute('aria-modal', 'true');

    const lenisBodies: HTMLElement[] = [];
    for (const body of el.querySelectorAll<HTMLElement>(sel(params.bodyPart))) {
      if (body.hasAttribute('data-lenis-prevent')) continue;
      body.setAttribute('data-lenis-prevent', '');
      lenisBodies.push(body);
    }

    const fadeDuration = (): number => {
      if (params.fadeMs !== undefined) return prefersReducedMotion() ? 0 : params.fadeMs;
      const measured = parseMaxDurationMs(getComputedStyle(el).transitionDuration);
      return Number.isFinite(measured) ? measured : DEFAULT_FADE_MS;
    };

    const clearSwap = () => {
      for (const timer of swapTimers) window.clearTimeout(timer);
      swapTimers = [];
      delete el.dataset.modalSwapping;
    };

    /** Bật một tấm, tắt các tấm khác, và cập nhật aria-current của link menu. */
    const activate = (panel: HTMLElement) => {
      for (const other of panels()) {
        if (other === panel) other.dataset.active = 'true';
        else delete other.dataset.active;
      }
      el.dataset.modalPanel = panel.id;
      for (const link of el.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
        if (link.getAttribute('href') === `#${panel.id}`) link.setAttribute('aria-current', 'true');
        else if (link.getAttribute('aria-current') === 'true') link.removeAttribute('aria-current');
      }
    };

    const activePanel = (): HTMLElement | null =>
      panels().find((panel) => panel.dataset.active === 'true') ?? null;

    /**
     * Đổi tấm. Đang mở thì thẻ MỜ HẾT, đổi nội dung ở GIỮA quãng mờ rồi hiện lại —
     * nội dung thay lúc thẻ đang opacity 0 nên chiều cao đổi mà không ai thấy.
     */
    const showPanel = (panel: HTMLElement, animate: boolean) => {
      if (activePanel() === panel) return;
      clearSwap();
      if (!animate || prefersReducedMotion() || params.swapMs === 0) {
        activate(panel);
        return;
      }
      el.dataset.modalSwapping = 'true';
      swapTimers.push(
        window.setTimeout(() => activate(panel), params.swapMs / 2),
        window.setTimeout(() => delete el.dataset.modalSwapping, params.swapMs),
      );
    };

    const visibleFocusables = (): HTMLElement[] =>
      [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // `getClientRects` thay cho `offsetParent`: gốc là `fixed` nên offsetParent
        // của chính nó là null dù đang hiện.
        (node) => node.getClientRects().length > 0,
      );

    const openModal = (panel: HTMLElement | null, from: HTMLElement | null) => {
      if (open) {
        if (panel) showPanel(panel, true);
        return;
      }
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      open = true;
      opener = from;

      clearSwap();
      const target = panel ?? activePanel() ?? panels()[0] ?? null;
      if (target) activate(target);

      // 1. hiện  2. ép layout  3. bật trạng thái mở.
      el.dataset.modalVisible = 'true';
      void el.offsetHeight;
      el.dataset.modalOpen = 'true';

      scroll.lock();

      // Header vẫn hiện dưới lớp phủ nhưng không được bấm hay Tab tới. Bỏ qua nếu
      // modal nằm TRONG header: đặt inert lên tổ tiên sẽ khoá luôn chính modal.
      headerEl = document.querySelector<HTMLElement>(params.headerSelector);
      if (headerEl && headerEl.contains(el)) headerEl = null;
      if (headerEl) {
        headerWasInert = headerEl.inert;
        headerEl.inert = true;
      }

      visibleFocusables()[0]?.focus();
    };

    const closeModal = () => {
      if (!open) return;
      open = false;
      clearSwap();
      delete el.dataset.modalOpen;
      // Đợi mờ xong mới ẩn hẳn, không thì lớp phủ biến mất đột ngột.
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        delete el.dataset.modalVisible;
      }, fadeDuration());

      scroll.unlock();
      if (headerEl) {
        headerEl.inert = headerWasInert;
        headerEl = null;
      }
      // Trả focus về nơi đã mở; bỏ bước này thì lần Tab sau bắt đầu lại từ đầu trang.
      if (opener && opener.isConnected) opener.focus();
      opener = null;
    };

    /** Panel hoặc gốc mà `#hash` trỏ tới; `undefined` nếu không phải của modal này. */
    const resolveHash = (hash: string): { panel: HTMLElement | null } | undefined => {
      if (!hash) return undefined;
      if (el.id && hash === el.id) return { panel: null };
      const panel = panels().find((candidate) => candidate.id === hash);
      return panel ? { panel } : undefined;
    };

    // Pha CAPTURE ở document, và chặn lan truyền: `scroll.bindAnchors` nghe click
    // ở pha nổi bọt trên document, thấy `#id` tồn tại thì cuộn tới và đổi hash —
    // đúng hai thứ modal không được làm.
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      if (!link) return;
      const hit = resolveHash(decodeURIComponent((link.getAttribute('href') ?? '').slice(1)));
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      openModal(hit.panel, link);
    };

    const onElClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target === el ||
        target.closest(sel(params.closePart)) ||
        target.closest(sel(params.scrimPart))
      ) {
        closeModal();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      // Bẫy focus: vòng lại ở HAI MÉP, và kéo focus về trong nếu nó đang ở ngoài.
      const list = visibleFocusables();
      if (!list.length) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      const outside = !el.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    // Cho effect/form khác điều khiển modal mà không cần biết DOM của nó (ví dụ
    // form danh sách chờ báo thành công thì chuyển sang tấm "đăng ký thành công").
    const onShowEvent = (event: Event) => {
      const id = (event as CustomEvent<{ panel?: string }>).detail?.panel;
      const panel = id ? (panels().find((candidate) => candidate.id === id) ?? null) : null;
      openModal(panel, document.activeElement as HTMLElement | null);
    };
    const onCloseEvent = () => closeModal();

    // Tấm đầu bật sẵn: mở bằng `#<id gốc>` thì có tấm để hiện, và CSS (chỉ ẩn tấm
    // không `data-active` sau khi `data-modal-ready` có mặt) không giấu hết tất cả.
    const first = panels()[0];
    if (first) activate(first);
    el.dataset.modalReady = 'true';

    document.addEventListener('click', onDocumentClick, true);
    el.addEventListener('click', onElClick);
    document.addEventListener('keydown', onKeyDown);
    el.addEventListener('modal:show', onShowEvent);
    el.addEventListener('modal:close', onCloseEvent);

    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      el.removeEventListener('click', onElClick);
      document.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('modal:show', onShowEvent);
      el.removeEventListener('modal:close', onCloseEvent);

      // Dọn phải trả trang về trạng thái dùng được, kể cả khi tháo giữa lúc đang
      // mở: một trang bị khoá cuộn hay header bị inert vĩnh viễn là lỗi tệ nhất.
      if (open) {
        scroll.unlock();
        if (headerEl) headerEl.inert = headerWasInert;
      }
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      clearSwap();

      delete el.dataset.modalOpen;
      delete el.dataset.modalVisible;
      delete el.dataset.modalPanel;
      delete el.dataset.modalReady;
      for (const panel of panels()) delete panel.dataset.active;
      for (const link of el.querySelectorAll('a[aria-current="true"]')) link.removeAttribute('aria-current');
      for (const body of lenisBodies) body.removeAttribute('data-lenis-prevent');
      if (addedRole) el.removeAttribute('role');
      if (addedModal) el.removeAttribute('aria-modal');
    };
  },
});
