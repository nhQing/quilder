'use client';

/**
 * Khung xem trước — MỘT khổ màn mỗi lúc, không phải một mặt phẳng vô hạn.
 *
 * ## Cái gì đã bị bỏ, và vì sao
 *
 * Bản trước là một canvas kiểu Figma: năm iframe bày cạnh nhau trên một mặt phẳng
 * kéo–phóng được, có lưới, có `Ctrl+cuộn` để zoom, có phím cách để kéo. Lý lẽ khi
 * đó là "responsive hỏng ở chỗ chuyển tiếp, bày cạnh nhau thì chỗ vỡ tự lộ ra".
 *
 * Người dùng bỏ lý lẽ đó ngày 19/08/2026, sau khi dùng thật: *"để height tự do
 * không được, và sử dụng canvas không hợp lý"*, rồi *"nhấn nút để thay đổi loại
 * màn hình, chỉ hiển thị 1 loại khi xem trên"*, rồi *"nếu hiển thị như này, có lẽ
 * không cần hiển thị canvas nữa"*. Ba nhận xét đó cùng chỉ về một chỗ, và họ đúng:
 *
 *  - Năm iframe cùng lúc là năm lần render cùng một trang. Mọi thao tác nặng gấp năm.
 *  - Kéo và phóng là hai bậc tự do phải quản lý bằng tay chỉ để nhìn một trang web —
 *    thứ vốn chỉ cần cuộn dọc.
 *  - Chỗ vỡ responsive vẫn tìm được bằng cách bấm qua từng khổ, và `pnpm check:layout`
 *    quét mọi khổ tự động, chính xác hơn mắt.
 *
 * Nên: một khung, thu vừa bề ngang pane, cuộn dọc như một trình duyệt thật. Không
 * lưới, không pan, không `Ctrl+cuộn`. Đổi khổ bằng cách BẤM NÚT.
 *
 * Ba lớp phức tạp biến mất theo, và cả một lớp lỗi: phép quy đổi toạ độ giữa iframe
 * và trang cha (§3.32) không còn tồn tại vì không còn phép biến đổi nào để quy đổi.
 *
 * ## "Toàn trang" — bật được, mặc định TẮT (16/10/2026)
 *
 * Người dùng hỏi lại: *"Mỗi Breakpoint luôn có scroll mà không full height theo nội dung,
 * tôi muốn hiển thị hết trong canvas giống kiểu figma"*. Vẫn MỘT khung (không quay lại
 * năm iframe), nhưng có nút "Toàn trang" ở `ScreenBar`: khung cao bằng nội dung và pane
 * cuộn thay khung. `vh` trong khung bị đóng băng ở chiều cao thiết bị (`freeze-viewport.ts`)
 * nên hero không phình; hiệu ứng theo cuộn thì đứng yên — vì thế nó là lựa chọn, không phải
 * mặc định.
 *
 * ## Vì sao vẫn có "thu nhỏ" mà không có "zoom"
 *
 * Khung 1920px không lọt vào pane rộng ~1000px. Nên khung được `scale` xuống cho vừa
 * BỀ NGANG — một phép tính, không phải một điều khiển. Nút `100%` có đó cho lúc cần
 * xem đúng kích thước thật, và khi đó pane cuộn ngang. Không có mức phóng tuỳ ý:
 * mức phóng tuỳ ý là thứ người dùng vừa nói là không hợp lý.
 *
 * ## Bấm vào link hay nút trong khung là CHỌN node, không phải dùng nó
 *
 * Trong khung xem trước, mọi thứ tương tác được đều bị vô hiệu hoá: link không điều
 * hướng, nút không bấm, slider không kéo. Một cú bấm luôn có nghĩa "cho tôi xem
 * thuộc tính của phần tử này". Xem `INERT_EVENTS`.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { breakpointForWidth, type Screen } from '@/lib/design/breakpoints';
import { useEditor } from '@/lib/builder/store';
import { cn } from '@/lib/builder/cn';
import { freezeViewportUnits } from '@/lib/builder/freeze-viewport';
import { readFlag, safeStorage, STORAGE_KEYS, write } from '@/lib/builder/persisted';
import { clipSpan, glideStart, revealCandidates, revealScroll } from '@/lib/builder/reveal';
import { recordTiming } from '@/lib/builder/timing';
import { prefersReducedMotion } from '@/lib/motion/reduced-motion';
import type { Doc, NodeId } from '@/lib/doc/types';
import type { PresetSummary } from '@/lib/builder/queries';
import { CanvasInsertDock } from './CanvasInsertDock';
import { ScreenBar } from './ScreenBar';

interface Box { top: number; left: number; width: number; height: number }

/** Lề hai bên khung khi thu cho vừa pane. */
const GUTTER = 32;

/**
 * Sự kiện bị chặn bên trong khung xem trước.
 *
 * ## Vì sao không chỉ `click`
 *
 * Bản trước chỉ `preventDefault` trên `click`, nên link không điều hướng nữa —
 * nhưng `<button>` vẫn chạy handler của nó, và slider của composite vẫn kéo được
 * bằng `pointerdown`. Kết quả là bấm vào nút "Tham gia" thì component đổi trạng
 * thái thay vì hiện thuộc tính, tức đúng cái người dùng yêu cầu sửa ngày
 * 19/08/2026.
 *
 * Chặn ở pha CAPTURE trên `document` của iframe, kèm `stopPropagation`: capture
 * chạy TRƯỚC mọi handler của phần tử, nên chặn ở đó là chặn được cả handler mà ta
 * không viết. `preventDefault` lo hành vi mặc định (điều hướng, submit form).
 *
 * `mousemove` KHÔNG nằm trong danh sách — đó là đường hover, và nó phải sống.
 */
const INERT_EVENTS = [
  'click',
  'dblclick',
  'auxclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'submit',
  'keydown',
  'keypress',
  'wheel',
] as const;

