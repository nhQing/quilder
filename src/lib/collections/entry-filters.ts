/**
 * Bộ lọc nâng cao của bảng bài trong Kho dữ liệu — kiểu nút "Filters" của Strapi
 * (23/11/2026): chọn field, chọn phép so, nhập giá trị; nhiều điều kiện thì AND.
 *
 * File này THUẦN và chạy được ở client: định nghĩa field lọc được, phép so, đọc/ghi
 * điều kiện từ URL. Phần dịch điều kiện ra truy vấn nằm ở `entry-filter-where.ts`
 * (server) — tách ra để `@prisma/client` không lọt vào bundle trình duyệt.
 *
 * ## Vì sao suy từ cấu trúc field
 *
 * Cùng lý do với cột (`entry-columns.ts`): thêm một field vào loại nội dung là có thêm
 * một thứ lọc được, không phải sửa bảng.
 *
 * ## Vì sao điều kiện nằm trên URL
 *
 * Cùng lý do với mọi bộ lọc khác của bảng (đầu `EntryTable.tsx`): số đếm do server tính,
 * và link chia sẻ được. Mỗi điều kiện là một `f=<field>|<phép>|<giá trị>`.
 */

import type { FieldDef } from './field-def';
import { taxonomyFieldsOf } from './taxonomy-fields';

export type FilterKind =
  | 'text'
  | 'longtext'
  | 'number'
  | 'date'
  | 'sysdate'
  | 'boolean'
  | 'enum'
  | 'presence'
  | 'taxonomy'
  | 'person';

export type FilterOp =
  | 'contains'
  | 'ncontains'
  | 'eq'
  | 'ne'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'empty'
  | 'filled'
  | 'true'
  | 'false'
  | 'has'
  | 'nhas';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterField {
  /** `field:<key>`, `tax:<key>` hoặc `sys:<tên>`. */
  id: string;
  label: string;
  kind: FilterKind;
  /** Field trong `data` mà điều kiện đọc. Vắng ở field hệ thống. */
  fieldKey?: string;
  /** Kiểu field gốc — `entry-filter-where.ts` cần nó để biết "trống" nghĩa là gì. */
  fieldType?: FieldDef['t'];
  options?: FilterOption[];
}

export interface FilterCond {
  id: string;
  op: FilterOp;
  /** Rỗng với phép không cần giá trị (`empty`, `filled`, `true`, `false`). */
  value: string;
}

/** Phép so dùng được cho từng loại, theo thứ tự hiện trong ô chọn. */
export const OPS: Record<FilterKind, readonly [FilterOp, ...FilterOp[]]> = {
  text: ['contains', 'ncontains', 'eq', 'ne', 'empty', 'filled'],
  longtext: ['contains', 'ncontains', 'empty', 'filled'],
  number: ['eq', 'gt', 'lt', 'empty', 'filled'],
  date: ['gte', 'lte', 'empty', 'filled'],
  sysdate: ['gte', 'lte'],
  boolean: ['true', 'false'],
  enum: ['eq', 'ne', 'empty', 'filled'],
  presence: ['filled', 'empty'],
  taxonomy: ['has', 'nhas', 'filled', 'empty'],
  person: ['eq', 'ne'],
};

export const OP_LABEL: Record<FilterOp, string> = {
  contains: 'chứa',
  ncontains: 'không chứa',
  eq: 'là',
  ne: 'không là',
  gt: 'lớn hơn',
  lt: 'nhỏ hơn',
  gte: 'từ ngày',
  lte: 'đến ngày',
  empty: 'trống',
  filled: 'đã có',
  true: 'là Có',
  false: 'là Không',
  has: 'có',
  nhas: 'không có',
};

/** Tối đa bấy nhiêu điều kiện — một URL dài vô hạn là một truy vấn dài vô hạn. */
export const MAX_FILTERS = 10;

const NO_VALUE: ReadonlySet<FilterOp> = new Set(['empty', 'filled', 'true', 'false']);

export function needsValue(op: FilterOp): boolean {
  return !NO_VALUE.has(op);
}

/** Kiểu field → loại bộ lọc. `null` = không lọc được (seo). */
function kindOf(f: FieldDef): FilterKind | null {
  switch (f.t) {
    case 'text':
    case 'slug':
      return 'text';
    case 'richtext':
    case 'html':
      return 'longtext';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return 'enum';
    case 'taxonomy':
      return 'taxonomy';
    case 'seo':
      return null;
    default:
      // Ảnh, tệp, liên kết, quan hệ, nhóm, khối, json, richdoc: chỉ hỏi được "có hay chưa".
      return 'presence';
  }
}

/**
 * Mọi thứ lọc được của một loại nội dung: field hệ thống trước (tác giả, ngày), rồi field
 * theo thứ tự khai trong cấu trúc.
 *
 * `taxonomies` là mọi mục phân loại của loại; mục có `fieldKey` null thuộc field taxonomy
 * ĐẦU TIÊN (cùng luật với cột, xem `taxonomy-fields.ts`).
 */
