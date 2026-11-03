import { describe, expect, it } from 'vitest';

/**
 * Khối "Form" của sidebar — phần thuần.
 *
 * Mọi hàm ghi ở đây sinh params MỚI từ params THÔ cũ (trải ra, vì `setProps` thay cả key)
 * và từ chối bằng `{ ok:false, issues }` khi kết quả không qua `parseFormParamsStrict` —
 * sidebar không bao giờ ghi một bộ params mà `.catch` của renderer sẽ lặng lẽ thay bằng
 * mặc định.
 */

import { apply } from '@/lib/doc/ops';
import { structuralIssues } from '@/lib/doc/structure';
import { zNode } from '@/lib/doc/schema';
import type { CompositeNode, Doc, SectionNode } from '@/lib/doc/types';
import {
  addField,
  fieldIndexMap,
  paramPathRemapper,
  reconcileOptions,
  translationRemapPlan,
  translationRemapSteps,
  formPreviewCss,
  moveField,
  optionsFromText,
  optionsToText,
  removeField,
  setAfterSubmitOps,
  setFormParam,
  updateField,
} from './form-edit';

const RAW = {
  endpointKey: '',
  fields: [{ name: 'email', kind: 'email', label: 'Email', required: true, autocomplete: 'email' }],
  submitLabel: 'Gửi',
  successMessage: 'Đã nhận.',
  errorMessage: 'Chưa gửi được.',
  afterSubmit: 'inline',
  // Khoá lạ mà schema không biết: vẫn phải được giữ nguyên khi ghi.
  extra: 'giu-nguyen',
};

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

function fieldsOf(p: Record<string, unknown>) {
  return p.fields as { name: string; kind: string; label: string; required?: boolean; options?: unknown[] }[];
}

describe('addField', () => {
  it('thêm ô theo loại, tên tự sinh từ loại và giữ mọi tham số khác', () => {
    const r = ok(addField(RAW, 'tel'));
    const fs = fieldsOf(r.params);
    expect(fs.map((f) => f.name)).toEqual(['email', 'tel']);
    expect(fs[1]!.kind).toBe('tel');
    expect(fs[1]!.label).toBe('Số điện thoại');
    expect(r.params.submitLabel).toBe('Gửi');
    expect(r.params.extra).toBe('giu-nguyen');
  });

  it('tên trùng thì đánh số — email, email_2, email_3 (gạch dưới: tên trường chỉ nhận a-z0-9_)', () => {
    const a = ok(addField(RAW, 'email'));
    const b = ok(addField(a.params, 'email'));
    expect(fieldsOf(b.params).map((f) => f.name)).toEqual(['email', 'email_2', 'email_3']);
  });

  it('select mới có sẵn lựa chọn, để không thành menu rỗng', () => {
    const r = ok(addField(RAW, 'select'));
    expect(fieldsOf(r.params)[1]!.options?.length).toBeGreaterThan(0);
  });

  it('params thiếu fields thì bắt đầu từ ô mặc định mà renderer đang hiện', () => {
    const r = ok(addField({ submitLabel: 'Gửi' }, 'text'));
    expect(fieldsOf(r.params)).toHaveLength(2);
  });

  it('quá 12 ô thì từ chối', () => {
    let p: Record<string, unknown> = RAW;
    for (let i = 0; i < 11; i++) p = ok(addField(p, 'text')).params;
    const r = addField(p, 'text');
    expect(r.ok).toBe(false);
  });
});

describe('removeField', () => {
  it('bỏ một ô', () => {
    const two = ok(addField(RAW, 'tel')).params;
    const r = ok(removeField(two, 'email'));
    expect(fieldsOf(r.params).map((f) => f.name)).toEqual(['tel']);
  });

  it('không bỏ được ô cuối — form cần ít nhất một ô', () => {
    const r = removeField(RAW, 'email');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.path).toBe('fields');
  });
});

describe('moveField', () => {
  it('kéo ô cuối lên đầu', () => {
    const three = ok(addField(ok(addField(RAW, 'text')).params, 'tel')).params;
    const r = ok(moveField(three, 2, 0));
    expect(fieldsOf(r.params).map((f) => f.name)).toEqual(['tel', 'email', 'text']);
  });

  it('chỉ số ngoài khoảng thì từ chối, không ghi', () => {
    expect(moveField(RAW, 0, 3).ok).toBe(false);
  });
});