/**
 * CSS chèn vào khung xem trước.
 *
 * `cursor: default` cho mọi thứ: con trỏ hình bàn tay trên một link không điều
 * hướng được là một lời hứa sai. Và `user-select: none` để kéo chọn chữ không tranh
 * với việc chọn node.
 *
 * KHÔNG dùng `pointer-events: none`: nó sẽ làm `elementFromPoint` trả về phần tử
 * cha, tức mất luôn khả năng chọn đúng node — trong khi chọn đúng node là cả mục
 * đích của khung này.
 *
 * Danh sách phần tử tương tác được liệt kê lại dù `*` đã phủ hết, vì route render
 * chèn sẵn một rule đặt con trỏ hình bàn tay cho `a` và `button`. Selector kiểu
 * (specificity 0,0,1) thắng `*` (0,0,0) bất kể thứ tự, và `!important` ở cả hai bên
 * cũng không đổi kết quả — nên phải đấu bằng cùng loại selector.
 *
 * Lưu ý cho người sửa: KHÔNG viết dấu backtick trong chuỗi này. Nó là template
 * literal, và một backtick trong phần chú thích CSS sẽ kết thúc chuỗi giữa dòng —
 * lỗi biên dịch đã xảy ra đúng như vậy ngày 19/08/2026.
 *
 * ## KHÔNG tạo kiểu thanh cuộn ở đây — đã thử rồi bỏ
 *
 * Ngày 20/08/2026 tôi từng thêm `::-webkit-scrollbar-*` vào chuỗi này, với lý lẽ rằng
 * thanh cuộn Windows dày 17px ăn 5% bề ngang khung 320px nên làm nó mảnh là gần thiết
 * bị thật hơn.
 *
 * Chủ dự án vạch lại ranh giới, và đúng hơn: *"site cứ dùng mặc định thôi, đổi thì đổi
 * riêng của nó, không liên quan đến scrollbar của builder"*. Khung này render nội dung
 * SITE, nên tạo kiểu thanh cuộn của nó là để builder quyết định site trông thế nào —
 * và lý lẽ độ trung thực cũng sai chỗ: khung xem trước là một trình duyệt desktop
 * render ở bề rộng 320px, nên thanh cuộn mặc định ĐÚNG LÀ thứ khách Windows sẽ thấy.
 *
 * Vỏ builder (`src/styles/builder.css`) thì vẫn tạo kiểu. Ranh giới là mép iframe:
 * bên ngoài là công cụ, bên trong là sản phẩm.
 */
const INERT_CSS = `
  *, *::before, *::after { cursor: default !important; }
  a, button, input, select, textarea, label, summary, [role="button"], [role="link"],
  [tabindex], [onclick] { cursor: default !important; }
  * { user-select: none !important; -webkit-user-select: none !important; }
`;

export interface InertHandlers {
  /**
   * `innerLocalId`: bấm rơi vào phần tử BÊN TRONG một instance (`data-cn`). Canvas trang
   * chỉ chọn được cả Instance, nên `id` vẫn là instance; id local đi kèm để "Copy link cho
   * AI" trỏ đúng phần tử người dùng vừa chỉ.
   */
  select: (id: string | null, innerLocalId?: string | null) => void;
  hover: (id: string | null) => void;
  /** Khung cuộn → đo lại viền chọn/hover. */
  onScroll: () => void;
}

/**
 * Gắn lớp vô hiệu hoá tương tác vào tài liệu trong khung.
 *
 * Trả về hàm dọn, hoặc `null` khi khung CHƯA SẴN SÀNG. Bên gọi phải xử lý `null`
 * bằng cách thử lại — xem `attachInertWhenReady`.
 *
 * ## Ba mức "chưa sẵn sàng", và mức thứ ba là mức từng làm trắng trang
 *
 *  1. Không có `contentWindow`.
 *  2. Không có `contentDocument`.
 *  3. **Có `contentDocument`, mà `documentElement` là `null`.**
 *
 * Guard cũ dừng ở mức 2, với lý lẽ đã đoán trúng một nửa: khung đang nạp có thể
 * chưa có `head`, nên gắn vào `documentElement`. Nhưng lúc tài liệu trong iframe
 * đang bị THAY — điều hướng phía client từ danh sách `/builder` sang trang soạn
 * thảo — tài liệu tồn tại mà cây tài liệu chưa có gốc. `documentElement` cũng là
 * `null`, và `null.appendChild` ném ngay trong một effect: React gỡ cả cây, người
 * dùng thấy `Application error: a client-side exception has occurred` thay vì
 * trình soạn thảo.
 *
 * Nó là cạnh tranh thời điểm, không tất định — mở thẳng URL thì không bao giờ ra.
 *
 * ## Vì sao kiểm GỐC trước khi gắn listener
 *
 * Bản cũ gắn 15 listener rồi mới đụng `documentElement`, nên cú ném để lại cả 15
 * trên một tài liệu mà không cleanup nào chạy tới — và `style` thì chưa bao giờ
 * được gắn, nên `style.remove()` trong cleanup dọn một thứ không tồn tại. Kiểm
 * trước thì lượt bỏ qua không để lại gì, và cleanup chỉ tồn tại khi đã gắn thật.
 */
export function attachInert(
  frame: HTMLIFrameElement | null,
  handlers: InertHandlers,
): (() => void) | null {
  const win = frame?.contentWindow;
  const fdoc = frame?.contentDocument;
  // GỐC tài liệu, không phải `head`: khung đang nạp có thể chưa có `head`, nhưng
  // trong lúc tài liệu bị thay thì chính gốc cũng chưa có.
  const root = fdoc?.documentElement;
  if (!win || !fdoc || !root) return null;

  /** Chặn hành vi riêng của phần tử; một cú bấm = chọn node. */
  const inert = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click') {
      const target = event.target as Element | null;
      const owner = target?.closest('[data-n]') ?? null;
      handlers.select(owner?.getAttribute('data-n') ?? null, innerLocalIdOf(target, owner));
    }
  };
  const onMove = (event: Event) => {
    const owner = (event.target as Element | null)?.closest('[data-n]');
    handlers.hover(owner?.getAttribute('data-n') ?? null);
  };
  const onLeave = () => handlers.hover(null);
  const onScroll = () => handlers.onScroll();

  for (const type of INERT_EVENTS) {
    fdoc.addEventListener(type, inert, true);
  }
  fdoc.addEventListener('mousemove', onMove);
  fdoc.addEventListener('mouseleave', onLeave);
  win.addEventListener('scroll', onScroll, { passive: true });

  const style = fdoc.createElement('style');
  style.dataset.mmInert = '';
  style.textContent = INERT_CSS;
  root.appendChild(style);

  return () => {
    for (const type of INERT_EVENTS) {
      fdoc.removeEventListener(type, inert, true);
    }
    fdoc.removeEventListener('mousemove', onMove);
    fdoc.removeEventListener('mouseleave', onLeave);
    win.removeEventListener('scroll', onScroll);
    style.remove();
  };
}

