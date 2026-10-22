/**
 * Đường dẫn vào `params` của Composite mà bản dịch được phép chạm.
 *
 * Hàm thuần, không import gì từ builder/render — file này được `text-units`,
 * `translations`, `instance` và schema cùng đọc, nên mọi import ngược sẽ thành vòng.
 *
 * ## Vì sao có một bảng trắng thay vì dịch mọi chuỗi trong params
 *
 * Params trộn chữ hiển thị với thứ KHÔNG ĐƯỢC dịch: `endpointKey`, `fields[i].name`
 * (tên trường gửi lên BE), `fields[i].options[j].value`, `kind`, `autocomplete`,
 * `successPanel`. Dịch nhầm một trong số đó là phá form im lặng. Nên chỉ chữ người đọc
 * thấy mới có tên trong bảng.
 *
 * ## Vì sao đọc params THÔ, không đọc qua schema
 *
 * Schema có `.catch()` + `.default()`: parse params rỗng ra nhãn mặc định
 * ("Đăng ký", "Email của bạn"). Phát đơn vị cho giá trị mặc định tạo ra "đơn vị ma" —
 * hàng trong bảng mà doc không hề chứa, và sửa nó không có chỗ để ghi. Chỉ giá trị
 * THẬT SỰ nằm trong node mới thành đơn vị.
 *
 * ## Vì sao có trần độ dài theo từng đường
 *
 * Schema composite có `.max()` cho mỗi trường và `.catch()` bao ngoài cả object: MỘT
 * chuỗi dịch vượt trần làm cả params rơi về mặc định (mất hết ô nhập). Tiếng Anh
 * thường ngắn hơn tiếng Việt, nhưng không có gì đảm bảo — nên trần được kiểm lúc ghi.
 */

import { projectComposite, projectComposites } from '@/lib/project/active';

/** Tiền tố của họ trường. `param:index.2.label`. */
export const PARAM_FIELD_PREFIX = 'param:';

export type ParamField = `param:${string}`;

/** [mẫu đường dẫn, trần độ dài]. `*` = một chỉ số mảng. Trần khớp `registry.ts`. */
type ParamTemplate = readonly [template: string, max: number];

/**
 * Bảng trắng theo tên composite. MỘT nơi duy nhất — thêm composite/trường dịch được
 * thì thêm dòng ở đây, và nhớ đối chiếu `.max()` trong `composites/registry.ts`.
 */
export const TRANSLATABLE_PARAMS: Record<string, readonly ParamTemplate[]> = {
  Form: [
    ['submitLabel', 80],
    ['successMessage', 300],
    ['errorMessage', 300],
    ['a11yLabel', 120],
    ['fields.*.label', 120],
    ['fields.*.placeholder', 120],
    ['fields.*.help', 200],
    ['fields.*.options.*.label', 120],
  ],
};

export function isParamField(field: string): field is ParamField {
  return field.startsWith(PARAM_FIELD_PREFIX) && field.length > PARAM_FIELD_PREFIX.length;
}

export function paramField(path: string): ParamField {
  return `${PARAM_FIELD_PREFIX}${path}`;
}

/** `param:index.0.label` → `index.0.label`. */
export function paramPathOf(field: ParamField): string {
  return field.slice(PARAM_FIELD_PREFIX.length);
}

const INDEX = /^\d{1,3}$/;

function matches(template: string, path: string): boolean {
  const t = template.split('.');
  const p = path.split('.');
  if (t.length !== p.length) return false;
  return t.every((seg, i) => (seg === '*' ? INDEX.test(p[i]!) : seg === p[i]));
}

/**
 * Trần độ dài của một đường, hoặc `null` nếu không có composite nào cho dịch đường này.
 *
 * Không cần biết composite: các mẫu của những composite khác nhau không trùng nhau
 * (`index.*.label` ≠ `fields.*.label`), và `title`/`a11yLabel` chỉ khác nhau ở chỗ
 * chúng đều có trần ≤ 200.
 */
export function paramMaxLength(path: string): number | null {
  let found: number | null = null;
  for (const list of [...Object.values(TRANSLATABLE_PARAMS), ...projectComposites().map((c) => c.translatableParams ?? [])]) {
    for (const [template, max] of list) {
      if (matches(template, path)) found = found === null ? max : Math.min(found, max);
    }
  }
  return found;
}

