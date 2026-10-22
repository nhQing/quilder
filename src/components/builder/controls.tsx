'use client';

/**
 * Control có kiểu cho inspector.
 *
 * Mọi control ở đây phát ra `setStyle` — CÙNG loại op mà AI phát. Một đường
 * mutation, một validator, một history stack, một audit trail. Đó là payoff của
 * thiết kế op có kiểu, và là lý do kéo một ô số cũng undo được như mọi thao tác.
 *
 * Ba tính chất chung của mọi control:
 *
 *  1. Hiện GIÁ TRỊ CÓ HIỆU LỰC, không phải giá trị của riêng lớp đang xem — nếu
 *     không, ở Tablet mọi ô đều trống dù trang rõ ràng có style.
 *  2. Đánh dấu ô nào là override của lớp này, và cho gỡ override để quay về kế
 *     thừa. Không có nút gỡ thì override chỉ thêm được, không bớt được.
 *  3. Ghi vào lớp ĐANG XEM. Đang ở Tablet mà sửa padding thì chỉ Tablet đổi.
 */

import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { fieldState } from '@/lib/builder/style-resolve';
import { cssAlias, cssLabel, propertiesFor } from '@/lib/builder/style-css-map';
import { declaredProperties } from '@/lib/render/sanitize-css';
import { scopeForTarget } from '@/lib/builder/css-scope';
import {
  UNIT_CHOICES,
  colorPreview,
  formatColor,
  formatLen,
  isComplexLen,
  parseColor,
  parseLen,
  roundLen,
  splitLen,
  stepLen,
  stepSize,
  unitOf,
} from '@/lib/builder/value-io';
import { selectStyleLocked, useEditor } from '@/lib/builder/store';
import { breakpointInfo, type Breakpoint } from '@/lib/design/breakpoints';
import type { ColorValue, Node, StyleProps } from '@/lib/doc/types';
import { ColorCustomPanel } from './ColorPopover';
import * as Popover from '@radix-ui/react-popover';

import { Icon, type IconName } from './ui/Icon';
import { Tip } from './ui/Tip';
import { TokenPicker } from './TokenPicker';
import { tokensOfKind } from '@/lib/builder/token-kinds';
import { SelectField } from './ui/Field';

export interface TokenOption {
  name: string;
  value: string;
  category: string;
  /** Token mặc định của Quilder — xem `tokensOfKind`. */
  core?: boolean;
}

type Group = keyof StyleProps;

interface Common {
  node: Node;
  breakpoint: Breakpoint;
  group: Group;
  field: string;
  /**
   * Nhãn của ô. BỎ TRỐNG là cách dùng bình thường — nó tự suy ra tên property CSS
   * mà ô này phát ra, qua `cssLabel()`.
   *
   * Vì sao mặc định chứ không truyền tay ở từng chỗ gọi: 34 chuỗi nhãn viết tay là
   * 34 chỗ có thể trôi khỏi thứ compiler thật sự phát ra. Suy ra từ
   * `STYLE_CSS_PROPERTY` — bảng đã có test dò `declarations()` thật — thì nhãn
   * không thể lệch khỏi CSS mà không làm đỏ test.
   *
   * Chỉ truyền tay khi ô không có mục trong bảng đó.
   */
  label?: string;
  tokens: TokenOption[];
}

/** Nhãn của ô: cái được truyền, hoặc tên property CSS mà ô này phát ra. */
function labelFor(group: Group, field: string, label?: string): string {
  return label ?? cssLabel(group, field);
}

/**
 * Hàng thuộc tính: nhãn bên trái, control bên phải — khuôn của MỌI ô trong Inspector,
 * kể cả dải nút nhiều lựa chọn (trước 21/10/2026 dải dài bỏ cột nhãn và bắt đầu ở mép
 * trái, nên control của nó lệch khỏi mọi hàng khác).
 *
 * Cột nhãn theo TỈ LỆ (36%, tối thiểu 4.5rem) chứ không cố định 8rem: sidebar giờ kéo
 * giãn được (`PaneResizer`), và một cột nhãn cố định thì kéo rộng ra chỉ có ô giãn — nhãn
 * vẫn cắt chữ ở 8rem. Mọi hàng chung một tỉ lệ nên mọi control vẫn bắt đầu cùng một mép.
 * Tên bị cắt thì tooltip (`Tip`) của nhãn giữ tên đầy đủ.
 *
 * `items-start` chứ không `items-center`: dưới control còn có thể có dòng giá trị token
 * hoặc dòng lỗi, và nhãn phải đứng ngang ô nhập chứ không trôi xuống giữa cả cụm.
 */
export const ROW = 'grid grid-cols-[minmax(4.5rem,36%)_minmax(0,1fr)] items-start gap-x-2';

/**
 * Dải nút chọn cỡ editor — cùng hình nhóm `Tabs` của design system (nền `shell-raised`,
 * mục đang chọn nổi lên bằng nền panel + bóng), thu về đúng một hàng 28px.
 *
 * Không dùng thẳng `Tabs`: nó cao 36px ở cỡ nhỏ nhất, và dải ở đây cần `title`, `id`,
 * `data-seg` riêng cho từng nút. Dải chọn ngôn ngữ ở đầu panel dùng chung công thức này.
 */
export const SEG = {
  group: 'flex min-w-0 gap-0.5 rounded-sm bg-shell-raised p-0.5',
  item: cn(
    'h-6 min-w-0 flex-auto truncate rounded-xs px-1 text-mini font-medium text-shell-muted transition-colors hover:text-shell-ink disabled:cursor-not-allowed disabled:opacity-40',
    focusRing,
  ),
  on: 'bg-shell-panel font-semibold text-shell-ink shadow-shell-card',
  /** Đang chọn nhưng là giá trị KẾ THỪA: vẫn nổi khỏi nền nhóm, nhưng chữ nhạt, không bóng. */
  inherited: 'bg-shell-panel text-shell-muted',
} as const;

/**
 * Bộ chọn đơn vị DÙNG CHUNG của hộp box model (`BoxModel`): hẹp, chữ mono nhỏ. `pr-6`
 * chừa đúng chỗ cho mũi tên của `SelectField` — ít hơn thì chữ chạy xuống dưới mũi tên.
 * Ô độ dài thường không còn dùng `<select>` — xem `TokenPicker`.
 */
const UNIT_BOX = 'w-[3.75rem] shrink-0';
const UNIT_SELECT = 'pl-1.5 pr-6 font-shell-mono text-micro';

/**
 * customCss của node này có đang đè ô đó không.
 *
 * Đây là lỗi khó chịu nhất của cả panel: kéo một ô số, trang không nhúc nhích,
 * và chỗ gây ra nằm cách đó vài trăm pixel trong một ô textarea. Không có cảnh
 * báo thì người dùng đi tìm bug ở chỗ không có bug.
 *
 * Chỉ cảnh báo với rule áp VÔ ĐIỀU KIỆN lên chính node. Rule trong `@media` hay
 * có pseudo (`&:hover`) chỉ đè trong một số hoàn cảnh — cảnh báo cho chúng sẽ
 * thành tiếng ồn, và tiếng ồn thì người ta học cách phớt lờ.
 */
function useShadowedBy(node: Node, group: Group, field: string): string | null {
  const target = useEditor((s) => s.target);
  return useMemo(() => {
    if (!node.customCss) return null;

    const targets = new Set(propertiesFor(group, field));
    if (!targets.size) return null;

    const hit = declaredProperties(node.customCss, node.id, scopeForTarget(target, node.id))
      .filter((d) => d.always)
      .find((d) => targets.has(d.prop));

    return hit ? hit.prop : null;
  }, [node.customCss, node.id, group, field, target]);
}

/** Gửi một thay đổi style vào lớp đang xem. `null` = gỡ khỏi lớp này. */
function useSetStyle(node: Node, breakpoint: Breakpoint, group: Group, field: string) {
  const dispatch = useEditor((s) => s.dispatch);

  return (value: unknown, label: string) =>
    dispatch(
      [
        {
          op: 'setStyle',
          nodeId: node.id,
          target: breakpoint,
          // `null` ở một key nghĩa là XOÁ key đó (xem mergeDeep trong ops.ts).
          patch: { [group]: { [field]: value } } as Partial<StyleProps>,
        },
      ],
      { label },
    );
}