/**
 * Số lượt hẹn lại trước khi bỏ cuộc — ~2 giây ở 60fps.
 *
 * Có trần vì có khung KHÔNG BAO GIỜ sẵn sàng: một iframe khác nguồn
 * (`contentDocument` luôn `null`), hay một khung bị gỡ giữa chừng. Hẹn lại mỗi
 * khung hình mãi mãi là một vòng lặp ăn CPU suốt phiên làm việc, và nó im lặng.
 *
 * Bỏ cuộc KHÔNG phải là mất hẳn đường gắn: `loaded` tăng ở `onLoad` của iframe và
 * nằm trong deps của effect, nên mỗi lần khung nạp xong là một lượt thử mới.
 */
const INERT_RETRY_FRAMES = 120;

/**
 * Id local của phần tử trong instance mà `target` nằm trong, hoặc `null`.
 *
 * Chỉ nhận `[data-cn]` NẰM TRONG `owner` (instance đang chọn): phần tử `data-cn` gần nhất
 * nhưng nằm NGOÀI nó thuộc một instance khác, và link trỏ tới đó là link sai.
 */
export function innerLocalIdOf(target: Element | null, owner: Element | null): string | null {
  if (!target || !owner) return null;
  const inner = target.closest('[data-cn]');
  if (!inner || inner === owner || !owner.contains(inner)) return null;
  return inner.getAttribute('data-cn');
}

/** Hẹn một lượt ở khung hình sau. Trả hàm huỷ. */
function nextFrame(fn: () => void): () => void {
  if (typeof requestAnimationFrame === 'undefined') {
    const t = setTimeout(fn, 16);
    return () => clearTimeout(t);
  }
  const id = requestAnimationFrame(fn);
  return () => cancelAnimationFrame(id);
}

/**
 * Gắn lớp vô hiệu hoá NGAY nếu được, và thử lại cho tới khi khung có gốc.
 *
 * ## Vì sao phải thử lại, chứ không chỉ guard
 *
 * Guard suông chữa được trắng trang nhưng đổi nó lấy một lỗi im lặng hơn: lượt
 * gắn duy nhất rơi đúng lúc tài liệu chưa có gốc thì khung xem trước KHÔNG BAO
 * GIỜ có lớp CSS vô hiệu hoá. Link trong khung lại điều hướng được, và một cú bấm
 * nhầm đưa iframe sang trang khác — mất cả phiên làm việc. Đúng cái mà `INERT_CSS`
 * và `INERT_EVENTS` sinh ra để chặn.
 *
 * Hai đường chạy lại, và chúng bù cho nhau:
 *
 *  - Ở đây: hẹn lại từng khung hình, cho khoảng trống vài chục mili giây lúc tài
 *    liệu đang bị thay.
 *  - Ở effect: `loaded` tăng mỗi lần `onLoad` của iframe chạy, nên một tài liệu
 *    thay xong muộn vẫn có một lượt gắn mới, sạch.
 *
 * `schedule` tiêm được CHỈ để test: một vòng `requestAnimationFrame` thật thì test
 * phải chờ theo thời gian thật, và thời gian thật là thứ làm test chớp tắt.
 */
export function attachInertWhenReady(
  frame: HTMLIFrameElement | null,
  handlers: InertHandlers,
  schedule: (fn: () => void) => () => void = nextFrame,
): () => void {
  let detach: (() => void) | null = null;
  let cancelPending: (() => void) | null = null;
  let stopped = false;
  let tries = 0;

  const attempt = () => {
    cancelPending = null;
    if (stopped || detach) return;

    detach = attachInert(frame, handlers);
    if (detach) return;

    if (++tries > INERT_RETRY_FRAMES) return;
    cancelPending = schedule(attempt);
  };

  attempt();

  return () => {
    stopped = true;
    cancelPending?.();
    cancelPending = null;
    detach?.();
    detach = null;
  };
}

/**
 * Lề giữ quanh node được cuộn tới, tính bằng pixel TRÊN MÀN HÌNH (đã thu).
 *
 * Phải lớn hơn nhãn id của khung chọn (~18px, nằm TRÊN viền): cuộn sát mép thì nhãn —
 * thứ duy nhất nói khung đó là node nào — rơi ra ngoài.
 */
const REVEAL_MARGIN = 24;

/**
 * Phần tử để cuộn tới cho `nodeId`: chính nó nếu nó có hộp, không thì thứ gần nhất có.
 *
 * Hai kiểu "không thấy", hai đường lui:
 *
 *  - **Không có trong DOM** (`render: false`, hay tổ tiên đang ẩn): thử tổ tiên theo
 *    DOC — xem `revealCandidates`.
 *  - **Có mà không có hộp** (`display: none` — ẩn ở khổ này, hay nằm trong một nhánh
 *    như thế): `getClientRects()` rỗng và rect toàn số 0, tức cuộn về đầu trang. Leo
 *    lên cha gần nhất trong DOM CÓ hộp.
 *
 * Một slide carousel nằm ngoài khung ngang của carousel thì VẪN có hộp, nên nó được
 * cuộn tới theo chiều dọc như mọi node khác; chiều ngang của scrollport bên trong
 * trang thì không đụng — xem `revealInFrame`.
 */
