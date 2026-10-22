/**
 * Con trỏ tuỳ biến — một chấm bám sát con trỏ thật và một vòng trễ phía sau.
 *
 * Port từ `Website-MM/shared/js/effects/cursor.js`. CSS thì KHÔNG port: builder
 * đã có sẵn `src/styles/components/cursor.css` — bản sao nguyên văn của thiết
 * kế, import ở `site.css:30` — và cho tới hôm nay nó là 45 dòng CSS CHẾT, vì
 * không có gì render ra `.cursor`. Module này là phần còn thiếu.
 *
 * ## Vì sao effect tự dựng DOM thay vì đọc cây node
 *
 * `cursor.css` bám vào tên class: `.cursor`, `.cursor__dot`, `.cursor__ring`,
 * `.cursor__label`. Node của builder phát ra `data-n` và `data-part`, KHÔNG phát
 * ra class — nên không có cách nào dựng con trỏ bằng cây node mà CSS kia khớp
 * được. Hoặc viết lại CSS theo `data-*`, hoặc effect tự dựng DOM. Chọn cách sau
 * vì nó giữ được một bản CSS duy nhất dùng chung với bản thiết kế: sửa thiết kế
 * thì chép lại file, không phải dịch lại.
 *
 * Và con trỏ không phải nội dung. Nó `aria-hidden`, không đọc được, không dịch
 * được, không ai muốn thấy nó trong cây node. `text-split` đã đi trước trên cùng
 * lằn ranh này: DOM do effect tính ra thì effect sở hữu.
 *
 * ## Vì sao gắn vào một node bất kỳ mà vẫn là singleton
 *
 * Con trỏ là chrome của CẢ TRANG, nhưng hợp đồng effect là "gắn vào một element".
 * Nên `el` ở đây chỉ là chỗ neo vòng đời — gắn vào đâu cũng cho cùng một kết
 * quả, và thực tế nên gắn vào node ngoài cùng của trang. Gắn hai lần thì đếm
 * tham chiếu, không dựng hai con trỏ: hai con trỏ `difference` chồng nhau sẽ
 * triệt tiêu lẫn nhau thành một mảng xám, và không ai đoán được vì sao.
 *
 * ## Đảo màu là blend, không phải logic màu
 *
 * `mix-blend-mode: difference` nằm trong CSS. Không có chỗ nào ở đây đọc nền hay
 * đổi màu theo section — chú thích của bản gốc nói thẳng lý do: *"painted in
 * `mix-blend-mode: difference` so the cursor stays legible over imagery without
 * any colour logic"*. Nên nó đảo trên MỌI nền, kể cả video và ảnh, miễn phí.
 *
 * ## Khoảng hở giữa chấm và vòng CHÍNH LÀ hiệu ứng
 *
 * Chấm ghim đúng con trỏ, vòng `damp` theo sau. Đứng yên thì chấm nằm giữa vòng;
 * đang di chuyển thì vòng tụt lại. Bỏ phần trễ đi là còn lại một vòng tròn vẽ
 * lại con trỏ hệ thống, chậm hơn.
 *
 * ## Một chỗ CỐ Ý khác bản gốc
 *
 * Bản gốc bắt hover bằng `'a, button, [data-cursor-hover]'`. Thuộc tính
 * `data-cursor-hover` không đặt được từ tầng nội dung của builder — node chỉ
 * phát `data-part`. Nên mặc định ở đây là `[data-part~="cursor-hover"]`, cùng
 * hình dạng hợp đồng mà `menu-toggle` dùng cho `"burger"` và `nav-invert` dùng
 * cho `"nav-dark"`. `a` và `button` vẫn tự động ăn, nên node Button và mọi link
 * không cần đánh dấu gì.
 */

import { z } from 'zod';

