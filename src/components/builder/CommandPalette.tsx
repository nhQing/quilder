'use client';

/**
 * `Ctrl+K` — tìm chung: trang, loại nội dung, component.
 *
 * ## Vì sao ở layout, không ở từng màn
 *
 * Phím tắt phải chạy ở mọi màn builder, kể cả màn đang mở một dialog khác. Đặt nó ở
 * từng trang nghĩa là nó chạy ở những trang có người nhớ chép nó vào — cùng lý do
 * `BuilderNav` nằm ở layout.
 *
 * ## Vì sao `<dialog>` thật
 *
 * Esc đóng, focus bị bẫy trong hộp, nền bị chặn — cả ba miễn phí và cả ba là thứ tự
 * làm sẽ làm sai. Cùng khuôn `PageHistory` và `PageRename`.
 *
 * ## Vì sao không cướp phím trong ô nhập
 *
 * `Ctrl+K` là "xoá tới cuối dòng" trong nhiều editor, và người đang gõ một bài dài mà
 * mất dòng đó sẽ không nối được nguyên nhân với cái hộp vừa mở ra. `inTextField` chặn
 * ca đó — xem docblock của nó cho lý do nó không dùng `instanceof`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { ui, type Tone } from '@/lib/builder/ui';
import {
  inTextField,
  matchesShortcut,
  shortcutById,
  shortcutText,
} from '@/lib/builder/shortcuts';

import { Badge, Kbd } from './ui/Badge';
import { TextField } from './ui/Field';

interface Hit {
  kind: 'page' | 'type' | 'component';
  id: string;
  title: string;
  hint: string;
  href: string;
}

/**
 * Phím tắt là dữ liệu TĨNH, nên nó nằm ở module.
 *
 * Trong component, `shortcutById('search')` trả một object MỚI mỗi lần render — và nó
 * là dep của effect đăng ký listener, nên effect đó tháo/gắn lại listener ở mỗi render.
 * Không sai về hành vi, nhưng nó là một nguồn chạy lại không có lý do, và ở đây nó nằm
 * cạnh một effect thứ hai mà chạy lại thì mất dữ liệu (xem effect nạp kết quả).
 */
const SEARCH = shortcutById('search')!;

const KIND_LABEL: Record<Hit['kind'], string> = {
  page: 'Trang',
  type: 'Loại nội dung',
  component: 'Component',
};

/** Trang — thứ được tìm nhiều nhất — mang nhãn accent; hai loại kia trung tính. */
const KIND_TONE: Record<Hit['kind'], Tone> = {
  page: 'accent',
  type: 'neutral',
  component: 'neutral',
};

