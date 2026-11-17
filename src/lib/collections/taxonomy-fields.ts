/**
 * Phân loại THEO FIELD: mỗi field `taxonomy` của một loại có danh sách mục riêng, và
 * một vai trò — Danh mục hoặc Tag.
 *
 * ## Vì sao (17/11/2026)
 *
 * Trước đây mỗi loại có MỘT danh sách phân loại chung (`Taxonomy.typeKey`), và một loại
 * chỉ được khai MỘT field `taxonomy`. CMS cũ (Strapi) của MaiMoney có hai lớp: Group
 * (chuyên mục — dải danh mục, trang `/blogs/<group>`) và Category (tag — nhãn trên thẻ
 * tin). Lúc nhập, hai lớp bị gộp vào một danh sách, nên dải danh mục hiện cả tag và
 * thẻ "Tin Tức Thị Trường" mang nhãn "Đầu tư" không phân biệt được đâu là chuyên mục.
 *
 * ## Cách địa chỉ hoá
 *
 * `Taxonomy.fieldKey` nói mục thuộc field nào. `null` = field `taxonomy` ĐẦU TIÊN của
 * loại — đúng mọi hàng đã có trước ngày này, nên không cần migration dữ liệu cho các
 * loại chỉ có một field. Bảng nối `EntryTaxonomy` không đổi: một bài vẫn có MỘT danh
 * sách `taxonomyIds` phẳng, và mỗi id tự biết nó thuộc ô nào qua `fieldKey` của mục.
 *
 * Khoá (`Taxonomy.key`) vẫn duy nhất trong cả LOẠI, không trong từng field: nó là đoạn
 * URL `/blogs/<key>`, và hai mục cùng khoá ở hai field là hai trang tranh một URL.
 *
 * File này THUẦN (không Prisma) để test được, và để cả client lẫn server dùng chung.
 */

import type { FieldDef } from './field-def';

export type TaxonomyField = Extract<FieldDef, { t: 'taxonomy' }>;
export type TaxonomyRole = 'category' | 'tag';

/** Các field `taxonomy` của loại, theo thứ tự khai báo. */
export function taxonomyFieldsOf(fields: readonly FieldDef[]): TaxonomyField[] {
  return fields.filter((f): f is TaxonomyField => f.t === 'taxonomy');
}

/** Vai trò của một field. Vắng = Danh mục — hành vi của mọi field có trước ngày này. */
export const roleOf = (f: Pick<TaxonomyField, 'role'> | undefined): TaxonomyRole =>
  f?.role === 'tag' ? 'tag' : 'category';

/**
 * Field mà một mục phân loại thuộc về. `fieldKey` null = field đầu tiên. Khoá trỏ tới một
 * field đã bị xoá khỏi cấu trúc → `undefined` (mục mồ côi: vẫn liên kết, không ô nào hiện).
 */
export function fieldOfTaxonomy(
  fields: readonly FieldDef[],
  fieldKey: string | null | undefined,
): TaxonomyField | undefined {
  const tax = taxonomyFieldsOf(fields);
  if (!fieldKey) return tax[0];
  return tax.find((f) => f.key === fieldKey);
}

/** Mục này có thuộc field `field` không. */
export function inPool(
  fields: readonly FieldDef[],
  field: TaxonomyField,
  taxonomyFieldKey: string | null | undefined,
): boolean {
  return fieldOfTaxonomy(fields, taxonomyFieldKey)?.key === field.key;
}

/** Vai trò của một mục phân loại. Mồ côi → Danh mục (hành vi cũ). */
export const taxonomyRole = (fields: readonly FieldDef[], fieldKey: string | null | undefined): TaxonomyRole =>
  roleOf(fieldOfTaxonomy(fields, fieldKey));

/**
 * Điều kiện `where` (Prisma) cho "mục thuộc một trong các field này".
 *
 * Trả `null` khi không có field nào khớp — bên gọi phải coi đó là "không có mục nào", vì
 * `{}` nghĩa là KHÔNG LỌC và sẽ trả cả danh sách.
 */
export function poolWhere(
  fields: readonly FieldDef[],
  pick: (f: TaxonomyField) => boolean,
): { OR: ({ fieldKey: { in: string[] } } | { fieldKey: null })[] } | null {
  const tax = taxonomyFieldsOf(fields);
  const keys = tax.filter(pick).map((f) => f.key);
  if (!keys.length) return null;
  const or: ({ fieldKey: { in: string[] } } | { fieldKey: null })[] = [{ fieldKey: { in: keys } }];
  // Hàng cũ (`fieldKey` null) thuộc field ĐẦU TIÊN.
  if (tax[0] && pick(tax[0])) or.push({ fieldKey: null });
  return { OR: or };
}

/**
 * Kiểm `required` và `multiple: false` theo TỪNG field.
 *
 * `picked` là các mục bài đang gắn, kèm `fieldKey`. Truyền chuỗi id trần (đường cũ, và
 * test) thì mọi id được coi là của field đầu tiên.
 */
export function checkTaxonomyPicks(
  fields: readonly FieldDef[],
  picked: readonly (string | { id: string; fieldKey: string | null })[] | undefined,
): { ok: true } | { ok: false; error: string } {
  const tax = taxonomyFieldsOf(fields);
  if (!tax.length) return { ok: true };
  const rows = (picked ?? []).map((p) => (typeof p === 'string' ? { id: p, fieldKey: null } : p));
  const countOf = (f: TaxonomyField) =>
    new Set(rows.filter((r) => inPool(fields, f, r.fieldKey)).map((r) => r.id)).size;

  const missing = tax.filter((f) => f.required === true && countOf(f) === 0);
  if (missing.length) {
    const labels = missing.map((f) => `"${f.label}"`).join(', ');
    return {
      ok: false,
      error:
        tax.length > 1
          ? `Phải chọn ít nhất một mục cho ${labels}`
          : 'Phải chọn ít nhất một danh mục',
    };
  }
  const tooMany = tax.find((f) => f.multiple === false && countOf(f) > 1);
  if (tooMany) return { ok: false, error: `"${tooMany.label}" chỉ được chọn một mục` };
  return { ok: true };
}
