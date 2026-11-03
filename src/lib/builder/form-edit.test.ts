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
    const r = ok(setAfterSubmitOps(node, 'dialog', counter()));
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
    const r = ok(setAfterSubmitOps(node, 'dialog', counter()));
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]!.op).toBe('setProps');
    const props = (r.ops[0] as unknown as { props: { slots: Record<string, string[]> } }).props;
    expect(props.slots).toEqual({ success: ['s'], error: ['e'], heading: ['h'] });
  });

  it('chỉ một slot trống → chỉ dựng slot đó', () => {
    const node = formNode({ slots: { success: ['s'] }, children: ['s'] as never });
    const r = ok(setAfterSubmitOps(node, 'dialog', counter()));
    expect(r.ops.filter((o) => o.op === 'insertNode')).toHaveLength(3);
  });

  it('inline / panel → chỉ setProps, không đụng slot', () => {
    const r = ok(setAfterSubmitOps(formNode(), 'panel', counter()));
    expect(r.ops).toHaveLength(1);
    const props = (r.ops[0] as unknown as { props: Record<string, unknown> }).props;
    expect((props.params as { afterSubmit: string }).afterSubmit).toBe('panel');
    expect('slots' in props).toBe(false);
  });

  it('params hiện tại hỏng → ok:false, không sinh op nào', () => {
    const r = setAfterSubmitOps(formNode({ params: { ...RAW, submitLabel: '' } }), 'dialog', counter());
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
