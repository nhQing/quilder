'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import type { TokenOption } from '@/lib/builder/queries';
import { matchToken, shortTokenValue } from '@/lib/builder/token-kinds';
import { resolveTokenColor } from '@/lib/builder/value-io';
import { Icon } from './ui/Icon';

/**
 * Bộ chọn đơn vị / từ khoá / token cho một ô của Inspector — thay `<select>` gốc.
 *
 * ## Vì sao không còn là `<select>`
 *
 * Chrome trên Windows tự vẽ danh sách của `<select>` và nó rộng tới cả màn hình, mỗi
 * đơn vị chiếm một dòng, token hiện nguyên `clamp(...)` (ảnh user gửi 21/10/2026). Mình
 * không style được thứ đó. Popover Radix thì có:
 *
 *  - **portal** — Inspector `overflow-hidden`, một popover tuyệt đối bên trong bị cắt;
 *  - **tự lật** khi đụng mép màn;
 *  - rộng bằng ô, cao tối đa ~320px, cuộn BÊN TRONG.
 *
 * ## Bố cục
 *
 * Ô tìm (khi có từ 8 token) → một HÀNG chip đơn vị (`px rem % …`) → một hàng chip từ khoá →
 * danh sách token. Token màu có ô màu tròn; token độ dài có giá trị rút gọn
 * (`shortTokenValue`). Dòng đang chọn có dấu ✓.
 *
 * ## Giá trị trả về
 *
 * Cùng mã với bộ chọn cũ để `commitUnit` không đổi: `''` (gỡ), `'px'` (đơn vị),
 * `'kw:auto'` (từ khoá), `'tk:space-m'` (token).
 */