describe('updateField', () => {
  it('bật bắt buộc, đổi nhãn', () => {
    const r = ok(updateField(RAW, 'email', { required: false, label: 'Thư điện tử' }));
    expect(fieldsOf(r.params)[0]).toMatchObject({ required: false, label: 'Thư điện tử' });
  });

  it('undefined trong patch là gỡ khoá (xoá chữ gợi ý)', () => {
    const a = ok(updateField(RAW, 'email', { placeholder: 'ban@vi-du.vn' })).params;
    const b = ok(updateField(a, 'email', { placeholder: undefined })).params;
    expect('placeholder' in fieldsOf(b)[0]!).toBe(false);
  });

  it('select không có lựa chọn → lỗi ở fields.N.options, không ghi', () => {
    const two = ok(addField(RAW, 'select')).params;
    const r = updateField(two, 'select', { options: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain('fields.1.options');
  });

  it('nhãn rỗng → lỗi ở fields.N.label bằng tiếng Việt', () => {
    const r = updateField(RAW, 'email', { label: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]!.path).toBe('fields.0.label');
      expect(r.issues[0]!.message).toMatch(/trống/);
    }
  });

  it('ô không tồn tại thì từ chối', () => {
    expect(updateField(RAW, 'khong_co', { label: 'x' }).ok).toBe(false);
  });
});

describe('setFormParam', () => {
  it('đổi chữ nút, giữ phần còn lại', () => {
    const r = ok(setFormParam(RAW, 'submitLabel', 'Đăng ký ngay'));
    expect(r.params.submitLabel).toBe('Đăng ký ngay');
    expect(r.params.fields).toEqual(RAW.fields);
  });

  it('chữ nút rỗng → lỗi ở submitLabel', () => {
    const r = setFormParam(RAW, 'submitLabel', '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.path).toBe('submitLabel');
  });

  it('chuỗi rỗng cho trường không bắt buộc là gỡ khoá', () => {
    const a = ok(setFormParam(RAW, 'successPanel', 'waitlist-done')).params;
    const b = ok(setFormParam(a, 'successPanel', '')).params;
    expect('successPanel' in b).toBe(false);
  });
});

/* ── setAfterSubmitOps ─────────────────────────────────────────────── */

function docWith(form: CompositeNode, extra: Doc['nodes'] = {}): Doc {
  const root: SectionNode = {
    id: 'root', type: 'Section', tag: 'main',
    parentId: null, children: [form.id], effects: [], style: { base: {} },
  };
  return { schemaVersion: 1, rootId: 'root', nodes: { root, [form.id]: form, ...extra } };
}

function formNode(over: Partial<CompositeNode> = {}): CompositeNode {
  return {
    id: 'f', type: 'Composite', composite: 'Form', parentId: 'root',
    children: [], effects: [], style: { base: {} },
    params: RAW, slots: {},
    ...over,
  } as CompositeNode;
}

function counter() {
  let i = 0;
  return () => `n${++i}`;
}

describe('setAfterSubmitOps', () => {
  it('chọn dialog khi slot trống → dựng khung + tiêu đề + dòng chữ cho cả hai slot, rồi setProps trong CÙNG batch', () => {
    const node = formNode();
    const r = ok(setAfterSubmitOps(node, 'dialog', counter(), docWith(node).nodes));
    const kinds = r.ops.map((o) => o.op);
    expect(kinds.filter((k) => k === 'insertNode')).toHaveLength(6);
    expect(kinds.at(-1)).toBe('setProps');

    const next = apply(docWith(node), r.ops);
    expect(structuralIssues(next)).toEqual([]);
    for (const n of Object.values(next.nodes)) expect(zNode.safeParse(n).success).toBe(true);

    const f = next.nodes.f as CompositeNode;
    expect((f.params as { afterSubmit: string }).afterSubmit).toBe('dialog');
    expect((f.params as { extra: string }).extra).toBe('giu-nguyen');
    expect(f.slots.success).toHaveLength(1);
    expect(f.slots.error).toHaveLength(1);
    // Slot là con thật của Composite (bất biến cấu trúc).
    expect(f.children).toEqual([...f.slots.success!, ...f.slots.error!]);

    const text = (id: string) => JSON.stringify(next.nodes[id]);
    const success = next.nodes[f.slots.success![0]!]!;
    expect(success.type).toBe('Stack');
    expect(success.children.map(text).join()).toContain('Đã gửi thành công');
    expect(success.children.map(text).join()).toContain('Cảm ơn bạn, chúng tôi sẽ liên hệ sớm.');
    const error = next.nodes[f.slots.error![0]!]!;
    expect(error.children.map(text).join()).toContain('Chưa gửi được');
    expect(error.children.map(text).join()).toContain('Bạn kiểm tra kết nối rồi thử lại giúp.');
    expect(JSON.stringify(next.nodes[success.children[0]!])).toContain('"tag":"h3"');
  });

  it('slot đã có nội dung → chỉ setProps, giữ slot cũ', () => {
    const node = formNode({ slots: { success: ['s'], error: ['e'], heading: ['h'] }, children: ['h', 's', 'e'] as never });
    const r = ok(setAfterSubmitOps(node, 'dialog', counter(), { s: {}, e: {}, h: {} }));
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]!.op).toBe('setProps');
    const props = (r.ops[0] as unknown as { props: { slots: Record<string, string[]> } }).props;
    expect(props.slots).toEqual({ success: ['s'], error: ['e'], heading: ['h'] });
  });

  it('chỉ một slot trống → chỉ dựng slot đó', () => {
    const node = formNode({ slots: { success: ['s'] }, children: ['s'] as never });
    const r = ok(setAfterSubmitOps(node, 'dialog', counter(), { s: {} }));
    expect(r.ops.filter((o) => o.op === 'insertNode')).toHaveLength(3);
  });

  it('slot trỏ tới node đã xoá → dựng lại slot đó, và chỉ ghi lại id còn sống', () => {
    // `removeNode` không dọn id trong `slots`: slot "có id" mà node không còn là slot TRỐNG.
    const node = formNode({
      slots: { success: ['gone'], error: ['e'], heading: ['h', 'gone2'] },
      children: ['h', 'e'] as never,
    });
    const r = ok(setAfterSubmitOps(node, 'dialog', counter(), { e: {}, h: {} }));
    expect(r.ops.filter((o) => o.op === 'insertNode')).toHaveLength(3);
    const props = (r.ops.at(-1) as unknown as { props: { slots: Record<string, string[]> } }).props;
    expect(props.slots.success).toEqual(['n1']);
    expect(props.slots.error).toEqual(['e']);
    expect(props.slots.heading).toEqual(['h']);
  });

  it('inline / panel → chỉ setProps, không đụng slot', () => {
    const r = ok(setAfterSubmitOps(formNode(), 'panel', counter(), {}));
    expect(r.ops).toHaveLength(1);
    const props = (r.ops[0] as unknown as { props: Record<string, unknown> }).props;
    expect((props.params as { afterSubmit: string }).afterSubmit).toBe('panel');
    expect('slots' in props).toBe(false);
  });

  it('params hiện tại hỏng → ok:false, không sinh op nào', () => {
    const r = setAfterSubmitOps(formNode({ params: { ...RAW, submitLabel: '' } }), 'dialog', counter(), {});
    expect(r.ok).toBe(false);
  });
});

