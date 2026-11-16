/**
 * Effect `share-link` — nút "Chia sẻ" của trang bài.
 *
 * `network: "facebook"` (mặc định): mở hộp chia sẻ của Facebook
 * (`facebook.com/sharer/sharer.php?u=<URL trang>`) trong cửa sổ nhỏ. Ảnh, tiêu đề và
 * mô tả trên bài đăng Facebook do Facebook tự đọc từ thẻ `og:image` / `og:title` /
 * `og:description` của trang — tức ảnh OG của bài (field SEO, rơi về ảnh thu nhỏ).
 * Facebook phải tải được trang, nên chỉ chạy với tên miền công khai.
 *
 * `network: "native"`: bảng chia sẻ của máy (`navigator.share`); máy không có thì
 * chép link. `network: "copy"`: luôn chép link. Chép xong bật cờ `share-copied`
 * trong `copiedMs` để nút đổi kiểu ("Đã chép link").
 *
 * Vì sao là effect chứ không phải link: đường dẫn cần chia sẻ là URL của CHÍNH trang
 * đang mở, mà href của Button là chữ cố định trong doc — một trang mẫu
 * `blogs/post/[slug]` không gõ trước được URL của từng bài.
 */

import { z } from 'zod';

import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Bao lâu cờ `share-copied` còn bật sau khi chép, ms. */
  copiedMs: z.number().int().min(300).max(10000).default(2000),
  /** Chia sẻ đi đâu. */
  network: z.enum(['facebook', 'native', 'copy']).default('facebook'),
});

type Params = z.infer<typeof paramsSchema>;

/** Đường dẫn hộp chia sẻ Facebook cho một URL. */
export function facebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

/** URL để chia sẻ: trang hiện tại, bỏ hash và tham số theo dõi `utm_*`. */
export function shareUrl(href: string): string {
  const url = new URL(href);
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k);
  return url.toString();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Trang không an toàn (http) hoặc bị chặn quyền: rơi về textarea + execCommand.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export default defineEffect<Params>({
  key: 'share-link',
  name: 'Nút chia sẻ trang',
  paramsSchema,
  aiDescription:
    'Gắn lên một Button (action none) để thành nút "Chia sẻ" URL trang hiện tại. network "facebook" (mặc định) mở hộp chia sẻ Facebook trong cửa sổ nhỏ — ảnh/tiêu đề/mô tả Facebook lấy từ og:image/og:title/og:description của trang (SEO của bài); "native" mở bảng chia sẻ của máy (navigator.share), không có thì chép link; "copy" luôn chép link. Ghi state "share-copied" trong copiedMs (mặc định 2000) sau khi chép — style bằng setStyle target {state:"share-copied"}.',
  appliesTo: ['Button'],
  runtimeCost: 'light',
  statesWritten: ['share-copied'],
  gates: { respectReducedMotion: false },

  init(el, params) {
    let timer: number | undefined;

    const onClick = async (event: MouseEvent) => {
      event.preventDefault();
      const url = shareUrl(window.location.href);
      if (params.network === 'facebook') {
        const w = 600;
        const h = 640;
        const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
        const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
        // KHÔNG đặt `noopener` trong chuỗi tính năng: với nó `window.open` luôn trả null,
        // và nhánh dự phòng bên dưới sẽ mở thêm một tab thứ hai. Cắt `opener` bằng tay.
        const popup = window.open(
          facebookShareUrl(url),
          'mm-share-facebook',
          `width=${w},height=${h},left=${left},top=${top}`,
        );
        if (popup) popup.opener = null;
        // Trình duyệt chặn popup: chuyển sang chính tab này thay vì im lặng.
        else window.location.assign(facebookShareUrl(url));
        return;
      }
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (params.network === 'native' && typeof nav.share === 'function') {
        try {
          await nav.share({ title: document.title, url });
          return;
        } catch (err) {
          // Người dùng đóng bảng: không làm gì thêm. Lỗi khác: rơi về chép link.
          if (err instanceof DOMException && err.name === 'AbortError') return;
        }
      }
      if (await copyText(url)) {
        el.dataset.shareCopied = 'true';
        el.setAttribute('aria-live', 'polite');
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          delete el.dataset.shareCopied;
        }, params.copiedMs);
      }
    };

    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('click', onClick);
      window.clearTimeout(timer);
      delete el.dataset.shareCopied;
    };
  },
});