/**
 * Dòng "kế thừa từ <lớp>" — và là nút hạ giá trị đó xuống lớp đang xem.
 *
 * Tên lớp dùng bản NGẮN (`sm`, `md`) chứ không phải nhãn người đọc ("Tablet"): bản ngắn
 * chính là thứ hiện trên dải khổ màn ở canvas cùng trên `LayerMap` — ba chỗ gọi một lớp
 * bằng ba tên là ba lần người dùng phải tự ánh xạ. Nhãn dài nằm trong `title`.
 */
function InheritChip({
  from,
  label,
  onOverride,
}: {
  from: Breakpoint;
  label: string;
  onOverride?: () => void;
}) {
  const info = breakpointInfo(from);
  const text = `kế thừa từ ${from}`;
  const look = 'min-w-0 truncate rounded-xs text-left text-micro leading-4 text-shell-muted';

  if (!onOverride) {
    return (
      <span data-inherit-from={from} className={look} title={`Kế thừa từ ${info.label} (${info.hint})`}>
        {text}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-inherit-from={from}
      onClick={onOverride}
      title={`Kế thừa từ ${info.label}. Bấm để ghi đè "${label}" riêng cho lớp đang xem.`}
      aria-label={`${label} đang kế thừa từ ${info.label} — ghi đè ở lớp đang xem`}
      className={cn(look, 'transition-colors hover:text-shell-accent hover:underline', focusRing)}
    >
      {text}
    </button>
  );
}

/**
 * Nhãn kèm chỉ báo kế thừa.
 *
 * Chấm sáng = giá trị đặt ngay tại lớp này.
 *
 * ## Vì sao lớp gốc hiện thành CHỮ, không chỉ nằm trong tooltip
 *
 * Bản trước chỉ có chấm + `title`, nên câu trả lời cho "giá trị này từ đâu" nằm sau
 * một lần hover: vô hình trên cảm ứng, vô hình với người quét mắt cả panel, và vô hình
 * trong ảnh chụp khi ai đó báo lỗi. Với một panel mà toàn bộ nội dung là quan hệ giữa
 * năm lớp, đó là thứ đáng chiếm bốn ký tự.
 *
 * Chip cũng LÀ nút ghi đè. Hai lý do nó không phải một nút thứ hai đặt cạnh: chỗ ấy
 * chỉ rộng chừng đó, và "ghi đè ở lớp này" là hành động duy nhất người ta muốn làm khi
 * vừa đọc ra giá trị đang đến từ lớp khác — nên nút nằm đúng trên câu trả lời.
 *
 * Ghi đè bằng CHÍNH giá trị đang kế thừa, không phải một giá trị rỗng: nó tạo một
 * override mà chưa đổi hình dạng gì, nên người dùng thấy ngay ô đã thuộc về lớp này và
 * sửa tiếp từ đó. Đặt rỗng sẽ làm trang nhảy trước khi họ kịp gõ.
 *
 * Đây là CỘT NHÃN của `ROW`: dòng đầu cao đúng bằng control (nhãn đứng ngang ô nhập),
 * dòng "kế thừa từ …" nằm ngay dưới. `inline` cho control chiếm cả hàng (dải nút nhiều
 * lựa chọn): mọi thứ dồn về một dòng phía trên control.
 */
function Label({
  htmlFor,
  label,
  alias,
  from,
  isOwn,
  onClear,
  onOverride,
  shadowedBy,
  inline,
}: {
  /** Một dòng phía trên control, thay cho cột nhãn bên trái. */
  inline?: boolean;
  /**
   * Ghi giá trị đang kế thừa xuống lớp đang xem. Vắng mặt thì chip chỉ là chữ.
   *
   * Optional vì không phải control nào cũng ghi được một giá trị đơn — `BoxModel`
   * quản tám ô cùng lúc và không có một `value` duy nhất để hạ xuống.
   */
  onOverride?: () => void;
  /**
   * Tên vật lý tương đương, nếu nhãn là logical property.
   *
   * Đi vào `title` chứ không hiện thành chữ: `inline-size` đã dài, thêm "(width)"
   * bên cạnh thì cột nhãn 8rem không còn chỗ. Ai quen `width` chỉ cần trỏ chuột — và
   * ô tìm khớp cả hai tên.
   */
  alias?: string | null;
  /** Property trong customCss đang đè ô này, nếu có. */
  shadowedBy?: string | null;
  /**
   * Bắt buộc, không phải trang trí. Thiếu liên kết label↔input thì screen reader
   * đọc một ô trống không tên, bấm vào chữ không focus vào ô, và test không có
   * cách nào trỏ tới đúng ô — cả ba đều là triệu chứng của cùng một thiếu sót.
   */
  htmlFor: string;
  label: string;
  from: Breakpoint | null;
  isOwn: boolean;
  onClear?: () => void;
}) {
  const name = (
    <label htmlFor={htmlFor} className="flex min-w-0 flex-1 items-center gap-1.5">
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          isOwn ? 'bg-shell-accent' : 'bg-transparent',
        )}
        title={
          isOwn
            ? 'Đặt riêng ở màn này'
            : from
              ? `Kế thừa từ ${breakpointInfo(from).label}`
              : 'Chưa đặt'
        }
      />
      {/* Tooltip cũng cứu nhãn bị cắt: cột nhãn co theo sidebar, và `truncate` thì im lặng. */}
      <Tip content={alias ? `${label} · ${alias}` : label}>
        <span className="text-shell-muted truncate text-mini">{label}</span>
      </Tip>
      {shadowedBy && (
        // Ký hiệu + title, không phải chỉ đổi màu: WCAG 1.4.1 — thông tin
        // không được truyền tải riêng bằng màu sắc.
        <span
          className="text-shell-warn inline-flex shrink-0"
          title={`CSS tuỳ chỉnh đang đè ô này bằng "${shadowedBy}". Sửa ở đây sẽ không thấy gì đổi.`}
          aria-label={`Bị CSS tuỳ chỉnh đè bằng ${shadowedBy}`}
        >
          <Icon name="alert" size={12} />
        </span>
      )}
    </label>
  );

  // Nút × và dòng kế thừa nằm NGOÀI <label>, không phải trong.
  //
  // Đặt một <button> bên trong <label htmlFor> thì click vừa chạy `onClear`/`onOverride`
  // vừa được label chuyển tiếp tới input — focus nhảy vào đúng ô vừa bị xoá hay vừa ghi
  // đè, trông như thao tác không ăn. Để chúng làm anh em của label thì label vẫn liên
  // kết đúng với input mà nút không bị cuốn theo.
  const inherit = !isOwn && from ? (
    <InheritChip from={from} label={label} onOverride={onOverride} />
  ) : null;
  const clear = isOwn && onClear ? (
    <button
      type="button"
      onClick={onClear}
      title={`Gỡ "${label}" khỏi màn này, quay về kế thừa`}
      aria-label={`Gỡ ${label}`}
      // size-6 = vùng bấm 24px. Bản đầu là ký tự × 10px `leading-none` không padding —
      // cao chừng 9px, nhỏ hơn ngưỡng tối thiểu của WCAG gần ba lần, rất dễ bấm trượt.
      className={cn(
        'text-shell-muted hover:bg-shell-raised hover:text-shell-danger grid size-6 shrink-0 place-items-center rounded-xs',
        focusRing,
      )}
    >
      <Icon name="x" size={12} />
    </button>
  ) : null;

  if (inline) {
    return (
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        {name}
        {inherit}
        {clear}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex h-control-sm min-w-0 items-center gap-1">
        {name}
        {clear}
      </div>
      {inherit && <div className="-mt-1 flex min-w-0 pl-3">{inherit}</div>}
    </div>
  );
}

/** Id ổn định cho một ô — dùng chung cho label và input. */
function fieldId(node: Node, breakpoint: Breakpoint, group: Group, field: string): string {
  return `f-${node.id}-${breakpoint}-${group}-${field}`;
}

/* ── Ô độ dài ─────────────────────────────────────────────────────────── */

