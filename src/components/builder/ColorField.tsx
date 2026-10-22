'use client';

/**
 * Bộ chọn màu dùng chung cho MỌI chỗ trong builder cần một màu tự chọn.
 *
 * ## Vì sao `react-colorful` chứ không phải `<input type="color">`
 *
 * Ô màu của trình duyệt mở hộp thoại của HỆ ĐIỀU HÀNH. Nó khác nhau trên Windows,
 * macOS và Linux, không theo theme của công cụ, và trên Windows nó là một hộp thoại
 * MODAL — mở ra là khoá cả cửa sổ, nên không thể vừa kéo màu vừa nhìn trang xem
 * trước đổi theo. Nó cũng không dán được, không có alpha, và không hút được màu.
 *
 * `react-colorful` được chọn vì ba lý do đo được, không phải vì quen tay:
 *
 *  - **2.8 kB, KHÔNG phụ thuộc gì.** `react-color` (lựa chọn phổ biến còn lại) kéo
 *    theo `lodash`, `material-colors`, `tinycolor2`, `prop-types` — và bản mới nhất
 *    là 2.19.3 từ 2020, tức là không còn ai bảo trì.
 *  - **Đã có sẵn trong `package.json`** từ trước, đang chạy trong `ColorPopover`.
 *    Thêm một thư viện thứ hai cho cùng một việc là cách một dự án có hai bộ chọn
 *    màu trông khác nhau.
 *  - **Không tự vẽ chrome.** Nó chỉ cho vùng bão hoà + thanh màu, còn viền, nút,
 *    khoảng cách là của mình — nên nó hoà vào vỏ builder thay vì mang theo một
 *    phong cách khác.
 *
 * ## Vì sao có ô gõ hex ngay cạnh bánh xe
 *
 * Bánh xe KHÔNG dán được. Mà nhận một mã màu từ bộ nhận diện thương hiệu rồi dán
 * vào là ca thường gặp nhất ở màn Cài đặt — thường xuyên hơn cả việc dò màu bằng
 * mắt. Hai lối vào cùng ghi một state.
 *
 * ## Vì sao có nút hút màu, và vì sao nó có thể không xuất hiện
 *
 * `EyeDropper` là API của trình duyệt, hiện chỉ Chromium có. Nó là cách nhanh nhất
 * để lấy màu từ một ảnh logo đang mở ở tab khác. Nút chỉ hiện khi API có thật —
 * một nút bấm vào không làm gì tệ hơn hẳn một nút không có.
 */

import { useEffect, useRef, useState } from 'react';
import { HexAlphaColorPicker, HexColorPicker } from 'react-colorful';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { normalizeHex, toPickerHex } from '@/lib/builder/hex';

import { buttonClass } from './ui/Button';
import { Tip } from './ui/Tip';

/* ── Ô xem trước, và cũng là nút mở ────────────────────────────────────── */

/**
 * `preview` là màu ĐÃ resolve, không phải giá trị thô.
 *
 * Vỏ builder cố ý không nạp `tokens.css`, nên `var(--color-accent)` viết ở đây
 * luôn ra rỗng và cả lưới sẽ thành những ô trắng — xem docblock của
 * `resolveTokenColor` trong `value-io.ts`.
 *
 * Viền là một vòng `inset` vẽ ĐÈ LÊN màu (`after:`), không phải `border` quanh nó: màu
 * gần với nền panel — trắng trên panel sáng, xanh đen trên panel tối — vẫn có mép thấy
 * được, vì vòng nằm trên lớp màu chứ không bị lớp màu che.
 *
 * `sm` cao đúng `control-sm` (28px), bằng ô nhập đứng cạnh nó trong Inspector — và là
 * vùng bấm nhỏ nhất design system cho phép.
 */
export function ColorSwatch({
  preview,
  active,
  size = 'md',
  ...rest
}: {
  preview: string | null;
  active?: boolean;
  size?: 'sm' | 'md';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'relative shrink-0 overflow-hidden disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'size-control-sm rounded-sm' : 'size-9 rounded',
        // Ô caro dưới nền: ô chưa đặt màu và ô đặt màu trắng trông y hệt nhau nếu
        // không có gì phía sau để phân biệt.
        'bg-[repeating-conic-gradient(var(--color-shell-line)_0_25%,transparent_0_50%)] bg-[length:8px_8px]',
        'after:ring-shell-line-strong after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-inset',
        active && 'ring-shell-accent ring-2 ring-offset-1 ring-offset-shell-panel',
        focusRing,
        rest.className,
      )}
    >
      <span className="block size-full" style={{ background: preview ?? 'transparent' }} />
    </button>
  );
}

/* ── Bảng chọn: bánh xe + ô hex + hút màu ──────────────────────────────── */

