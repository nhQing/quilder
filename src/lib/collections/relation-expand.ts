/**
 * Nở field `relation` từ ID trần thành thứ ánh xạ được lên một thẻ.
 *
 * ## Vấn đề
 *
 * `relation` lưu ID (`entry-data.ts`: `one` → một chuỗi, `many` → mảng chuỗi).
 * Khối lặp đọc thô `item.data[key]`, nên:
 *
 *  - `one` ánh xạ vào `content` in NGUYÊN một cuid lên thẻ tin — thứ lên
 *    production mà không ai nhận ra, vì nó "vẫn hiện chữ";
 *  - `many` thì `toRichText` nhận một mảng chuỗi, trả `undefined`, và không hiện
 *    gì — im lặng.
 *
 * ## Vì sao hình dạng nở ra lại là `{ title, href, assetId, alt }`
 *
 * Vì đó ĐÚNG là bộ mà `itemOverrides` đã biết xử lý: `href` đi qua nhánh
 * `{ href }` của field `link`, `assetId`+`alt` đi qua nhánh ảnh (kể cả phần tự
 * điền alt). Chọn một hình dạng khác là viết thêm bốn nhánh cho bốn vai đã có.
 *
 * `href` được dựng SẴN ở server, không phải ghép từ slug lúc render: gốc của
 * trang chi tiết phụ thuộc LOẠI của bản ghi đích, mà loại ấy khác loại của bài
 * đang lặp. `hrefBase` ở `repeat.ts` chỉ biết gốc của loại đang lặp, nên ghép ở
 * đó sẽ cho `/blogs/post/<slug-của-chuyên-đề>` — một URL 404 chỉ lộ ra khi có
 * người bấm.
 *
 * ## Một cấp, và có trần
 *
 * Nở một cấp là đủ cho mọi ca đã đặt ra (huy hiệu chuyên đề, "cùng tác giả",
 * "sản phẩm liên quan"). Cấp thứ hai là một truy vấn nữa cho mỗi bản ghi đích,
 * tức đúng cái N+1 mà cả tầng này tránh — và nó sẽ tự đến nếu không đặt trần,
 * vì bản ghi đích cũng có field `relation`.
 *
 * Không `server-only`: phần dựng hình dạng ở đây thuần và phải test được. Phần
 * đọc DB nằm ở `resolve-repeat.ts`.
 */

import type { FieldDef } from './field-def';

/**
 * Một bản ghi đích đã nở.
 *
 * `__rel` là dấu nhận biết, không phải dữ liệu. Không có nó thì `itemOverrides`
 * phải đoán từ hình dạng — và một field `json` của tác giả tình cờ có khoá
 * `title` sẽ đi nhầm nhánh.
 */
export interface RelationRef {
  __rel: true;
  id: string;
  /** Giá trị `titleField` của loại đích. Vắng = bản ghi chưa đặt tiêu đề. */
  title?: string;
  /** Đường dẫn ĐẦY ĐỦ tới trang chi tiết của bản ghi đích, nếu loại ấy có trang. */
  href?: string;
  /** Ảnh đầu tiên của bản ghi đích. */
  assetId?: string;
  alt?: string;
}

export function isRelationRef(v: unknown): v is RelationRef {
  return typeof v === 'object' && v !== null && (v as { __rel?: unknown }).__rel === true;
}

/** Trần số bản ghi nở cho MỘT field `many` của MỘT item. Xem docblock. */
export const MAX_RELATION_FANOUT = 20;

/**
 * ID mà một giá trị `relation` trỏ tới. `one` → một, `many` → nhiều.
 *
 * Chấp nhận cả hai hình dạng bất kể `cardinality` khai gì: một field vừa được
 * đổi từ `one` sang `many` để lại hàng cũ mang hình dạng cũ trong JSONB, và
 * ném ở đó nghĩa là một lần sửa schema làm trắng cả trang danh sách.
 */