export function LenControl({
  node, breakpoint, group, field, label: labelProp, tokens,
  keywords, placeholder, tokenCategory, compact, unitHint,
}: Common & {
  keywords?: readonly string[];
  placeholder?: string;
  /**
   * Đơn vị mặc định cho ô đang TRỐNG, khi người dùng gõ một số trần.
   *
   * Chỉ dùng ở compact, nơi mỗi ô không có bộ chọn riêng: một bộ chọn dùng chung cho cả
   * hộp quyết định đơn vị này. Ô đã CÓ giá trị thì đơn vị của chính nó thắng — đổi bộ
   * chọn không được âm thầm biến `24px` thành `24rem`, vì đó là đổi giá trị thật của
   * tám ô mà người dùng chỉ bấm một lần.
   */
  unitHint?: string;
  /**
   * Loại token bày trong bộ chọn — xem `tokensOfKind`. VẮNG = không có token nào (từ
   * 21/10/2026): trước đó vắng nghĩa là cả 469 token, kể cả `dur-*` và màu.
   */
  tokenCategory?: string;
  /**
   * Chỉ hiện ô nhập, không hiện hàng nhãn.
   *
   * Dùng cho hộp đệm/lề (`BoxModel`), nơi VỊ TRÍ của ô đã nói nó là cạnh nào —
   * đúng cách Webflow bày box model. Tám hàng nhãn "đệm trên / đệm dưới / …" ở đó
   * chiếm gấp ba chỗ mà không thêm thông tin nào.
   *
   * Đánh đổi phải bù lại: nhãn đi vào `aria-label` và `title` (screen reader và
   * chuột vẫn có), chấm "đặt riêng ở màn này" thành viền màu quanh ô, và gỡ giá
   * trị bằng cách XOÁ TRẮNG ô — vì không còn nút ×.
   */
  compact?: boolean;
}) {
  const label = labelFor(group, field, labelProp);
  const state = fieldState(node, breakpoint, group, field);
  const setStyle = useSetStyle(node, breakpoint, group, field);
  const id = fieldId(node, breakpoint, group, field);
  const shadowedBy = useShadowedBy(node, group, field);
  const saving = useEditor(selectStyleLocked);
  const localeLocked = useEditor((s) => s.locale !== null);

  const display = formatLen(state.value);
  const mode = splitLen(state.value);

  /**
   * Ô nhập giữ SỐ, không giữ đơn vị — đơn vị là việc của bộ chọn bên cạnh.
   *
   * Trừ chế độ compact: hộp box model cho mỗi ô đúng 3rem, không nhét thêm một bộ chọn
   * vào được (đo ở panel 300px: hai cột 74px cộng hộp trong là tràn). Ở đó ô giữ cả
   * chuỗi `24px` như trước, và đơn vị cho giá trị MỚI do bộ chọn dùng chung của cả hộp
   * quyết định — xem `BoxModel`.
   */
  const numText = mode.kind === 'number' ? String(mode.v) : '';
  const [draft, setDraft] = useState(compact ? display : numText);
  const [error, setError] = useState<string | null>(null);

  // Doc đổi từ bên ngoài (undo, AI, chọn node khác) thì ô phải theo.
  useEffect(() => {
    setDraft(compact ? display : numText);
    setError(null);
  }, [display, numText, compact, node.id, breakpoint]);

  const complex = isComplexLen(state.value);
  const names = new Set(tokens.map((t) => t.name));
  const currentUnit = unitOf(state.value);
  const tokenOptions = tokensOfKind(tokens, tokenCategory);

  /**
   * Giá trị đang chọn trong bộ chọn đơn vị.
   *
   * Ba tiền tố để MỘT `<select>` diễn đạt được cả ba dạng giá trị: đơn vị thật, từ khoá
   * (`auto`, `full`, `measure`), và token của design system. Hai bộ chọn cạnh nhau sẽ
   * chiếm hết chỗ của ô số ở panel 300px, và bắt người dùng biết trước giá trị mình
   * muốn thuộc loại nào — trong khi cả ba đều là "đơn vị" theo cách họ nghĩ.
   */
  const unitValue =
    mode.kind === 'number'
      ? mode.u || 'px'
      : mode.kind === 'token'
        ? `tk:${mode.name}`
        : mode.kind === 'keyword'
          ? `kw:${mode.word}`
          : '';

  /** Ghi theo lựa chọn của bộ chọn, giữ nguyên con số đang có trong ô. */
  const commitUnit = (next: string) => {
    setError(null);

    if (!next) {
      void setStyle(null, `gỡ ${label}`);
      return;
    }
    if (next.startsWith('tk:')) {
      const name = next.slice(3);
      void setStyle({ $token: name }, `${label}: ${name}`);
      return;
    }
    if (next.startsWith('kw:')) {
      const word = next.slice(3);
      void setStyle(word, `${label}: ${word}`);
      return;
    }

    // Đơn vị thật thì cần một con số. Ô còn trống thì KHÔNG ghi gì: ghi `0px` là bịa
    // ra một giá trị người dùng không gõ, và `0px` là giá trị có thật, có tác dụng.
    const num = Number(draft.trim());
    if (!draft.trim() || !Number.isFinite(num)) {
      setError('Nhập số trước, rồi chọn đơn vị.');
      return;
    }
    void setStyle({ v: roundLen(num), u: next }, `${label}: ${roundLen(num)}${next}`);
  };

  /**
   * Giá trị THẬT của token đang ở trong ô.
   *
   * Ô mang `space-m` nói đúng ý định nhưng không nói con số, và người đang canh một
   * khoảng cách cần con số. Datalist có hiện giá trị lúc mở gợi ý, nhưng chọn xong là
   * mất — tức thông tin chỉ tồn tại ở đúng một khoảnh khắc.
   *
   * Đọc từ `tokens` (cùng bảng Token mà `search_tokens` của MCP đọc), không tính lại
   * bằng tay: token đổi giá trị trong DB thì chú thích đổi theo, không lệch.
   */
  const tokenValue = (() => {
    const ref = state.value as { $token?: unknown } | null | undefined;
    if (!ref || typeof ref !== 'object' || typeof ref.$token !== 'string') return null;
    return tokens.find((t) => t.name === ref.$token)?.value ?? null;
  })();

  // `clamp()`/`min()`/`max()` = con số đổi theo bề rộng màn, nên nó KHÔNG phải một
  // hằng số và không được hiện như một hằng số. Dấu ≈ mang đúng thông tin đó.
  const tokenFluid = !!tokenValue && /clamp\(|min\(|max\(/.test(tokenValue);

  const commitText = (text: string) => {
    /*
     * Vẫn đi qua `parseLen`, dù ô giờ chỉ nhận số.
     *
     * Hai lý do: compact vẫn giữ cả chuỗi (`24px`), và ở chế độ đầy đủ người ta DÁN
     * được `1.5rem` vào ô — chặn nó là bắt họ xoá phần đơn vị bằng tay. `parseLen` đã
     * biết hiểu cả hai, và số trần thì kế thừa đơn vị đang có.
     *
     * Ô còn trống thì đơn vị mặc định lấy từ bộ chọn, nếu nó đang trỏ một đơn vị thật.
     */
    const fallbackUnit =
      currentUnit ??
      unitHint ??
      ((UNIT_CHOICES as readonly string[]).includes(unitValue) ? unitValue : null);

    const parsed = parseLen(text, { tokens: names, keywords, currentUnit: fallbackUnit });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    void setStyle(parsed.value, `${label}: ${text.trim() || '—'}`);
  };

  const commit = () => {
    if (draft === (compact ? display : numText)) return;
    commitText(draft);
  };

  /**
   * Mũi tên lên/xuống tăng giảm giá trị — ghi LUÔN, không đợi blur.
   *
   * Đợi blur thì giữ mũi tên để dò một con số trở nên vô dụng: canvas đứng im
   * cho tới khi rời ô, nên không thấy được mình đang dò tới đâu. Mỗi bước là một
   * op, tức mỗi bước undo được — đúng thứ người ta muốn khi dò bị quá tay.
   */
  const nudge = (delta: number) => {
    const next = stepLen(draft, delta, currentUnit);
    // `null` = ô đang mang token, từ khoá hoặc clamp(). Cộng số vào đó sẽ NUỐT
    // MẤT giá trị có chủ đích, nên phím mũi tên không làm gì cả.
    if (next === null) return;
    setDraft(next);
    commitText(next);
  };

  const body = (
    <>
      {/*
        Cảnh báo "customCss đang đè ô này" phải sống cả ở chế độ compact.

        Bản đầu của compact chỉ đổi MÀU VIỀN, và đó là vi phạm WCAG 1.4.1 — thông tin
        không được truyền tải riêng bằng màu sắc — đúng cái mà docblock của `Label`
        bên trên đã ghi rõ. Ký hiệu cảnh báo kèm `aria-label` giữ nguyên thông tin cho
        cả mắt lẫn screen reader, và giữ luôn `getByLabel('Bị CSS tuỳ chỉnh đè bằng …')`
        mà e2e đang dùng.
      */}
      {compact && shadowedBy && (
        <span
          className="text-shell-warn bg-shell-panel pointer-events-none absolute -top-1.5 -right-1 z-10 inline-flex rounded-full"
          title={`CSS tuỳ chỉnh đang đè ô này bằng "${shadowedBy}". Sửa ở đây sẽ không thấy gì đổi.`}
          aria-label={`Bị CSS tuỳ chỉnh đè bằng ${shadowedBy}`}
        >
          <Icon name="alert" size={12} />
        </span>
      )}

      {complex ? (
        // clamp()/calc() không sửa được bằng ô text mà không mất thông tin. Hiện
        // chỉ đọc còn hơn cho gõ đè rồi âm thầm phá một công thức có chủ đích.
        <p
          className={cn(
            'bg-shell-raised text-shell-muted font-shell-mono truncate rounded-sm text-mini',
            compact ? 'h-6 px-1 text-center leading-6' : 'h-control-sm px-2 leading-[1.75rem]',
          )}
          title="Giá trị phức tạp — sửa trong panel CSS hoặc gỡ rồi nhập lại."
        >
          {display}
        </p>
      ) : (
        <>
          {/* Hàng SỐ + ĐƠN VỊ. Compact chỉ có ô số — xem ghi chú ở bộ chọn. */}
          <div className={compact ? undefined : 'relative'}>
          <input
            id={id}
            value={draft}
            /*
              `inputMode` chứ không phải `type="number"`.

              `type="number"` mang theo hai thứ không muốn: mũi tên xoay của trình duyệt
              (đã có mũi tên bàn phím với bước Shift/Alt riêng), và nó TỪ CHỐI mọi chuỗi
              không phải số — dán `1.5rem` vào thì ô trắng trơn, không lỗi, không giá
              trị. `inputMode` vẫn gọi bàn phím số trên máy cảm ứng.
            */
            inputMode="decimal"
            /*
             * Vô hiệu khi giá trị là token/từ khoá — nhưng CHỈ ở chế độ đầy đủ.
             *
             * Ở đó bộ chọn bên cạnh là đường ra: đổi nó về `px` là ô số mở lại. Compact
             * KHÔNG có bộ chọn, nên vô hiệu ở đó biến một ô mang token thành ô không bao
             * giờ sửa hay gỡ được nữa — đúng cái mà test "gỡ override bằng cách xoá
             * trắng ô" bắt được. Compact giữ cả chuỗi trong ô, nên nó vẫn tự xoá được.
             */
            disabled={saving || (!compact && (mode.kind === 'token' || mode.kind === 'keyword'))}
            spellCheck={false}
            // Placeholder KHÔNG được trông giống một giá trị thật. Bản đầu để
            // "16px" và ô trống nhìn hệt như ô đã đặt 16px — không cách nào
            // phân biệt "chưa đặt" với "đặt bằng đúng giá trị mặc định".
            //
            // Khi giá trị là token/từ khoá thì ô số bị vô hiệu, và placeholder nói RÕ
            // đang là gì — thay vì để một ô xám không lý do.
            placeholder={
              mode.kind === 'token'
                ? mode.name
                : mode.kind === 'keyword'
                  ? mode.word
                  : (placeholder ?? '—')
            }
            aria-label={compact ? label : undefined}
            title={
              [
                compact ? `${label}.` : '',
                // Ở compact không có dòng chú thích dưới ô, nên giá trị thật của
                // token chỉ còn chỗ này để nói.
                compact && tokenValue ? `${tokenFluid ? '≈' : '='} ${tokenValue}.` : '',
                mode.kind === 'token' || mode.kind === 'keyword'
                  ? 'Đang là token/từ khoá. Đổi bộ chọn bên cạnh về một đơn vị để gõ số.'
                  : currentUnit
                    ? `Gõ số; đơn vị đang là ${currentUnit}. Dán được cả "1.5rem".`
                    : 'Gõ số, rồi chọn đơn vị bên cạnh.',
                '↑↓ tăng giảm, Shift ↑↓ bước 10, Alt ↑↓ bước 0.1.',
                compact && state.isOwn ? 'Xoá trắng để gỡ khỏi màn này.' : '',
              ]
                .filter(Boolean)
                .join(' ')
            }
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { setDraft(display); setError(null); }
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                // preventDefault để con trỏ không nhảy về đầu/cuối ô — hành vi
                // mặc định của input text, và nó làm mất chỗ đang gõ.
                e.preventDefault();
                nudge(stepSize(e) * (e.key === 'ArrowUp' ? 1 : -1));
              }
            }}
            className={cn(
              ui.fieldSm,
              'font-shell-mono',
              compact
                ? // Ô hẹp, canh giữa: trong hộp box model, một con số lệch trái
                  // trông như đang lệch khỏi cạnh nó mô tả. 24px chứ không 28px: hộp
                  // có ba hàng ô lồng hai lớp, và mỗi 4px nhân lên thành cả khối cao.
                  'h-6 px-1 text-center text-mini'
                : // Số canh PHẢI khi đứng cạnh bộ chọn: `24` và `px` sát nhau thì mắt
                  // đọc thành "24px"; số canh trái thì hai nửa rời ra.
                  // `pr-14` chừa chỗ cho nút hậu tố đơn vị nằm trong ô.
                  'w-full pr-14 text-right',
              // Không còn hàng nhãn nên chấm "đặt riêng" phải chuyển thành viền.
              compact && state.isOwn && 'border-shell-accent',
              compact && shadowedBy && 'border-shell-warn',
              error && 'border-shell-danger',
              !state.isOwn && state.value !== undefined && 'text-shell-muted',
            )}
          />

          {/*
            Hậu tố ĐƠN VỊ nằm BÊN TRONG ô (21/10/2026), không còn là một `<select>` cạnh ô.

            Hai ô cạnh nhau làm mép phải của hàng này lệch khỏi mọi hàng khác, và danh sách
            của `<select>` gốc do trình duyệt vẽ — rộng cả màn hình, không style được. Nút
            hậu tố mở `TokenPicker`: một hàng chip đơn vị, chip từ khoá, và token ĐÚNG LOẠI
            của ô (`tokensOfKind`). Mã giá trị giữ nguyên (`px`, `kw:auto`, `tk:space-m`, `''`)
            nên `commitUnit` không đổi.

            Không có ở compact: hộp box model không còn chỗ (xem ghi chú ở `numText`).
          */}
          {!compact && (
            <TokenPicker
              kind="length"
              label={label}
              units={[
                ...UNIT_CHOICES,
                // Đơn vị dữ liệu ĐANG mang mà danh sách không bày (`cqi`, `fr`, hoặc thứ
                // Agent ghi qua MCP). Thiếu chip đó thì bộ chọn nói ô chưa có đơn vị nào.
                ...(mode.kind === 'number' && !!mode.u && !(UNIT_CHOICES as readonly string[]).includes(mode.u)
                  ? [mode.u]
                  : []),
              ]}
              keywords={keywords}
              tokens={tokenOptions}
              allTokens={tokens}
              value={unitValue}
              onPick={commitUnit}
              trigger={
                <button
                  type="button"
                  // Chỉ khoá theo chế độ ngôn ngữ, KHÔNG theo `saving`: nút này chỉ MỞ bộ chọn.
                  // Bấm nó làm ô số mất focus và ghi ngay (`onBlur`), nên khoá theo `saving` là
                  // nút tự tắt giữa pointerdown và click — popover không bao giờ mở được.
                  disabled={localeLocked}
                  aria-label={`Đơn vị của ${label}`}
                  data-unit-select={`${group}.${field}`}
                  className={cn(
                    'absolute inset-y-0.5 right-0.5 flex max-w-[3.5rem] items-center gap-0.5 rounded-xs pl-1.5 pr-1 font-shell-mono text-micro text-shell-muted transition-colors hover:bg-shell-panel hover:text-shell-ink disabled:opacity-40',
                    mode.kind === 'token' && 'text-shell-accent',
                    focusRing,
                  )}
                >
                  <span className="min-w-0 truncate">
                    {mode.kind === 'token' ? 'token' : mode.kind === 'keyword' ? mode.word : unitValue || '—'}
                  </span>
                  <Icon name="chevron-down" size={10} />
                </button>
              }
            />
          )}
          </div>

          {/*
            Chú thích chỉ hiện ở chế độ ĐẦY ĐỦ, không hiện trong hộp box model.

            Không phải vì chỗ hẹp: thêm một dòng dưới ô compact làm ô đó CAO HƠN bảy
            ô kia, và vì hộp dùng `items-center` thì ô nhập bị đẩy lên nửa dòng — tức
            nó phá đúng cái thẳng cột vừa sửa xong. Ở compact, giá trị token nằm trong
            `title` của ô (xem `title` phía trên).
          */}
          {tokenValue && !compact && (
            <p
              className={cn(
                'font-shell-mono mt-0.5 truncate text-micro tabular-nums',
                tokenFluid ? 'text-shell-warn' : 'text-shell-muted',
              )}
              title={
                tokenFluid
                  ? `${tokenValue} — token co giãn theo bề rộng màn, nên đây là công thức chứ không phải một con số cố định.`
                  : `Giá trị thật của token, khai trong tokens.css: ${tokenValue}`
              }
            >
              {tokenFluid ? '≈ ' : '= '}
              {tokenValue}
            </p>
          )}
        </>
      )}

      {error && <p className={cn(ui.error, 'mt-0.5')}>{error}</p>}
    </>
  );

  if (compact) return <div className="relative">{body}</div>;

  return (
    <div className={ROW}>
      <Label
        htmlFor={id}
        label={label}
        alias={cssAlias(group, field)}
        shadowedBy={shadowedBy}
        from={state.from}
        isOwn={state.isOwn}
        onClear={() => void setStyle(null, `gỡ ${label}`)}
        onOverride={() => void setStyle(state.value, `ghi đè ${label} ở lớp này`)}
      />
      <div className="min-w-0">{body}</div>
    </div>
  );
}