export function ColorPickerPanel({
  hex,
  onHex,
  seed,
  alpha = false,
  action,
}: {
  /** Giá trị thô đang sửa. Có thể chưa phải hex hợp lệ trong lúc gõ dở. */
  hex: string;
  onHex: (next: string) => void;
  /** Màu đang hiển thị, dùng làm hạt giống khi `hex` chưa đọc được. */
  seed: string;
  alpha?: boolean;
  /** Nút đứng giữa ô mã màu và nút chọn màu từ màn hình (vd. "Dùng màu này"). */
  action?: React.ReactNode;
}) {
  const Picker = alpha ? HexAlphaColorPicker : HexColorPicker;
  const canDrop = typeof window !== 'undefined' && 'EyeDropper' in window;

  const pick = async () => {
    try {
      const Ctor = (window as unknown as { EyeDropper: new () => EyeDropperLike }).EyeDropper;
      const { sRGBHex } = await new Ctor().open();
      const norm = normalizeHex(sRGBHex);
      if (norm) onHex(norm);
    } catch {
      // Bấm Escape giữa chừng cũng ném — đó là HUỶ, không phải lỗi, nên không báo gì.
    }
  };

  return (
    <div>
      <Picker
        color={toPickerHex(hex, seed, alpha)}
        onChange={onHex}
        style={{ width: '100%', height: 120 }}
      />

      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={hex}
          onChange={(e) => onHex(e.target.value)}
          spellCheck={false}
          placeholder="#0d1321"
          aria-label="Mã màu hex"
          aria-invalid={hex !== '' && normalizeHex(hex) === null ? true : undefined}
          className={cn(
            ui.fieldSm,
            'font-shell-mono flex-1 text-mini',
            hex !== '' && normalizeHex(hex) === null && 'border-shell-danger',
          )}
        />
        {action}
        {canDrop && (
          <Tip content="Chọn màu từ màn hình">
            <button
              type="button"
              onClick={() => void pick()}
              aria-label="Chọn màu từ màn hình"
              // `secondary` chứ không `ghost`: nút này đứng sát một ô nhập có viền,
              // và một nút không viền cạnh đó trông như chữ rơi ra ngoài ô.
              className={buttonClass('secondary', 'sm', 'w-control-sm px-0')}
            >
              <PipetteIcon />
            </button>
          </Tip>
        )}
      </div>
    </div>
  );
}

/**
 * Icon ống nhỏ giọt ĐẶC: bóp cao su + vành + ống thuỷ tinh có ô sáng, kèm một giọt màu rơi
 * ở đầu ống (22/10/2026, user chọn kiểu này thay cho ống hút nét mảnh — nét mảnh ở cỡ 15px
 * trông như cây bút chì).
 *
 * Đặc, khác quy ước nét của bộ `Icon`, nên nằm ở đây chứ không ở `ui/Icon.tsx`. Ống vẽ
 * dựng đứng rồi xoay 45° cho dễ đọc toạ độ.
 */
function PipetteIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" className="shrink-0">
      <g transform="rotate(45 12 12)">
        <rect x="10" y="1" width="4" height="6" rx="2" />
        <rect x="7.5" y="6" width="9" height="3" rx="1.2" />
        <path fillRule="evenodd" d="M10 9h4v7a2 2 0 0 1-4 0zm1.2 1.4v3.2l1.6-3.2z" />
      </g>
      <path d="M4.6 17.2s-2.1 2.7-2.1 3.9a2.1 2.1 0 0 0 4.2 0c0-1.2-2.1-3.9-2.1-3.9z" />
    </svg>
  );
}

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>;
}

/* ── Đóng popover: bấm ra ngoài, hoặc Escape ───────────────────────────── */

/**
 * `Escape` phải `stopPropagation`.
 *
 * Canvas cũng nghe `Escape` để bỏ chọn node. Không chặn thì một lần bấm Escape vừa
 * đóng popover VỪA mất node đang sửa — và người dùng phải đi tìm lại nó.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  box: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as globalThis.Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close, box]);
}

/* ── Ô màu hoàn chỉnh: swatch + popover ────────────────────────────────── */

/**
 * Dùng ở nơi chỉ cần "một màu", không cần bảng token — ví dụ màn Cài đặt.
 *
 * Nơi cần cả token thì dùng `ColorPopover`: nó đặt bảng token LÊN TRÊN bánh xe, và
 * thứ tự đó là có chủ đích (xem docblock ở đó).
 */
export function ColorField({
  value,
  preview,
  onChange,
  disabled,
  label,
  alpha,
  block,
  className,
  swatchClassName,
}: {
  value: string;
  /** Màu đang hiển thị thật, dùng cho ô xem trước và làm hạt giống bánh xe. */
  preview: string | null;
  onChange: (hex: string) => void;
  disabled?: boolean;
  label: string;
  alpha?: boolean;
  /**
   * Ô xem trước thành một DẢI màu rộng hết khung (cao 64px) thay cho ô vuông 36px —
   * cho thẻ màu ở màn Cài đặt, nơi chính màu là nội dung của thẻ. Bảng màu vẫn mở
   * ngay dưới dải.
   */
  block?: boolean;
  /** Class thêm cho khung ngoài (khung neo bảng màu). */
  className?: string;
  /** Class thêm cho ô xem trước — thắng `block` khi cùng một thuộc tính. */
  swatchClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), box);

  return (
    <div ref={box} className={cn('relative shrink-0', block && 'w-full', className)}>
      <ColorSwatch
        preview={preview}
        active={open}
        disabled={disabled}
        aria-expanded={open}
        aria-label={`Chọn ${label}`}
        title="Bấm để mở bảng màu"
        onClick={() => setOpen((o) => !o)}
        className={cn(block && 'h-16 w-full rounded-md', swatchClassName)}
      />
      {open && (
        <div
          role="dialog"
          aria-label={`Bảng màu — ${label}`}
          className={cn(ui.pop, 'absolute z-50 mt-1.5 w-56 p-3')}
          style={{ insetInlineStart: 0 }}
        >
          <ColorPickerPanel
            hex={value}
            onHex={onChange}
            seed={preview ?? '#000000'}
            alpha={alpha}
          />
        </div>
      )}
    </div>
  );
}