/** Đường này có nằm trong bảng trắng của MỘT composite nào đó không. */
export function isKnownParamPath(path: string): boolean {
  return paramMaxLength(path) !== null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Mọi đường dẫn bảng trắng mà `params` THẬT SỰ có một chuỗi không rỗng.
 *
 * Thứ tự: theo từng mẫu của bảng trắng, trong mẫu thì mảng theo chỉ số.
 */
export function listParamPaths(composite: string, params: unknown): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];

  const walk = (value: unknown, segs: string[], at: number, trail: string[]) => {
    if (at === segs.length) {
      if (typeof value === 'string' && value.trim()) out.push({ path: trail.join('.'), text: value });
      return;
    }
    const seg = segs[at]!;
    if (seg === '*') {
      if (!Array.isArray(value)) return;
      value.forEach((item, i) => walk(item, segs, at + 1, [...trail, String(i)]));
      return;
    }
    if (!isRecord(value)) return;
    walk(value[seg], segs, at + 1, [...trail, seg]);
  };

  // Lõi trước, rồi composite của gói dự án (`translatableParams`).
  for (const [template] of [...(TRANSLATABLE_PARAMS[composite] ?? []), ...(projectComposite(composite)?.translatableParams ?? [])]) {
    walk(params, template.split('.'), 0, []);
  }
  return out;
}

/** Nhãn ngắn cho cột "Loại" của bảng Văn bản. */
export function paramKindLabel(path: string): string {
  const seg = path.split('.');
  const n = (i: number) => Number(seg[i]) + 1;
  if (seg[0] === 'index') return `mục lục ${n(1)}`;
  if (seg[0] === 'fields') {
    if (seg[2] === 'options') return `ô ${n(1)} · lựa chọn ${n(3)}`;
    const what: Record<string, string> = { label: 'nhãn', placeholder: 'placeholder', help: 'gợi ý' };
    return `ô ${n(1)} · ${what[seg[2] ?? ''] ?? seg[2]}`;
  }
  const names: Record<string, string> = {
    title: 'tiêu đề',
    submitLabel: 'nút gửi',
    successMessage: 'báo thành công',
    errorMessage: 'báo lỗi',
    a11yLabel: 'a11y form',
  };
  return names[path] ?? path;
}

/**
 * `params` + một đường + giá trị → params MỚI (nhân bản dọc đường đi, không sửa gốc).
 *
 * Params đến từ doc/cây component trong cache dùng chung — sửa tại chỗ là rò rỉ bản
 * dịch sang request của ngôn ngữ khác. Đường không tồn tại thì trả đúng object cũ:
 * bản dịch mồ côi (ô đã bị xoá khỏi form) không được TẠO ra một ô.
 */
export function setParamPath(params: unknown, path: string, value: string): unknown {
  const segs = path.split('.');

  const set = (node: unknown, at: number): unknown => {
    const seg = segs[at]!;
    const last = at === segs.length - 1;

    if (Array.isArray(node)) {
      if (!INDEX.test(seg)) return node;
      const i = Number(seg);
      if (i >= node.length) return node;
      const next = last ? (typeof node[i] === 'string' ? value : node[i]) : set(node[i], at + 1);
      if (next === node[i]) return node;
      const copy = node.slice();
      copy[i] = next;
      return copy;
    }
    if (isRecord(node)) {
      if (!(seg in node)) return node;
      const next = last ? (typeof node[seg] === 'string' ? value : node[seg]) : set(node[seg], at + 1);
      if (next === node[seg]) return node;
      return { ...node, [seg]: next };
    }
    return node;
  };

  return set(params, 0);
}

/**
 * Áp nhiều đường cùng lúc. Trả ĐÚNG object cũ khi không đổi gì.
 *
 * Đường ngoài bảng trắng hoặc chuỗi vượt trần bị BỎ QUA chứ không ném: một chuỗi quá
 * trần làm `.catch()` của composite vứt cả params, mà một bản dịch hỏng không đáng
 * làm form mất hết ô nhập.
 */
export function applyParamMap(params: unknown, map: Record<string, string>): unknown {
  let out = params;
  for (const [path, value] of Object.entries(map)) {
    if (typeof value !== 'string' || !value) continue;
    const max = paramMaxLength(path);
    if (max === null || value.length > max) continue;
    out = setParamPath(out, path, value);
  }
  return out;
}