/* ── Ô màu ────────────────────────────────────────────────────────────── */

export function ColorControl({
  node, breakpoint, group, field, label: labelProp, tokens,
}: Common) {
  const label = labelFor(group, field, labelProp);
  const state = fieldState(node, breakpoint, group, field);
  const setStyle = useSetStyle(node, breakpoint, group, field);
  const id = fieldId(node, breakpoint, group, field);
  const shadowedBy = useShadowedBy(node, group, field);
  const saving = useEditor(selectStyleLocked);
  // Mở bộ chọn chỉ khoá theo chế độ ngôn ngữ — cùng lý do với nút đơn vị của `LenControl`.
  const localeLocked = useEditor((s) => s.locale !== null);

  const display = formatColor(state.value);
  const [draft, setDraft] = useState(display);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    setDraft(display);
    setError(null);
  }, [display, node.id, breakpoint]);

  const names = new Set(tokens.map((t) => t.name));
  const colorTokens = tokensOfKind(tokens, 'color');
  const currentToken =
    state.value && typeof state.value === 'object' ? (state.value as { $token?: string }).$token : undefined;

  const commit = () => {
    if (draft === display) return;
    const parsed = parseColor(draft, names);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    void setStyle(parsed.value, `${label}: ${draft || '—'}`);
  };

  const pick = (next: ColorValue | null) => {
    setError(null);
    void setStyle(next, next ? `${label}: ${formatColor(next)}` : `gỡ ${label}`);
  };

  const openPicker = () => {
    setCustom(false);
    setOpen(true);
  };

  return (
    <div className={ROW}>
      <Label
        htmlFor={id}
        label={label}
        alias={cssAlias(group, field)}
        shadowedBy={shadowedBy}
        from={state.from}
        isOwn={state.isOwn}
        onClear={() => void setStyle(null, `gỡ ${label}`)}
        onOverride={() => void setStyle(state.value, `ghi đè ${label} ở lớp này`)}
      />
      <div className="min-w-0">
        {/*
          MỘT ô (21/10/2026): ô màu xem trước ở đầu, ô nhập ở giữa, nút ▾ ở cuối.

          Bản trước là ô vuông + ô nhập đứng cạnh nhau, gợi ý token đi qua `<datalist>` gốc —
          danh sách KHÔNG có ô màu nào, nên chọn `color-ink-raised` là chọn mù (lời phàn nàn
          của user). Giờ ô vuông và nút ▾ cùng mở `TokenPicker kind="color"`: mỗi dòng token
          có ô màu thật, tên và mã; phần đáy là màu tự chọn + lưu thành biến.

          Ô nhập vẫn GÕ được (dán `#ff6600`, gõ tên token) — bộ chọn là lối nhanh, không
          phải lối duy nhất.
        */}
        <TokenPicker
          kind="color"
          label={label}
          tokens={colorTokens}
          allTokens={tokens}
          value={currentToken ? `tk:${currentToken}` : state.value ? '#custom' : ''}
          open={open}
          onOpenChange={setOpen}
          onPick={(code) => pick(code.startsWith('tk:') ? { $token: code.slice(3) } : null)}
          footer={(close) =>
            custom ? (
              <ColorCustomPanel
                value={state.value}
                onPick={(next) => {
                  pick(next);
                  close();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setCustom(true)}
                className={cn(ui.menuItem, 'min-h-control-sm rounded-none px-3 text-small')}
              >
                <span className="flex-1">Màu tự chọn…</span>
                <Icon name="chevron-right" size={14} />
              </button>
            )
          }
          anchor={
            <div className="relative" data-color-field={`${group}.${field}`}>
              <button
                type="button"
                disabled={localeLocked}
                onClick={openPicker}
                aria-label={`Mở bộ chọn màu cho ${label}`}
                className={cn(
                  'absolute top-1/2 left-1 size-5 -translate-y-1/2 overflow-hidden rounded-full ring-1 ring-shell-line-strong disabled:opacity-40',
                  // Ô caro dưới nền: chưa đặt màu và đặt màu trắng/trong suốt phải phân biệt được.
                  'bg-[repeating-conic-gradient(var(--color-shell-line)_0_25%,transparent_0_50%)] bg-[length:6px_6px]',
                  focusRing,
                )}
              >
                {/* Giá trị thật từ bảng token, KHÔNG phải var(): vỏ builder không nạp
                    tokens.css nên var() ở đây luôn rỗng. */}
                <span className="block size-full" style={{ background: colorPreview(state.value, tokens) ?? 'transparent' }} />
              </button>
              <input
                id={id}
                value={draft}
                disabled={saving}
                spellCheck={false}
                placeholder="—"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') { setDraft(display); setError(null); }
                  if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); openPicker(); }
                }}
                className={cn(
                  ui.fieldSm,
                  'w-full pr-7 pl-8 font-shell-mono',
                  error && 'border-shell-danger',
                  !state.isOwn && state.value !== undefined && 'text-shell-muted',
                )}
              />
              <button
                type="button"
                tabIndex={-1}
                disabled={localeLocked}
                onClick={openPicker}
                aria-label={`Chọn token màu cho ${label}`}
                className="absolute inset-y-0.5 right-0.5 grid w-6 place-items-center rounded-xs text-shell-muted hover:bg-shell-panel hover:text-shell-ink disabled:opacity-40"
              >
                <Icon name="chevron-down" size={12} />
              </button>
            </div>
          }
        />
        {error && <p className={cn(ui.error, 'mt-0.5')}>{error}</p>}
      </div>
    </div>
  );
}

