'use client';

/**
 * Thanh chọn khổ màn — một nút cho mỗi khổ, và một chỗ để sửa danh sách.
 *
 * ## Vì sao nhãn là CON SỐ, không phải "Desktop / Tablet / Mobile"
 *
 * Bề rộng giờ do người dùng đặt. "Tablet" là tên đúng cho 768 nhưng vô nghĩa khi họ
 * thêm 1600 hay 480 — và tên gán sẵn cho một con số tuỳ ý là một lời hứa sai. Con số
 * là thứ họ vừa gõ vào, nên nó luôn đúng.
 *
 * Chữ nhỏ cạnh mỗi con số là **lớp style** mà khổ đó ghi vào (`xl`, `lg`, …). Đó là
 * thông tin duy nhất người dùng không tự suy ra được, và là thứ quyết định thao tác
 * sửa của họ rơi vào đâu. Hai khổ có thể trùng lớp — 1920 và 1600 đều là `xl` — và
 * lúc đó nhìn thanh này là biết ngay vì sao sửa ở khổ này lại đổi cả khổ kia.
 *
 * Con số phải là `<span>` ĐẦU TIÊN trong mỗi nút: e2e đọc bề rộng của từng nút bằng
 * `querySelector('span')`.
 */

import { useEffect, useRef, useState } from 'react';

import {
  MAX_SCREEN_WIDTH,
  MIN_SCREEN_WIDTH,
  breakpointForWidth,
  breakpointInfo,
} from '@/lib/design/breakpoints';
import { MAX_SCREENS } from '@/lib/builder/screens';
import { useEditor } from '@/lib/builder/store';
import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Tabs } from './ui/Tabs';

export function ScreenBar({
  scale,
  actualSize,
  onToggleActualSize,
  fullPage = false,
  onToggleFullPage,
}: {
  scale: number;
  actualSize: boolean;
  onToggleActualSize: () => void;
  /** Khung cao bằng cả trang, pane cuộn thay khung. Xem `Canvas`. */
  fullPage?: boolean;
  /** Vắng = không có nút (đang sửa component). */
  onToggleFullPage?: () => void;
}) {
  const screens = useEditor((s) => s.screens);
  const activeScreenId = useEditor((s) => s.activeScreenId);
  const setActiveScreen = useEditor((s) => s.setActiveScreen);
  const breakpoint = useEditor((s) => s.breakpoint);

  const [managing, setManaging] = useState(false);
  // Nút mở VÀ bảng nằm trong cùng khung: bấm lại nút để đóng thì cú bấm đó không được
  // tính là "bấm ra ngoài" — nếu không, bảng đóng ở `mousedown` rồi mở lại ở `click`.
  const manageRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative z-30 flex shrink-0 flex-wrap items-center gap-2.5 px-3 py-2.5">
      <Tabs
        label="Khổ màn"
        size="sm"
        value={activeScreenId}
        onChange={setActiveScreen}
        items={screens.map((s) => {
          const bp = breakpointForWidth(s.width);
          return {
            id: s.id,
            label: (
              <>
                <span className="font-shell-mono tabular-nums">{s.width}</span>
                <span className="text-micro font-medium text-shell-muted">{bp}</span>
              </>
            ),
            data: { 'data-screen-button': s.id },
          };
        })}
      />

      <div ref={manageRef} className="relative">
        <Button
          variant="ghost"
          size="sm"
          icon="sliders"
          data-screen-manage=""
          onClick={() => setManaging((v) => !v)}
          aria-expanded={managing}
          title="Thêm, sửa bề rộng, hoặc bỏ khổ màn"
          className={cn(managing && 'bg-shell-raised')}
        >
          Khổ màn
        </Button>
        {managing && <ManagePanel containerRef={manageRef} onClose={() => setManaging(false)} />}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Lớp style đang ghi — nhắc lại ở đây vì nó quyết định mọi thao tác sửa. */}
        <Badge tone="accent" size="sm" title={breakpointInfo(breakpoint).hint}>
          đang sửa lớp {breakpoint} · {breakpointInfo(breakpoint).label}
        </Badge>
        {onToggleFullPage && (
          <Button
            variant="ghost"
            size="sm"
            icon="monitor"
            data-stage-full-page=""
            onClick={onToggleFullPage}
            aria-pressed={fullPage}
            title={
              fullPage
                ? 'Đang xem toàn trang: khung cao bằng nội dung, cuộn ở ngoài khung. Hiệu ứng theo cuộn đứng yên. Bấm để về một màn thiết bị.'
                : 'Xem toàn trang một lượt như Figma: khung cao bằng nội dung. Hero vẫn cao đúng một màn thiết bị.'
            }
            className={cn(fullPage && 'bg-shell-accent-soft text-shell-accent hover:bg-shell-accent-soft')}
          >
            Toàn trang
          </Button>
        )}
        <button
          type="button"
          data-stage-actual-size=""
          onClick={onToggleActualSize}
          aria-pressed={actualSize}
          title={
            actualSize
              ? 'Đang xem đúng kích thước thật. Bấm để thu cho vừa pane.'
              : 'Xem đúng kích thước thật (100%). Pane sẽ cuộn ngang nếu không đủ chỗ.'
          }
          className={cn(
            'font-shell-mono inline-flex h-control-sm items-center rounded-sm border px-2 text-mini tabular-nums transition-colors',
            focusRing,
            actualSize
              ? 'border-shell-accent bg-shell-accent-soft text-shell-accent'
              : 'border-shell-line-strong bg-shell-panel text-shell-muted hover:text-shell-ink',
          )}
        >
          {Math.round(scale * 100)}%
        </button>
      </div>
    </div>
  );
}

