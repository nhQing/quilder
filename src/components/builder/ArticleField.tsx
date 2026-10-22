'use client';

/**
 * Vỏ của ô soạn thân bài `html`: nạp CKEditor phía client, và nói ra những gì phép
 * làm sạch sẽ làm với bài này TRƯỚC khi bấm lưu.
 *
 * ## Vì sao phải có `next/dynamic` với `ssr: false`
 *
 * CKEditor chạm `window`/`document` ở tầng module. Import thẳng trong một component
 * client vẫn vỡ, vì Next render component client MỘT LẦN ở server để dựng HTML đầu
 * tiên. `ssr: false` là cách duy nhất bỏ lượt đó. Lỗi khi làm sai chỉ lộ ra ở
 * `pnpm build`, không ở `pnpm dev` — nên nó đáng một docblock chứ không một dòng.
 *
 * Bundle của CKEditor lớn (hàng trăm KB). `dynamic` cũng tách nó khỏi bundle chung,
 * nên trang danh sách entry và trang cấu trúc không phải tải nó.
 *
 * ## Cảnh báo, không chặn
 *
 * Hai thứ được nói ra ở đây và cả hai đều KHÔNG ngăn lưu:
 *
 *  - **Thẻ không được nhận.** Tính bằng `unsupportedTags`, chỉ dựa vào danh sách
 *    trắng thẻ — thứ không phụ thuộc database. Ô soạn ở client không biết bảng
 *    `EmbedOrigin`, nên nó KHÔNG đoán được `<iframe>` của tác giả có đi qua hay
 *    không; báo bừa là tệ hơn không báo. Câu chữ dưới đây nói đúng phạm vi đó.
 *  - **`h1` trong thân bài.** Trang chi tiết đã có `h1` là tiêu đề bài. Đây là một
 *    lỗi SEO/a11y không có triệu chứng nhìn thấy được, tức đúng loại lỗi cần một
 *    dòng chữ nhắc.
 *
 * Chặn thì sai: `h1` là thứ người dùng đã yêu cầu, và một thẻ lạ có thể là thứ tác
 * giả cố ý dán vào để rồi tự dọn.
 */

import dynamic from 'next/dynamic';
import { useMemo } from 'react';

import { htmlPlainText, unsupportedTags } from '@/lib/collections/html-sanitize';
import { cn } from '@/lib/builder/cn';

import { CKEDITOR_THEME } from './ckeditor-theme';
import { Spinner } from './ui/Button';

/**
 * `loading` là một khung có ĐÚNG chiều cao của ô soạn thật.
 *
 * Một placeholder thấp hơn làm cả form nhảy lên khi CKEditor nạp xong, và cú nhảy đó
 * xảy ra đúng lúc người dùng vừa bắt đầu đọc — nên nó tệ hơn một khoảng trống.
 */
const ArticleEditor = dynamic(() => import('./ArticleEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[27rem] items-center justify-center gap-2 rounded-md border border-shell-line-strong bg-shell-paper text-small text-shell-paper-ink/65">
      <Spinner />
      Đang nạp ô soạn…
    </div>
  ),
});

export interface ArticleFieldProps {
  value: unknown;
  onChange: (html: string) => void;
  maxChars?: number;
  disabled?: boolean;
}

export function ArticleField({ value, onChange, maxChars, disabled }: ArticleFieldProps) {
  // JSONB có thể chứa bất cứ gì: một hàng cũ vừa được đổi kiểu field từ `richdoc`
  // sang `html` vẫn còn một MẢNG ở đây. Không phải chuỗi thì coi như bài trống —
  // ném ở đây là làm trắng cả trang sửa bài, và người dùng không cứu được gì.
  const html = typeof value === 'string' ? value : '';

  const report = useMemo(() => {
    const text = htmlPlainText(html);
    return {
      chars: text.length,
      unsupported: unsupportedTags(html),
      hasH1: /<h1\b/i.test(html),
    };
  }, [html]);

  const over = maxChars !== undefined && report.chars > maxChars;

  return (
    <div className="mm-ck">
      {/* Nạp cùng chỗ với ô soạn, không ở layout: chỉ trang sửa bài cần nó, và
          `dynamic` đã tách bundle của CKEditor ra khỏi mọi trang khác. */}
      {/* Chuỗi CSS hằng trong code (`ckeditor-theme.ts`), không có dữ liệu người dùng. */}
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: CKEDITOR_THEME }} />

      <ArticleEditor value={html} onChange={onChange} disabled={disabled} />

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-mini">
        <span className={cn('tabular-nums', over ? 'font-medium text-shell-danger' : 'text-shell-muted')}>
          {report.chars.toLocaleString('vi-VN')}
          {maxChars !== undefined && ` / ${maxChars.toLocaleString('vi-VN')}`} ký tự
        </span>

        {over && (
          <span role="alert" className="font-medium text-shell-danger">
            Quá trần — lưu sẽ bị từ chối.
          </span>
        )}

        {report.hasH1 && (
          <span className="text-shell-warn">
            Bài có thẻ <code className="font-shell-mono">h1</code>. Trang chi tiết đã dùng <code className="font-shell-mono">h1</code> cho tiêu đề
            bài — nên dùng Tiêu đề 2 trở xuống trong thân bài.
          </span>
        )}

        {report.unsupported.length > 0 && (
          <span className="text-shell-warn">
            Sẽ bị gỡ khi lưu:{' '}
            <code className="font-shell-mono">{report.unsupported.map((t) => `<${t}>`).join(', ')}</code>
          </span>
        )}
      </div>
    </div>
  );
}
