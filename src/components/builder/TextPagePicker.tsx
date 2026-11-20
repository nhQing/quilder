'use client';

/**
 * Chọn trang cho màn Văn bản — một ô chọn thay cho dãy nút (19/11/2026: mười mấy trang thành
 * ba hàng nút đẩy bảng xuống dưới màn đầu).
 *
 * Vẫn là URL `?page=`: đổi lựa chọn thì điều hướng tới đúng URL đó, nên mở tab mới, gửi link và
 * nút Back của trình duyệt dùng được như trước. Không có JS thì `<form method="get">` + nút
 * trong `<noscript>` vẫn chuyển trang được.
 */

import { useRouter } from 'next/navigation';
import { useId } from 'react';

import { SelectField } from './ui/Field';

export interface TextPageOption {
  id: string;
  title: string;
  slug: string;
}

/** Nhãn một lựa chọn: tiêu đề + đường dẫn — nhiều trang có tiêu đề gần giống nhau. */
export function pageOptionLabel(p: Pick<TextPageOption, 'title' | 'slug'>): string {
  const path = '/' + p.slug.replace(/^\/+/, '');
  return `${p.title || '(chưa đặt tiêu đề)'} — ${path}`;
}

export function TextPagePicker({ pages, current }: { pages: readonly TextPageOption[]; current: string }) {
  const router = useRouter();
  const id = useId();
  return (
    <form method="get" action="/builder/text" className="flex max-w-full items-center gap-2 self-start">
      <label htmlFor={id} className="shrink-0 text-small font-medium text-shell-muted">
        Trang
      </label>
      <SelectField
        id={id}
        name="page"
        size="md"
        value={current}
        onChange={(e) => router.push(`/builder/text?page=${encodeURIComponent(e.target.value)}`)}
        wrapperClassName="min-w-0"
        className="w-[min(40rem,100%)] max-w-full"
      >
        {pages.map((p) => (
          <option key={p.id} value={p.id}>
            {pageOptionLabel(p)}
          </option>
        ))}
      </SelectField>
      <noscript>
        <button type="submit" className="text-small font-medium underline">
          Mở
        </button>
      </noscript>
    </form>
  );
}