/**
 * Bảng sửa danh sách khổ.
 *
 * Bề rộng ghi bằng `<input type="number">` và **chỉ áp khi rời ô hoặc Enter**, không
 * áp theo từng ký tự: gõ "1440" mà áp ngay từng bước nghĩa là đi qua 1 → 14 → 144,
 * và mỗi bước là một lần dựng lại iframe. Bước "1" còn bị chặn dưới ngưỡng tối thiểu
 * nên nó cũng không phải trạng thái hợp lệ để đi qua.
 */
function ManagePanel({
  containerRef,
  onClose,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const screens = useEditor((s) => s.screens);
  const addScreen = useEditor((s) => s.addScreen);
  const removeScreen = useEditor((s) => s.removeScreen);
  const setScreenWidth = useEditor((s) => s.setScreenWidth);
  const resetScreens = useEditor((s) => s.resetScreens);

  const [draft, setDraft] = useState('');

  // Bấm ra ngoài hoặc Esc thì đóng — cùng quy ước với các popover khác trong builder.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [containerRef, onClose]);

  const submitNew = () => {
    const w = Number(draft);
    if (!Number.isFinite(w)) return;
    addScreen(w);
    setDraft('');
  };

  return (
    <div
      data-screen-panel=""
      className={cn(ui.pop, 'absolute top-full left-0 z-50 mt-2 flex w-80 flex-col gap-3 p-4')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui font-semibold">Khổ màn</span>
        <IconButton icon="x" label="Đóng bảng khổ màn" size="sm" onClick={onClose} />
      </div>

      <p className={ui.hint}>
        Bề rộng {MIN_SCREEN_WIDTH}–{MAX_SCREEN_WIDTH}px. Chiều cao đi theo bề rộng, và nó
        cũng là chiều cao một màn mà <code className="font-shell-mono">100vh</code> nghĩa là.
      </p>

      <ul className="flex flex-col gap-1.5">
        {screens.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <input
              type="number"
              defaultValue={s.width}
              min={MIN_SCREEN_WIDTH}
              max={MAX_SCREEN_WIDTH}
              step={10}
              data-screen-width={s.id}
              aria-label={`Bề rộng khổ ${s.width}px`}
              onBlur={(e) => setScreenWidth(s.id, Number(e.currentTarget.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className={cn(ui.fieldSm, 'font-shell-mono w-22 tabular-nums')}
            />
            <span className="font-shell-mono text-mini text-shell-muted tabular-nums">× {s.height}</span>
            <Badge size="sm">{breakpointForWidth(s.width)}</Badge>
            <IconButton
              icon="x"
              size="sm"
              data-screen-remove={s.id}
              label={`Bỏ khổ ${s.width}px`}
              // Khổ cuối cùng không xoá được: danh sách rỗng là một pane trắng không
              // còn đường nào để thêm lại.
              disabled={screens.length <= 1}
              onClick={() => removeScreen(s.id)}
              title={screens.length <= 1 ? 'Phải còn ít nhất một khổ' : `Bỏ khổ ${s.width}px`}
              className="ml-auto hover:bg-shell-danger-soft hover:text-shell-danger"
            />
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitNew();
          }}
          min={MIN_SCREEN_WIDTH}
          max={MAX_SCREEN_WIDTH}
          placeholder="1600"
          aria-label="Bề rộng khổ mới"
          data-screen-new=""
          className={cn(ui.fieldSm, 'font-shell-mono w-22 tabular-nums')}
        />
        <Button
          size="sm"
          icon="plus"
          data-screen-add=""
          onClick={submitNew}
          disabled={screens.length >= MAX_SCREENS}
          title={screens.length >= MAX_SCREENS ? `Tối đa ${MAX_SCREENS} khổ` : 'Thêm khổ'}
        >
          Thêm khổ
        </Button>
      </div>

      <div className="flex justify-end border-t border-shell-line pt-3">
        <Button
          variant="ghost"
          size="sm"
          icon="refresh"
          data-screen-reset=""
          onClick={resetScreens}
          title="Về 1920 / 1440 / 1024 / 768 / 320"
        >
          Đặt lại
        </Button>
      </div>
    </div>
  );
}
