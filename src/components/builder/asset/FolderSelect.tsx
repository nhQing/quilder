'use client';

/**
 * Chọn thư mục đích.
 *
 * ## Vì sao là listbox tự dựng chứ không phải `<select>`
 *
 * `<select>` mở ra một popup do HỆ ĐIỀU HÀNH vẽ: font, bo góc, màu nền, mũi chỉ
 * xuống đều là của Windows/macOS chứ không phải của builder. Trên một trang mà mọi
 * thứ khác đọc token `shell-*` — kể cả khi đổi sang theme tối — nó là widget duy nhất
 * không đi theo, và vì nó nằm trên mọi thẻ ảnh nên chỗ lệch đó bị nhân lên mười lăm
 * lần. `appearance-none` chỉ chữa được cái nút, không chữa được popup.
 *
 * Đổi lại là phải tự làm ba thứ `<select>` cho không, và không thứ nào được bỏ:
 * đi bằng bàn phím, đóng khi bấm ra ngoài, và chọn hướng mở. Một dropdown không dùng
 * được bằng bàn phím thì tệ hơn hẳn một dropdown lệch font.
 *
 * ## Vì sao vẫn giữ lối gõ tay
 *
 * Bản đầu của kho ảnh bắt gõ đường dẫn `trang-chu/hero` cho từng ảnh. Nó sai theo hai
 * hướng cùng lúc: gõ sai một ký tự là đẻ ra một thư mục gần giống thư mục đã có, và
 * người dùng không thấy danh sách thư mục đang tồn tại đúng lúc cần thấy. Nhưng bỏ
 * hẳn lối gõ là bịt đường tạo thư mục con ngay trong lúc dời ảnh — nên nó ở lại, sau
 * một lựa chọn tường minh ("Thư mục mới…").
 */

import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { FOLDER_TEXT, folderTone, type FolderItem } from './types';

/**
 * Chiều cao tối thiểu cần có bên dưới nút để mở xuống; thấp hơn thì mở LÊN.
 *
 * Không có phép này thì ô chọn nằm gần đáy màn hình (hàng thẻ cuối, thanh chọn nhiều
 * khi đang dính) mở ra một danh sách nằm trọn bên ngoài khung nhìn.
 */
const SPACE_BELOW = 260;

interface Choice {
  /** `null` = Chưa phân loại. */
  value: string | null;
  label: string;
  depth: number;
}

