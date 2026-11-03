/**
 * Khối "Form" của Inspector — phần thuần: thêm/bớt/sắp ô, đổi tham số, chế độ "Sau khi gửi".
 *
 * ## Vì sao ở file riêng
 *
 * Cùng lý lẽ với `endpoint-options.ts`: hàm thuần không import store hay component, nên
 * test không phải dựng gì. `FormPanel.tsx` chỉ còn phần vẽ và một lần `dispatch`.
 *
 * ## Hai luật mọi hàm ghi ở đây đều giữ
 *
 *  1. **Trải params THÔ cũ.** `setProps` THAY cả key `params`, không gộp — gửi `{ fields }`
 *     trần là xoá sạch nơi nhận, chữ nút và thông báo. Khoá schema không biết cũng giữ
 *     nguyên: ta không phải bên quyết định nó thừa.
 *  2. **Không bao giờ trả params hỏng.** Kết quả đi qua `parseFormParamsStrict`; hỏng thì
 *     trả `{ ok:false, issues }` (có đường dẫn) để sidebar báo cạnh ô gây lỗi. Ghi params
 *     hỏng thì `.catch` của renderer đưa CẢ form về mặc định một cách im lặng — form trên
 *     site mất hết ô nhập mà không ai thấy lỗi nào.
 */

import { blankNode } from '@/lib/builder/node-actions';
import { toSlug } from '@/lib/builder/slug';
import {
  parseFormParamsStrict,
  type AfterSubmit,
  type FormFieldDef,
  type FormParamsIssue,
} from '@/lib/composites/registry';
import type { Op } from '@/lib/doc/ops';
import type { CompositeNode, Node, NodeId } from '@/lib/doc/types';

export type FieldKind = FormFieldDef['kind'];
type Raw = Record<string, unknown>;
type RawField = Record<string, unknown> & { name: string };

export type FormEdit = { ok: true; params: Raw } | { ok: false; issues: FormParamsIssue[] };

/** Nhãn của loại ô trong sidebar, và nhãn mặc định của ô mới loại đó. */
export const FIELD_KINDS: { kind: FieldKind; label: string; defaultLabel: string }[] = [
  { kind: 'text', label: 'Chữ', defaultLabel: 'Họ và tên' },
  { kind: 'email', label: 'Email', defaultLabel: 'Email' },
  { kind: 'tel', label: 'Số điện thoại', defaultLabel: 'Số điện thoại' },
  { kind: 'number', label: 'Số', defaultLabel: 'Số' },
  { kind: 'textarea', label: 'Đoạn văn', defaultLabel: 'Lời nhắn' },
  { kind: 'select', label: 'Danh sách chọn', defaultLabel: 'Chọn một mục' },
  { kind: 'checkbox', label: 'Ô đánh dấu', defaultLabel: 'Tôi đồng ý' },
];

/** `autocomplete` mặc định — trình duyệt điền sẵn đúng thứ khách đã lưu. */
const AUTOCOMPLETE: Partial<Record<FieldKind, string>> = { email: 'email', tel: 'tel' };

/** Lựa chọn mặc định của một danh sách chọn mới — select rỗng không qua schema. */
export const DEFAULT_OPTIONS = [
  { value: 'lua_chon_1', label: 'Lựa chọn 1' },
  { value: 'lua_chon_2', label: 'Lựa chọn 2' },
];

