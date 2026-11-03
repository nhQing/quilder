'use client';

/**
 * Phạm vi mà các ô style của inspector đang ghi vào.
 *
 * ## Vì sao là context chứ không phải prop
 *
 * Hơn ba chục control và bốn chỗ phát `setStyle` cùng cần biết "đang chỉnh phần nào, ở trạng
 * thái nào". Truyền prop qua từng control là sửa mọi chỗ gọi; context thì chỉ cần `useSetStyle`
 * và vài chỗ phát op tay đọc nó. Phần ĐỌC đi đường khác: `scopedView` đưa cho control một node
 * mà style chính là lớp đang chỉnh, nên control không phải biết gì về scope.
 */

import { createContext, useContext } from 'react';

import { SelectField } from './ui/Field';
import { NO_SCOPE, type StyleScope } from '@/lib/builder/style-resolve';

export type { StyleScope } from '@/lib/builder/style-resolve';

const Ctx = createContext<StyleScope>(NO_SCOPE);

export const StyleScopeProvider = Ctx.Provider;
export const useStyleScope = () => useContext(Ctx);

const STATES: { value: string; label: string }[] = [
  { value: '', label: 'Thường' },
  { value: 'hover', label: 'Di chuột' },
  { value: 'focusVisible', label: 'Focus' },
];

/**
 * Hai ô chọn "Đang chỉnh" (cả node / một phần của Composite) và "Trạng thái".
 * Ô "Đang chỉnh" ẩn khi node không có phần con nào; "Trạng thái" luôn hiện.
 */
export function ScopePicker({
  nodeId,
  parts,
  wholeLabel = 'Cả khối',
  scope,
  onChange,
}: {
  nodeId: string;
  parts: { key: string; label: string }[];
  /** Nhãn lựa chọn "cả node" — xem `wholeScopeLabel` ("Cả form" cho Form). */
  wholeLabel?: string;
  scope: StyleScope;
  onChange: (next: StyleScope) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5 px-3.5" data-style-scope="">
      {parts.length > 0 && (
        <div className="grid grid-cols-[minmax(4.5rem,36%)_minmax(0,1fr)] items-center gap-x-2">
          <label htmlFor={`${nodeId}-scope-part`} className="text-shell-muted text-mini">
            Đang chỉnh
          </label>
          <SelectField
            size="sm"
            id={`${nodeId}-scope-part`}
            value={scope.part ?? ''}
            onChange={(e) => onChange({ ...scope, part: e.target.value || null })}
          >
            <option value="">{wholeLabel}</option>
            {parts.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      <div className="grid grid-cols-[minmax(4.5rem,36%)_minmax(0,1fr)] items-center gap-x-2">
        <label htmlFor={`${nodeId}-scope-state`} className="text-shell-muted text-mini">
          Trạng thái
        </label>
        <SelectField
          size="sm"
          id={`${nodeId}-scope-state`}
          value={scope.state ?? ''}
          onChange={(e) => onChange({ ...scope, state: (e.target.value || null) as StyleScope['state'] })}
        >
          {STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
      </div>
    </section>
  );
}
