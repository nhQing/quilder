/**
 * `zStyleProps` → bản đọc được cho người và cho model: nhóm nào có field nào, và
 * mỗi field nhận giá trị hình dạng gì.
 *
 * ## Vì sao phải có, và vì sao SUY RA chứ không viết tay
 *
 * Sự cố 07/09/2026: một agent cần làm mờ nền phía sau một node, thử bốn đường —
 * `fill.blur`, `backdrop.blur`, `effect.backdropBlur`, `fill.backdropBlur` — tất
 * cả bị từ chối là `unrecognized key`, rồi nó kết luận builder THIẾU tính năng và
 * đề xuất xây lại. Đường đúng là `effects.backdropBlur`, đã tồn tại từ đầu, và
 * compiler còn phát cả bản `-webkit-`. Chi phí không nằm ở dòng code nào.
 *
 * `get_node_schema` trước đó nói được field bắt buộc của từng node type nhưng
 * không nói gì về hình dạng `style` ngoài một câu "ResponsiveStyle: { base, sm,
 * ... }". Với một agent chỉ nối MCP — máy khác, không có repo — mọi thứ tầng tool
 * không nói là thứ nó sẽ đoán.
 *
 * Bảng này SUY RA từ `zStyleProps` chứ không chép tay, vì bản chép tay sẽ trôi và
 * bản trôi thì tệ hơn không có: nó nói sai một cách tự tin. `extra-fields.ts` đã
 * là một bản chép tay (nó phải chép, vì LOẠI ĐIỀU KHIỂN không suy ra được từ
 * schema) và nó cần cả một test duyệt schema thật để canh. Ở đây không cần chọn
 * điều khiển nào, nên không cần chép.
 *
 * ## Vì sao không dùng zodToJsonSchema
 *
 * Cùng lý do như `get_node_schema`: `zStyleProps` nhúng union đệ quy cho `Len`,
 * `ColorValue`, `CalcOp`, và bản JSON Schema tự chứa của nó là hàng chục nghìn
 * dòng — xem `apply_ops` và `json-schema.ts` (7,26 MB, làm chết context mọi
 * phiên). Ở đây cần một dòng cho mỗi field, không cần bản đặc tả đầy đủ.
 */

import { z } from 'zod';

import { zStyleProps } from './schema';

/** Cởi `.optional()` / `.nullable()` cho tới khi gặp kiểu thật. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let cur = schema;
  for (let i = 0; i < 8; i += 1) {
    const inner = (cur as unknown as { unwrap?: () => z.ZodTypeAny }).unwrap?.();
    if (!inner) return cur;
    cur = inner;
  }
  return cur;
}

/**
 * Tên gọn cho hình dạng một object có kiểu.
 *
 * Nhận diện theo TẬP KHOÁ chứ không theo tên biến Zod: `zLen` và `zColor` là
 * union, nên nhánh của chúng đến đây dưới dạng object trần không mang tên nào.
 */
function objectName(shape: Record<string, z.ZodTypeAny>): string {
  const keys = Object.keys(shape).sort().join(',');
  const known: Record<string, string> = {
    $token: '{$token:"<tên token>"}',
    'u,v': '{v:<số>,u:"px"|"rem"|"%"|"vw"|"vh"|"svh"|"ch"|"em"}',
    hex: '{hex:"#rrggbb"}',
    clamp: '{clamp:{min,preferred,max}}',
    calc: '{calc:[...]}',
  };
  return known[keys] ?? `{${Object.keys(shape).join(',')}}`;
}

/** Một dòng mô tả giá trị mà field nhận. */
function describe(schema: z.ZodTypeAny, depth = 0): string {
  const s = unwrap(schema);

  if (s instanceof z.ZodEnum) return (s.options as string[]).map((o) => `"${o}"`).join(' | ');
  if (s instanceof z.ZodLiteral) return JSON.stringify(s.value);
  if (s instanceof z.ZodBoolean) return 'boolean';
  if (s instanceof z.ZodNumber) return 'number';
  if (s instanceof z.ZodString) return 'string';

  if (s instanceof z.ZodArray) {
    return depth > 2 ? 'mảng' : `mảng ${describe(s.element as z.ZodTypeAny, depth + 1)}`;
  }

  if (s instanceof z.ZodUnion) {
    // Bỏ trùng: `Len` có nhiều nhánh cùng ra `{v,u}` sau khi cởi vỏ.
    const parts = (s.options as z.ZodTypeAny[]).map((o) => describe(o, depth + 1));
    return [...new Set(parts)].join(' | ');
  }

  if (s instanceof z.ZodObject) {
    const shape = (s as z.ZodObject<z.ZodRawShape>).shape;
    // Sâu quá thì chỉ nêu tên khoá — bản đầy đủ là thứ làm nổ context.
    return depth > 1 ? objectName(shape) : objectName(shape);
  }

  return 'xem schema';
}