function isRecord(raw: unknown): raw is Raw {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

function rawOf(params: unknown): Raw {
  return isRecord(params) ? params : {};
}

/**
 * Ô nhập HIỆN TẠI, dạng thô. Params chưa có `fields` thì renderer đang hiện ô mặc định —
 * lấy đúng ô đó làm điểm xuất phát, không phải mảng rỗng (thêm một ô vào mảng rỗng là
 * âm thầm xoá ô email người dùng đang thấy trên canvas).
 */
export function fieldsOf(params: unknown): RawField[] {
  const raw = rawOf(params);
  if (Array.isArray(raw.fields)) return raw.fields.filter(isRecord) as RawField[];
  const parsed = parseFormParamsStrict({});
  return parsed.ok ? (parsed.params.fields as unknown as RawField[]) : [];
}

function finish(next: Raw): FormEdit {
  const r = parseFormParamsStrict(next);
  return r.ok ? { ok: true, params: next } : { ok: false, issues: r.issues };
}

function fail(path: string, message: string): FormEdit {
  return { ok: false, issues: [{ path, message }] };
}

/**
 * Tên duy nhất từ loại: `email`, `email_2`, `email_3`…
 *
 * Gạch dưới chứ không gạch ngang: tên trường gửi lên BE theo bộ ký tự `^[a-z][a-z0-9_]*$`
 * (xem `formField.name`), cùng quy ước với khoá field của collection.
 */
export function uniqueFieldName(fields: { name: string }[], base: string): string {
  const taken = new Set(fields.map((f) => f.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const name = `${base}_${i}`;
    if (!taken.has(name)) return name;
  }
}

export function addField(params: unknown, kind: FieldKind): FormEdit {
  const fields = fieldsOf(params);
  const meta = FIELD_KINDS.find((k) => k.kind === kind);
  if (!meta) return fail('fields', `Loại ô không hợp lệ: ${kind}`);
  const field: RawField = {
    name: uniqueFieldName(fields, kind),
    kind,
    label: meta.defaultLabel,
    required: false,
    ...(AUTOCOMPLETE[kind] ? { autocomplete: AUTOCOMPLETE[kind] } : {}),
    ...(kind === 'select' ? { options: DEFAULT_OPTIONS.map((o) => ({ ...o })) } : {}),
  };
  return finish({ ...rawOf(params), fields: [...fields, field] });
}

export function removeField(params: unknown, name: string): FormEdit {
  const fields = fieldsOf(params);
  if (!fields.some((f) => f.name === name)) return fail('fields', `Không có ô "${name}".`);
  if (fields.length <= 1) return fail('fields', 'Form cần ít nhất một ô — thêm ô khác trước khi bỏ ô này.');
  return finish({ ...rawOf(params), fields: fields.filter((f) => f.name !== name) });
}

export function moveField(params: unknown, from: number, to: number): FormEdit {
  const fields = [...fieldsOf(params)];
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < fields.length;
  if (!inRange(from) || !inRange(to)) return fail('fields', 'Vị trí ô không hợp lệ.');
  const [moved] = fields.splice(from, 1);
  fields.splice(to, 0, moved!);
  return finish({ ...rawOf(params), fields });
}

/**
 * Sửa một ô theo tên. `undefined` trong `patch` là GỠ khoá (xoá chữ gợi ý, bỏ lựa chọn khi
 * đổi khỏi loại select) — giữ một chuỗi rỗng lại là lỗi schema (`label` min 1) hoặc một ô
 * gợi ý trống vô nghĩa.
 */
export function updateField(
  params: unknown,
  name: string,
  patch: Partial<Omit<FormFieldDef, 'name'>>,
): FormEdit {
  const fields = fieldsOf(params);
  const index = fields.findIndex((f) => f.name === name);
  if (index < 0) return fail('fields', `Không có ô "${name}".`);
  const next: RawField = { ...fields[index]! };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return finish({ ...rawOf(params), fields: fields.map((f, i) => (i === index ? next : f)) });
}

/** Tham số chữ của form mà sidebar sửa trực tiếp. */
export type FormTextParam = 'submitLabel' | 'successMessage' | 'errorMessage' | 'successPanel' | 'a11yLabel';

/** Trường KHÔNG bắt buộc: chuỗi rỗng nghĩa là gỡ khoá, không phải giá trị rỗng. */
const OPTIONAL: ReadonlySet<FormTextParam> = new Set(['successPanel', 'a11yLabel']);

export function setFormParam(params: unknown, key: FormTextParam, value: string): FormEdit {
  const next = { ...rawOf(params) };
  if (value === '' && OPTIONAL.has(key)) delete next[key];
  else next[key] = value;
  return finish(next);
}

/** `autocomplete` mặc định của một loại ô (đổi loại thì đổi theo, không giữ `email` cho ô số). */
export function defaultAutocomplete(kind: FieldKind): string | undefined {
  return AUTOCOMPLETE[kind];
}

/* ── Lựa chọn của danh sách chọn, dạng chữ ────────────────────────── */

type Option = { value: string; label: string };

/** Giá trị gửi lên suy từ nhãn: bỏ dấu, `a-z0-9_` — "Quỹ mở" → `quy_mo`. */
function optionValue(label: string): string {
  return toSlug(label).replace(/-/g, '_');
}

/**
 * Ô "Lựa chọn" của sidebar: mỗi dòng một mục. Dòng thường là NHÃN (giá trị suy ra);
 * `giá trị | nhãn` khi BE cần một giá trị riêng. Dòng trống bỏ qua.
 *
 * Chuỗi rỗng ra mảng rỗng — KHÔNG tự bịa lựa chọn: schema sẽ báo `fields.N.options` và
 * sidebar hiện lỗi cạnh ô, đúng thứ người dùng cần biết.
 */
export function optionsFromText(text: string): Option[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const bar = line.indexOf('|');
      if (bar >= 0) return { value: line.slice(0, bar).trim(), label: line.slice(bar + 1).trim() };
      return { value: optionValue(line) || `lua_chon_${i + 1}`, label: line };
    });
}