function revealableElement(fdoc: Document, doc: Doc, nodeId: NodeId): Element | null {
  for (const id of revealCandidates(doc, nodeId)) {
    let el: Element | null = fdoc.querySelector(`[data-n="${id}"]`);
    while (el && el.getClientRects().length === 0) el = el.parentElement;
    if (el) return el;
  }
  return null;
}

/**
 * Cuộn một vùng tới `to`: nhảy tới cách đích một màn rồi lướt nốt — xem `glideStart`.
 * Người dùng tắt chuyển động thì nhảy thẳng, không lướt chút nào.
 *
 * `'instant'` chứ không `'auto'`: `'auto'` nghe theo `scroll-behavior` của CSS, và trang
 * trong khung có quyền đặt nó thành `smooth`.
 */
function glideTo(
  scroller: { scrollTo(options: ScrollToOptions): void },
  from: { top: number; left: number },
  to: { top: number; left: number },
  view: { height: number; width: number },
) {
  if (prefersReducedMotion()) {
    scroller.scrollTo({ ...to, behavior: 'instant' });
    return;
  }
  const top = glideStart(from.top, to.top, view.height);
  const left = glideStart(from.left, to.left, view.width);
  if (top !== from.top || left !== from.left) scroller.scrollTo({ top, left, behavior: 'instant' });
  scroller.scrollTo({ ...to, behavior: 'smooth' });
}

/**
 * Cuộn khung xem trước để node hiện ra — khi người dùng chọn nó từ NGOÀI khung.
 *
 * Trả `false` khi khung CHƯA có trang để cuộn (còn là `about:blank` ban đầu, hay tài
 * liệu chưa parse xong — cuộn lúc đó là cuộn trên một bố cục chưa đủ, `scrollHeight`
 * còn ngắn và đích bị kẹp sai): bên gọi giữ yêu cầu lại và thử ở lần `load` sau. Trả
 * `true` khi đã xử lý xong, kể cả khi không tìm được gì để cuộn tới — yêu cầu đó không
 * còn gì để đợi.
 *
 * Đợi `load` không treo được: nếu khung nạp xong TRƯỚC khi React gắn `onLoad` (hydrate
 * chậm), thì lúc effect chạy `readyState` đã là `complete` và lượt đầu đã thành công.
 *
 * ## Hai vùng cuộn, theo thứ tự
 *
 *  1. **Trong iframe** — trang cao hơn khung một màn, nên đây là vùng cuộn chính.
 *  2. **Pane bao ngoài** — khi khung đã thu vẫn cao hơn pane (khổ điện thoại ở mức
 *     100%, hay component cao theo nội dung) hoặc rộng hơn pane (chế độ `100%`).
 *     Tính theo vị trí node SAU bước 1, vì bước 1 cuộn mượt và lúc này chưa tới đích.
 *
 * ## Vì sao không `scrollIntoView`
 *
 * Nó cuộn MỌI vùng cuộn tổ tiên, kể cả những vùng thuộc về trang: scrollport của
 * carousel, dải ray ngang. Đó là sửa trạng thái của sản phẩm đang được xem chỉ để
 * nhìn một node — và chiều ngang của carousel là thứ effect của nó sở hữu. Với iframe
 * cùng nguồn, nó còn đi xuyên ra trang cha và cuộn bất kỳ vùng cuộn nào của vỏ builder
 * nằm trên đường. Nó cũng không biết lề cho nhãn khung chọn. Tự tính trên đúng hai
 * vùng cuộn của builder thì không có chuyện nào trong số đó.
 *
 * Lướt, trừ khi người dùng tắt chuyển động (`prefers-reduced-motion`) — thì nhảy
 * thẳng tới. Đọc tuỳ chọn của trang CHA: đó là người đang dùng builder. Xem `glideTo`.
 */
export function revealInFrame(
  frame: HTMLIFrameElement | null,
  pane: HTMLElement | null,
  doc: Doc,
  nodeId: NodeId,
  scale: number,
): boolean {
  const win = frame?.contentWindow;
  const fdoc = frame?.contentDocument;
  const root = fdoc?.documentElement;
  if (!frame || !win || !fdoc || !root || fdoc.readyState === 'loading') return false;
  // Chưa có node gốc = chưa phải trang của mình (khung trống ban đầu, hay đang thay).
  if (!fdoc.querySelector(`[data-n="${doc.rootId}"]`)) return false;

  const el = revealableElement(fdoc, doc, nodeId);
  if (!el) return true;

  const r = el.getBoundingClientRect();
  const s = scale > 0 ? scale : 1;

  // 1. Trong iframe. Lề chia cho `scale`: 24px trên màn là 24/scale px trong khung.
  const vh = root.clientHeight;
  const vw = root.clientWidth;
  const fromY = win.scrollY;
  const toY = revealScroll(
    { start: r.top, size: r.height },
    { size: vh, scroll: fromY, max: root.scrollHeight - vh },
    REVEAL_MARGIN / s,
  );
  if (toY !== null) {
    glideTo(win, { top: fromY, left: win.scrollX }, { top: toY, left: win.scrollX }, { height: vh, width: vw });
  }

  // 2. Pane bao ngoài — theo chỗ node SẼ nằm khi bước 1 tới đích.
  if (!pane) return true;
  const top = r.top - ((toY ?? fromY) - fromY);
  const f = frame.getBoundingClientRect();
  const p = pane.getBoundingClientRect();
  // Chỉ phần nằm TRONG khung: phần ngoài khung bị khung cắt, pane có cuộn cũng không thấy.
  const v = clipSpan({ start: top, size: r.height }, vh);
  const h = clipSpan({ start: r.left, size: r.width }, vw);

  const paneY = revealScroll(
    { start: f.top - p.top - pane.clientTop + v.start * s, size: v.size * s },
    { size: pane.clientHeight, scroll: pane.scrollTop, max: pane.scrollHeight - pane.clientHeight },
    REVEAL_MARGIN,
  );
  // Node nằm hẳn ngoài khung theo chiều ngang (slide carousel bên phải scrollport của
  // nó): không có gì để pane cuộn tới — cuộn về mép khung là cuộn tới một chỗ trống.
  const paneX = h.size > 0 || r.width === 0
    ? revealScroll(
        { start: f.left - p.left - pane.clientLeft + h.start * s, size: h.size * s },
        { size: pane.clientWidth, scroll: pane.scrollLeft, max: pane.scrollWidth - pane.clientWidth },
        REVEAL_MARGIN,
      )
    : null;
  if (paneY !== null || paneX !== null) {
    glideTo(
      pane,
      { top: pane.scrollTop, left: pane.scrollLeft },
      { top: paneY ?? pane.scrollTop, left: paneX ?? pane.scrollLeft },
      { height: pane.clientHeight, width: pane.clientWidth },
    );
  }
  return true;
}