export interface StyleShape {
  /** `{ nhóm: { field: mô tả giá trị } }` — khoá đúng cách `setStyle.patch` gọi. */
  groups: Record<string, Record<string, string>>;
  /**
   * Thuộc tính cấp CAO NHẤT — giá trị của nó không phải một object có field.
   *
   * ## Vì sao mục này phải tồn tại
   *
   * Vòng duyệt bên dưới từng có một dòng `if (!(entry instanceof z.ZodObject))
   * continue;`. `shadow` là một UNION (`TokenRef | Shadow[]`), nên nó rơi vào
   * đúng dòng đó và BIẾN MẤT khỏi mọi thứ bảng này phục vụ: `get_node_schema`
   * không nhắc tới nó, và `nearestStylePaths` không gợi ý được nó.
   *
   * Hậu quả đo được: đội `Website-MM` kết luận ngày 11/09/2026 rằng "bộ token có
   * 2 token shadow nhưng `style.groups` không có field nào để áp chúng — phải đi
   * qua `customCss`". Cả hai vế đều sai: `StyleProps.shadow` có từ đầu, nhận
   * thẳng `{ $token }`, và compiler phát ra `box-shadow`. Chỉ có bảng này không
   * nói ra.
   *
   * Đây là ĐÚNG sự cố mà docblock đầu file kể về `effects.backdropBlur`, lặp lại
   * với một field khác — và lần này chính cơ chế sinh ra để chống nó lại là chỗ
   * giấu đi.
   */
  props: Record<string, string>;
  /**
   * Mọi khoá hợp lệ, phẳng, đã sắp — dùng để gợi khoá gần nhất.
   *
   * Gồm cả `nhóm.field` lẫn tên thuộc tính cấp cao nhất (`shadow`), vì cả hai đều
   * là khoá hợp lệ của `setStyle.patch`.
   */
  paths: string[];
}

let cached: StyleShape | null = null;

/**
 * Hình dạng `style`, tính một lần rồi giữ.
 *
 * Duyệt Zod không đắt, nhưng nó chạy trên mỗi lần gọi `get_node_schema` và trên
 * mỗi câu từ chối `unrecognized key` — và kết quả không bao giờ đổi trong một
 * tiến trình, vì `zStyleProps` là hằng.
 */
export function styleShape(): StyleShape {
  if (cached) return cached;

  const shape = (zStyleProps as unknown as z.ZodObject<z.ZodRawShape>).shape;
  const groups: Record<string, Record<string, string>> = {};
  const props: Record<string, string> = {};
  const paths: string[] = [];

  for (const groupName of Object.keys(shape).sort()) {
    const entry = unwrap(shape[groupName]!);

    // Không phải object thì nó là một thuộc tính cấp cao nhất, không phải một
    // nhóm. Bỏ qua nó là cách `shadow` biến mất — xem `StyleShape.props`.
    if (!(entry instanceof z.ZodObject)) {
      props[groupName] = describe(entry);
      paths.push(groupName);
      continue;
    }

    const fields: Record<string, string> = {};
    const inner = (entry as z.ZodObject<z.ZodRawShape>).shape;
    for (const field of Object.keys(inner).sort()) {
      fields[field] = describe(inner[field]!);
      paths.push(`${groupName}.${field}`);
    }
    groups[groupName] = fields;
  }

  cached = { groups, props, paths: paths.sort() };
  return cached;
}

/* ── Gợi khoá gần nhất ────────────────────────────────────────────────── */

/** Khoảng cách Levenshtein, đủ cho danh sách vài trăm khoá. */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let last = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j]!;
      prev[j] = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * `nhóm.field` gần nhất với một khoá gõ sai.
 *
 * So trên CẢ đường dẫn và trên riêng tên field: hai kiểu sai khác nhau cần hai
 * phép so. `fill.backdropBlur` sai NHÓM — tên field đúng hoàn toàn — còn
 * `effects.backdropBlurr` sai tên field. Chỉ so cả đường dẫn thì ca thứ nhất phải
 * vượt khoảng cách 4 ký tự ("fill" → "effects") và thường bị trần cắt mất.
 *
 * Trần 5 là để câu gợi ý không bịa: gõ `zzz` thì không có "ý bạn là" nào cả, và
 * nói "không có khoá này" là câu trả lời đúng.
 */
export function nearestStylePaths(bad: string, limit = 3): string[] {
  const { paths } = styleShape();
  const wanted = bad.toLowerCase();
  const field = wanted.includes('.') ? wanted.slice(wanted.lastIndexOf('.') + 1) : wanted;

  const scored = paths
    .map((p) => {
      const lower = p.toLowerCase();
      const own = lower.slice(lower.indexOf('.') + 1);
      return { path: p, score: Math.min(distance(wanted, lower), distance(field, own)) };
    })
    .filter((s) => s.score <= 5)
    .sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));

  return scored.slice(0, limit).map((s) => s.path);
}
