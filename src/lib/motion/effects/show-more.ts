/**
 * Effect `show-more` — nút "Xem thêm / Thu gọn" bung một phần nội dung đang gập.
 *
 * Ca gốc: bảng "So sánh giữa các lựa chọn" của maimoney.com/maicash hiện 5 hàng,
 * bấm "Xem thêm" thì hiện thêm 6 hàng và nút đổi thành "Thu gọn".
 *
 * ## Vì sao không dùng `menu-toggle` hay Accordion
 *
 * `menu-toggle` là trình đơn: mở là khoá cuộn và bẫy focus — đúng với ngăn kéo,
 * sai với một bảng dài thêm. Accordion phát `<details>`: nút luôn đứng TRƯỚC nội
 * dung và không đổi được nhãn, trong khi ở đây nút nằm dưới ghi chú và đọc
 * "Thu gọn" khi đang mở.
 *
 * ## Ẩn bằng `hidden` + `display:none` nội dòng
 *
 * Chỉ `hidden` là không đủ: lớp style của node (`display:flex`…) thắng style mặc
 * định của trình duyệt cho `[hidden]`. Style nội dòng thắng cả hai. Nội dung vẫn
 * nằm trong HTML nên máy tìm kiếm và Ctrl+F vẫn thấy.
 *
 * ## Đổi nhãn tại chỗ
 *
 * Nhãn là chữ trong Button (RichText). Effect thay `nodeValue` của nút chữ duy
 * nhất trong nút, không gán `textContent`, để thẻ bọc chữ (và style của nó) còn
 * nguyên. Nhiều nút chữ thì không đoán — giữ nhãn gốc.
 */

import { z } from 'zod';

import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Vai của nút bật/tắt, trong `part`. */
  togglePart: z.string().min(1).max(40).default('more-toggle'),
  /** Vai của khối bị gập. Nhiều node mang vai này thì gập/bung cùng lúc. */
  panelPart: z.string().min(1).max(40).default('more-panel'),
  /** Nhãn của nút khi đang mở. Nhãn khi gập là chữ tác giả đặt trên nút. */
  labelOpen: z.string().min(1).max(60).default('Thu gọn'),
});

type Params = z.infer<typeof paramsSchema>;

interface TextLike {
  nodeType: number;
  nodeValue: string | null;
  childNodes?: ArrayLike<TextLike>;
}

/** Nút chữ có nội dung trong nút; đúng MỘT thì đổi được nhãn tại chỗ. */
function onlyTextNode(root: TextLike): TextLike | null {
  const found: TextLike[] = [];
  const walk = (n: TextLike) => {
    for (const c of Array.from(n.childNodes ?? [])) {
      if (c.nodeType === 3) {
        if (c.nodeValue?.trim()) found.push(c);
      } else walk(c);
    }
  };
  walk(root);
  return found.length === 1 ? found[0]! : null;
}

export default defineEffect<Params>({
  key: 'show-more',
  name: 'Xem thêm / Thu gọn',
  paramsSchema,
  aiDescription:
    'Nút "Xem thêm" bung phần nội dung đang gập ngay tại chỗ (vd thêm hàng cho bảng), bấm lại là "Thu gọn". Gắn lên node bọc cả nút lẫn phần gập. Đánh dấu nút bằng part "more-toggle" và mọi khối bị gập bằng part "more-panel" (setProps part). Gắn vào là gập; nhãn khi mở lấy từ param labelOpen (mặc định "Thu gọn"). Ghi state "more-open" lên node gắn effect. Tự lo aria-expanded. Không khoá cuộn — khác menu-toggle.',
  runtimeCost: 'light',
  statesWritten: ['more-open'],
  // Đổi trạng thái theo cú bấm, không phải chuyển động.
  gates: { respectReducedMotion: false },

  init(el, params) {
    const toggles = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.togglePart}"]`)];
    const panels = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.panelPart}"]`)];
    // Cây đang dựng dở trong builder: không làm gì, không ném.
    if (!toggles.length || !panels.length) return;

    const labels = toggles.map((t) => {
      const node = onlyTextNode(t as unknown as TextLike);
      return { node, closed: node?.nodeValue ?? null };
    });

    const panelId = panels[0]!.id || `mm-more-${el.dataset.n ?? 'x'}`;
    panels[0]!.id = panelId;
    for (const t of toggles) t.setAttribute('aria-controls', panelId);

    const apply = (open: boolean) => {
      for (const p of panels) {
        p.hidden = !open;
        p.style.display = open ? '' : 'none';
      }
      for (const t of toggles) t.setAttribute('aria-expanded', String(open));
      for (const l of labels) if (l.node) l.node.nodeValue = open ? params.labelOpen : l.closed;
      if (open) el.dataset.moreOpen = 'true';
      else delete el.dataset.moreOpen;
    };

    let open = false;
    apply(false);

    const onClick = (event: Event) => {
      event.preventDefault();
      open = !open;
      apply(open);
    };
    for (const t of toggles) t.addEventListener('click', onClick);

    return () => {
      for (const t of toggles) {
        t.removeEventListener('click', onClick);
        t.removeAttribute('aria-expanded');
        t.removeAttribute('aria-controls');
      }
      for (const p of panels) {
        p.hidden = false;
        p.style.display = '';
      }
      for (const l of labels) if (l.node) l.node.nodeValue = l.closed;
      delete el.dataset.moreOpen;
    };
  },
});