describe('formPreviewCss', () => {
  it('không có xem trước nào → rỗng', () => {
    expect(formPreviewCss({})).toBe('');
    expect(formPreviewCss({ f: 'form' })).toBe('');
  });

  it('hiện khối xem trước đúng loại và ẩn <form> của đúng node', () => {
    const css = formPreviewCss({ f1: 'success', f2: 'error' });
    expect(css).toContain('[data-n="f1"]');
    expect(css).toContain('[data-preview="success"]');
    expect(css).toContain('[data-n="f2"]');
    expect(css).toContain('[data-preview="error"]');
  });

  it('id lạ (có thể phá selector) bị bỏ', () => {
    expect(formPreviewCss({ 'a"]{x}': 'success' })).toBe('');
  });
});

describe('optionsFromText / optionsToText', () => {
  it('mỗi dòng một lựa chọn; giá trị suy từ nhãn (bỏ dấu, a-z0-9_)', () => {
    expect(optionsFromText('Quỹ mở\n\n  Tiết kiệm  \n')).toEqual([
      { value: 'quy_mo', label: 'Quỹ mở' },
      { value: 'tiet_kiem', label: 'Tiết kiệm' },
    ]);
  });

  it('"giá trị | nhãn" khi cần giá trị riêng', () => {
    expect(optionsFromText('fund | Quỹ mở')).toEqual([{ value: 'fund', label: 'Quỹ mở' }]);
  });

  it('chuỗi rỗng → mảng rỗng (để schema báo lỗi cạnh ô, không tự bịa lựa chọn)', () => {
    expect(optionsFromText('  \n ')).toEqual([]);
  });

  it('đi vòng không đổi', () => {
    const opts = [
      { value: 'quy_mo', label: 'Quỹ mở' },
      { value: 'fund', label: 'Quỹ khác' },
    ];
    expect(optionsFromText(optionsToText(opts))).toEqual(opts);
  });
});

