import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Validator chặn GIÁ TRỊ sai trong params của `Form`, không chỉ tên tham số lạ.
 *
 * Renderer đọc params qua `.catch(FORM_DEFAULTS)`: một giá trị sai làm CẢ form về mặc định
 * (gửi tới `newsletter`) mà không lỗi nào hiện ra. Sidebar đã không ghi params hỏng, nhưng
 * AI/MCP và API ghi thẳng qua `validateOps` — nên chặn phải nằm ở đây (spec §5).
 */

const site = vi.hoisted(() => ({
  globals: { endpoint: { newsletter: 'https://a.example/n', 'lien-he': 'https://a.example/l' } } as Record<string, unknown>,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    token: { findMany: vi.fn().mockResolvedValue([]) },
    site: { findFirst: vi.fn(async () => ({ globals: site.globals })) },
  },
}));

import { validateOps } from './validate';
import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

const FIELDS = [{ name: 'email', kind: 'email', label: 'Email', required: true }];

function doc(params: Record<string, unknown> = { endpointKey: 'newsletter', fields: FIELDS }): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'Section', tag: 'main', parentId: null, children: ['f', 't'], effects: [], style: { base: {} } },
      f: { id: 'f', type: 'Composite', composite: 'Form', params, slots: {}, parentId: 'root', children: [], effects: [], style: { base: {} } },
      t: { id: 't', type: 'Text', tag: 'p', parentId: 'root', children: [], effects: [], style: { base: {} }, content: [{ t: 'text', v: 'x' }] },
    },
  } as unknown as Doc;
}

const setParams = (params: unknown, d: Doc = doc()) =>
  validateOps(d, [{ op: 'setProps', nodeId: 'f', props: { params } }], 'ai');

const messages = (r: Awaited<ReturnType<typeof validateOps>>, code: string) =>
  r.issues.filter((i) => i.code === code).map((i) => i.message).join('\n');

const insertForm = (node: Record<string, unknown>) =>
  validateOps(
    doc(),
    [{
      op: 'insertNode', parentId: 'root', index: 0,
      node: {
        id: 'f2', type: 'Composite', composite: 'Form', params: {}, slots: {}, parentId: 'root',
        children: [], effects: [], style: { base: {} }, ...node,
      },
    }],
    'ai',
  );

beforeEach(() => {
  site.globals = { endpoint: { newsletter: 'https://a.example/n', 'lien-he': 'https://a.example/l' } };
});

describe('validateOps — giá trị params của Form', () => {
  it('params hợp lệ đi qua', async () => {
    const r = await setParams({ endpointKey: 'lien-he', fields: FIELDS, afterSubmit: 'dialog' });
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it('afterSubmit ngoài ba giá trị bị chặn, câu lỗi nêu đường dẫn', async () => {
    const r = await setParams({ fields: FIELDS, afterSubmit: 'modal' });
    expect(r.ok).toBe(false);
    expect(messages(r, 'composite_params')).toContain('afterSubmit');
  });

  it('fields rỗng bị chặn', async () => {
    const r = await setParams({ fields: [] });
    expect(r.ok).toBe(false);
    expect(messages(r, 'composite_params')).toContain('fields');
  });

  it('endpointKey không phải slug bị chặn', async () => {
    const r = await setParams({ endpointKey: 'Bad', fields: FIELDS });
    expect(r.ok).toBe(false);
    expect(messages(r, 'composite_params')).toContain('endpointKey');
  });

  it('lựa chọn trùng giá trị bị chặn ở đường ghi (renderer thì vẫn giữ form)', async () => {
    const r = await setParams({
      fields: [{
        name: 'goi', kind: 'select', label: 'Gói',
        options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'A2' }],
      }],
    });
    expect(r.ok).toBe(false);
    expect(messages(r, 'composite_params')).toContain('fields.0.options');
  });

  it('insertNode mang params sai cũng bị chặn', async () => {
    const r = await insertForm({ params: { afterSubmit: 'popup' } });
    expect(r.ok).toBe(false);
    expect(messages(r, 'composite_params')).toContain('afterSubmit');
  });

  it('insertNode bản sao mẫu (endpointKey rỗng) đi qua', async () => {
    const r = await insertForm({ params: { endpointKey: '', fields: FIELDS } });
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });
});

describe('validateOps — đổi endpointKey sang khoá không có trong bảng', () => {
  it('đổi sang khoá chưa có URL bị chặn, câu lỗi nêu khoá', async () => {
    const r = await setParams({ endpointKey: 'khong-co', fields: FIELDS });
    expect(r.ok).toBe(false);
    expect(messages(r, 'endpoint_missing')).toContain('khong-co');
  });

  it('đổi sang khoá có trong bảng, hoặc về rỗng, thì được', async () => {
    expect((await setParams({ endpointKey: 'lien-he', fields: FIELDS })).ok).toBe(true);
    expect((await setParams({ endpointKey: '', fields: FIELDS })).ok).toBe(true);
  });

  it('form ĐANG ở khoá không có URL vẫn sửa được chỗ khác', async () => {
    const d = doc({ endpointKey: 'cu', fields: FIELDS });
    const r = await setParams({ endpointKey: 'cu', fields: FIELDS, submitLabel: 'Gửi đi' }, d);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it('vắng endpointKey trước và sau (= newsletter) không tính là đổi, kể cả khi bảng không có newsletter', async () => {
    site.globals = {};
    const d = doc({ fields: FIELDS });
    const r = await setParams({ fields: FIELDS, submitLabel: 'Gửi đi' }, d);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });
});

describe('validateOps — style.parts qua insertNode', () => {
  const patch = { fill: { color: { hex: '#ff0000' } } };

  it('phần lạ bị chặn như setStyle { part }', async () => {
    const r = await insertForm({ style: { base: {}, parts: { nope: { base: patch } } } });
    expect(r.ok).toBe(false);
    expect(messages(r, 'unknown-part')).toContain('nope');
  });

  it('style.parts trên node không phải Composite bị chặn', async () => {
    const r = await validateOps(
      doc(),
      [{
        op: 'insertNode', parentId: 'root', index: 0,
        node: {
          id: 't2', type: 'Text', tag: 'p', parentId: 'root', children: [], effects: [],
          content: [{ t: 'text', v: 'y' }], style: { base: {}, parts: { submit: { base: patch } } },
        },
      }],
      'ai',
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'part-not-composite')).toBe(true);
  });

  it('phần hợp lệ đi qua', async () => {
    const r = await insertForm({ style: { base: {}, parts: { submit: { base: patch }, dialog: { base: patch } } } });
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });
});
