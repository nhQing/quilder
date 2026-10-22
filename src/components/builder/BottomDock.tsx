'use client';

/**
 * Dock đáy của màn sửa trang: Văn bản · Cảnh báo chất lượng · AI.
 *
 * ## Đây KHÔNG phải `CanvasInsertDock`
 *
 * Cái kia nổi giữa đáy khung xem trước và chèn component/trang. Cái này là một dải ở
 * đáy khung canvas, chứa những thứ nói VỀ trang chứ không thao tác lên canvas. Hai
 * thứ từng cùng tên `CanvasDock`; xem docblock của file kia.
 *
 * ## Vì sao dải CHIẾM CHỖ, không phải `fixed` đè lên
 *
 * Cùng bài học mà `PreviewChrome` đã trả giá: `position: fixed` bị lấy ra khỏi luồng
 * nên không có gì chừa chỗ cho nó, và nó đè lên phần dưới của thứ nằm sau — ở đây là
 * đáy canvas, nơi dock chèn đang nổi. Dải nằm trong luồng của `Canvas` (prop `footer`)
 * thì vùng xem tự ngắn lại đúng bằng chiều cao của nó. Chỉ danh sách cảnh báo là lớp
 * nổi: nó mở lên trên dải khi được bấm, và đóng lại bằng chính nút đó.
 *
 * ## Trạng thái rỗng — thứ wireframe không vẽ
 *
 * Spec §8 ghi rằng wireframe chỉ vẽ happy path và để lát 4 tự quyết. Quyết định:
 * **không có cảnh báo nào thì nút vẫn ở đó, mang số 0 và một dấu ✓**. Ẩn nó đi sẽ làm
 * dải nhảy chỗ mỗi lần người dùng sửa xong lỗi cuối cùng, và tệ hơn: "không thấy nút"
 * và "chưa kiểm" trông giống hệt nhau.
 */

import { useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { scanQuality } from '@/lib/builder/quality';
import { useEditor } from '@/lib/builder/store';
import { focusRing, ui } from '@/lib/builder/ui';
import type { Doc } from '@/lib/doc/types';

import { Badge } from './ui/Badge';
import { buttonClass, ButtonLink } from './ui/Button';
import { Icon } from './ui/Icon';

type Panel = 'quality' | null;

export function BottomDock({ doc, pageId }: { doc: Doc; pageId: string | null }) {
  const [open, setOpen] = useState<Panel>(null);
  const select = useEditor((s) => s.select);
  const selectedId = useEditor((s) => s.selectedId);

  const issues = scanQuality(doc);

  return (
    <div data-bottom-dock="" className="relative flex shrink-0 flex-wrap items-center gap-1.5 px-3 pt-1 pb-3">
      {open === 'quality' && (
        <div
          className={cn(
            ui.pop,
            'absolute bottom-full left-3 z-40 mb-1 flex max-h-72 w-[min(30rem,calc(100%-1.5rem))] flex-col gap-2 overflow-y-auto p-3',
          )}
        >
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 px-1 text-small text-shell-muted">
              <Icon name="check-circle" size={17} className="text-shell-ok" />
              Không có cảnh báo nào trên trang này.
            </p>
          ) : (
            <>
              {/*
                Câu này phải có mặt, và nó là phần khó chịu nhất của cả dock.

                Nhãn wireframe là "Cần sửa trước khi publish", tức nó hứa một cổng.
                Cổng đó không tồn tại: `/api/publish` nhận doc nháp nguyên trạng. Nói
                thẳng ra còn hơn để người dùng tin rằng có ai đó đang chặn giúp họ.
              */}
              <p className="px-1 text-mini leading-relaxed text-shell-muted">
                Đây là <strong className="font-semibold text-shell-ink">cảnh báo</strong>, không phải
                hàng rào — publish vẫn chạy dù còn cảnh báo.
              </p>
              <ul className="grid gap-0.5">
                {/* Bấm một cảnh báo là "đưa tôi tới chỗ hỏng": chọn VÀ cuộn khung tới nó
                    (`reveal`). Danh sách vẫn mở sau khi bấm, vì người ta đi qua từng dòng
                    một. `data-quality-item` là móc cho e2e, cùng lý do `data-layer-row`. */}
                {issues.map((i) => (
                  <li key={`${i.nodeId}-${i.kind}`}>
                    <button
                      type="button"
                      data-quality-item={i.nodeId}
                      onClick={() => select(i.nodeId, { reveal: true })}
                      className={cn(
                        'flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-small',
                        focusRing,
                        selectedId === i.nodeId
                          ? 'bg-shell-accent-soft text-shell-ink'
                          : 'text-shell-muted hover:bg-shell-raised hover:text-shell-ink',
                      )}
                    >
                      <Icon name="alert" size={15} className="shrink-0 translate-y-0.5 text-shell-warn" />
                      <span className="shrink-0 font-semibold text-shell-ink">{i.label}</span>
                      <span className="min-w-0 flex-1">{i.message}</span>
                      <span className="font-shell-mono shrink-0 text-mini text-shell-muted">{i.nodeId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/*
        Bảng Văn bản là một TRANG khác, nên nó là `<Link>` chứ không phải nút mở
        panel: nó có URL riêng, chia sẻ được, và Back của trình duyệt đưa về đây.
        Ở chế độ sửa component thì không có trang nào để trỏ tới — bảng Văn bản
        theo từng trang.
      */}
      {pageId ? (
        <ButtonLink href={`/builder/text?page=${pageId}`} variant="secondary" size="sm" icon="type">
          Văn bản
        </ButtonLink>
      ) : (
        <span
          className={cn(buttonClass('secondary', 'sm'), 'cursor-not-allowed opacity-40')}
          title="Bảng Văn bản theo từng trang — đang sửa component thì không có trang nào để mở."
        >
          <Icon name="type" size={15} />
          Văn bản
        </span>
      )}

      <button
        type="button"
        data-quality-toggle=""
        aria-expanded={open === 'quality'}
        onClick={() => setOpen((v) => (v === 'quality' ? null : 'quality'))}
        className={buttonClass('secondary', 'sm', cn(open === 'quality' && 'bg-shell-raised'))}
      >
        <Icon
          name={issues.length ? 'alert' : 'check'}
          size={15}
          className={issues.length ? 'text-shell-warn' : 'text-shell-ok'}
        />
        Cảnh báo chất lượng
        <Badge size="sm" tone={issues.length ? 'warn' : 'neutral'} className="tabular-nums">
          {issues.length}
        </Badge>
      </button>

      {/*
        AI: chỗ đã chừa, chưa dựng.

        Spec §0 đặt lớp AI NGOÀI phạm vi — nó không nằm trong danh sách màn của `t3`.
        Nút tối kèm `title` nói ra điều đó, thay vì một nút bấm được rồi không làm gì:
        cái sau dạy người dùng rằng nút của công cụ này không đáng tin.
      */}
      <span
        className={cn(buttonClass('secondary', 'sm'), 'cursor-not-allowed opacity-40')}
        title="Lớp AI chưa dựng — nằm ngoài phạm vi bản thiết kế này."
      >
        <Icon name="sparkle" size={15} />
        AI
      </span>
    </div>
  );
}
