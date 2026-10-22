/**
 * Trạng thái của form nhập entry — THUẦN.
 *
 * ## Vì sao không sống trong component
 *
 * Form của một loại có `group` repeatable và `blocks` là một cây, và mọi thao tác
 * (gõ vào một ô sâu ba tầng, thêm khối, đổi thứ tự) là một phép biến đổi trên cây
 * đó. Viết chúng trong `useState` của một component nghĩa là chúng chỉ kiểm được
 * bằng cách bấm chuột — và lỗi nặng nhất ở đây (clone cạn làm hai mục cạnh nhau
 * dùng chung tham chiếu) chỉ lộ ra khi có mục thứ hai.
 *
 * Không `server-only`: đây là module của client.
 */

import type { FieldDef, GroupTable } from './field-def';

export type FormPath = (string | number)[];

/**
 * Giá trị khởi tạo cho một field.
 *
 * KHÔNG bao giờ trả `undefined` cho field có control: input React nhảy giữa
 * controlled và uncontrolled sẽ mất con trỏ giữa lúc gõ, và React chỉ cảnh báo ở
 * console — nơi người viết nội dung không bao giờ mở.
 */
export function emptyValue(f: Exclude<FieldDef, { t: 'taxonomy' }>, groups: GroupTable): unknown {
  switch (f.t) {
    case 'text':
    case 'slug':
      return '';
    case 'richtext':
      // Một đoạn rỗng, không phải mảy rỗng: mảy rỗng thì không có chỗ đặt con trỏ.
      return [{ t: 'text', v: '' }];
    case 'richdoc':
      // Cùng lý do, một tầng nữa: `zRichDoc` có `.min(1)` nên `[]` bị từ chối
      // ngay lúc lưu, và một khối `p` rỗng là thứ ô soạn cần để có chỗ gõ.
      return [{ b: 'p', children: [{ t: 'text', v: '' }] }];
    case 'html':
      // Chuỗi rỗng, KHÔNG phải `'<p></p>'`: CKEditor tự dựng đoạn đầu tiên khi nhận
      // dữ liệu trống, và một `<p></p>` gửi vào lại làm `required` với `isBlankHtml`
      // nói hai điều khác nhau về cùng một ô chưa gõ.
      return '';
    case 'number':
      return null;
    case 'boolean':
      return f.default ?? false;
    case 'date':
      return null;
    case 'enum':
      // Lựa chọn đầu tiên, không để trống: một `select` không có giá trị hiện ô
      // trống mà người dùng tưởng là một lựa chọn.
      return f.options[0]?.value ?? '';
    case 'image':
      return f.multiple ? [] : null;
    case 'file':
      return null;
    case 'relation':
      return f.cardinality === 'many' ? [] : null;
    case 'link':
      return { href: '', label: '' };
    case 'group': {
      if (f.repeatable) return [];
      const inner = groups[f.groupKey];
      return inner ? emptyEntry(inner, groups) : {};
    }
    case 'blocks':
      return [];
    case 'json':
      return null;
    // Object, không `null`: các ô con của khối SEO đọc `value.metaTitle`, và một ô nhận
    // `undefined` từ `null` là React nhảy sang uncontrolled giữa lúc gõ.
    case 'seo':
      return {};
  }
}

