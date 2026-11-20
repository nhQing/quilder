/**
 * Cột của bảng bài trong Kho dữ liệu — cột nào có, cột nào đang hiện.
 *
 * ## Cột suy từ cấu trúc field, không gõ tay
 *
 * Bảng từng có đúng một cột "Danh mục" gom MỌI mục phân loại của bài. Từ khi một loại
 * nội dung có nhiều field taxonomy (Danh mục + Tag, xem `taxonomy-fields.ts`), gom chung
 * là trộn hai thứ khác nghĩa. Nên mỗi field taxonomy là một cột riêng mang nhãn của
 * chính field đó, và thêm field là thêm lựa chọn cột — không phải sửa bảng.
 *
 * Field đơn giản (chữ một dòng, số, ngày, có/không, lựa chọn, liên kết) cũng chọn được
 * làm cột. Field nặng (richtext, html, khối, nhóm, ảnh, json, seo) thì không: một ô bảng
 * không hiện được chúng, và kéo chúng theo mỗi hàng là kéo cả thân bài về trình duyệt.
 *
 * ## Lưu ở cookie, theo từng loại nội dung
 *
 * Server đọc cookie để render đúng ngay lần đầu (không nháy từ "mặc định" sang "đã
 * chọn"). Lựa chọn là thói quen của người xem trên máy đó, không phải dữ liệu của
 * site — nên không cần bảng DB, và hai biên tập viên chọn cột khác nhau không giẫm
 * lên nhau.
 */

import type { FieldDef } from './field-def';
import { roleOf, taxonomyFieldsOf } from './taxonomy-fields';

export type EntryColumn =
  | { id: string; label: string; kind: 'taxonomy'; fieldKey: string; role: 'category' | 'tag' }
  | { id: string; label: string; kind: 'field'; field: FieldDef }
  | { id: 'status'; label: string; kind: 'status' }
  | { id: string; label: string; kind: 'locale'; code: string }
  | { id: 'created'; label: string; kind: 'created' }
  | { id: 'updated'; label: string; kind: 'updated' };

/** Kiểu field hiện gọn được trong một ô. `text` nhiều dòng bị loại riêng. */
const CELL_TYPES = new Set(['text', 'number', 'boolean', 'date', 'enum', 'link', 'slug']);

export const columnsCookie = (typeKey: string) => `qb-cols.${typeKey}`;

/**
 * Mọi cột chọn được, theo thứ tự hiện trong bảng: phân loại, field, trạng thái,
 * ngôn ngữ, ngày tạo, cập nhật. Tiêu đề không có trong danh sách — nó luôn hiện, vì nó là
 * đường vào bài.
 */
export function availableColumns(
  fields: readonly FieldDef[],
  opts: { titleField: string; slugField: string | null; locales: readonly string[] },
): EntryColumn[] {
  const tax: EntryColumn[] = taxonomyFieldsOf(fields).map((f) => ({
    id: `tax:${f.key}`,
    label: f.label,
    kind: 'taxonomy',
    fieldKey: f.key,
    role: roleOf(f),
  }));
  const plain: EntryColumn[] = fields
    .filter(
      (f) =>
        CELL_TYPES.has(f.t) &&
        f.key !== opts.titleField &&
        // Slug đã nằm dưới tiêu đề.
        f.key !== opts.slugField &&
        !(f.t === 'text' && f.multiline),
    )
    .map((f) => ({ id: `field:${f.key}`, label: f.label, kind: 'field', field: f }));
  return [
    ...tax,
    ...plain,
    { id: 'status', label: 'Trạng thái', kind: 'status' },
    ...opts.locales.map(
      (code): EntryColumn => ({ id: `locale:${code}`, label: code.toUpperCase(), kind: 'locale', code }),
    ),
    // Ngày tạo: cột của thứ tự mặc định (`entry-sort.ts`) — sắp theo một ngày mà không
    // thấy ngày đó thì thứ tự trông như ngẫu nhiên.
    { id: 'created', label: 'Ngày tạo', kind: 'created' },
    { id: 'updated', label: 'Cập nhật', kind: 'updated' },
  ];
}

/**
 * Cột hiện khi người xem chưa chọn gì: như bảng trước đây (phân loại, trạng thái,
 * ngôn ngữ, cập nhật). Field đơn giản mặc định ẩn — chúng là thứ người ta bật khi cần.
 */
export function defaultColumnIds(cols: readonly EntryColumn[]): string[] {
  return cols.filter((c) => c.kind !== 'field').map((c) => c.id);
}

/**
 * Đọc giá trị cookie thành danh sách cột đang hiện, theo thứ tự của `cols`.
 *
 * Id lạ (field đã xoá, ngôn ngữ đã tắt) bị bỏ qua. Cookie trống, hỏng hoặc không còn
 * id nào hợp lệ thì về mặc định — một bảng chỉ còn cột tiêu đề vì cookie cũ là lỗi
 * người dùng không tự gỡ được.
 */
export function visibleColumnIds(cols: readonly EntryColumn[], raw: string | undefined | null): string[] {
  if (!raw) return defaultColumnIds(cols);
  let picked: Set<string>;
  try {
    picked = new Set(decodeURIComponent(raw).split(',').filter(Boolean));
  } catch {
    return defaultColumnIds(cols);
  }
  // Cookie ghi `-` khi người xem tắt hết cột tuỳ chọn: hợp lệ, khác với "chưa chọn".
  if (picked.has('-')) return cols.filter((c) => picked.has(c.id)).map((c) => c.id);
  const ids = cols.filter((c) => picked.has(c.id)).map((c) => c.id);
  return ids.length ? ids : defaultColumnIds(cols);
}

/** Giá trị cookie cho một lựa chọn. Rỗng thì ghi `-` (xem `visibleColumnIds`). */
export function serializeColumnIds(ids: readonly string[]): string {
  return encodeURIComponent(ids.length ? ids.join(',') : '-');
}

/** Field cần kéo kèm mỗi hàng để vẽ các cột field CHỌN ĐƯỢC (không chỉ cột đang hiện). */
export function columnFieldKeys(cols: readonly EntryColumn[]): string[] {
  return cols.flatMap((c) => (c.kind === 'field' ? [c.field.key] : []));
}

const DAY = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DAY_TIME = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});
const NUM = new Intl.NumberFormat('vi-VN');

/** Chữ hiện trong ô của một cột field. Trống = '—'. */
export function formatCell(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (field.t) {
    case 'boolean':
      return value === true ? 'Có' : 'Không';
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return String(value);
      return field.format === 'currencyVND' ? `${NUM.format(n)} ₫` : NUM.format(n);
    }
    case 'date': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      return (field.withTime ? DAY_TIME : DAY).format(d);
    }
    case 'enum':
      return field.options.find((o) => o.value === value)?.label ?? String(value);
    case 'link':
      if (typeof value === 'object' && value && 'href' in value) {
        return String((value as { href: unknown }).href ?? '—') || '—';
      }
      return String(value);
    default:
      return typeof value === 'string' ? value : JSON.stringify(value);
  }
}