export function TokenPicker({
  kind,
  units = [],
  keywords = [],
  tokens,
  allTokens,
  value,
  onPick,
  trigger,
  label,
  allowClear = true,
  footer,
  anchor,
  open: openProp,
  onOpenChange,
}: {
  kind: 'length' | 'color';
  units?: readonly string[];
  keywords?: readonly string[];
  /** Token ĐÃ LỌC theo loại của ô — xem `tokensOfKind`. */
  tokens: readonly TokenOption[];
  /** Toàn bộ bảng — để giải bí danh màu (`var(--x)`). */
  allTokens?: readonly TokenOption[];
  value: string;
  onPick: (next: string) => void;
  /** Phần tử mở popover (Radix `asChild`). Bỏ trống khi dùng `anchor` + `open`. */
  trigger?: React.ReactElement;
  /**
   * Neo popover theo phần tử này thay vì theo nút mở — ô màu neo theo CẢ Ô (ô xem trước +
   * ô nhập + nút ▾) để popover rộng bằng ô, và hai nút trong ô cùng mở được nó.
   */
  anchor?: React.ReactElement;
  /** Điều khiển từ ngoài (đi cùng `anchor`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Tên ô — cho `aria-label` của danh sách. */
  label: string;
  allowClear?: boolean;
  /** Phần thêm ở đáy (bộ chọn màu tự do, nút tạo token). */
  footer?: (close: () => void) => React.ReactNode;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => {
    if (openProp === undefined) setOpenState(o);
    onOpenChange?.(o);
  };
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedToken = value.startsWith('tk:') ? value.slice(3) : null;

  // Mỗi lần MỞ: ô tìm trống, con trỏ đứng ở token đang chọn. Theo `open` chứ không trong
  // `onOpenChange`: khi mở bằng `open` từ ngoài (ô màu), Radix không gọi callback đó.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(Math.max(0, tokens.findIndex((t) => t.name === selectedToken)));
    // Chỉ khi vừa mở — không chạy lại theo từng lần gõ ô tìm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /*
   * Token đang chọn LUÔN có mặt, kể cả khi nó không thuộc loại của ô (dữ liệu cũ, Agent
   * ghi qua MCP). Thiếu dòng đó thì danh sách nói ô chưa chọn gì trong khi nó đang mang
   * `mm-nav-pad-x`.
   */
  const rows = useMemo(() => {
    const base = [...tokens];
    if (selectedToken && !base.some((t) => t.name === selectedToken)) {
      const extra = allTokens?.find((t) => t.name === selectedToken);
      base.unshift(extra ?? { name: selectedToken, value: '', category: '' });
    }
    return base.filter((t) => matchToken(t, query));
  }, [tokens, allTokens, selectedToken, query]);

  const close = () => setOpen(false);
  const pick = (next: string) => {
    onPick(next);
    close();
  };

  const swatch = (t: TokenOption) =>
    kind === 'color' ? resolveTokenColor(t.name, (allTokens ?? tokens) as TokenOption[]) : null;

  const onListKey = (e: React.KeyboardEvent) => {
    // Phím gõ trong phần ĐÁY (ô tên biến của màu tự chọn) là của phần đó: Enter ở đó là
    // "lưu biến", không phải "chọn token đang trỏ".
    if ((e.target as HTMLElement).closest('[data-picker-footer]')) return;
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, cursor + (e.key === 'ArrowDown' ? 1 : -1)));
      setCursor(next);
      listRef.current?.querySelectorAll<HTMLElement>('[data-token-row]')[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = rows[cursor];
      if (t) pick(`tk:${t.name}`);
    }
  };

  const chip = (code: string, text: string) => (
    <button
      key={code}
      type="button"
      data-pick={code}
      aria-pressed={code !== '' && value === code}
      onClick={() => pick(code)}
      className={cn(
        'h-6 rounded-xs px-1.5 font-shell-mono text-micro transition-colors',
        code !== '' && value === code
          ? 'bg-shell-accent text-shell-on-accent'
          : 'bg-shell-raised text-shell-ink hover:bg-shell-line',
        focusRing,
      )}
    >
      {text}
    </button>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {anchor ? <Popover.Anchor asChild>{anchor}</Popover.Anchor> : null}
      {trigger ? <Popover.Trigger asChild>{trigger}</Popover.Trigger> : null}
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          onKeyDown={onListKey}
          data-token-picker={label}
          className={cn(
            ui.pop,
            'z-[90] flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[max(15rem,var(--radix-popover-trigger-width))] max-w-[calc(100vw-1rem)] flex-col overflow-hidden',
          )}
        >
          {tokens.length >= 8 && (
            <div className="border-b border-shell-line p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                placeholder="Tìm token…"
                aria-label={`Tìm token cho ${label}`}
                className={cn(ui.fieldSm, 'h-7 font-shell-mono text-mini')}
              />
            </div>
          )}

          {(units.length > 0 || keywords.length > 0 || allowClear) && (
            <div className="flex flex-col gap-1.5 border-b border-shell-line p-1.5">
              {units.length > 0 && (
                <div className="flex flex-wrap gap-1" role="group" aria-label="Đơn vị">
                  {units.map((u) => chip(u, u))}
                </div>
              )}
              {(keywords.length > 0 || allowClear) && (
                <div className="flex flex-wrap gap-1" role="group" aria-label="Từ khoá">
                  {keywords.map((k) => chip(`kw:${k}`, k))}
                  {allowClear && chip('', '— gỡ')}
                </div>
              )}
            </div>
          )}

          {rows.length > 0 ? (
            <div
              ref={listRef}
              role="listbox"
              aria-label={`Token cho ${label}`}
              className="min-h-0 flex-1 overflow-y-auto p-1"
            >
              {rows.map((t, i) => {
                const active = t.name === selectedToken;
                const color = swatch(t);
                return (
                  <button
                    key={t.name}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-token-row={t.name}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(`tk:${t.name}`)}
                    className={cn(
                      'flex w-full min-w-0 items-center gap-2 rounded-xs px-2 py-1 text-left',
                      i === cursor ? 'bg-shell-raised' : 'hover:bg-shell-raised',
                    )}
                  >
                    {kind === 'color' && (
                      <span
                        aria-hidden
                        data-swatch={color ?? ''}
                        className="relative size-3.5 shrink-0 overflow-hidden rounded-full ring-1 ring-shell-line-strong"
                        // Nền bàn cờ dưới màu: màu có alpha (`rgb(… / 0.12)`) vẽ thẳng lên
                        // nền tối của popover thì gần như vô hình.
                        style={{
                          backgroundImage:
                            'conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0)',
                          backgroundSize: '6px 6px',
                        }}
                      >
                        <span className="absolute inset-0" style={{ background: color ?? 'transparent' }} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-shell-mono text-mini text-shell-ink">
                      {t.name}
                    </span>
                    {t.value && (
                      <span className="max-w-[45%] shrink-0 truncate font-shell-mono text-micro text-shell-muted">
                        {kind === 'color' ? t.value : shortTokenValue(t.value)}
                      </span>
                    )}
                    {active && <Icon name="check" size={12} className="text-shell-accent" />}
                  </button>
                );
              })}
            </div>
          ) : tokens.length > 0 ? (
            <p className="p-3 text-mini text-shell-muted">Không có token khớp “{query}”.</p>
          ) : null}

          {footer && (
            <div data-picker-footer="" className="min-h-0 shrink-0 overflow-y-auto border-t border-shell-line">
              {footer(close)}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