describe('reconcileOptions — sửa nhãn KHÔNG đổi giá trị gửi lên', () => {
  const prev = [
    { value: 'quy_mo', label: 'Quỹ mở' },
    { value: 'tiet_kiem', label: 'Tiết kiệm' },
    { value: 'khac', label: 'Khác' },
  ];

  it('đổi nhãn tại chỗ giữ giá trị cũ của dòng đó', () => {
    const r = reconcileOptions('Quỹ đóng\nTiết kiệm\nKhác', prev);
    expect(r.options[0]).toEqual({ value: 'quy_mo', label: 'Quỹ đóng' });
    expect(r.map).toEqual([0, 1, 2]);
  });

  it('đảo thứ tự dòng: giá trị đi theo nhãn, map ghi lại chỗ mới', () => {
    const r = reconcileOptions('Khác\nQuỹ mở\nTiết kiệm', prev);
    expect(r.options.map((o) => o.value)).toEqual(['khac', 'quy_mo', 'tiet_kiem']);
    expect(r.map).toEqual([1, 2, 0]);
  });

  it('bỏ một dòng giữa: dòng sau không "kế thừa" giá trị của dòng bị bỏ', () => {
    const r = reconcileOptions('Quỹ mở\nKhác', prev);
    expect(r.options.map((o) => o.value)).toEqual(['quy_mo', 'khac']);
    expect(r.map).toEqual([0, null, 1]);
  });

  it('dòng mới thì suy giá trị, và không trùng giá trị đã có', () => {
    const r = reconcileOptions('Quỹ mở\nTiết kiệm\nKhác\nquy mo', prev);
    expect(r.options[3]!.value).toBe('quy_mo_2');
    expect(new Set(r.options.map((o) => o.value)).size).toBe(4);
  });

  it('không có lựa chọn cũ → như optionsFromText', () => {
    expect(reconcileOptions('A\nB', undefined).options).toEqual(optionsFromText('A\nB'));
  });
});