/* ── Ô chọn ───────────────────────────────────────────────────────────── */

export function SelectControl({
  node, breakpoint, group, field, label: labelProp, options, numeric,
}: Omit<Common, 'tokens'> & {
  options: readonly { value: string; label: string }[];
  /**
   * Giá trị của ô này là SỐ trong schema, không phải chuỗi.
   *
   * `<select>` luôn trả `string`. Ô "độ đậm" khai `weight: 400 | 500 | 700` là
   * số, nên mọi lần chọn đều bị Zod từ chối và người dùng chỉ thấy "Op không hợp
   * lệ" — ô đó chưa bao giờ dùng được.
   */
  numeric?: boolean;
}) {
  const label = labelFor(group, field, labelProp);
  const state = fieldState(node, breakpoint, group, field);
  const setStyle = useSetStyle(node, breakpoint, group, field);
  const id = fieldId(node, breakpoint, group, field);
  const shadowedBy = useShadowedBy(node, group, field);
  const saving = useEditor(selectStyleLocked);

  // Giá trị trong doc có thể là SỐ (weight), nhưng <select value> cần chuỗi.
  const current =
    state.value === undefined || state.value === null ? '' : String(state.value);

  return (
    <div className={ROW}>
      <Label
        htmlFor={id}
        label={label}
        alias={cssAlias(group, field)}
        shadowedBy={shadowedBy}
        from={state.from}
        isOwn={state.isOwn}
        onClear={() => void setStyle(null, `gỡ ${label}`)}
        onOverride={() => void setStyle(state.value, `ghi đè ${label} ở lớp này`)}
      />
      <SelectField
        size="sm"
        id={id}
        value={current}
        disabled={saving}
        onChange={(e) =>
          void setStyle(
            e.target.value ? (numeric ? Number(e.target.value) : e.target.value) : null,
            `${label}: ${e.target.value || '—'}`,
          )
        }
        className={cn(!state.isOwn && current && 'text-shell-muted')}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </SelectField>
    </div>
  );
}