export function FolderSelect({
  folders,
  value,
  placeholder,
  disabled,
  autoFocus,
  quiet,
  onPick,
  onCancel,
}: {
  folders: FolderItem[];
  /**
   * Thư mục đang chọn; `null` = Chưa phân loại; `undefined` = chưa chọn gì, hiện
   * `placeholder`.
   *
   * Ba trạng thái vì ô này phục vụ hai vai: trên thẻ ảnh nó HIỂN THỊ thư mục hiện
   * tại, còn trên thanh chọn nhiều nó là một NÚT HÀNH ĐỘNG chưa có giá trị nào —
   * để nó hiện sẵn "Chưa phân loại" ở vai thứ hai là nói rằng 8 ảnh kia đang chưa
   * phân loại, điều thường sai.
   */
  value: string | null | undefined;
  /** Nhãn cho trạng thái `value === undefined`. */
  placeholder?: string;
  disabled?: boolean;
  /** Mở sẵn danh sách. Dùng khi ô này vừa xuất hiện do một cú bấm của người dùng. */
  autoFocus?: boolean;
  /**
   * Không vẽ viền và nền cho tới khi rê chuột hoặc mở.
   *
   * Dùng trên thẻ ảnh. Ở đó ô này xuất hiện mười lăm lần và mười ba lần trong số đó
   * cùng đọc "Chưa phân loại" — vẽ đủ khung cho tất cả là mười lăm control tranh
   * chú ý với chính những cái ảnh. Ở thanh thao tác hàng loạt thì ngược lại: nó là
   * hành động chính, nên nó vẽ như một nút `secondary`.
   */
  quiet?: boolean;
  onPick: (folder: string | null) => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(Boolean(autoFocus));
  const [typing, setTyping] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [active, setActive] = useState(0);
  /**
   * Đã đo xong hướng mở chưa.
   *
   * Panel phải nằm trong DOM để đo được, nhưng chỉ hiện sau khi biết mở lên hay
   * xuống. Không có cờ này thì frame đầu vẽ nó xuống dưới — tức ngay dưới con trỏ
   * vừa bấm — nên `pointerenter` bắn vào hàng nằm dưới chuột và làm sáng sai hàng,
   * rồi panel nhảy lên. Đo được rồi hiện thì không có cả cú nhảy lẫn cú sáng sai.
   */
  const [placed, setPlaced] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const choices: Choice[] = [
    { value: null, label: 'Chưa phân loại', depth: 0 },
    ...folders.map((f) => ({ value: f.path, label: f.name, depth: f.depth })),
  ];
  /** Chỉ số của mục "Thư mục mới…" — luôn nằm cuối. */
  const newIndex = choices.length;

  /*
   * Hướng mở được quyết ở LÚC MỞ, không phải mỗi lần render.
   *
   * Vị trí của nút chỉ biết được sau khi trình duyệt dựng xong layout, và nó đổi
   * theo mức cuộn — nên đo một lần rồi giữ suốt lượt mở đó.
   */
  useEffect(() => {
    if (!open) {
      setPlaced(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setDropUp(window.innerHeight - rect.bottom < SPACE_BELOW);
    /* Mục đang chọn được nhấn sẵn, để Enter ngay sau khi mở không đổi gì cả. */
    const i = choices.findIndex((c) => c.value === value);
    setActive(i === -1 ? 0 : i);
    setPlaced(true);
    // `choices` dựng mới ở mỗi render nên không đưa vào deps — chỉ lượt mở cần đo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  /*
   * Focus SAU khi panel hiện, không cùng lượt với phép đo.
   *
   * Một phần tử `visibility: hidden` không nhận được focus — `focus()` gọi trong
   * cùng effect với `setPlaced(true)` chạy khi class `invisible` vẫn còn, nên nó im
   * lặng không làm gì. Hệ quả đo được (e2e ngày 03/09/2026): mũi lên/xuống không di
   * chuyển và Escape không đóng, vì `onKeyDown` của listbox chưa bao giờ nhận phím.
   */
  useEffect(() => {
    if (open && placed) listRef.current?.focus();
  }, [open, placed]);

  /*
   * Bấm ra ngoài thì đóng. `pointerdown` chứ không `click`: cú bấm vào chỗ khác phải
   * đóng danh sách ngay khi nhấn, không đợi nhả chuột — nếu đợi thì thao tác kéo bắt
   * đầu từ ngoài dropdown sẽ chạy trong lúc dropdown vẫn còn che mất đích.
   */
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
      onCancel?.();
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, onCancel]);

  function choose(index: number) {
    setOpen(false);
    if (index === newIndex) {
      setTyping(true);
      return;
    }
    onPick(choices[index]!.value);
  }

  if (typing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const el = e.currentTarget.elements.namedItem('path');
          setTyping(false);
          if (el instanceof HTMLInputElement && el.value.trim()) onPick(el.value.trim());
          else onCancel?.();
        }}
        className="flex min-w-0 gap-1.5"
      >
        <input
          name="path"
          autoFocus
          aria-label="Đường dẫn thư mục"
          placeholder="trang-chu/hero"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            setTyping(false);
            onCancel?.();
          }}
          className={cn(ui.fieldSm, 'font-shell-mono flex-1')}
        />
        <Button type="submit" size="sm" disabled={disabled}>
          Lưu
        </Button>
      </form>
    );
  }

  const current = value === undefined ? undefined : choices.find((c) => c.value === value);
  const label =
    value === undefined
      ? (placeholder ?? 'Chọn thư mục…')
      : (current?.label ?? value ?? 'Chưa phân loại');

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          setOpen(true);
        }}
        title={value === undefined ? undefined : (value ?? 'Chưa phân loại')}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          focusRing,
          quiet
            ? 'h-control-sm rounded px-2 text-small text-shell-muted hover:bg-shell-raised hover:text-shell-ink'
            : 'h-control-md rounded-md border border-shell-line-strong bg-shell-panel px-3.5 text-small font-semibold text-shell-ink hover:bg-shell-raised',
          open && 'bg-shell-raised text-shell-ink',
        )}
      >
        <Icon
          name="folder"
          size={quiet ? 15 : 17}
          className={value === undefined ? undefined : FOLDER_TEXT[folderTone(value)]}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {/*
          Ở biến thể im lặng mũi chỉ chỉ hiện khi rê chuột hoặc mở — một mũi chỉ xuống
          là lời hứa "bấm được", và nó chỉ cần nói ra khi người dùng đang nhắm vào đây.
        */}
        <Icon
          name="chevron-down"
          size={14}
          className={cn(
            'text-shell-muted transition-opacity',
            quiet && !open && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          )}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Tab') {
              setOpen(false);
              onCancel?.();
              buttonRef.current?.focus();
              return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              choose(active);
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => (i >= newIndex ? 0 : i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (i <= 0 ? newIndex : i - 1));
            } else if (e.key === 'Home') {
              e.preventDefault();
              setActive(0);
            } else if (e.key === 'End') {
              e.preventDefault();
              setActive(newIndex);
            }
          }}
          className={cn(
            ui.pop,
            'absolute z-30 max-h-64 w-full min-w-52 overflow-y-auto p-1.5 outline-none',
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1',
            // `invisible` chứ không phải `hidden`: phần tử vẫn phải có kích thước để
            // đo được, chỉ là chưa được vẽ và không nhận chuột.
            !placed && 'invisible',
          )}
        >
          {choices.map((c, i) => {
            const selected = value !== undefined && c.value === value;
            return (
              <li
                key={c.value ?? '<unfiled>'}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(i)}
                title={c.value ?? 'Chưa phân loại'}
                style={{ paddingLeft: `${0.5 + c.depth * 0.875}rem` }}
                className={cn(
                  'flex min-h-8 cursor-pointer items-center gap-2 rounded pr-2 text-small text-shell-ink',
                  active === i && 'bg-shell-raised',
                  selected && 'font-semibold',
                )}
              >
                <Icon name="folder" size={15} className={FOLDER_TEXT[folderTone(c.value)]} />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {/* Dấu tích chiếm chỗ cố định kể cả khi không hiện: thiếu nó thì hàng
                    đang chọn hẹp hơn một nhịp so với mọi hàng còn lại. */}
                <Icon name="check" size={15} className={cn('text-shell-accent', !selected && 'invisible')} />
              </li>
            );
          })}

          <li role="presentation" className="mx-1 my-1.5 h-px bg-shell-line" />

          <li
            id={`${listId}-${newIndex}`}
            role="option"
            aria-selected={false}
            onPointerEnter={() => setActive(newIndex)}
            onClick={() => choose(newIndex)}
            className={cn(
              'flex min-h-8 cursor-pointer items-center gap-2 rounded px-2 text-small font-medium text-shell-ink',
              active === newIndex && 'bg-shell-raised',
            )}
          >
            <Icon name="folder-plus" size={15} className="text-shell-muted" />
            <span>Thư mục mới…</span>
          </li>
        </ul>
      )}
    </div>
  );
}