export function filterableFields(
  fields: readonly FieldDef[],
  ctx: {
    taxonomies: readonly { id: string; name: string; parentId: string | null; fieldKey: string | null }[];
    writers: readonly { email: string; name: string | null }[];
  },
): FilterField[] {
  const people: FilterOption[] = ctx.writers.map((w) => ({
    value: w.email,
    label: w.name ? `${w.name} (${w.email})` : w.email,
  }));
  const firstTax = taxonomyFieldsOf(fields)[0]?.key ?? null;

  const sys: FilterField[] = [
    ...(people.length
      ? [
          { id: 'sys:author', label: 'Tác giả', kind: 'person' as const, options: people },
          { id: 'sys:editor', label: 'Người sửa gần nhất', kind: 'person' as const, options: people },
        ]
      : []),
    { id: 'sys:created', label: 'Ngày tạo', kind: 'sysdate' },
    { id: 'sys:updated', label: 'Ngày cập nhật', kind: 'sysdate' },
    { id: 'sys:published', label: 'Ngày đăng', kind: 'sysdate' },
  ];

  const own: FilterField[] = [];
  for (const f of fields) {
    const kind = kindOf(f);
    if (!kind) continue;
    if (f.t === 'taxonomy') {
      own.push({
        id: `tax:${f.key}`,
        label: f.label,
        kind,
        fieldKey: f.key,
        fieldType: f.t,
        options: ctx.taxonomies
          .filter((t) => (t.fieldKey ?? firstTax) === f.key)
          .map((t) => ({ value: t.id, label: t.parentId ? `— ${t.name}` : t.name })),
      });
      continue;
    }
    own.push({
      id: `field:${f.key}`,
      label: f.label,
      kind,
      fieldKey: f.key,
      fieldType: f.t,
      ...(f.t === 'enum' ? { options: f.options.map((o) => ({ value: o.value, label: o.label })) } : {}),
    });
  }
  return [...sys, ...own];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Giá trị có hợp với field + phép không. Sai thì điều kiện bị bỏ, không ném. */
function valueOk(field: FilterField, op: FilterOp, value: string): boolean {
  if (!needsValue(op)) return true;
  if (!value.trim()) return false;
  switch (field.kind) {
    case 'number':
      return Number.isFinite(Number(value));
    case 'date':
    case 'sysdate':
      return DAY.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
    case 'enum':
    case 'taxonomy':
    case 'person':
      return (field.options ?? []).some((o) => o.value === value);
    default:
      return value.length <= 200;
  }
}

/** Một điều kiện → giá trị của tham số `f`. */
export function serializeFilter(c: FilterCond): string {
  return `${c.id}|${c.op}|${needsValue(c.op) ? c.value : ''}`;
}

/**
 * Đọc các tham số `f` thành điều kiện hợp lệ.
 *
 * Điều kiện hỏng (field đã xoá, phép không hợp loại, giá trị sai) bị BỎ QUA chứ không làm
 * hỏng cả bảng: một link cũ sau khi đổi cấu trúc vẫn phải mở được. Trùng nhau thì giữ một.
 */
export function parseFilters(
  raw: string | readonly string[] | undefined | null,
  fields: readonly FilterField[],
): FilterCond[] {
  const list = raw == null ? [] : typeof raw === 'string' ? [raw] : raw;
  const byId = new Map(fields.map((f) => [f.id, f]));
  const out: FilterCond[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    const a = s.indexOf('|');
    const b = a < 0 ? -1 : s.indexOf('|', a + 1);
    if (b < 0) continue;
    const id = s.slice(0, a);
    const op = s.slice(a + 1, b) as FilterOp;
    const field = byId.get(id);
    if (!field || !OPS[field.kind].includes(op)) continue;
    const value = needsValue(op) ? s.slice(b + 1).trim() : '';
    if (!valueOk(field, op, value)) continue;
    const key = serializeFilter({ id, op, value });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, op, value });
    if (out.length >= MAX_FILTERS) break;
  }
  return out;
}

/** Nhãn của giá trị trong một chip: tên mục phân loại / tên người thay cho id / email. */
function valueLabel(field: FilterField, c: FilterCond): string {
  if (!needsValue(c.op)) return '';
  const opt = field.options?.find((o) => o.value === c.value);
  if (opt) return opt.label.replace(/^— /, '');
  if (field.kind === 'date' || field.kind === 'sysdate') {
    const [y, m, d] = c.value.split('-');
    return `${d}/${m}/${y}`;
  }
  return `"${c.value}"`;
}

/** Chữ trên chip của một điều kiện, ví dụ `Danh mục có Thị trường`. */
export function describeFilter(c: FilterCond, fields: readonly FilterField[]): string {
  const field = fields.find((f) => f.id === c.id);
  if (!field) return c.id;
  return [field.label, OP_LABEL[c.op], valueLabel(field, c)].filter(Boolean).join(' ');
}