/* ── Ô chọn dạng dải nút ──────────────────────────────────────────────── */

/**
 * Chọn một giá trị bằng một dải nút, thay cho `<select>`.
 *
 * ## Vì sao đổi khỏi dropdown
 *
 * Webflow và Framer đều dùng dải nút cho những thứ có ít lựa chọn và có hình
 * dạng: hướng trục, canh lề, canh chữ. Lý do không phải thẩm mỹ:
 *
 *  - Một `<select>` cần hai lần bấm (mở, chọn) và che mất canvas khi mở. Dải nút
 *    cần một lần và không che gì.
 *  - Giá trị đang chọn ĐỌC ĐƯỢC mà không phải mở ra, nên so sánh hai node là quét
 *    mắt thay vì mở hai dropdown.
 *
 * Chỉ dùng cho tập ≤ 6 lựa chọn. Nhiều hơn thì dải nút tràn dòng và mất luôn ưu
 * thế — `display` với 6 giá trị là đúng ngưỡng trên; `position` vẫn để dropdown.
 *
 * `aria-pressed` chứ không phải `role="radiogroup"`: đây là một nhóm nút bật/tắt
 * mà bấm lại chính nút đang chọn sẽ GỠ giá trị (quay về kế thừa) — hành vi đó
 * không có trong ngữ nghĩa radio.
 *
 * Mọi dải đều ngồi ở cột control của `ROW` (21/10/2026). Bản trước cho dải "dài" chiếm cả
 * hàng với nhãn lên dòng trên — control của nó bắt đầu ở mép trái trong khi mọi hàng khác
 * bắt đầu sau cột nhãn, và đó là chỗ lệch dễ thấy nhất trong panel. Giờ dải giữ gọn bằng
 * hai cách thay cho việc phình ra:
 *
 *  - **Icon** cho giá trị có hình dạng (`align-items`, `justify-content`, hướng trục).
 *    Tooltip + `aria-label` là giá trị CSS, nên icon không là thông tin duy nhất (WCAG 1.1.1).
 *  - **`more`**: giá trị ít dùng (`inline-flex`, `contents` của `display`) vào nút "…".
 *    Đang chọn một giá trị trong `more` thì nút "…" hiện chính giá trị đó, ở trạng thái chọn.
 */
export interface SegOption {
  value: string;
  label: string;
  hint?: string;
  icon?: IconName;
}

export function SegmentedControl({
  node, breakpoint, group, field, label: labelProp, options, more, numeric,
}: Omit<Common, 'tokens'> & {
  options: readonly SegOption[];
  /** Lựa chọn ít dùng, nằm sau nút "…". */
  more?: readonly SegOption[];
  /** Giá trị là SỐ trong schema (ví dụ `weight`), không phải chuỗi. */
  numeric?: boolean;
}) {
  const label = labelFor(group, field, labelProp);
  const state = fieldState(node, breakpoint, group, field);
  const setStyle = useSetStyle(node, breakpoint, group, field);
  const id = fieldId(node, breakpoint, group, field);
  const shadowedBy = useShadowedBy(node, group, field);
  const saving = useEditor(selectStyleLocked);
  const [moreOpen, setMoreOpen] = useState(false);

  const current =
    state.value === undefined || state.value === null ? '' : String(state.value);

  const pick = (o: SegOption, active: boolean) =>
    void setStyle(
      // Bấm lại nút đang chọn = gỡ. Không có nó thì một giá trị đặt nhầm ở màn hẹp
      // không có cách nào bỏ ngoài nút × ở hàng nhãn, và nút đó chỉ hiện khi đã đặt —
      // vòng lặp khó hiểu.
      active ? null : numeric ? Number(o.value) : o.value,
      active ? `gỡ ${label}` : `${label}: ${o.value}`,
    );

  const activeMore = more?.find((o) => o.value === current);
  const activeLook = state.isOwn ? SEG.on : SEG.inherited;

  return (
    <div className={ROW}>
      <Label
        htmlFor={id}
        label={label}
        alias={cssAlias(group, field)}
        shadowedBy={shadowedBy}
        from={state.from}
        isOwn={state.isOwn}
        onClear={() => void setStyle(null, `gỡ ${label}`)}
        onOverride={() => void setStyle(state.value, `ghi đè ${label} ở lớp này`)}
      />
      {/* `id` gắn vào nút ĐẦU TIÊN để `<label htmlFor>` có đích thật: label trỏ
          vào một id không tồn tại thì screen reader đọc một nhãn không thuộc về
          đâu, và bấm vào chữ không làm gì. */}
      <div className={SEG.group}>
        {options.map((o, i) => {
          const active = current === o.value;
          const name = o.hint ?? o.label;
          return (
            <Tip key={o.value} content={name}>
              <button
                id={i === 0 ? id : undefined}
                type="button"
                disabled={saving}
                aria-pressed={active}
                aria-label={o.icon ? name : undefined}
                data-seg={`${group}.${field}=${o.value}`}
                onClick={() => pick(o, active)}
                className={cn(SEG.item, o.icon && 'grid place-items-center', active && activeLook)}
              >
                {o.icon ? <Icon name={o.icon} size={14} /> : o.label}
              </button>
            </Tip>
          );
        })}

        {more?.length ? (
          <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                disabled={saving}
                aria-label={activeMore ? `${label}: ${activeMore.value} — giá trị khác` : `${label}: giá trị khác`}
                data-seg-more={`${group}.${field}`}
                className={cn(SEG.item, activeMore ? 'flex-none px-1.5' : 'w-6 flex-none px-0', activeMore && activeLook)}
              >
                {activeMore ? activeMore.label : '…'}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={4}
                collisionPadding={8}
                className={cn(ui.pop, 'z-[90] flex min-w-36 flex-col p-1')}
              >
                {more.map((o) => {
                  const active = current === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={active}
                      data-seg={`${group}.${field}=${o.value}`}
                      onClick={() => {
                        pick(o, active);
                        setMoreOpen(false);
                      }}
                      className={cn(ui.menuItem, 'min-h-control-sm text-small')}
                    >
                      <span className="flex-1 font-shell-mono">{o.label}</span>
                      {active && <Icon name="check" size={14} />}
                    </button>
                  );
                })}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : null}
      </div>
    </div>
  );
}

/* ── Ô số ─────────────────────────────────────────────────────────────── */

export function NumberControl({
  node, breakpoint, group, field, label: labelProp, min, max, step, placeholder,
}: Omit<Common, 'tokens'> & {
  min?: number; max?: number; step?: number; placeholder?: string;
}) {
  const label = labelFor(group, field, labelProp);
  const state = fieldState(node, breakpoint, group, field);
  const setStyle = useSetStyle(node, breakpoint, group, field);
  const id = fieldId(node, breakpoint, group, field);
  const shadowedBy = useShadowedBy(node, group, field);
  const saving = useEditor(selectStyleLocked);

  const display = typeof state.value === 'number' ? String(state.value) : '';
  const [draft, setDraft] = useState(display);

  useEffect(() => setDraft(display), [display, node.id, breakpoint]);

  const commit = () => {
    if (draft === display) return;
    const text = draft.trim();
    if (!text) {
      void setStyle(null, `gỡ ${label}`);
      return;
    }
    const num = Number(text);
    if (!Number.isFinite(num)) {
      setDraft(display);
      return;
    }
    // Làm tròn TRƯỚC khi kẹp biên: `opacity` bước 0.05 gõ tay ra
    // `0.30000000000000004`, và con số đó đi thẳng vào stylesheet nếu không chặn.
    const clamped = roundLen(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, num)));
    void setStyle(clamped, `${label}: ${clamped}`);
  };

  return (
    <div className={ROW}>
      <Label
        htmlFor={id}
        label={label}
        alias={cssAlias(group, field)}
        shadowedBy={shadowedBy}
        from={state.from}
        isOwn={state.isOwn}
        onClear={() => void setStyle(null, `gỡ ${label}`)}
        onOverride={() => void setStyle(state.value, `ghi đè ${label} ở lớp này`)}
      />
      <input
        id={id}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={saving}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(display);
        }}
        className={cn(ui.fieldSm, 'font-shell-mono', !state.isOwn && display && 'text-shell-muted')}
      />
    </div>
  );
}