/**
 * Đọc lại ô "Lựa chọn" so với lựa chọn ĐANG CÓ — sửa nhãn không được đổi giá trị gửi lên.
 *
 * Giá trị là thứ BE lưu; đổi nó vì người dựng sửa chính tả nhãn là làm dữ liệu cũ và mới
 * lệch nhau mà không ai thấy. Thứ tự khớp:
 *
 *  1. Dòng `giá trị | nhãn` → đúng giá trị đó (khớp lựa chọn cũ cùng giá trị nếu có).
 *  2. Dòng trùng NHÃN một lựa chọn cũ chưa dùng → giữ giá trị của nó (dòng bị đảo chỗ).
 *  3. Dòng còn lại mà lựa chọn cũ ở CÙNG VỊ TRÍ chưa được dòng nào nhận → giữ giá trị đó
 *     (sửa nhãn tại chỗ).
 *  4. Còn lại là dòng mới → suy giá trị từ nhãn, thêm hậu tố nếu trùng.
 *
 * `map[chỉ số cũ] = chỉ số mới | null` — để bản dịch `fields.N.options.M.*` đi theo dòng.
 */
export function reconcileOptions(
  text: string,
  prev: readonly Option[] | undefined,
): { options: Option[]; map: (number | null)[] } {
  const old = prev ?? [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const parsed = lines.map((line) => {
    const bar = line.indexOf('|');
    return bar >= 0
      ? { explicit: line.slice(0, bar).trim(), label: line.slice(bar + 1).trim() }
      : { explicit: null as string | null, label: line };
  });

  const from: (number | null)[] = parsed.map(() => null);
  const used = new Set<number>();
  const claim = (line: number, oldIndex: number) => {
    from[line] = oldIndex;
    used.add(oldIndex);
  };
  // 1 + 2: khớp theo giá trị tường minh, rồi theo nhãn.
  parsed.forEach((p, i) => {
    const j = p.explicit !== null
      ? old.findIndex((o, k) => !used.has(k) && o.value === p.explicit)
      : old.findIndex((o, k) => !used.has(k) && o.label === p.label);
    if (j >= 0) claim(i, j);
  });
  // 3: sửa nhãn tại chỗ.
  parsed.forEach((p, i) => {
    if (from[i] === null && p.explicit === null && i < old.length && !used.has(i)) claim(i, i);
  });

  const taken = new Set<string>();
  for (const [i, p] of parsed.entries()) {
    if (p.explicit !== null) taken.add(p.explicit);
    else if (from[i] !== null) taken.add(old[from[i]!]!.value);
  }
  const options = parsed.map((p, i) => {
    if (p.explicit !== null) return { value: p.explicit, label: p.label };
    if (from[i] !== null) return { value: old[from[i]!]!.value, label: p.label };
    // 4: dòng mới.
    const base = optionValue(p.label) || `lua_chon_${i + 1}`;
    let value = base;
    for (let n = 2; taken.has(value); n++) value = `${base}_${n}`;
    taken.add(value);
    return { value, label: p.label };
  });

  const map: (number | null)[] = old.map(() => null);
  from.forEach((j, i) => {
    if (j !== null) map[j] = i;
  });
  return { options, map };
}

/* ── Bản dịch đi theo ô ───────────────────────────────────────────── */

/**
 * Bản dịch chữ trong params được đánh địa chỉ theo CHỈ SỐ (`param:fields.2.label`, xem
 * `render/param-paths.ts`). Kéo hay bỏ một ô thì chỉ số đổi, và bản tiếng Anh của ô 0 sẽ
 * nằm lên ô khác đang đứng ở chỗ 0. Ba hàm dưới đây tính chỗ mới; `FormPanel` ghi lại
 * qua đường ghi bản dịch có sẵn (`/api/translations`) sau khi op đã lưu.
 */

/** `map[chỉ số cũ] = chỉ số mới | null` (bị bỏ), so theo TÊN ô — tên là định danh bền. */
export function fieldIndexMap(before: unknown, after: unknown): (number | null)[] {
  const next = fieldsOf(after).map((f) => f.name);
  return fieldsOf(before).map((f) => {
    const i = next.indexOf(f.name);
    return i >= 0 ? i : null;
  });
}

/**
 * Hàm đổi đường dẫn params: `fields.N.…` theo `fieldMap`, `fields.N.options.M.…` thêm theo
 * `optionMaps[N cũ]`. Trả `null` khi ô/lựa chọn đã bị bỏ; đường ngoài `fields` giữ nguyên.
 */
export function paramPathRemapper(
  fieldMap: readonly (number | null)[],
  optionMaps: Readonly<Record<number, readonly (number | null)[]>>,
): (path: string) => string | null {
  return (path) => {
    const m = /^fields\.(\d+)(?:\.(.*))?$/.exec(path);
    if (!m) return path;
    const oldField = Number(m[1]);
    const newField = oldField < fieldMap.length ? fieldMap[oldField] : oldField;
    if (newField === null || newField === undefined) return null;
    let rest = m[2] ?? '';
    const opt = /^options\.(\d+)(\..*)?$/.exec(rest);
    const omap = optionMaps[oldField];
    if (opt && omap) {
      const oldOpt = Number(opt[1]);
      const newOpt = oldOpt < omap.length ? omap[oldOpt] : oldOpt;
      if (newOpt === null || newOpt === undefined) return null;
      rest = `options.${newOpt}${opt[2] ?? ''}`;
    }
    return rest ? `fields.${newField}.${rest}` : `fields.${newField}`;
  };
}

export interface TranslationRow { locale: string; field: string; value: unknown }

/**
 * Những gì phải ghi vào bảng bản dịch: `upserts` (giá trị cũ đặt vào chỗ mới) rồi
 * `deletes` (chỗ cũ không còn ai dời vào). Đích vừa ghi KHÔNG bao giờ nằm trong `deletes`
 * — hoán đổi hai ô là hai lần ghi đè, không có lần xoá nào.
 */
export function translationRemapPlan(
  rows: readonly TranslationRow[],
  remap: (path: string) => string | null,
): { upserts: TranslationRow[]; deletes: { locale: string; field: string }[] } {
  const PREFIX = 'param:';
  const upserts: TranslationRow[] = [];
  const moved: { locale: string; field: string }[] = [];
  for (const row of rows) {
    if (!row.field.startsWith(PREFIX)) continue;
    const path = row.field.slice(PREFIX.length);
    const next = remap(path);
    if (next === path) continue;
    moved.push({ locale: row.locale, field: row.field });
    if (next !== null) upserts.push({ locale: row.locale, field: PREFIX + next, value: row.value });
  }
  const targets = new Set(upserts.map((u) => `${u.locale}|${u.field}`));
  const deletes = moved.filter((m) => !targets.has(`${m.locale}|${m.field}`));
  return { upserts, deletes };
}

/** Ngược của `optionsFromText`: chỉ viết `giá trị | nhãn` khi giá trị KHÔNG suy được từ nhãn. */
export function optionsToText(options: readonly Option[] | undefined): string {
  return (options ?? [])
    .map((o) => (o.value === optionValue(o.label) ? o.label : `${o.value} | ${o.label}`))
    .join('\n');
}

/* ── Sau khi gửi ──────────────────────────────────────────────────── */

/** Nội dung mặc định của hai slot hộp thoại — trung tính, không riêng dự án nào. */
const DIALOG_SEED = {
  success: { name: 'Hộp thoại · thành công', title: 'Đã gửi thành công', body: 'Cảm ơn bạn, chúng tôi sẽ liên hệ sớm.' },
  error: { name: 'Hộp thoại · thất bại', title: 'Chưa gửi được', body: 'Bạn kiểm tra kết nối rồi thử lại giúp.' },
} as const;

function textNode(id: NodeId, parentId: NodeId, tag: 'h3' | 'p', name: string, text: string): Node {
  return {
    ...(blankNode('Text', id, parentId) as Extract<Node, { type: 'Text' }>),
    tag,
    name,
    content: [{ t: 'text', v: text }],
  } as Node;
}

/**
 * Op để đổi chế độ báo kết quả.
 *
 * Chọn `dialog` mà slot `success`/`error` còn trống thì DỰNG SẴN nội dung (khung Stack +
 * tiêu đề h3 + một dòng chữ): hộp thoại rỗng mở ra sau khi khách bấm gửi là tệ hơn dòng
 * chữ cũ. Mọi thứ nằm trong CÙNG MỘT mảng op với `setProps` — một lần undo gỡ cả chế độ
 * lẫn nội dung vừa dựng, và không có lúc nào params trỏ `dialog` mà slot chưa có.
 *
 * Node slot là CON THẬT của Composite (`insertNode` vào chính form): `slots` chỉ là bảng
 * định tuyến, còn bất biến cấu trúc đòi mọi node nằm trong `children` của cha nó.
 *
 * Slot đã có nội dung thì giữ nguyên — người dùng đã thiết kế nó, chuyển qua lại giữa các
 * chế độ không được xoá công đó.
 *
 * `nodes`: các node ĐANG CÓ trong doc. `removeNode` không dọn id trong `slots`, nên một slot
 * "có id" mà node đã bị xoá thật ra là slot TRỐNG — đếm theo độ dài thì hộp thoại mở ra
 * rỗng. Id chết bị lọc khỏi mọi slot trước khi quyết, và không được ghi lại.
 */
export function setAfterSubmitOps(
  node: CompositeNode,
  mode: AfterSubmit,
  newId: () => NodeId,
  nodes: Readonly<Record<NodeId, unknown>>,
): { ok: true; ops: Op[] } | { ok: false; issues: FormParamsIssue[] } {
  const next = { ...rawOf(node.params), afterSubmit: mode };
  const checked = parseFormParamsStrict(next);
  if (!checked.ok) return { ok: false, issues: checked.issues };

  const ops: Op[] = [];
  const slots: Record<string, NodeId[]> = {};
  let stale = false;
  for (const [key, ids] of Object.entries(node.slots)) {
    const alive = ids.filter((id) => Object.hasOwn(nodes, id));
    if (alive.length !== ids.length) stale = true;
    slots[key] = alive;
  }
  let index = node.children.length;

  if (mode === 'dialog') {
    for (const slot of ['success', 'error'] as const) {
      if (slots[slot]?.length) continue;
      const seed = DIALOG_SEED[slot];
      const boxId = newId();
      const box = { ...blankNode('Stack', boxId, node.id), name: seed.name } as Node;
      ops.push(
        { op: 'insertNode', parentId: node.id, index: index++, node: box },
        { op: 'insertNode', parentId: boxId, index: 0, node: textNode(newId(), boxId, 'h3', 'Tiêu đề', seed.title) },
        { op: 'insertNode', parentId: boxId, index: 1, node: textNode(newId(), boxId, 'p', 'Lời nhắn', seed.body) },
      );
      slots[slot] = [boxId];
    }
  }

  const slotsChanged = ops.length > 0;
  ops.push({
    op: 'setProps',
    nodeId: node.id,
    props: slotsChanged || stale || mode === 'dialog' ? { params: next, slots } : { params: next },
  });
  return { ok: true, ops };
}

/* ── Xem trước trên canvas ────────────────────────────────────────── */

export type FormPreview = 'form' | 'success' | 'error';

/** Id đi thẳng vào selector — chỉ nhận bộ ký tự `freshId` sinh ra, phần còn lại bỏ. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * CSS mà Canvas chèn vào khung xem trước để hiện nội dung slot hộp thoại TẠI CHỖ.
 *
 * Form chỉ render khối `.mm-form__preview` (ẩn bằng `hidden`) khi chạy trong khung của
 * builder — xem `canvasPreview` của `Form`. CSS này bật đúng khối của đúng node và ẩn
 * `<form>` của nó; site thật không có khối đó nên không có gì để bật.
 *
 * `:has()` khi ẩn form: form đã đổi khỏi chế độ hộp thoại thì không còn khối xem trước,
 * và luật này tự thôi tác dụng thay vì để lại một form vô hình.
 */
export function formPreviewCss(preview: Record<NodeId, FormPreview>): string {
  return Object.entries(preview)
    .filter(([id, v]) => v !== 'form' && SAFE_ID.test(id))
    .map(([id, v]) => {
      const root = `[data-n="${id}"] > .mm-form-root`;
      return (
        `${root}:has(> .mm-form__preview[data-preview="${v}"]) > .mm-form { display: none !important; }\n`
        + `${root} > .mm-form__preview[data-preview="${v}"] { display: block !important; }`
      );
    })
    .join('\n');
}
