/**
 * Effect `paginate` — chia một danh sách dài thành trang, có thanh số trang và
 * giữ số trang trên URL (`?page=2`).
 *
 * Ca gốc: lưới bài của trang danh mục `/blogs/[category]` — khối lặp lấy tới 100
 * bài và in hết một lượt, ảnh của cả trăm thẻ tranh nhau tải.
 *
 * ## Chia ở trình duyệt, không ở server
 *
 * Cùng lý do với `filter`: trang site dựng theo đường dẫn và không đọc query. Ở
 * đây HTML vẫn chứa đủ mọi bài (máy tìm kiếm thấy đủ, không JS vẫn đọc được),
 * effect chỉ ẨN các thẻ ngoài trang hiện tại. Thẻ bị ẩn mang `display:none`, và
 * ảnh của next/image mặc định `loading="lazy"` — trình duyệt không tải ảnh của
 * thẻ đang `display:none`, nên trang 1 chỉ tải ảnh của trang 1.
 *
 * ## Nút số trang lấy style từ doc
 *
 * Effect KHÔNG tự vẽ nút. Trong node mang part `pager` có một Button mẫu mang
 * part `page-link`; effect nhân bản nó cho mỗi số trang (bản sao giữ nguyên
 * `data-n`, nên mọi style của node mẫu áp cho cả dãy) rồi ẩn bản mẫu. Nút đang
 * chọn nhận cờ `page-active`, nút khác `page-inactive`; ô "…" nhận `page-gap`.
 * Hai nút lùi/tới (part `page-prev` / `page-next`, tuỳ chọn) nhận `page-disabled`
 * ở hai đầu. Style từng trạng thái bằng setStyle target {state:"page-active"}.
 *
 * Chỉ có một trang thì cả `pager` bị ẩn.
 */

import { z } from 'zod';

import * as scroll from '../scroll';
import { clampPage, hrefWithPage, onPage, pageCount, pageList } from './paginate-model';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Số mục mỗi trang. */
  pageSize: z.number().int().min(1).max(100).default(12),
  /** Tên tham số trên URL. */
  param: z.string().regex(/^[a-z][a-z0-9_-]*$/i).max(40).default('page'),
  /** Vai của mỗi mục được chia trang. */
  itemPart: z.string().min(1).max(40).default('page-item'),
  /** Số trang hai bên trang hiện tại trước khi rút thành "…". */
  siblings: z.number().int().min(0).max(3).default(1),
  /** Cuộn lên đầu khối khi đổi trang. */
  scrollToTop: z.boolean().default(true),
});

type Params = z.infer<typeof paramsSchema>;

const FLAGS = ['pageActive', 'pageInactive', 'pageGap', 'pageDisabled'] as const;

function clearFlags(node: HTMLElement) {
  for (const f of FLAGS) delete node.dataset[f];
}

function setDisabled(node: HTMLElement | null, disabled: boolean) {
  if (!node) return;
  if (disabled) {
    node.dataset.pageDisabled = 'true';
    node.setAttribute('aria-disabled', 'true');
    node.tabIndex = -1;
  } else {
    delete node.dataset.pageDisabled;
    node.removeAttribute('aria-disabled');
    node.removeAttribute('tabindex');
  }
}