/* ── Ô chữ tự do ──────────────────────────────────────────────────────── */

/**
 * Ô cho những field mà giá trị là CHUỖI tự do có kiểm.
 *
 * Bốn field dùng nó: `layout.gridArea`, `size.aspectRatio`, `effects.objectPosition`,
 * `container.name`. Chúng không phải độ dài, không phải số, và tập giá trị hợp lệ quá
 * rộng để làm `<select>` — `aspect-ratio` nhận `16/9`, `1`, `4 / 3`.
 *
 * Không tự kiểm cú pháp ở đây, và đó là quyết định: schema dùng `zSafeString` (chặn
 * ký tự phá CSS), còn "16/9 có phải tỉ lệ hợp lệ không" thì trình duyệt trả lời tốt
 * hơn một regex viết tay — sai thì property bị bỏ qua, không phá trang. Thứ PHẢI chặn
 * là injection, và chỗ chặn là schema ở server, không phải ô nhập ở client.
 */
export function TextControl({
  node, breakpoint, group, field, label: labelProp, placeholder, hint,
}: Omit<Common, 'tokens'> & { placeholder?: string; hint?: string }) {
  const label = labelFor(group, field, labelProp);
  const state = fieldState(node, breakpoint, group, field);
  const setStyle = useSetStyle(node, breakpoint, group, field);
  const id = fieldId(node, breakpoint, group, field);
  const shadowedBy = useShadowedBy(node, group, field);
  const saving = useEditor(selectStyleLocked);

  const display = typeof state.value === 'string' ? state.value : '';
  const [draft, setDraft] = useState(display);

  useEffect(() => setDraft(display), [display, node.id, breakpoint]);

  const commit = () => {
    if (draft === display) return;
    const text = draft.trim();
    // Xoá trắng = GỠ, không phải "đặt chuỗi rỗng". Chuỗi rỗng đi vào stylesheet thành
    // một khai báo vô nghĩa mà vẫn chiếm một dòng và vẫn đè lớp dưới.
    void setStyle(text || null, text ? `${label}: ${text}` : `gỡ ${label}`);
  };

  return (
    <div className={ROW}>
      <Label
        htmlFor={id}
        label={label}
        alias={cssAlias(group, field)}
        shadowedBy={shadowedBy}
        from={state.from}
        isOwn={state.isOwn}
        onClear={() => void setStyle(null, `gỡ ${label}`)}
        onOverride={() => void setStyle(state.value, `ghi đè ${label} ở lớp này`)}
      />
      <input
        id={id}
        value={draft}
        disabled={saving}
        spellCheck={false}
        placeholder={placeholder ?? '—'}
        title={hint}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(display);
        }}
        className={cn(ui.fieldSm, 'font-shell-mono', !state.isOwn && display && 'text-shell-muted')}
      />
    </div>
  );
}

/* ── Nhóm gập được ────────────────────────────────────────────────────── */

/**
 * Nhóm có nên hiện với từ khoá đang tìm không, và có nên MỞ SẴN không.
 *
 * Trả về `null` nghĩa là ẩn hẳn. Khớp thì luôn mở: một nhóm khớp mà vẫn gập lại thì
 * ô tìm chỉ lọc bớt tiếng ồn chứ không đưa người dùng tới ô cần sửa — mà đó mới là
 * việc của nó.
 *
 * Khớp theo `keys` (tên field + tên property CSS + tên vật lý, sinh từ
 * `searchKeysFor`) HOẶC theo tiêu đề nhóm, nên gõ "width", "inline-size", "kích" đều
 * ra cùng một nhóm.
 */
/*
 * `data-prop-group` trên `<section>` của `Section`.
 *
 * Đánh dấu đúng những nhóm mà Ô TÌM THUỘC TÍNH lọc được — bảy nhóm style của node
 * đang chọn, không hơn. Nó ghép cặp với `data-prop-search` trên chính ô tìm.
 *
 * Cần nó vì pane phải còn một khối `<section>` nữa KHÔNG phải nhóm thuộc tính: khối
 * "Trang" (`PageSeoPanel`) nói về trang chứ không về node, nằm ngoài nhánh node và
 * luôn hiện ở đáy. Selector cấu trúc kiểu `aside section > button` gộp cả hai loại
 * làm một, và test dùng nó sẽ đỏ mỗi lần pane phải có thêm một khối cấp trang —
 * đỏ vì selector tả sai, không vì thứ nó định canh đã hỏng.
 */
function matchFilter(
  filter: string | undefined,
  title: string,
  keys: string | undefined,
): { forceOpen: boolean } | null {
  const q = filter?.trim().toLowerCase();
  if (!q) return { forceOpen: false };
  const hit = (keys ?? '').includes(q) || title.toLowerCase().includes(q);
  return hit ? { forceOpen: true } : null;
}

/**
 * Hàng tiêu đề gập/mở — dùng chung cho các nhóm style và khối "Trang".
 *
 * Mũi tên `▸`/`▾` là CHỮ, không phải icon: nó đứng đầu tên truy cập của nút, và e2e mở
 * nhóm bằng đúng phép khớp đó (`/^[▸▾]\s*Bố cục/`). `aria-expanded` nói cùng điều ấy
 * cho screen reader.
 */
export function GroupToggle({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        'hover:bg-shell-raised text-shell-ink flex min-h-control-md w-full items-center gap-1.5 rounded-xs px-1 text-left text-small font-semibold transition-colors',
        focusRing,
      )}
    >
      <span className="text-shell-muted w-3 shrink-0 text-center text-micro">{open ? '▾' : '▸'}</span>
      {children}
    </button>
  );
}

/**
 * Một nhóm thuộc tính gập được: hàng tiêu đề, rồi các `ROW` xếp dọc.
 *
 * Mọi control tự bày theo `ROW` (nhãn | control), nên thân nhóm chỉ là một cột — không
 * còn lưới hai cột chia đôi panel như bản trước, nơi ô số còn ba ký tự và nhãn dài bị
 * cắt mất nửa. Hộp box model và dải nút nhiều lựa chọn chiếm cả hàng theo cách riêng.
 */
export function Section({
  title,
  count,
  children,
  defaultOpen = false,
  filter,
  keys,
}: {
  title: string;
  /** Số thuộc tính đang có giá trị — cho biết nhóm nào đáng mở mà không phải mở. */
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Từ khoá ở ô tìm. Không khớp thì nhóm ẩn hẳn. */
  filter?: string;
  /** Từ khoá tìm được của nhóm — dùng `searchKeysFor([...])`. */
  keys?: string;
}) {
  const [open, setOpen] = useState(defaultOpen || count > 0);

  const m = matchFilter(filter, title, keys);
  if (!m) return null;
  const isOpen = open || m.forceOpen;

  return (
    <section data-prop-group="" className="border-shell-line mx-3.5 border-t pt-1">
      <GroupToggle open={isOpen} onToggle={() => setOpen((v) => !v)}>
        {title}
        {count > 0 && (
          <span
            className="text-shell-muted ml-auto text-micro font-medium tabular-nums"
            title={`${count} thuộc tính đang có giá trị`}
          >
            {count}
          </span>
        )}
      </GroupToggle>
      {isOpen && <div className="flex flex-col gap-2 pt-1 pb-3">{children}</div>}
    </section>
  );
}