import { damp } from '../math';
import * as raf from '../raf';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /**
   * Thứ được coi là "bấm được", tức làm vòng phình ra.
   *
   * `a` và `button` là mặc định của bản gốc và giữ nguyên. Phần thứ ba dịch
   * `[data-cursor-hover]` sang vai `part` — xem docblock. Thẻ, ô ảnh, hàng mục
   * lục… những thứ bấm được mà không phải `<a>`/`<button>` thì đặt
   * `part: "cursor-hover"` cho chúng.
   */
  hoverSelector: z
    .string()
    .min(1)
    .max(200)
    .default('a, button, [data-part~="cursor-hover"]'),

  /**
   * Độ trễ của vòng, dưới dạng tham số `smoothing` của `damp`.
   *
   * Đọc là "phần khoảng cách CÒN LẠI sau một giây": 0.0004 nghĩa là sau 1s vòng
   * đã đi hết 99.96% quãng đường. Nhỏ hơn = bám sát hơn, lớn hơn = lười hơn.
   * Mặc định là con số của bản thiết kế, đừng đổi nếu chỉ muốn "mượt hơn" —
   * cảm giác mượt đến từ vòng lặp rAF chung, không từ số này.
   */
  trail: z.number().min(0.000001).max(0.5).default(0.0004),
});

type Params = z.infer<typeof paramsSchema>;

/* ── Trạng thái dùng chung ────────────────────────────────────────────── */

interface Live {
  root: HTMLElement;
  dot: HTMLElement;
  ring: HTMLElement;
  label: HTMLElement;
  hoverSelector: string;
  trail: number;
  unsubscribe: () => void;
}

const pointer = { x: 0, y: 0 };
const ringPos = { x: 0, y: 0 };
let live: Live | null = null;
let refCount = 0;

function onPointerMove(event: PointerEvent): void {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  // Con trỏ nằm im ở `opacity: 0` cho tới lần di chuyển đầu tiên, nếu không nó
  // sẽ nhấp nháy ở giữa màn hình trên mỗi lần tải trang.
  if (live && live.root.dataset.active !== 'true') live.root.dataset.active = 'true';
}

function onPointerOver(event: PointerEvent): void {
  if (!live) return;

  const target =
    event.target instanceof Element ? event.target.closest(live.hoverSelector) : null;

  live.root.dataset.hover = target ? 'true' : 'false';
  live.label.textContent =
    target instanceof HTMLElement ? (target.dataset.cursorLabel ?? '') : '';
}

function onPointerLeave(): void {
  if (live) live.root.dataset.active = 'false';
}

function frame({ deltaSec }: raf.FrameInfo): void {
  if (!live) return;

  ringPos.x = damp(ringPos.x, pointer.x, live.trail, deltaSec);
  ringPos.y = damp(ringPos.y, pointer.y, live.trail, deltaSec);

  live.dot.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`;
  live.ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`;
}

/**
 * Dựng đúng cây DOM mà `cursor.css` mô tả.
 *
 * Thứ tự con quan trọng: `.cursor__dot` trước `.cursor__ring`, giống bản thiết
 * kế. Cả hai `position: absolute` không z-index, nên vòng vẽ ĐÈ lên chấm — và
 * lúc hover, vòng đặc nuốt chấm thay vì để chấm nổi lên trên.
 */
function build(): { root: HTMLElement; dot: HTMLElement; ring: HTMLElement; label: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'cursor';
  root.dataset.cursor = '';
  root.setAttribute('aria-hidden', 'true');

  const dot = document.createElement('div');
  dot.className = 'cursor__dot';

  const ring = document.createElement('div');
  ring.className = 'cursor__ring';

  const label = document.createElement('span');
  label.className = 'cursor__label';

  ring.append(label);
  root.append(dot, ring);
  document.body.append(root);

  return { root, dot, ring, label };
}

