'use client';

/**
 * Nút "Bộ lọc" và hàng chip điều kiện của bảng bài — kiểu Strapi (23/11/2026).
 *
 * Component chỉ dựng điều kiện; đọc/ghi URL và dịch ra truy vấn là việc của
 * `EntryTable` và `lib/collections/entry-filters.ts`.
 */

import { useState } from 'react';

import {
  describeFilter,
  MAX_FILTERS,
  needsValue,
  OP_LABEL,
  OPS,
  type FilterCond,
  type FilterField,
  type FilterOp,
} from '@/lib/collections/entry-filters';
import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Button } from './ui/Button';
import { SelectField, TextField } from './ui/Field';
import { Icon } from './ui/Icon';
import { Popover } from './ui/Overlay';

/** Ô nhập giá trị theo loại field. */
function ValueInput({
  field,
  value,
  onChange,
}: {
  field: FilterField;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.options) {
    return (
      <SelectField label="Giá trị" size="md" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Chọn —</option>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectField>
    );
  }
  const type = field.kind === 'number' ? 'number' : field.kind === 'date' || field.kind === 'sysdate' ? 'date' : 'text';
  return (
    <TextField
      label="Giá trị"
      size="md"
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={type === 'text' ? 200 : undefined}
      autoFocus
    />
  );
}

/** Ô dựng MỘT điều kiện mới. */
function FilterForm({
  fields,
  onAdd,
}: {
  fields: readonly FilterField[];
  onAdd: (c: FilterCond) => void;
}) {
  const [id, setId] = useState(fields[0]?.id ?? '');
  const field = fields.find((f) => f.id === id) ?? fields[0];
  const [op, setOp] = useState<FilterOp>(field ? OPS[field.kind][0] : 'eq');
  const [value, setValue] = useState('');
  if (!field) return null;

  const ops = OPS[field.kind];
  const currentOp = ops.includes(op) ? op : ops[0];
  const ready = !needsValue(currentOp) || value.trim() !== '';

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onAdd({ id: field.id, op: currentOp, value: needsValue(currentOp) ? value.trim() : '' });
      }}
    >
      <SelectField
        label="Field"
        size="md"
        value={field.id}
        onChange={(e) => {
          const next = fields.find((f) => f.id === e.target.value);
          setId(e.target.value);
          setValue('');
          if (next) setOp(OPS[next.kind][0]);
        }}
      >
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Điều kiện"
        size="md"
        value={currentOp}
        onChange={(e) => setOp(e.target.value as FilterOp)}
        options={ops.map((o) => ({ value: o, label: OP_LABEL[o] }))}
      />
      {needsValue(currentOp) && <ValueInput key={field.id} field={field} value={value} onChange={setValue} />}
      <Button type="submit" variant="primary" size="md" disabled={!ready} className="self-end">
        Thêm bộ lọc
      </Button>
    </form>
  );
}

/** Nút mở ô dựng điều kiện. Đặt trên thanh lọc của bảng. */
export function FilterButton({
  fields,
  active,
  onChange,
}: {
  fields: readonly FilterField[];
  active: readonly FilterCond[];
  onChange: (next: FilterCond[]) => void;
}) {
  const full = active.length >= MAX_FILTERS;
  return (
    <Popover
      label="Thêm bộ lọc"
      align="start"
      panelClassName="w-80 p-4"
      trigger={(p) => (
        <Button {...p} icon="filter" disabled={full} title={full ? `Tối đa ${MAX_FILTERS} bộ lọc` : undefined}>
          Bộ lọc{active.length ? ` (${active.length})` : ''}
        </Button>
      )}
    >
      {(close) => (
        <FilterForm
          fields={fields}
          onAdd={(c) => {
            const same = (x: FilterCond) => x.id === c.id && x.op === c.op && x.value === c.value;
            if (!active.some(same)) onChange([...active, c]);
            close();
          }}
        />
      )}
    </Popover>
  );
}

/** Hàng chip điều kiện đang áp. Không có điều kiện thì không vẽ gì. */
export function FilterChips({
  fields,
  active,
  onChange,
}: {
  fields: readonly FilterField[];
  active: readonly FilterCond[];
  onChange: (next: FilterCond[]) => void;
}) {
  if (!active.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Bộ lọc đang áp">
      {active.map((c, i) => {
        const text = describeFilter(c, fields);
        return (
          <span
            key={`${c.id}|${c.op}|${c.value}`}
            className="inline-flex items-center gap-1 rounded-full border border-shell-line bg-shell-raised py-1 pr-1 pl-3 text-small"
          >
            {text}
            <button
              type="button"
              aria-label={`Bỏ bộ lọc ${text}`}
              onClick={() => onChange(active.filter((_, j) => j !== i))}
              className={cn(
                'grid size-5 place-items-center rounded-full text-shell-muted hover:bg-shell-line hover:text-shell-ink',
                focusRing,
              )}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        );
      })}
      <Button variant="ghost" size="sm" onClick={() => onChange([])}>
        Bỏ hết bộ lọc
      </Button>
      <span className={cn(ui.eyebrow, 'sr-only')}>Các bộ lọc nối bằng VÀ</span>
    </div>
  );
}
