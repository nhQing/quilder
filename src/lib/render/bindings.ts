/**
 * Binding: `{ t: 'bind', ref, fallback }` → chuỗi đã định dạng.
 *
 * Ba nguồn: `site` (globals), `page` (metadata), và `collection` — item của khối
 * đang lặp, hoặc entry của trang chi tiết. Nguồn thứ ba trả `fallback` trên mọi
 * trang thường, đúng như trước khi nó được resolve.
 *
 * Vì sao binding quan trọng: số giấy phép và hotline xuất hiện ở cả trust bar lẫn
 * footer. Gõ tay hai nơi nghĩa là một ngày nào đó chúng lệch nhau — với một công ty
 * tài chính thì đó là vấn đề tuân thủ, không phải lỗi chính tả.
 */

import type { BindingRef } from '@/lib/doc/types';

export interface BindingScope {
  site: Record<string, unknown>;
  page: Record<string, unknown>;
  /**
   * Item của khối đang lặp, hoặc entry của trang chi tiết.
   *
   * Vắng mặt trên trang thường — và khi vắng, binding `collection` trả `fallback`.
   * Đó là lý do nó optional chứ không phải `{}`: `{}` và "không có ngữ cảnh" là hai
   * chuyện khác nhau, và chỉ chuyện thứ hai mới đáng trả về chữ tác giả đã gõ.
   */
  collection?: Record<string, unknown>;
}

/**
 * Đọc `a.b.c` và `a.0.b` an toàn.
 *
 * Chỉ số mảng có mặt từ khi collection dùng tới: một field `group` repeatable là một
 * MẢNG, và `ctas.0.heading` là cách duy nhất trỏ vào mục đầu của nó từ một binding.
 * Trước đó ghi chú ở đây nói "collection chưa dùng tới" — giờ dùng tới.
 */
function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) {
      const i = Number(key);
      // `Number('')` là 0, nên `a..b` sẽ đọc phần tử đầu nếu không chặn chuỗi rỗng.
      return key !== '' && Number.isInteger(i) && i >= 0 ? acc[i] : undefined;
    }
    if (typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

export function formatBinding(
  ref: BindingRef,
  fallback: string,
  scope: BindingScope,
): string {
  const root =
    ref.source === 'site' ? scope.site
    : ref.source === 'page' ? scope.page
    : scope.collection;
  // Trang thường không có ngữ cảnh collection — trả `fallback`, đúng như trước.
  if (!root) return fallback;

  // path dạng 'site.phone' — bỏ tiền tố nguồn nếu tác giả viết kèm.
  const path = ref.path.startsWith(`${ref.source}.`)
    ? ref.path.slice(ref.source.length + 1)
    : ref.path;

  const raw = readPath(root, path);
  if (raw === null || raw === undefined || raw === '') return fallback;

  switch (ref.format) {
    case 'currencyVND': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return fallback;
      return new Intl.NumberFormat('vi-VN', {
        style: 'currency', currency: 'VND', maximumFractionDigits: 0,
      }).format(n);
    }
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? new Intl.NumberFormat('vi-VN').format(n) : fallback;
    }
    case 'date': {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) return fallback;
      return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'long' }).format(d);
    }
    default:
      return String(raw);
  }
}
