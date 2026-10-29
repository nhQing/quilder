/**
 * Effect `steps` — danh sách bước bấm chọn, mỗi bước kèm một ảnh minh hoạ.
 *
 * Ca gốc: khối "Bắt đầu trong 3 bước" của maimoney.com/maigreen. Bấm một bước thì
 * bước đó mở phần mô tả, các bước khác gập lại, và chồng ảnh điện thoại bên cạnh
 * trượt dọc tới ảnh của bước đó.
 *
 * ## Effect chỉ ghi trạng thái, style nằm ở doc
 *
 * Mỗi bước (part "step") và mỗi ảnh (part "step-media") nhận cờ `step-active` hoặc
 * `step-inactive`. Hai cờ chứ không một: style base của trang là ảnh tĩnh lúc clone
 * (bước đầu mở sẵn), nên bước đầu cần style cho lúc BỊ gập và các bước sau cần style
 * cho lúc ĐƯỢC mở. Base giữ đúng ảnh tĩnh thì trang không nhảy bố cục khi JS chạy.
 *
 * State áp cho cả cây con của node mang cờ (xem `css.ts`), nên vòng số, tiêu đề và
 * khung mô tả bên trong một bước style được theo trạng thái của bước đó.
 *
 * ## Ảnh trượt bằng biến CSS
 *
 * Ảnh thứ i nhận `--step-offset` = (bước đang chọn − i): 0 là ảnh đang xem, âm là
 * ảnh nằm phía trên, dương là phía dưới. Vị trí và transition do customCss của ảnh
 * quyết định (vd `translateY(calc(var(--step-offset, 0) * 162%))`), nên khoảng trượt
 * và nhịp chỉnh được trong doc mà không đụng tới code.
 */

import { z } from 'zod';

import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Vai của mỗi bước bấm được, trong `part`. */
  stepPart: z.string().min(1).max(40).default('step'),
  /** Vai của ảnh đi kèm, cùng thứ tự với các bước. Không bắt buộc. */
  mediaPart: z.string().min(1).max(40).default('step-media'),
  /** Bước mở sẵn, đếm từ 0. Ngoài khoảng thì kẹp về bước gần nhất. */
  initial: z.number().int().min(0).max(50).default(0),
});

type Params = z.infer<typeof paramsSchema>;

const ACTIVATE_KEYS = new Set(['Enter', ' ', 'Spacebar']);

export default defineEffect<Params>({
  key: 'steps',
  name: 'Các bước bấm chọn',
  paramsSchema,
  aiDescription:
    'Danh sách bước bấm chọn kèm ảnh minh hoạ (vd "Bắt đầu trong 3 bước"): bấm một bước thì bước đó mở, các bước khác gập, ảnh của bước đó trượt vào. Gắn lên node bọc cả danh sách lẫn ảnh. Đánh dấu mỗi bước bằng part "step" và mỗi ảnh bằng part "step-media" (cùng thứ tự). Effect ghi state "step-active" / "step-inactive" lên bước và ảnh — style cho các node BÊN TRONG bước (vòng số, tiêu đề, khung mô tả) cũng viết theo hai state này. Ảnh nhận biến --step-offset (bước đang chọn − thứ tự ảnh) để customCss dịch ảnh. Param initial = bước mở sẵn. Tự lo role tab, tabindex, aria-selected và phím Enter/Space.',
  runtimeCost: 'light',
  statesWritten: ['step-active', 'step-inactive'],
  // Đổi trạng thái theo cú bấm, không phải chuyển động.
  gates: { respectReducedMotion: false },

  init(el, params) {
    const items = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.stepPart}"]`)];
    const media = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.mediaPart}"]`)];
    // Cây đang dựng dở trong builder: không làm gì, không ném.
    if (!items.length) return;

    const mark = (node: HTMLElement, on: boolean) => {
      if (on) {
        node.dataset.stepActive = 'true';
        delete node.dataset.stepInactive;
      } else {
        node.dataset.stepInactive = 'true';
        delete node.dataset.stepActive;
      }
    };

    const select = (index: number) => {
      items.forEach((item, i) => {
        mark(item, i === index);
        item.setAttribute('aria-selected', String(i === index));
      });
      media.forEach((m, i) => {
        mark(m, i === index);
        m.style.setProperty('--step-offset', String(index - i));
      });
    };

    const cleanups = items.map((item, i) => {
      // Bước là Stack (div): phải tự khai vai và đưa vào thứ tự tab.
      const hadRole = item.hasAttribute('role');
      const hadTabindex = item.hasAttribute('tabindex');
      if (!hadRole) item.setAttribute('role', 'tab');
      if (!hadTabindex) item.setAttribute('tabindex', '0');

      const onClick = () => select(i);
      const onKey = (event: KeyboardEvent) => {
        if (!ACTIVATE_KEYS.has(event.key)) return;
        event.preventDefault();
        select(i);
      };
      item.addEventListener('click', onClick);
      item.addEventListener('keydown', onKey);

      return () => {
        item.removeEventListener('click', onClick);
        item.removeEventListener('keydown', onKey);
        if (!hadRole) item.removeAttribute('role');
        if (!hadTabindex) item.removeAttribute('tabindex');
        item.removeAttribute('aria-selected');
      };
    });

    select(Math.min(params.initial, items.length - 1));

    return () => {
      for (const c of cleanups) c();
      for (const node of [...items, ...media]) {
        delete node.dataset.stepActive;
        delete node.dataset.stepInactive;
      }
      for (const m of media) m.style.removeProperty('--step-offset');
    };
  },
});