export default defineEffect<Params>({
  key: 'paginate',
  name: 'Phân trang danh sách',
  paramsSchema,
  aiDescription:
    'Chia một danh sách dài thành trang (mặc định 12 mục/trang), số trang nằm trên URL (?page=2). Gắn lên node bọc CẢ danh sách lẫn thanh số trang. Mỗi mục (vd Instance lặp của thẻ tin) mang part "page-item". Thanh số trang là một node mang part "pager" chứa MỘT Button mẫu (action link, href bất kỳ) mang part "page-link" — effect nhân bản nút đó cho từng số trang và ẩn bản mẫu, nên style nút mẫu là style của cả dãy. Tuỳ chọn: Button part "page-prev" / "page-next". Ghi state "page-active" / "page-inactive" / "page-gap" lên nút số và "page-disabled" lên nút lùi/tới ở hai đầu — style bằng setStyle target {state:"page-active"}. Một trang thì "pager" bị ẩn. Mục ngoài trang bị display:none nên ảnh lazy của chúng không tải. Param: pageSize, param (mặc định "page"), siblings, scrollToTop.',
  runtimeCost: 'light',
  statesWritten: ['page-active', 'page-inactive', 'page-gap', 'page-disabled'],
  // Đổi trạng thái theo cú bấm, không phải chuyển động.
  gates: { respectReducedMotion: false },

  init(el, params) {
    const items = [...el.querySelectorAll<HTMLElement>(`[data-part~="${params.itemPart}"]`)];
    const pager = el.querySelector<HTMLElement>('[data-part~="pager"]');
    const template = pager?.querySelector<HTMLElement>('[data-part~="page-link"]') ?? null;
    const prev = pager?.querySelector<HTMLElement>('[data-part~="page-prev"]') ?? null;
    const next = pager?.querySelector<HTMLElement>('[data-part~="page-next"]') ?? null;
    // Cây đang dựng dở trong builder: không làm gì, không ném.
    if (!items.length) return;

    const total = pageCount(items.length, params.pageSize);
    let clones: HTMLElement[] = [];
    let current = 1;

    if (template) {
      template.hidden = true;
      template.style.display = 'none';
    }
    if (pager) {
      pager.hidden = total <= 1;
      pager.style.display = total <= 1 ? 'none' : '';
    }

    const drawPager = () => {
      if (!pager || !template) return;
      for (const c of clones) c.remove();
      clones = [];
      let anchor: Element = template;
      for (const slot of pageList(current, total, params.siblings)) {
        const node = template.cloneNode(true) as HTMLElement;
        node.hidden = false;
        node.style.display = '';
        node.dataset.part = (node.dataset.part ?? '').replace(/\bpage-link\b/, 'page-link-item').trim();
        clearFlags(node);
        if (slot === 'gap') {
          node.textContent = '…';
          node.removeAttribute('href');
          node.setAttribute('aria-hidden', 'true');
          node.tabIndex = -1;
          node.dataset.pageGap = 'true';
        } else {
          node.textContent = String(slot);
          node.setAttribute('href', hrefWithPage(window.location.href, params.param, slot));
          node.setAttribute('aria-label', `Trang ${slot}`);
          node.dataset.page = String(slot);
          if (slot === current) {
            node.dataset.pageActive = 'true';
            node.setAttribute('aria-current', 'page');
          } else {
            node.dataset.pageInactive = 'true';
            node.removeAttribute('aria-current');
          }
        }
        anchor.after(node);
        anchor = node;
        clones.push(node);
      }
      if (prev) {
        prev.setAttribute('href', hrefWithPage(window.location.href, params.param, Math.max(1, current - 1)));
        setDisabled(prev, current <= 1);
      }
      if (next) {
        next.setAttribute('href', hrefWithPage(window.location.href, params.param, Math.min(total, current + 1)));
        setDisabled(next, current >= total);
      }
    };

    const apply = (page: number) => {
      current = page;
      items.forEach((item, i) => {
        const show = onPage(i, page, params.pageSize);
        item.hidden = !show;
        item.style.display = show ? '' : 'none';
      });
      drawPager();
    };

    const fromUrl = () => clampPage(new URL(window.location.href).searchParams.get(params.param), total);

    const go = (page: number) => {
      if (page === current || page < 1 || page > total) return;
      window.history.pushState(null, '', hrefWithPage(window.location.href, params.param, page));
      apply(page);
      if (params.scrollToTop) scroll.scrollTo(el, { offset: -120, duration: 0.6 });
    };

    apply(fromUrl());

    // Một listener trên `pager` thay vì mỗi nút một cái: dãy nút được vẽ lại mỗi lần đổi trang.
    const onClick = (event: MouseEvent) => {
      // Ctrl/⌘/giữa chuột = mở tab mới: để trình duyệt làm việc của nó.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const hit = target?.closest<HTMLElement>('[data-page], [data-part~="page-prev"], [data-part~="page-next"], [data-page-gap]');
      if (!hit || !pager?.contains(hit)) return;
      event.preventDefault();
      if (hit.dataset.pageGap || hit.dataset.pageDisabled) return;
      if (hit === prev) go(current - 1);
      else if (hit === next) go(current + 1);
      else go(Number(hit.dataset.page));
    };
    pager?.addEventListener('click', onClick);

    const onPop = () => apply(fromUrl());
    window.addEventListener('popstate', onPop);

    return () => {
      pager?.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPop);
      for (const c of clones) c.remove();
      for (const item of items) {
        item.hidden = false;
        item.style.display = '';
      }
      if (template) {
        template.hidden = false;
        template.style.display = '';
      }
      if (pager) {
        pager.hidden = false;
        pager.style.display = '';
      }
      for (const b of [prev, next]) {
        if (b) {
          clearFlags(b);
          setDisabled(b, false);
        }
      }
    };
  },
});