export function emptyEntry(fields: FieldDef[], groups: GroupTable): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    // Field `taxonomy` KHÔNG có chỗ trong `data`: giá trị sống ở bảng `EntryTaxonomy`
    // và được ghi qua `taxonomyIds`. Tạo khoá cho nó ở đây nghĩa là form gửi một khoá
    // mà server strip đi — và người đọc sau sẽ tưởng `data` là nguồn, rồi dựng lại
    // đúng cái lỗi hai-nguồn đã gộp. Cùng luật với `objectSchema` ở entry-data.ts.
    if (f.t === 'taxonomy') continue;
    /*
     * Field `slug` cũng KHÔNG có chỗ ở đây, và cùng một lý do với `taxonomy`: giá trị
     * của nó không do form quyết định. Server suy slug từ `titleField` rồi thêm hậu
     * tố cho tới khi không trùng (`deriveSlug` + `uniqueSlug`) — client không biết
     * những slug đã bị chiếm, nên nó không có gì để gửi.
     *
     * Bỏ qua chứ không gửi `''`. Đây không phải chuyện gọn gàng: `validateEntryData`
     * từ chối slug rỗng, nên một khoá `slug: ''` làm **mọi lần tạo bài qua giao diện**
     * trả 400 `slug: Không được để trống`. Vắng khoá thì server tự suy — đúng đường
     * mà tool MCP và API công khai vẫn đi, và đó là lý do lỗi này sống sót lâu: mọi
     * bài hiện có đều được tạo bằng hai đường đó, không bằng form.
     *
     * Bài ĐÃ CÓ không bị ảnh hưởng: `EntryForm` phủ `props.entry.data` lên trên, và
     * hàng đã lưu luôn mang slug thật.
     */
    if (f.t === 'slug') continue;
    out[f.key] = emptyValue(f as Exclude<FieldDef, { t: 'taxonomy' }>, groups);
  }
  return out;
}

/** Một khối mới trong Dynamic Zone. `__type` luôn có, kể cả khi nhóm mồ côi. */
export function emptyBlock(blockKey: string, groups: GroupTable): Record<string, unknown> {
  const inner = groups[blockKey];
  // Thiếu `__type` thì render không biết khối này là gì, và nó biến mất im lặng.
  return { __type: blockKey, ...(inner ? emptyEntry(inner, groups) : {}) };
}

export function readAt(data: unknown, path: FormPath): unknown {
  let cur: unknown = data;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

/**
 * Clone THEO ĐƯỜNG ĐI, không clone sâu toàn bộ.
 *
 * Clone sâu cả entry mỗi lần gõ một ký tự là copy cả cây `RichText` và mọi khối
 * cho mỗi lần nhấn phím. Clone cạn thì hai mục cạnh nhau dùng chung tham chiếu và
 * sửa mục 0 đổi mục 1 — lỗi chỉ lộ ra khi có mục thứ hai.
 *
 * Nên: clone đúng các nút trên đường đi, giữ nguyên tham chiếu ở mọi nhánh khác.
 */
function cloneAlong(node: unknown, path: FormPath, apply: (leaf: unknown) => unknown): unknown {
  if (path.length === 0) return apply(node);

  const [seg, ...rest] = path;

  if (typeof seg === 'number') {
    const arr = Array.isArray(node) ? [...node] : [];
    arr[seg] = cloneAlong(arr[seg], rest, apply);
    return arr;
  }

  const obj = typeof node === 'object' && node !== null ? { ...(node as Record<string, unknown>) } : {};
  obj[seg as string] = cloneAlong(obj[seg as string], rest, apply);
  return obj;
}

export function writeAt<T extends object>(data: T, path: FormPath, value: unknown): T {
  return cloneAlong(data, path, () => value) as T;
}

export function appendItem<T extends object>(data: T, path: FormPath, item: unknown): T {
  return cloneAlong(data, path, (leaf) => [...(Array.isArray(leaf) ? leaf : []), item]) as T;
}

export function removeItem<T extends object>(data: T, path: FormPath, index: number): T {
  return cloneAlong(data, path, (leaf) => {
    if (!Array.isArray(leaf) || index < 0 || index >= leaf.length) return leaf;
    return leaf.filter((_, i) => i !== index);
  }) as T;
}

export function moveItem<T extends object>(data: T, path: FormPath, index: number, dir: -1 | 1): T {
  return cloneAlong(data, path, (leaf) => {
    if (!Array.isArray(leaf)) return leaf;
    const to = index + dir;
    // Quá biên thì trả nguyên: nút ▲ ở mục đầu phải vô hại, không phải bị ẩn —
    // nút biến mất làm hàng đầu và hàng giữa trông khác nhau không lý do.
    if (index < 0 || to < 0 || index >= leaf.length || to >= leaf.length) return leaf;
    const out = [...leaf];
    [out[index], out[to]] = [out[to], out[index]];
    return out;
  }) as T;
}