/**
 * Selector đến từ JSONB trong Postgres hoặc từ tool call của AI, nên nó có thể
 * không phải CSS hợp lệ. `closest()` với selector hỏng KHÔNG trả null — nó NÉM,
 * và nó ném ở mọi lần `pointerover`, tức mọi lần con trỏ đi qua bất cứ thứ gì.
 * Triệu chứng sẽ là "con trỏ hiện ra nhưng không bao giờ phình", kèm một dòng
 * console lặp vô hạn — không ai lần ngược được về một ô chữ trong inspector.
 *
 * Kiểm một lần lúc gắn, và rơi về mặc định nếu hỏng.
 */
function selectorKhaDung(selector: string): string {
  try {
    document.createDocumentFragment().querySelector(selector);
    return selector;
  } catch {
    console.warn(`[cursor] hoverSelector không hợp lệ, dùng mặc định: ${selector}`);
    return paramsSchema.parse({}).hoverSelector;
  }
}

/**
 * Gắn lần đầu là bên quyết định tham số — lần gắn sau chỉ tăng bộ đếm.
 *
 * Con trỏ là singleton, nên hai node gắn với `trail` khác nhau không thể cùng
 * đúng. Lấy bên đầu tiên; dựng hai con trỏ thì tệ hơn hẳn (xem docblock).
 * Thực tế effect này gắn MỘT lần cho cả trang, nên đây là đường thoát hiểm
 * chứ không phải đường chính.
 */
function ensureRunning(params: Params): void {
  if (live) return;

  const { root, dot, ring, label } = build();

  // Bắt đầu ở giữa màn hình để frame đầu tiên không bay vào từ góc trái trên.
  pointer.x = window.innerWidth / 2;
  pointer.y = window.innerHeight / 2;
  ringPos.x = pointer.x;
  ringPos.y = pointer.y;

  // Chỉ giấu con trỏ hệ thống khi con trỏ tự vẽ THẬT SỰ đang chạy. Ghi trước
  // rồi mới bật là cách duy nhất không có một frame nào không có con trỏ nào.
  document.body.dataset.cursorEnabled = 'true';

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);

  live = {
    root,
    dot,
    ring,
    label,
    hoverSelector: selectorKhaDung(params.hoverSelector),
    trail: params.trail,
    // Bản gốc đăng ký ở priority 5 — sau `magnetic` (effect + 4), nên vòng đọc
    // được vị trí nút đã bị hút trong cùng frame chứ không chậm một frame.
    unsubscribe: raf.add(frame, raf.PRIORITY.effect + 5),
  };
}

function stopIfUnused(): void {
  if (refCount > 0 || !live) return;

  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerover', onPointerOver);
  document.removeEventListener('pointerleave', onPointerLeave);

  live.unsubscribe();
  live.root.remove();
  live = null;

  delete document.body.dataset.cursorEnabled;
}

/* ── Effect ───────────────────────────────────────────────────────────── */

export default defineEffect<Params>({
  key: 'cursor',
  name: 'Con trỏ tuỳ biến',
  paramsSchema,
  aiDescription:
    'Thay con trỏ hệ thống bằng một chấm bám sát con trỏ và một vòng tròn trễ phía sau, đảo màu trên mọi nền. Vòng phình ra và đặc lại khi rê vào link hoặc nút. Gắn MỘT lần cho cả trang, vào node ngoài cùng. Chỉ chạy khi có chuột thật.',
  runtimeCost: 'light',
  // Không ghi state nào lên node được gắn: `data-active`/`data-hover` nằm trên
  // DOM của chính con trỏ, không phải trên node, nên `style.states` không với
  // tới được và khai ra đây sẽ là một lời hứa sai.
  gates: { finePointerOnly: true },

  init(el, params) {
    // `el` không được dùng: con trỏ là chrome của cả trang, `el` chỉ neo vòng
    // đời. Xem docblock — đây là cố ý, không phải bỏ sót.
    void el;

    refCount += 1;
    ensureRunning(params);

    return () => {
      refCount = Math.max(0, refCount - 1);
      stopIfUnused();
    };
  },
});