export function Canvas({
  renderSrc,
  doc,
  presets,
  reloadToken = 0,
  fitContent = false,
  showDock = true,
  footer,
}: {
  /**
   * URL mà iframe nạp. Trang thì `/render/<pageId>`, component thì
   * `/render/component/<id>`.
   */
  renderSrc: string;
  doc: Doc;
  presets: PresetSummary[];
  /**
   * Tăng lên mỗi khi doc được lưu, để iframe nạp lại bản server render mới.
   *
   * Phải đi vào `key` của IFRAME, không phải của component này: `src` không đổi nên
   * React sẽ không tự nạp lại, nhưng dựng lại cả khung thì mất vị trí cuộn.
   */
  reloadToken?: number;
  /**
   * Khung cao bằng NỘI DUNG thay vì cao bằng một màn thiết bị.
   *
   * Bật khi sửa component: một cái nút 43px trong khung 1080px thì nằm lọt góc
   * trên–trái một vùng trắng mênh mông. Với TRANG thì tắt, vì chiều cao khung phải
   * là chiều cao một màn thật — đó là thứ `100svh` bên trong nghĩa là.
   */
  fitContent?: boolean;
  /** Dock đáy ("Thêm component", "Thêm trang"). */
  showDock?: boolean;
  /**
   * Dải nằm DƯỚI vùng xem, trong cùng khung canvas (dock Văn bản · Cảnh báo · AI của
   * màn sửa trang). Chiếm chỗ trong luồng chứ không đè lên khung — vùng xem tự ngắn lại.
   */
  footer?: React.ReactNode;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  /** Khung ĐANG HIỆN. Mọi phép đo, viền chọn và lớp vô hiệu hoá đọc từ đây. */
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  /*
   * Hai khung: khung đang hiện, và khung bản mới đang nạp ẨN phía sau nó.
   *
   * Trước 08/10/2026 `reloadToken` đi thẳng vào `key` của iframe duy nhất: mỗi lần lưu,
   * React gỡ khung cũ và dựng khung mới tại chỗ. Đo trên trang chủ (11.500px): khung
   * trắng ~340ms sau mỗi lần lưu, và vị trí cuộn bên trong khung về 0 — sửa một thứ ở
   * giữa trang là bị đá lên đầu trang, mỗi lần.
   *
   * Giờ khung mới nạp ẩn; khi nó `load` xong mới chép vị trí cuộn của khung cũ sang rồi
   * hoán đổi. Người dùng chỉ thấy nội dung đổi tại chỗ. Server render vẫn là nguồn sự
   * thật: canvas vẫn hiện ĐÚNG thứ server sẽ trả về, chỉ không còn chớp.
   *
   * Thứ tự key luôn tăng, và khung mới luôn đứng SAU khung cũ trong DOM: gỡ khung cũ thì
   * khung mới ở yên chỗ. Di chuyển một iframe trong DOM là nạp lại nó.
   */
  const [shownKey, setShownKey] = useState(reloadToken);
  const nextKey = reloadToken !== shownKey ? reloadToken : null;
  const frameEls = useRef(new Map<number, HTMLIFrameElement>());
  const reloadStartedAt = useRef<number | null>(null);

  const [selBox, setSelBox] = useState<Box | null>(null);
  const [hovBox, setHovBox] = useState<Box | null>(null);
  const [loaded, setLoaded] = useState(0);
  /** Bề ngang pane, để tính mức thu. Đo bằng ResizeObserver, không đoán. */
  const [paneWidth, setPaneWidth] = useState(0);
  /** `true` = xem đúng 100%, pane cuộn ngang nếu không đủ chỗ. */
  const [actualSize, setActualSize] = useState(false);
  /** Chiều cao nội dung khi `fitContent`. */
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const screens = useEditor((s) => s.screens);
  const activeScreenId = useEditor((s) => s.activeScreenId);
  const hydrateScreens = useEditor((s) => s.hydrateScreens);
  const selectedId = useEditor((s) => s.selectedId);
  const hoveredId = useEditor((s) => s.hoveredId);
  const storeSelect = useEditor((s) => s.select);
  const hover = useEditor((s) => s.hover);
  const select = useCallback(
    (id: string | null, inner?: string | null) => storeSelect(id, inner ? { inner } : undefined),
    [storeSelect],
  );

  const screen: Screen = screens.find((s) => s.id === activeScreenId) ?? screens[0]!;

  /*
   * "Toàn trang": khung cao bằng nội dung, pane cuộn thay cho khung — nhìn cả trang một lượt
   * như Figma. Bật/tắt ở `ScreenBar`, nhớ trong localStorage. Không áp cho component
   * (`fitContent` đã bám nội dung sẵn).
   *
   * Đơn vị chiều cao màn trong khung bị đóng băng theo chiều cao THIẾT BỊ (xem
   * `freeze-viewport.ts`), nên hero vẫn cao như trên máy thật. Đổi lại: hiệu ứng theo cuộn
   * đứng yên, vì khung không còn cuộn.
   */
  const [fullPageChosen, setFullPageChosen] = useState(false);
  useEffect(() => {
    if (readFlag(safeStorage(), STORAGE_KEYS.canvasFullPage)) setFullPageChosen(true);
  }, []);
  const fullPage = fullPageChosen && !fitContent;
  const live = useRef({ fullPage, vh: screen.height });
  live.current = { fullPage, vh: screen.height };

  /** Đóng băng `vh` + tắt cuộn trong một khung, nếu đang ở chế độ Toàn trang. */
  const prepareFrame = useCallback((frame: HTMLIFrameElement | null) => {
    const fdoc = frame?.contentDocument;
    if (!live.current.fullPage || !fdoc?.documentElement) return;
    freezeViewportUnits(fdoc, live.current.vh);
    // Khung đã cao bằng nội dung; còn vài px lệch thì cũng không được sinh thanh cuộn thứ hai.
    fdoc.documentElement.style.overflow = 'hidden';
  }, []);

  /*
   * Tắt Toàn trang, hay đổi sang khổ có chiều cao khác: `vh` trong khung đã thành px của
   * chiều cao cũ, không "rã đông" được — nạp lại khung. `location.reload()` không thêm mục
   * lịch sử (khác với đổi `src`, xem `key` của iframe).
   */
  const frozenFor = useRef<number | null>(null);
  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (fullPage) {
      if (frozenFor.current !== null && frozenFor.current !== screen.height) win?.location.reload();
      frozenFor.current = screen.height;
    } else if (frozenFor.current !== null) {
      frozenFor.current = null;
      win?.location.reload();
    }
  }, [fullPage, screen.height]);

  const toggleFullPage = () => {
    const next = !fullPageChosen;
    setFullPageChosen(next);
    write(safeStorage(), STORAGE_KEYS.canvasFullPage, next ? '1' : '0');
  };

  useEffect(() => {
    if (reloadToken !== shownKey) reloadStartedAt.current = performance.now();
  }, [reloadToken, shownKey]);

  /*
   * Đi tắt cho phần NHÌN: batch vừa lưu có đổi style thì server trả kèm CSS của bản mới
   * (`/api/ops` → `liveCss`), và CSS đó thay vào khung đang hiện ngay — đổi padding là
   * thấy ngay, không đợi ~1 giây dựng lại cả trang. Bản render đầy đủ vẫn tới sau và thay
   * khung như thường; nó mang đúng CSS này, nên không có gì nhảy.
   */
  const liveCss = useEditor((s) => s.liveCss);
  useEffect(() => {
    if (!liveCss) return;
    const style = frameRef.current?.contentDocument?.querySelector<HTMLStyleElement>('style[data-mm-doc]');
    if (style) style.textContent = liveCss.css;
    // CSS vừa thay mang `vh` mới — đóng băng lại, không thì hero phình theo khung.
    prepareFrame(frameRef.current);
  }, [liveCss, prepareFrame]);

  /** Khung bản mới đã nạp xong: mang vị trí cuộn sang, rồi cho nó lên hiện. */
  const promote = useCallback((key: number) => {
    const incoming = frameEls.current.get(key);
    const from = frameRef.current?.contentWindow;
    const to = incoming?.contentWindow;
    if (from && to) {
      try {
        to.scrollTo(from.scrollX, from.scrollY);
      } catch {
        // Khung khác nguồn: không đọc được vị trí cuộn. Hiện từ đầu còn hơn không hiện.
      }
    }
    if (incoming) frameRef.current = incoming;
    if (reloadStartedAt.current !== null) {
      recordTiming('canvas', performance.now() - reloadStartedAt.current);
      reloadStartedAt.current = null;
    }
    setShownKey(key);
    setLoaded((n) => n + 1);
  }, []);

  // Nạp danh sách khổ đã lưu SAU khi mount: `localStorage` không có trên server, và
  // đọc nó trong lúc render sẽ làm HTML hai bên lệch nhau.
  useEffect(() => { hydrateScreens(); }, [hydrateScreens]);

  /* ── Mức thu ───────────────────────────────────────────────────────── */

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const ro = new ResizeObserver(([entry]) => {
      setPaneWidth(entry!.contentRect.width);
    });
    ro.observe(pane);
    setPaneWidth(pane.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  /*
   * Thu cho vừa bề NGANG, và không bao giờ phóng to quá 100%.
   *
   * `Math.min(1, …)` là phần quan trọng: khung 320px trong pane 1000px mà phóng lên
   * 3× thì chữ to bằng ngón tay và không còn giống điện thoại nào cả.
   */
  const scale = actualSize || paneWidth === 0
    ? 1
    : Math.min(1, (paneWidth - GUTTER * 2) / screen.width);

  /* ── Đo node trong khung ───────────────────────────────────────────── */

  const measure = useCallback((nodeId: string | null): Box | null => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !nodeId) return null;
    const el = doc.querySelector(`[data-n="${nodeId}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Toạ độ trong hệ CHƯA thu của khung. Lớp phủ nằm trong cùng phần tử đã `scale`
    // nên nó dùng đúng hệ này — không phải nhân chia gì với `scale`.
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }, []);

  useEffect(() => { setSelBox(measure(selectedId)); }, [selectedId, measure, loaded, scale]);
  useEffect(() => { setHovBox(measure(hoveredId)); }, [hoveredId, measure]);

  /* ── Chọn / hover / vô hiệu hoá tương tác ──────────────────────────── */

  useEffect(() => {
    const onScroll = () => {
      setSelBox(measure(useEditor.getState().selectedId));
      setHovBox(measure(useEditor.getState().hoveredId));
    };
    return attachInertWhenReady(frameRef.current, { select, hover, onScroll });
  }, [loaded, select, hover, measure]);

  /* ── Cuộn tới node được chọn từ ngoài khung ────────────────────────── */

  /*
   * Chỉ xử lý yêu cầu MỚI (theo `seq`), và chỉ đánh dấu xong khi khung đã có trang.
   *
   * `loaded` trong deps là đường thử lại: yêu cầu đến lúc khung còn đang nạp (mở
   * editor bằng link `?node=`, hay bấm cây ngay khi vừa vào) thì `revealInFrame` trả
   * `false`, yêu cầu nằm chờ, và `onLoad` của khung chạy lại effect này. Các lần
   * `loaded` tăng SAU đó (mỗi lần lưu là một khung mới) thì `seq` đã xử lý rồi — không
   * kéo người dùng về node cũ sau mỗi lần sửa.
   *
   * Bấm trong canvas đi qua `select(id)` không cờ, nên `reveal` là `null` và effect
   * này không làm gì: node vừa bấm thì đang nằm dưới con trỏ rồi.
   */
  const reveal = useEditor((s) => s.reveal);
  const revealedSeq = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.seq === revealedSeq.current) return;
    /*
     * Node VỪA TẠO (`exact`) chưa có trong khung đang hiện → CHỜ bản server mới. Không chờ
     * thì `revealInFrame` lùi về tổ tiên gần nhất có trong khung cũ (thường là gốc), cuộn
     * tới đó, và đánh dấu yêu cầu là xong — node vừa chèn ở cuối trang không bao giờ được
     * cuộn tới (16/10/2026). Effect chạy lại khi khung mới lên hiện (`shownKey`).
     */
    if (reveal.exact && !frameRef.current?.contentDocument?.querySelector(`[data-n="${CSS.escape(reveal.id)}"]`)) {
      return;
    }
    if (revealInFrame(frameRef.current, paneRef.current, doc, reveal.id, scale)) {
      revealedSeq.current = reveal.seq;
    }
    // `shownKey`: node VỪA CHÈN chỉ có trong khung bản mới, và khung đó lên hiện qua
    // `promote` chứ không qua `loaded` — thiếu nó thì lượt thử lại sau khi lưu không bao
    // giờ chạy, và bấm Chèn ở pane Component không cuộn tới node mới (16/10/2026).
  }, [reveal, loaded, doc, scale, shownKey]);

  /*
   * `?node=` / `?cn=` / `?component=` / `?locale=` do `EditorShell` đọc MỘT lần (xem
   * `useLinkParams` ở đó): link dẫn tới component phải mở component TRƯỚC khi chọn node, và
   * chỉ `EditorShell` biết khi nào cây component đã nạp. Canvas từng đọc `?node=` ở đây
   * nhưng không biết gì về component nên không đủ cho link mới.
   */

  /* ── Chiều cao khung khi bám nội dung (component, và trang ở chế độ Toàn trang) ── */

  useEffect(() => {
    if (!fitContent && !fullPage) {
      setContentHeight(null);
      return;
    }
    const read = () => {
      const fdoc = frameRef.current?.contentDocument;
      if (fullPage) {
        if (!fdoc?.body) return;
        prepareFrame(frameRef.current);
        // `body`, không phải `scrollHeight` của tài liệu: cái sau không bao giờ nhỏ hơn
        // chính khung, nên trang ngắn lại thì khung không co lại được.
        const h = Math.ceil(fdoc.body.getBoundingClientRect().height);
        if (h > 0) setContentHeight(Math.max(screen.height, h));
        return;
      }
      const root = fdoc?.querySelector(`[data-n="${doc.rootId}"]`);
      if (!root) return;
      // Chừa lề dưới, và một mức tối thiểu để khung rỗng vẫn bấm được.
      setContentHeight(Math.max(200, Math.ceil(root.getBoundingClientRect().height) + 48));
    };
    read();
    // Đo lại sau một nhịp: webfont và ảnh về sau lần render đầu.
    const t = setTimeout(read, 600);
    // Toàn trang: nội dung còn đổi cao sau đó (ảnh lười, khối mở/đóng) — theo dõi luôn.
    // Không vòng lặp: `vh` đã đóng băng nên chiều cao body không phụ thuộc chiều cao khung.
    const win = frameRef.current?.contentWindow as (Window & typeof globalThis) | null | undefined;
    const body = frameRef.current?.contentDocument?.body;
    const ro = fullPage && win?.ResizeObserver && body ? new win.ResizeObserver(read) : null;
    if (ro && body) ro.observe(body);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
    };
  }, [fitContent, fullPage, loaded, reloadToken, shownKey, doc.rootId, screen.height, prepareFrame]);

  const frameHeight = fitContent || fullPage ? (contentHeight ?? screen.height) : screen.height;

  /*
   * Phơi trạng thái ra DOM cho e2e.
   *
   * Không có nó thì test phải đoán lại phép tính thu — cùng lý do đã ghi ở
   * `e2e/layer-row-actions.spec.ts` khi bản canvas cũ không phơi pan/zoom.
   */
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    pane.dataset.stageScale = scale.toFixed(4);
    pane.dataset.stageWidth = String(screen.width);
    pane.dataset.stageHeight = String(frameHeight);
    pane.dataset.stageScreen = screen.id;
  });

  return (
    // `min-w-0`: đây là con GIỮA của lưới ba pane, và con của grid mặc định
    // `min-width: auto` — tức không co xuống dưới min-content của mình.
    // `ScreenBar` là một hàng nút không xuống dòng, nên ở màn hẹp chính nó đặt sàn
    // cho cả cột và đẩy trang tràn ngang, dù canvas bên trong đã tự thu vừa khung.
    //
    // Nền lưới nằm trên khung NGOÀI, không trên vùng cuộn: `background` của phần tử
    // `overflow: auto` đứng yên khi nội dung cuộn, nên lưới không trôi theo trang.
    // KHÔNG `overflow-hidden` ở đây: bảng Khổ màn và danh sách cảnh báo là lớp nổi mọc
    // ra từ khung này, và cắt chúng ở mép là giấu nửa bảng khi canvas hẹp. Nền đã tự
    // theo góc bo.
    <div
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col rounded-xl bg-canvas-bg',
        'bg-[linear-gradient(var(--color-canvas-grid)_1px,transparent_1px),linear-gradient(90deg,var(--color-canvas-grid)_1px,transparent_1px)] bg-size-[24px_24px]',
      )}
    >
      <ScreenBar
        scale={scale}
        actualSize={actualSize}
        onToggleActualSize={() => setActualSize((v) => !v)}
        fullPage={fullPage}
        // Component đã bám nội dung sẵn — không có gì để bật.
        onToggleFullPage={fitContent ? undefined : toggleFullPage}
      />

      {/* Vùng xem. Cuộn dọc là chuyện thường; cuộn ngang chỉ xảy ra ở chế độ 100%. */}
      <div
        ref={paneRef}
        data-stage=""
        className="relative min-h-0 flex-1 overflow-auto"
      >
        <div
          // Bo góc và bóng ở lớp CHƯA thu: đặt trên khung đã `scale` thì góc bo co
          // theo mức thu, và ở 25% nó còn chưa tới 3px.
          className="mx-auto overflow-hidden rounded shadow-shell-pop"
          style={{
            // Bề rộng sau khi thu, để phần tử cha cuộn đúng và khung nằm giữa.
            width: screen.width * scale,
            height: frameHeight * scale,
            marginBlock: GUTTER / 2,
          }}
        >
          {/*
            `overflow-hidden` là BẮT BUỘC, không phải để cho gọn.

            Viền chọn/hover lấy `height` từ `getBoundingClientRect()` bên trong iframe,
            nên một section cao 5.000px trong khung 900px sẽ vẽ ra một div cao 5.000px.
            Không cắt thì nó làm pane cuộn phình ra và **sinh thêm một thanh cuộn** cạnh
            thanh cuộn của chính trang — đúng lỗi người dùng báo ngày 20/08/2026: thanh
            cuộn tự xuất hiện khi chỉ di chuột vào một phần tử.

            Cắt ở đây là đúng chỗ: khung là khung nhìn của thiết bị, và một phần tử cao
            hơn khung thì trên thiết bị thật cũng chỉ thấy được phần trong khung.
          */}
          <div
            data-stage-frame=""
            className="relative overflow-hidden bg-shell-paper"
            style={{
              width: screen.width,
              height: frameHeight,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {[shownKey, ...(nextKey === null ? [] : [nextKey])].map((key) => {
              const shown = key === shownKey;
              return (
                <iframe
                  // Token nằm trong key: `src` không đổi giữa hai lần lưu nên React sẽ
                  // không nạp lại, mà bản server render thì đã mới.
                  //
                  // `src` CŨNG nằm trong key: đổi `src` của một iframe đang sống (trang →
                  // component) là một lượt điều hướng trong khung, và trình duyệt ghi nó vào
                  // lịch sử CHUNG của tab. Nút Back khi đó lùi cái iframe chứ không lùi
                  // trang (đo 16/10/2026: `history.back()` không ra `popstate` nào, URL đứng
                  // yên). Iframe MỚI nạp lần đầu thì không thêm mục lịch sử nào.
                  key={`${renderSrc}#${key}`}
                  ref={(el) => {
                    if (el) frameEls.current.set(key, el);
                    else frameEls.current.delete(key);
                    if (el && shown) frameRef.current = el;
                  }}
                  src={renderSrc}
                  title={shown ? `Xem trước ${screen.width}px` : 'Bản mới đang nạp'}
                  aria-hidden={shown ? undefined : true}
                  tabIndex={shown ? undefined : -1}
                  data-canvas-frame={shown ? 'shown' : 'next'}
                  onLoad={(e) => {
                    // Đóng băng TRƯỚC khi khung lên hiện: khung bản mới không được chớp
                    // một hero cao bằng cả trang.
                    prepareFrame(e.currentTarget);
                    if (shown) setLoaded((n) => n + 1);
                    else promote(key);
                  }}
                  className={cn(
                    'h-full w-full border-0',
                    !shown && 'pointer-events-none invisible absolute inset-0',
                  )}
                />
              );
            })}

            {hovBox && hoveredId !== selectedId && (
              <Outline box={hovBox} scale={scale} tone="hover" />
            )}
            {selBox && <Outline box={selBox} scale={scale} tone="select" label={selectedId} />}
          </div>
        </div>

        {showDock && <CanvasInsertDock doc={doc} presets={presets} />}
      </div>

      {footer}
    </div>
  );
}

