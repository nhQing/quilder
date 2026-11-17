'use client';

/**
 * Giữ `<html lang>` đúng ngôn ngữ của trang đang xem sau khi điều hướng phía client.
 *
 * ## Vì sao cần (17/11/2026)
 *
 * `lang` do `(site)/layout.tsx` đặt lúc render server. Layout KHÔNG render lại khi
 * next/link chuyển trang, nên bấm "EN" trên `/blogs` đưa tới `/en/blogs` mà `<html>`
 * vẫn là `lang="vi"` cho tới khi tải lại trang:
 *  - header vẫn đánh dấu "VI": style chip ngôn ngữ đọc `html[lang="…"]`;
 *  - screen reader đọc chữ tiếng Anh bằng giọng tiếng Việt.
 *
 * ## Vì sao ép reflow trước khi đổi
 *
 * Trang đích được dựng mới hoàn toàn (đổi param của `[[...slug]]` là đổi segment), nên
 * header mới mount dưới `lang` CŨ rồi mới đổi sang `lang` mới ở đây. Ép trình duyệt tính
 * style trước khi đổi thì `transition` trong CSS của header có điểm xuất phát, tức con
 * gạt VI/EN TRƯỢT từ ngôn ngữ cũ sang ngôn ngữ mới thay vì nhảy. Lần tải đầu `lang` đã
 * đúng sẵn từ server, nên không có gì chạy.
 */

import { useEffect } from 'react';

export function HtmlLang({ code }: { code: string }) {
  useEffect(() => {
    const html = document.documentElement;
    if (html.lang === code) return;
    void html.offsetWidth; // chốt style của header mới dưới `lang` cũ — xem docblock
    html.lang = code;
  }, [code]);
  return null;
}
