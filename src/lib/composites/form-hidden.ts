/**
 * Giá trị của ô ẩn (`kind: 'hidden'`) — thay chỗ giữ chỗ ở SERVER lúc render.
 *
 * Ô ẩn nằm trong doc, còn giá trị cần gửi (tên sự kiện của trang chi tiết) chỉ biết lúc
 * render một bài cụ thể. Thay ở server chứ không ở trình duyệt: HTML ra đã mang đúng
 * giá trị, và không có JS nào phải đọc lại tiêu đề trang.
 */

import { localizeHref, type LinkLocale } from '@/lib/i18n/locale-href';

export interface HiddenScope {
  /** Binding `collection` của trang: bài/sự kiện đang mở (title, slug…). */
  collection?: Record<string, unknown>;
  /** `scope.page` — `slug` là slug của TRANG (mẫu `events/[slug]` mang cả đoạn động). */
  page?: Record<string, unknown>;
  /**
   * Ngôn ngữ đang phục vụ. `{page.path}` mang tiền tố của nó (`/en/events/…`).
   *
   * Thiếu tiền tố thì nơi nhận không biết khách gửi từ trang nào: 20/11/2026 form đăng
   * ký trên `/en/events/the-art-of-wealth` gửi `/events/the-art-of-wealth`, và gói
   * MaiMoney (suy ngôn ngữ từ ô này) trả câu báo lẫn email xác nhận bằng tiếng Việt.
   */
  locale?: LinkLocale;
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

export function resolveHiddenValue(template: string | undefined, scope: HiddenScope): string {
  if (!template) return '';
  const entrySlug = str(scope.collection?.slug);
  return template.replace(/\{(entry\.title|entry\.slug|page\.path)\}/g, (_, key: string) => {
    if (key === 'entry.title') return str(scope.collection?.title);
    if (key === 'entry.slug') return entrySlug;
    const pageSlug = str(scope.page?.slug);
    const path = '/' + pageSlug.replace(/\[[^\]]+\]/, entrySlug).replace(/^\/+/, '');
    return localizeHref(path, scope.locale);
  });
}