/**
 * Viền quanh node đang chọn hoặc đang hover.
 *
 * Nét và nhãn chia cho `scale` để chúng luôn dày 1px và đọc được trên MÀN HÌNH, dù
 * khung đang bị thu bao nhiêu. Không chia thì ở mức thu 50% viền mỏng thành nửa
 * pixel và biến mất.
 */
function Outline({
  box,
  scale,
  tone,
  label,
}: {
  box: Box;
  scale: number;
  tone: 'select' | 'hover';
  label?: string | null;
}) {
  const color = tone === 'select' ? 'var(--color-shell-accent)' : 'color-mix(in oklab, var(--color-shell-accent) 45%, transparent)';
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
        outline: `${(tone === 'select' ? 2 : 1) / scale}px solid ${color}`,
        outlineOffset: 0,
      }}
    >
      {tone === 'select' && label && (
        <span
          className="font-shell-mono absolute whitespace-nowrap bg-shell-accent text-shell-on-accent"
          style={{
            fontSize: 10.5 / scale,
            lineHeight: 1.4,
            // Đệm và bo góc cũng chia cho `scale`, cùng lý do với cỡ chữ.
            padding: `${1 / scale}px ${5 / scale}px`,
            borderRadius: 4 / scale,
            /*
              Nhãn nằm TRÊN viền, trừ khi không còn chỗ thì tụt vào TRONG.

              Khung giờ cắt phần tràn (xem `overflow-hidden` ở trên), nên một node sát
              mép trên sẽ có nhãn bị cắt mất hoàn toàn — và lúc đó không còn cách nào
              biết mình đang chọn node nào ngoài việc dò trong cây.
            */
            top: box.top < 18 / scale ? 0 : -18 / scale,
            left: 0,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/** Lớp style đang được ghi, suy ra từ bề rộng khung — dùng cho nhãn ở thanh trên. */
export function activeStyleLayer(width: number) {
  return breakpointForWidth(width);
}
