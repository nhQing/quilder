'use client';

/**
 * Khu "API công khai" dưới bảng entry: các URL THẬT của loại này, để copy.
 *
 * ## Vì sao nó ở đây chứ không ở màn cấu trúc field
 *
 * Người hỏi "API lấy tin tức là gì" đang đứng ở bảng tin tức, không đứng ở màn cấu
 * trúc. Và câu trả lời phải là một URL bấm-copy-dán-chạy được, không phải một mẫu
 * có `{typeKey}` để người ta tự thay — mỗi chỗ phải tự thay là một chỗ có thể thay sai.
 *
 * ## Vì sao đóng sẵn
 *
 * Bảng entry là việc hằng ngày; khu này là việc một lần mỗi dự án. Mở sẵn là đẩy
 * bảng xuống dưới màn hình cho mọi người, mọi ngày, để phục vụ một lần.
 *
 * ## Vì sao dựng URL ở `api-urls.ts` chứ không ở đây
 *
 * Thứ khu này bán là sự chính xác, và một URL sai sẽ hỏng ở chỗ khác vài ngày sau —
 * xem docblock ở đó. Luật nằm trong một module thuần có test; component này chỉ hiện
 * và copy.
 */

import { useState } from 'react';

import { copyText } from '@/lib/builder/clipboard';
import type { ApiUrlRow } from '@/lib/collections/api-urls';
import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

export function ApiPanel(props: { rows: ApiUrlRow[]; hasOrigin: boolean }) {
  /*
   * Một khoá đang "đã copy", không phải một cờ boolean.
   *
   * Cờ chung làm mọi dòng cùng đổi chữ khi copy một dòng — người dùng thấy sáu chữ
   * "đã copy" và không biết mình vừa copy cái nào.
   */
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const copy = async (row: ApiUrlRow) => {
    setFailed(null);
    try {
      await copyText(row.url);
      setCopied(row.id);
      setTimeout(() => setCopied((c) => (c === row.id ? null : c)), 1500);
    } catch {
      /*
       * Clipboard API ném ở HTTP không phải localhost, và ở chế độ riêng tư của
       * Safari. Nói ra thay vì im lặng: người dùng sẽ dán và nhận nội dung cũ trong
       * bộ nhớ tạm mà tưởng là URL vừa bấm — sai lệch không có triệu chứng.
       */
      setFailed(row.id);
    }
  };

  return (
    <details className={cn(ui.card, 'group px-5 py-4')}>
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2.5 rounded-sm text-ui font-semibold select-none [&::-webkit-details-marker]:hidden',
          focusRing,
        )}
      >
        <Icon name="chevron-right" size={16} className="text-shell-muted transition-transform group-open:rotate-90" />
        API công khai — {props.rows.length} đường dẫn để copy
      </summary>

      <div className="mt-3.5 flex flex-col gap-3">
        {!props.hasOrigin && (
          <p className="rounded-md bg-shell-warn-soft px-3.5 py-2.5 text-small leading-relaxed">
            Site chưa đặt <b className="font-semibold">tên miền chính</b> trong Cài đặt, nên các URL
            dưới đây là đường dẫn tương đối. Đặt tên miền rồi quay lại đây để copy được URL đầy đủ.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {props.rows.map((row) => (
            <li key={row.id} data-api-row={row.id} className="flex flex-col gap-1.5">
              <span className="text-small font-medium">{row.label}</span>
              <div className="flex items-center gap-2.5 rounded-sm bg-shell-raised py-1.5 pr-1.5 pl-3">
                {/*
                  `overflow-x-auto` chứ không xuống dòng: một URL bị bẻ dòng trông như hai
                  URL, và người đọc sẽ copy nhầm một nửa khi bôi đen bằng tay.
                */}
                <code className="font-shell-mono min-w-0 flex-1 overflow-x-auto py-0.5 text-small whitespace-pre">
                  <b className="font-semibold text-shell-ok">GET</b> {row.url}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copied === row.id ? 'check' : failed === row.id ? 'alert' : 'copy'}
                  onClick={() => void copy(row)}
                  className={cn(failed === row.id && 'text-shell-danger')}
                >
                  {copied === row.id ? 'đã copy' : failed === row.id ? 'không copy được' : 'Copy'}
                </Button>
              </div>
              {row.note && <p className={ui.hint}>{row.note}</p>}
            </li>
          ))}
        </ul>

        <p className="text-small leading-relaxed text-shell-muted">
          Chỉ <code className="font-shell-mono">GET</code>, không cần token, và chỉ thấy bài
          đã đăng đã tới mốc. Bốn method ghi trả 405. Tham số sai trả 400 kèm{' '}
          <code className="font-shell-mono">code</code> — đừng so khớp câu chữ. Chi tiết đầy
          đủ ở <code className="font-shell-mono">docs/API-PUBLIC.md</code>, và{' '}
          <code className="font-shell-mono">pnpm api:types</code> sinh sẵn kiểu TypeScript
          cho client.
        </p>
      </div>
    </details>
  );
}