describe('giá trị lựa chọn trùng nhau bị schema từ chối', () => {
  it('lỗi ở fields.N.options', () => {
    const two = ok(addField(RAW, 'select')).params;
    const r = updateField(two, 'select', { options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain('fields.1.options');
  });
});

describe('dời bản dịch theo chỉ số ô', () => {
  const before = { fields: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };

  it('fieldIndexMap theo tên: kéo, bỏ', () => {
    expect(fieldIndexMap(before, { fields: [{ name: 'c' }, { name: 'a' }, { name: 'b' }] })).toEqual([1, 2, 0]);
    expect(fieldIndexMap(before, { fields: [{ name: 'a' }, { name: 'c' }] })).toEqual([0, null, 1]);
  });

  it('remapParamPath: ô dời, ô bị bỏ, lựa chọn dời, đường khác giữ nguyên', () => {
    const remap = paramPathRemapper([1, null, 0], { 0: [1, 0] });
    expect(remap('fields.0.label')).toBe('fields.1.label');
    expect(remap('fields.1.help')).toBeNull();
    expect(remap('fields.2.placeholder')).toBe('fields.0.placeholder');
    expect(remap('fields.0.options.0.label')).toBe('fields.1.options.1.label');
    expect(remap('submitLabel')).toBe('submitLabel');
  });

  it('kế hoạch ghi: hoán đổi hai ô ghi đè đúng chỗ, không xoá đích vừa ghi; ô bị bỏ thì xoá', () => {
    const rows = [
      { locale: 'en', field: 'param:fields.0.label', value: 'A' },
      { locale: 'en', field: 'param:fields.1.label', value: 'B' },
      { locale: 'en', field: 'param:fields.2.label', value: 'C' },
      { locale: 'en', field: 'param:submitLabel', value: 'Send' },
    ];
    const plan = translationRemapPlan(rows, paramPathRemapper([1, 0, null], {}));
    expect(plan.upserts).toEqual([
      { locale: 'en', field: 'param:fields.1.label', value: 'A' },
      { locale: 'en', field: 'param:fields.0.label', value: 'B' },
    ]);
    expect(plan.deletes).toEqual([{ locale: 'en', field: 'param:fields.2.label' }]);
  });

  it('không có gì dời → kế hoạch rỗng', () => {
    const plan = translationRemapPlan(
      [{ locale: 'en', field: 'param:fields.0.label', value: 'A' }],
      paramPathRemapper([0, 1], {}),
    );
    expect(plan).toEqual({ upserts: [], deletes: [] });
  });
});

/**
 * Hoàn tác / làm lại một lần kéo/bỏ ô: params quay về nhờ op nghịch đảo, còn bản dịch theo
 * chỉ số ô thì phải được ghi NGƯỢC lại — không thì nhãn tiếng Anh nằm trên ô khác.
 */
describe('translationRemapSteps', () => {
  /** Áp một bước lên bảng bản dịch giả (khoá locale|field). */
  const run = (table: Map<string, unknown>, step: ReturnType<typeof translationRemapSteps>['forward']) => {
    const next = new Map(table);
    for (const u of step.upserts) next.set(`${u.locale}|${u.field}`, u.value);
    for (const d of step.deletes) next.delete(`${d.locale}|${d.field}`);
    return next;
  };
  const tableOf = (rows: { locale: string; field: string; value: unknown }[]) =>
    new Map(rows.map((r) => [`${r.locale}|${r.field}`, r.value]));

  it('kéo ô: forward là kế hoạch dời cũ, backward trả mọi hàng về chỗ cũ', () => {
    const rows = [
      { locale: 'en', field: 'param:fields.0.label', value: 'Email EN' },
      { locale: 'en', field: 'param:fields.1.label', value: 'Phone EN' },
      { locale: 'en', field: 'param:fields.1.help', value: 'Phone help' },
    ];
    const remap = paramPathRemapper([1, 0], {});
    const steps = translationRemapSteps(rows, remap);
    expect(steps.forward).toEqual(translationRemapPlan(rows, remap));

    const before = tableOf(rows);
    const after = run(before, steps.forward);
    expect(after.get('en|param:fields.1.label')).toBe('Email EN');
    expect(after.get('en|param:fields.0.label')).toBe('Phone EN');
    expect(after.get('en|param:fields.0.help')).toBe('Phone help');
    expect(after.has('en|param:fields.1.help')).toBe(false);

    expect(run(after, steps.backward)).toEqual(before);
    // Làm lại sau hoàn tác: về đúng trạng thái sau lần dời.
    expect(run(run(after, steps.backward), steps.forward)).toEqual(after);
  });

  it('bỏ ô: backward ghi LẠI bản dịch của ô đã bỏ (lần dời đã xoá nó)', () => {
    const rows = [
      { locale: 'en', field: 'param:fields.0.label', value: 'Email EN' },
      { locale: 'en', field: 'param:fields.1.label', value: 'Phone EN' },
      { locale: 'fr', field: 'param:fields.0.label', value: 'Email FR' },
    ];
    const steps = translationRemapSteps(rows, paramPathRemapper([null, 0], {}));
    const before = tableOf(rows);
    const after = run(before, steps.forward);
    expect([...after.entries()]).toEqual([['en|param:fields.0.label', 'Phone EN']]);
    expect(run(after, steps.backward)).toEqual(before);
  });

  it('không có gì dời → hai bước đều rỗng', () => {
    const steps = translationRemapSteps(
      [{ locale: 'en', field: 'param:fields.0.label', value: 'A' }],
      paramPathRemapper([0, 1], {}),
    );
    expect(steps.forward).toEqual({ upserts: [], deletes: [] });
    expect(steps.backward).toEqual({ upserts: [], deletes: [] });
  });
});
