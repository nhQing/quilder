/**
 * Effect `app-link` — nút "Tải ứng dụng" trỏ thẳng tới cửa hàng trên điện thoại.
 *
 * Port từ home-v2/effects/useAppStoreLink.js. Trên máy tính, nút giữ nguyên đích
 * do tác giả đặt — thường là một neo trong trang dẫn tới mã QR. Trên điện thoại,
 * nó trỏ thẳng tới cửa hàng tương ứng.
 *
 * ## Nhận diện máy
 *
 * - Android → Google Play.
 * - iPhone / iPad / iPod → App Store.
 * - iPadOS 13+ ở chế độ "Request Desktop Website" (MẶC ĐỊNH) gửi user agent y hệt
 *   macOS; điểm khác còn đáng tin duy nhất là màn hình cảm ứng — Mac không có cái
 *   nào, kể cả Mac có Touch Bar. Nên `Macintosh` + `maxTouchPoints > 1` là iOS.
 *
 * ## Vì sao là effect chứ không phải bước SSR
 *
 * Trang được dựng tĩnh rồi cache; user agent chỉ có ở client. Effect ghi đè sau
 * khi hydrate, còn HTML tĩnh giữ href gốc nên không-JS vẫn có một đích dùng được.
 *
 * ## Rời khỏi site
 *
 * `target=_blank` + `rel=noopener`: không có `noopener`, trang cửa hàng chạm được
 * `window.opener` của ta. Cả ba thuộc tính được trả về nguyên trạng khi dọn.
 */

import { z } from 'zod';

import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Link App Store. */
  ios: z.string().url(),
  /** Link Google Play. */
  android: z.string().url(),
});

type Params = z.infer<typeof paramsSchema>;

/** Máy đang cầm là iOS hay Android; `null` = máy tính (hoặc không rõ). */
function detectStore(): 'ios' | 'android' | null {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  return null;
}

export default defineEffect<Params>({
  key: 'app-link',
  name: 'Link cửa hàng ứng dụng',
  paramsSchema,
  aiDescription:
    'Trên điện thoại, đổi đích của nút/link sang cửa hàng ứng dụng tương ứng (Android → Google Play, iPhone/iPad → App Store) và mở tab mới (target=_blank rel=noopener); trên máy tính giữ nguyên href tác giả đặt (thường là neo tới mã QR). Gắn lên node Button có action navigate (render thành thẻ <a>) — vẫn phải đặt href mặc định cho máy tính. Bắt buộc 2 tham số: ios (URL App Store) và android (URL Google Play).',
  appliesTo: ['Button'],
  requiredParams: ['ios', 'android'],
  runtimeCost: 'light',
  // Đổi đích chứ không phải chuyển động: người bật giảm chuyển động vẫn phải được
  // dẫn tới cửa hàng.
  gates: { respectReducedMotion: false },

  init(el, params) {
    // Chỉ thẻ <a> mới có đích để thay. Button submit/action thường không có.
    if (!(el instanceof HTMLAnchorElement)) return;

    const store = detectStore();
    if (!store) return;
    const href = store === 'ios' ? params.ios : params.android;

    const prev = {
      href: el.getAttribute('href'),
      target: el.getAttribute('target'),
      rel: el.getAttribute('rel'),
    };

    el.setAttribute('href', href);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener');

    return () => {
      const restore = (name: string, value: string | null) => {
        if (value === null) el.removeAttribute(name);
        else el.setAttribute(name, value);
      };
      restore('href', prev.href);
      restore('target', prev.target);
      restore('rel', prev.rel);
    };
  },
});
