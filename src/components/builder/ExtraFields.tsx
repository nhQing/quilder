'use client';

/**
 * Ô "thêm khi cần" của một nhóm.
 *
 * ## Hai luật quyết định ô nào hiện
 *
 *  1. **Có giá trị thì LUÔN hiện**, kể cả khi người dùng chưa bấm thêm nó. Nếu không,
 *     một `row-gap` do Agent đặt qua MCP sẽ vô hình trong panel — người dùng thấy
 *     khoảng cách trên trang mà không tìm được ô nào giải thích, và đó là loại bí ẩn
 *     đắt nhất trong một builder.
 *  2. **Bấm thêm thì hiện, kể cả khi còn trống.** Đó chính là việc của nút: mở một ô
 *     rỗng để gõ vào.
 *
 * Xét theo giá trị CÓ HIỆU LỰC, không phải giá trị của riêng lớp đang xem: một
 * `white-space: nowrap` đặt ở `base` vẫn đang tác động ở `lg`, nên ô của nó phải thấy
 * được ở `lg` để gỡ hoặc ghi đè.
 *
 * ## Vì sao state là cục bộ và KHÔNG lưu
 *
 * "Tôi vừa mở ô này ra" là ngữ cảnh của một khoảnh khắc. Lưu nó nghĩa là mở panel lần
 * sau thấy sáu ô rỗng lạ mà không nhớ vì sao — đúng loại trạng thái ẩn mà cả panel này
 * đang đi bỏ. Node đổi thì `NodeInspector` remount theo `key={node.id}`, nên danh sách
 * tự sạch.
 */

import { useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing } from '@/lib/builder/ui';
import { extrasFor, type ExtraField } from '@/lib/builder/extra-fields';
import { cssLabel } from '@/lib/builder/style-css-map';
import type { StyleProps } from '@/lib/doc/types';
import type { Breakpoint } from '@/lib/design/breakpoints';
import type { Node } from '@/lib/doc/types';
import {
  ColorControl,
  LenControl,
  NumberControl,
  SelectControl,
  TextControl,
  type TokenOption,
} from './controls';
import { Icon } from './ui/Icon';

/** Ô này đang có giá trị có hiệu lực không. */
function hasValue(effective: Partial<StyleProps>, meta: ExtraField): boolean {
  const groupValues = (effective as Record<string, Record<string, unknown> | undefined>)[
    meta.group
  ];
  return groupValues?.[meta.field] !== undefined;
}

function Field({
  meta,
  node,
  breakpoint,
  tokens,
}: {
  meta: ExtraField;
  node: Node;
  breakpoint: Breakpoint;
  tokens: TokenOption[];
}) {
  const common = {
    node,
    breakpoint,
    group: meta.group as keyof StyleProps,
    field: meta.field,
    ...(meta.label ? { label: meta.label } : {}),
  };

  switch (meta.control) {
    case 'len':
      return <LenControl {...common} tokens={tokens} tokenCategory={meta.tokenCategory} />;
    case 'number':
      return <NumberControl {...common} min={meta.min} max={meta.max} step={meta.step} />;
    case 'color':
      return <ColorControl {...common} tokens={tokens} />;
    case 'text':
      return <TextControl {...common} hint={meta.hint} />;
    case 'select':
      return (
        <SelectControl
          {...common}
          // Nhãn lựa chọn ĐÚNG BẰNG giá trị CSS — không dịch. Người dùng chọn `anywhere`
          // và nhìn thấy `overflow-wrap: anywhere` trong stylesheet, không phải đoán
          // "bất kỳ đâu" tương ứng với giá trị nào.
          options={(meta.options ?? []).map((v) => ({ value: v, label: v, hint: meta.hint }))}
        />
      );
  }
}

export function ExtraFields({
  panelGroup,
  node,
  breakpoint,
  tokens,
  effective,
}: {
  /** Nhóm HIỂN THỊ của panel — xem ghi chú khoá của `EXTRA_FIELDS`. */
  panelGroup: string;
  node: Node;
  breakpoint: Breakpoint;
  tokens: TokenOption[];
  effective: Partial<StyleProps>;
}) {
  const all = extrasFor(panelGroup);
  const [revealed, setRevealed] = useState<readonly string[]>([]);
  const [picking, setPicking] = useState(false);

  if (!all.length) return null;

  const key = (m: ExtraField) => `${m.group}.${m.field}`;
  const shown = all.filter((m) => hasValue(effective, m) || revealed.includes(key(m)));
  const rest = all.filter((m) => !shown.includes(m));

  return (
    <>
      {shown.map((meta) => (
        <Field key={key(meta)} meta={meta} node={node} breakpoint={breakpoint} tokens={tokens} />
      ))}

      {rest.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
            data-add-field={panelGroup}
            className={cn(
              'text-shell-accent hover:bg-shell-accent-soft flex w-full min-w-0 items-center gap-1.5 rounded-xs px-1 py-1 text-left text-mini font-medium',
              focusRing,
            )}
          >
            <Icon name="plus" size={14} />
            <span className="min-w-0 flex-1 truncate">
              {rest.slice(0, 3).map((m) => m.label ?? cssName(m)).join(', ')}
              {rest.length > 3 && '…'}
            </span>
            {/* Con số đứng CUỐI nút: nó là số ô còn ẩn, và e2e đọc nó ở cuối chữ. */}
            <span className="text-shell-muted shrink-0 text-micro tabular-nums">{rest.length}</span>
          </button>

          {picking && (
            <div className="bg-shell-raised mt-1 max-h-40 overflow-y-auto rounded-sm p-1">
              {rest.map((meta) => (
                <button
                  key={key(meta)}
                  type="button"
                  data-add-field-pick={key(meta)}
                  title={meta.hint}
                  onClick={() => {
                    setRevealed((list) => [...list, key(meta)]);
                    // Đóng danh sách sau khi chọn: thêm một ô rồi muốn thêm ô nữa là
                    // trường hợp ít gặp hơn hẳn, và để mở thì nó che mất ô vừa thêm.
                    setPicking(false);
                  }}
                  className={cn(
                    'hover:bg-shell-panel flex w-full min-w-0 items-baseline gap-2 rounded-xs px-1.5 py-1 text-left text-micro',
                    focusRing,
                  )}
                >
                  <span className="text-shell-ink font-shell-mono shrink-0">{meta.label ?? cssName(meta)}</span>
                  {meta.hint && (
                    <span className="text-shell-muted min-w-0 truncate">{meta.hint}</span>
                  )}
                  <Icon name="plus" size={12} className="text-shell-accent ml-auto self-center" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Tên hiện trong danh sách chọn — dùng chung `cssLabel` để không có tên thứ hai. */
function cssName(meta: ExtraField): string {
  return cssLabel(meta.group, meta.field);
}