/**
 * Hộp đệm và lề — bốn cạnh bày ĐÚNG chỗ của chúng.
 *
 * ## Vì sao đổi khỏi tám hàng nhãn
 *
 * Đây là UI đặc trưng của Webflow, và nó thắng vì một lý do cụ thể: hộp đệm/lề là
 * thứ duy nhất trong bảng thuộc tính có **hình dạng không gian**. "đệm trên" và
 * "đệm dưới" là hai dòng chữ phải đọc rồi dựng hình trong đầu; hai ô nằm trên và
 * dưới một hình chữ nhật thì không phải đọc gì.
 *
 * Bản trước còn thiếu hẳn `ml`/`mr` — không có đường nào đặt lề ngang từ bảng
 * thuộc tính, dù schema và compiler đều hỗ trợ. Bày theo hộp thì chỗ trống đó lộ
 * ra ngay, đó cũng là một lợi ích của việc bày theo hình.
 *
 * Vòng ngoài là LỀ, vòng trong là ĐỆM — thứ tự của chính box model CSS, nên người
 * đã biết CSS không phải học lại gì.
 *
 * ## Vì sao LƯỚI chứ không phải ba hàng flex
 *
 * Bản trước xếp bằng flex và bốn ô KHÔNG thẳng cột, vì hai lỗi cộng lại:
 *
 *  1. Hàng trên dùng `justify-between` để nhét nhãn "lề" vào cùng hàng, nên ô trên
 *     bị nhãn cùng một `<span className="w-8" />` chèn đẩy sang chỗ tuỳ hoàn cảnh;
 *     hàng dưới dùng `justify-center`. Hai cách canh khác nhau trong CÙNG một hộp
 *     thì ô trên và ô dưới không bao giờ trùng cột.
 *  2. Hàng giữa có hai ô 3rem hai bên, nên tâm hộp TRONG lệch khỏi tâm hộp NGOÀI —
 *     mà ô dưới của hộp ngoài lại canh theo tâm hộp ngoài.
 *
 * Lưới `3rem / 1fr / 3rem` dùng chung cho cả hai hộp, mỗi ô ghim `col-start`/
 * `row-start` của nó, sửa cả hai. Ghim hàng TƯỜNG MINH là bắt buộc: một ô chỉ khai
 * cột 1 mà không khai hàng sẽ được nhồi vào hàng 2 (đang trống cột 1), tức `lề
 * trái` nhảy lên ngồi cạnh `lề trên`.
 *
 * Nhãn ra HÀNG RIÊNG ở trên thay vì chen cùng hàng với ô: nó không còn đẩy ô nào,
 * và ở panel hẹp nhất (`--shell-right` = 300px) nhãn dài cũng không đè lên ô.
 */
/**
 * Bộ chọn đơn vị DÙNG CHUNG cho một cụm ô compact.
 *
 * Hộp box model có tám ô rộng 3rem, và cụm offset có bốn — không ô nào nhét thêm được
 * một bộ chọn riêng (đo ở panel 300px: cột 74px là tràn hộp). Nhưng "nhập số rồi chọn
 * đơn vị" phải đúng ở cả hai chỗ đó, nên bộ chọn lên cấp trên: một cái cho cả cụm.
 *
 * Nó chỉ quyết định đơn vị cho ô đang TRỐNG. Ô đã có giá trị giữ đơn vị của chính nó —
 * đổi bộ chọn mà âm thầm biến `24px` thành `24rem` là đổi giá trị thật của tám ô sau
 * một cú bấm, và `24rem` lớn gấp 16 lần.
 */
export function UnitPicker({
  unit,
  onChange,
  scope,
}: {
  unit: string;
  onChange: (unit: string) => void;
  /** Cho `data-unit-picker`, để test và người đọc DOM biết cụm nào. */
  scope: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <SelectField
        size="sm"
        value={unit}
        onChange={(e) => onChange(e.target.value)}
        data-unit-picker={scope}
        aria-label="Đơn vị cho ô đang trống"
        wrapperClassName={UNIT_BOX}
        className={UNIT_SELECT}
        options={UNIT_CHOICES}
      />
      <span className="text-shell-muted text-micro leading-snug">
        đơn vị cho ô trống — ô đã có giá trị giữ đơn vị của nó
      </span>
    </div>
  );
}

export function BoxModel({
  node,
  breakpoint,
  tokens,
}: {
  node: Node;
  breakpoint: Breakpoint;
  tokens: TokenOption[];
}) {
  const [unit, setUnit] = useState<string>('px');

  // Nhãn để `cssLabel()` suy ra: `padding-block-start` v.v. — cùng tên với thứ
  // stylesheet thật sự ghi, nên cảnh báo customCss và ô này gọi nó y như nhau.
  const cell = (field: string) => (
    <LenControl
      compact
      node={node}
      breakpoint={breakpoint}
      tokens={tokens}
      group="spacing"
      field={field}
      tokenCategory="space"
      unitHint={unit}
    />
  );

  // Một chuỗi duy nhất cho cả hai hộp — hai hộp lệch lưới là đúng cái lỗi vừa sửa.
  const grid = 'relative grid grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-1';
  /*
   * Nhãn RA KHỎI LUỒNG — không chiếm hàng, không chiếm ô.
   *
   * Cho nhãn một hàng riêng trong lưới vẫn còn lệch, và lệch theo chiều DỌC: hàng
   * nhãn đẩy nội dung hộp TRONG xuống, nên tâm hộp trong không còn là tâm hàng giữa
   * của nó. `lề trái/phải` canh theo tâm hộp trong (chúng ở hàng giữa hộp ngoài),
   * còn `đệm trái/phải` canh theo tâm hàng giữa hộp trong — hai tâm cách nhau đúng
   * nửa chiều cao nhãn.
   *
   * `absolute` làm nhãn không chiếm chỗ nào, nên cả hai hộp lại đối xứng dọc và hai
   * tâm trùng nhau. Nhãn ngồi ở góc trên-trái, chỗ lưới bỏ trống (cột 1 hàng 1 không
   * có ô nào) — "lề"/"đệm" ở cỡ micro rộng ~20px, còn ô trên bắt đầu ở ~54px.
   */
  const lab = cn(ui.eyebrow, 'pointer-events-none absolute top-1 left-1.5');
  /*
   * Ô TRÊN và ô DƯỚI nằm ở cột giữa, mà cột giữa là `1fr`.
   *
   * Không ghim bề rộng thì chúng dãn ra bằng cả hộp — đo được 118px so với 48px của
   * hai ô ngang, tức hai ô rộng gấp gần ba, và một ô rộng hơn đọc như một ô quan
   * trọng hơn. `w-12` + `justify-self-center` cho tám ô đúng một bề rộng.
   */
  const mid = 'col-start-2 w-12 justify-self-center';

  return (
    <>
      <UnitPicker unit={unit} onChange={setUnit} scope="spacing" />
      {/* Hai hộp phân biệt bằng NỀN, không bằng viền nét đứt: lề là vùng `shell-raised`,
          đệm là tấm `shell-panel` đặt lên nó — đúng ba lớp bề mặt của design system, nên
          hộp đọc ra "lớp ngoài / lớp trong" ở cả hai theme mà không thêm màu nào. */}
      <div className={cn(grid, 'bg-shell-raised rounded-md p-1.5')} data-box-model="">
      <span className={lab}>lề</span>
      <div className={cn(mid, 'row-start-1')}>{cell('mt')}</div>
      <div className="col-start-1 row-start-2">{cell('ml')}</div>

      <div
        className={cn(
          grid,
          'bg-shell-panel ring-shell-line col-start-2 row-start-2 rounded-sm p-1.5 ring-1',
        )}
      >
        <span className={lab}>đệm</span>
        <div className={cn(mid, 'row-start-1')}>{cell('pt')}</div>
        <div className="col-start-1 row-start-2">{cell('pl')}</div>
        {/* Ô giữa: chỗ đứng của nội dung. Trống có chủ đích — nó là hình, không
            phải một ô nhập bị quên.

            Tô bằng token CÓ khai trong `builder.css`: bản đầu dùng `bg-shell-sunken/60`,
            mà `--color-shell-sunken` không tồn tại — Tailwind v4 không sinh utility cho
            token không khai báo, nên hình chữ nhật này trong suốt và hộp mất cái làm nó
            đọc ra "hộp". `shell-raised` trên tấm đệm `shell-panel` đọc như một hố nội
            dung. */}
        <div className="bg-shell-raised col-start-2 row-start-2 h-6 rounded-xs" aria-hidden="true" />
        <div className="col-start-3 row-start-2">{cell('pr')}</div>
        <div className={cn(mid, 'row-start-3')}>{cell('pb')}</div>
      </div>

      <div className="col-start-3 row-start-2">{cell('mr')}</div>
      <div className={cn(mid, 'row-start-3')}>{cell('mb')}</div>
      </div>
    </>
  );
}
