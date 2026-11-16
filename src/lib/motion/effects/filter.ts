/**
 * Effect `filter` — các nút lọc một danh sách theo tham số trên URL (`?place=ha-noi`).
 *
 * Ca gốc: hàng nút "Tất cả / Hà Nội / Hồ Chí Minh" trên /events. Bấm một nút thì
 * lưới chỉ còn thẻ của nơi đó, nút được chọn tô đậm, và URL đổi thành
 * `/events?place=ha-noi` — mở link đó (hoặc gõ `?place=Ha-Noi`) là vào thẳng
 * trạng thái lọc.
 *
 * ## Lọc ở trình duyệt, không ở server
 *
 * Trang site dựng theo đường dẫn và không đọc query, nên lọc ở server cần một
 * kiểu nguồn lặp mới lẫn đường truyền query xuống renderer. Danh sách sự kiện chỉ
 * vài chục thẻ: ẩn/hiện tại chỗ nhanh hơn một lượt tải trang, và giống prototype.
 * Đổi lại, HTML luôn chứa đủ mọi thẻ — đúng cho máy tìm kiếm, và trang không có
 * JS vẫn đủ nội dung.
 *
 * ## Lấy giá trị từ chính nội dung
 *
 * - Nút: là link (Button action link); giá trị là tham số `param` trong `href`. "Tất
 *   cả" là link không có tham số. Không JS thì link vẫn chạy.
 * - Thẻ: giá trị là CHỮ của node mang part `valuePart` bên trong thẻ (vd nơi tổ
 *   chức "Hà Nội" in trên thẻ), chuẩn hoá về `ha-noi`. Không thêm field hay thuộc
 *   tính nào cho dữ liệu.
 *
 * ## Effect chỉ ghi trạng thái, style nằm ở doc
 *
 * Nút đang chọn nhận cờ `filter-active`, nút khác `filter-inactive` (cùng lý do hai
 * cờ với `steps`). Thẻ bị lọc ra nhận `hidden` + `display:none` nội dòng (cùng lý do
 * với `show-more`).
 */

import { z } from 'zod';

import {
  filterValueFromHref,
  hrefWithFilter,
  itemVisible,
  normalizeFilterValue,
  resolveActive,
} from './filter-model';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Tên tham số trên URL. */
  param: z.string().regex(/^[a-z][a-z0-9_-]*$/i).max(40).default('place'),
  /** Vai của mỗi nút lọc (link), trong `part`. */
  optionPart: z.string().min(1).max(40).default('filter-option'),
  /** Vai của mỗi mục bị lọc. */
  itemPart: z.string().min(1).max(40).default('filter-item'),
  /** Vai của node bên trong mục mang chữ dùng làm giá trị. */
  valuePart: z.string().min(1).max(40).default('filter-value'),
});

type Params = z.infer<typeof paramsSchema>;

export default defineEffect<Params>({
  key: 'filter',
  name: 'Nút lọc theo tham số URL',
  paramsSchema,
  aiDescription:
    'Hàng nút lọc một danh sách theo tham số URL (vd /events?place=ha-noi). Gắn lên node bọc CẢ hàng nút lẫn danh sách. Mỗi nút là Button action link mang part "filter-option", href chứa tham số (vd "/events?place=ha-noi"; nút "Tất cả" trỏ "/events" không tham số). Mỗi mục (vd root của component thẻ lặp) mang part "filter-item", và node chữ bên trong mục mang part "filter-value" (vd nơi tổ chức "Hà Nội"). So khớp không phân biệt hoa thường/dấu ("Ha-Noi" = "Hà Nội"). Bấm nút: ẩn mục không khớp, đổi URL không tải lại trang. Ghi state "filter-active" / "filter-inactive" lên từng nút — style nút đang chọn bằng setStyle target {state:"filter-active"}. Param: param (mặc định "place").',
  runtimeCost: 'light',
  statesWritten: ['filter-active', 'filter-inactive'],
  // Đổi trạng thái theo cú bấm, không phải chuyển động.
  gates: { respectReducedMotion: false },

  init(el, params) {
    const options = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.optionPart}"]`)];
    const items = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.itemPart}"]`)];
    // Cây đang dựng dở trong builder: không làm gì, không ném.
    if (!options.length) return;

    const base = window.location.href;
    const optionValues = options.map((o) => filterValueFromHref(o.getAttribute('href'), params.param, base));
    const itemValues = items.map((item) =>
      normalizeFilterValue(item.querySelector(`[data-part~="${params.valuePart}"]`)?.textContent),
    );

    const apply = (active: string) => {
      options.forEach((o, i) => {
        const on = optionValues[i] === active;
        if (on) {
          o.dataset.filterActive = 'true';
          delete o.dataset.filterInactive;
          o.setAttribute('aria-current', 'true');
        } else {
          o.dataset.filterInactive = 'true';
          delete o.dataset.filterActive;
          o.removeAttribute('aria-current');
        }
      });
      items.forEach((item, i) => {
        const show = itemVisible(active, itemValues[i] ?? '');
        item.hidden = !show;
        item.style.display = show ? '' : 'none';
      });
    };

    const fromUrl = () =>
      resolveActive(
        normalizeFilterValue(new URL(window.location.href).searchParams.get(params.param)),
        optionValues,
      );

    apply(fromUrl());

    const cleanups = options.map((o, i) => {
      const onClick = (event: MouseEvent) => {
        // Ctrl/⌘/giữa chuột = mở tab mới: để trình duyệt làm việc của nó.
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const value = optionValues[i] ?? '';
        window.history.pushState(null, '', hrefWithFilter(window.location.href, params.param, value));
        apply(value);
      };
      o.addEventListener('click', onClick);
      return () => o.removeEventListener('click', onClick);
    });

    const onPop = () => apply(fromUrl());
    window.addEventListener('popstate', onPop);

    return () => {
      for (const c of cleanups) c();
      window.removeEventListener('popstate', onPop);
      for (const o of options) {
        delete o.dataset.filterActive;
        delete o.dataset.filterInactive;
        o.removeAttribute('aria-current');
      }
      for (const item of items) {
        item.hidden = false;
        item.style.display = '';
      }
    };
  },
});