export function CommandPalette() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => {
    setQ('');
    setCursor(0);
    setOpen(true);
    dialog.current?.showModal();
    // `showModal` tự lấy focus về hộp, nhưng không vào đúng ô — focus tay để gõ được
    // ngay. Không có dòng này thì phím đầu tiên người dùng gõ rơi vào hư không.
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  /* ── Phím tắt ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesShortcut(e, SEARCH)) return;
      if (inTextField(e.target)) return;
      // `preventDefault` SAU hai phép kiểm trên: chặn phím mặc định của trình duyệt
      // rồi mới quyết định có dùng nó không là cách lấy đi một phím mà không trả lại gì.
      e.preventDefault();
      openPalette();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const onClose = () => setOpen(false);
    el.addEventListener('close', onClose);
    return () => el.removeEventListener('close', onClose);
  }, []);

  /* ── Nạp kết quả ──────────────────────────────────────────────────── */

  useEffect(() => {
    if (!open) return;

    /*
     * Chờ 120ms rồi gọi, và bỏ QUA kết quả cũ — không HUỶ nó.
     *
     * Việc phải giải: gõ "tin tức" là 7 phím, và lượt trả về của "tin" có thể tới SAU
     * lượt của "tin tức", ghi đè kết quả đúng bằng kết quả cũ.
     *
     * Bản đầu dùng `AbortController` và `ctrl.abort()` trong cleanup. Nó SAI, và trace
     * của Playwright nói ra bằng một con số: request duy nhất đi ra mang status `-1`
     * (đã huỷ), nên palette không bao giờ có dữ liệu. Cleanup của một effect chạy mỗi
     * lần dep đổi — và ở đây nó huỷ đúng cái fetch mà lượt chạy hiện tại vừa bắt đầu.
     *
     * Cờ `stale` giữ nguyên tính đúng về thứ tự (kết quả cũ tới muộn thì bị bỏ) mà
     * không giết một request đang trên đường. Đổi lại: request cũ vẫn chạy tới cùng —
     * một lượt đọc DB nhỏ, đúng thứ mà 120ms debounce đã cắt gần hết.
     */
    let stale = false;

    const t = setTimeout(() => {
      void fetch(`/api/builder/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((j: { hits?: Hit[] }) => {
          if (stale) return;
          setHits(j.hits ?? []);
          setCursor(0);
        })
        .catch(() => {
          // Mạng đứt hay phiên hết hạn: palette hiện "không có gì khớp" thay vì nổ.
          // Người dùng còn mọi đường điều hướng khác; một hộp lỗi ở đây không giúp gì.
        });
    }, 120);

    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, open]);

  /* ── Điều hướng bằng bàn phím ─────────────────────────────────────── */

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, hits.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[cursor];
      if (hit) go(hit);
    }
  }

  function go(hit: Hit) {
    dialog.current?.close();
    router.push(hit.href);
  }

  return (
    <dialog
      ref={dialog}
      data-command-palette=""
      className={cn(ui.dialog, 'mx-auto mt-[12vh] mb-auto w-[min(36rem,94vw)]')}
    >
      <div className="flex flex-col">
        <div className="border-b border-shell-line p-3">
          {/* `TextField` có icon, không `SearchField`: ô `type="search"` nuốt phím Esc đầu
              tiên để xoá chữ, nên hộp phải bấm Esc hai lần mới đóng. */}
          <TextField
            ref={input}
            size="md"
            icon="search"
            label="Tìm chung"
            hideLabel
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Tìm trang, loại nội dung, component…"
            suffix={<Kbd className="mr-1.5">{shortcutText(SEARCH)}</Kbd>}
          />
        </div>

        {hits.length === 0 ? (
          <p className="px-4 py-5 text-small text-shell-muted">
            {q ? `Không có gì khớp “${q}”.` : 'Đang nạp…'}
          </p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-px overflow-y-auto p-1.5">
            {hits.map((h, i) => (
              <li key={`${h.kind}-${h.id}`}>
                <button
                  type="button"
                  // `onMouseEnter` đồng bộ con trỏ bàn phím với chuột: nếu không, mắt
                  // đang ở dòng chuột trỏ mà Enter lại mở dòng khác.
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(h)}
                  className={cn(ui.menuItem, 'text-small', i === cursor && 'bg-shell-raised')}
                >
                  <Badge size="sm" tone={KIND_TONE[h.kind]} className="w-24 shrink-0 justify-center">
                    {KIND_LABEL[h.kind]}
                  </Badge>
                  <span className="min-w-0 truncate">{h.title}</span>
                  {/* Gợi ý của trang là slug, của loại nội dung là khoá — chữ máy đọc nên mono.
                      Của component là tên nhóm, chữ người đọc. */}
                  <span
                    className={cn(
                      'ml-auto max-w-[45%] shrink-0 truncate text-mini font-normal text-shell-muted',
                      h.kind !== 'component' && 'font-shell-mono',
                    )}
                  >
                    {h.hint}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-shell-line px-4 py-2.5 text-mini text-shell-muted">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> chọn
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> mở
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> đóng
          </span>
        </p>
      </div>
    </dialog>
  );
}