export function relationIds(value: unknown): string[] {
  if (typeof value === 'string' && value) return [value];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  return [];
}

/** Field `relation` của một loại, kèm loại đích. */
export function relationFields(fields: FieldDef[]) {
  return fields.filter(
    (f): f is Extract<FieldDef, { t: 'relation' }> => f.t === 'relation',
  );
}

export interface RelationTarget {
  id: string;
  slug: string;
  typeKey: string;
  data: Record<string, unknown>;
}

/**
 * Bản ghi đích → `RelationRef`.
 *
 * `titleField` và `detailBase` đến từ LOẠI ĐÍCH, không phải loại đang lặp — xem
 * docblock đầu file.
 */
export function toRelationRef(
  target: RelationTarget,
  shape: { titleField: string | null; fields: FieldDef[] } | null,
  detailBase: string | null,
): RelationRef {
  const ref: RelationRef = { __rel: true, id: target.id };

  const rawTitle = shape?.titleField ? target.data[shape.titleField] : undefined;
  if (typeof rawTitle === 'string' && rawTitle.trim()) ref.title = rawTitle.trim();

  if (detailBase && target.slug) {
    ref.href = `${detailBase.replace(/\/+$/, '')}/${target.slug}`;
  }

  // Ảnh ĐẦU TIÊN của loại đích, theo thứ tự field đã khai — cùng luật SUY RA mà
  // `entrySeo` dùng khi bài chưa đặt ảnh OG. Ảnh OG của field `seo` KHÔNG vào đây: nó
  // là ảnh để chia sẻ, không phải ảnh bìa trên thẻ.
  for (const f of shape?.fields ?? []) {
    if (f.t !== 'image') continue;
    const v = target.data[f.key];
    const pick = Array.isArray(v) ? v[0] : v;
    if (typeof pick === 'object' && pick !== null) {
      const { assetId, alt } = pick as { assetId?: unknown; alt?: unknown };
      if (typeof assetId === 'string' && assetId) {
        ref.assetId = assetId;
        if (typeof alt === 'string' && alt.trim()) ref.alt = alt.trim();
        else if (ref.title) ref.alt = ref.title;
      }
    }
    break;
  }

  return ref;
}

/**
 * `data` của một entry, với mọi field `relation` đã thay ID bằng `RelationRef`.
 *
 * Bản ghi đích không tra được (đã xoá, hoặc còn nháp nên không lọt bộ lọc) thì
 * field BIẾN MẤT khỏi `data` thay vì thành mảng rỗng hay `{}`. Hai lý do:
 * `itemOverrides` bỏ qua `undefined` và giữ chữ gốc của component — trông có chủ
 * đích hơn một thẻ trắng; và một mảng rỗng lọt xuống `toRichText` cũng ra
 * `undefined`, nhưng mất luôn chỗ để phân biệt "chưa chọn" với "đã chọn, đích
 * mất rồi".
 */
export function expandRelations(
  data: Record<string, unknown>,
  fields: Extract<FieldDef, { t: 'relation' }>[],
  refById: Map<string, RelationRef>,
): Record<string, unknown> {
  if (!fields.length) return data;

  let out: Record<string, unknown> | null = null;

  for (const f of fields) {
    const ids = relationIds(data[f.key]);
    if (!ids.length) continue;

    const refs = ids
      .slice(0, MAX_RELATION_FANOUT)
      .map((id) => refById.get(id))
      .filter((r): r is RelationRef => r !== undefined);

    // Sao chép LƯỜI: phần lớn loại nội dung không có field `relation` nào, và
    // `data` ở đây đến thẳng từ JSONB — clone nó cho mỗi bài là một phép sao vô
    // ích nhân với số thẻ trên trang.
    out ??= { ...data };

    if (!refs.length) delete out[f.key];
    else out[f.key] = f.cardinality === 'many' ? refs : refs[0];
  }

  return out ?? data;
}
