import { describe, expect, it, vi } from 'vitest';

/**
 * Bản dịch cho chữ trong `params` của Composite (`param:<đường dẫn>`).
 *
 * Phủ cả vòng: rút đơn vị (doc + instance) → ghi (shape) → ảnh chụp Release →
 * phủ lên doc. Hỏng ở bất kỳ mắt xích nào là một chữ tiếng Việt còn sót trên trang EN
 * mà không có lỗi nào báo.
 */

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/builder/queries', () => ({ getDraftPage: vi.fn() }));
vi.mock('@/lib/render/components', () => ({ loadComponents: vi.fn() }));

/*
 * Một composite của GÓI DỰ ÁN có mảng nhãn dịch được (`index.*.label`), cạnh `Form` của lõi —
 * phủ cả đường chữ dịch được khai ở gói (`translatableParams`).
 */
vi.mock('@/lib/project/active', async () => {
  const actual = await vi.importActual<typeof import('@/lib/project/active')>('@/lib/project/active');
  const composite = { key: 'TestIndex', translatableParams: [['index.*.label', 120]] as const };
  return {
    ...actual,
    projectComposites: () => [composite],
    projectComposite: (key: string) => (key === composite.key ? composite : undefined),
  };
});

import type { Doc, Node } from '@/lib/doc/types';
import { zOp, zNode } from '@/lib/doc/schema';
import { applyTranslations, entriesFromSnapshot, snapshotKey } from '@/lib/render/translations';
import { applyOverride } from '@/lib/render/instance';
import { shapeError } from './set-translation';
import { extractUnits, fieldValueKind, unitKey, type ComponentTrees } from './text-units';

const base = { parentId: null as string | null, children: [] as string[], style: {}, effects: [] };

const formParams = {
  endpointKey: 'newsletter',
  submitLabel: 'Đăng ký',
  fields: [{ name: 'email', kind: 'email', label: 'Email của bạn', placeholder: 'ban@mail.com' }],
};

function docWith(nodes: Record<string, object>): Doc {
  const full: Record<string, Node> = {};
  for (const [id, n] of Object.entries(nodes)) full[id] = { ...base, id, ...n } as unknown as Node;
  return { rootId: 'root', nodes: full, schemaVer: 1 } as unknown as Doc;
}

const pageDoc = () =>
  docWith({
    root: { type: 'Section', tag: 'main', children: ['ch', 'f'] },
    ch: {
      type: 'Composite', composite: 'TestIndex', parentId: 'root', slots: {},
      params: { index: [{ label: 'Giới thiệu', number: '01' }, { label: 'Quỹ', number: '02' }], stageMinHeight: 620 },
    },
    f: { type: 'Composite', composite: 'Form', parentId: 'root', slots: {}, params: formParams },
  });

describe('đơn vị param trên node thường', () => {
  it('composite của gói và Form phát đúng đơn vị, flat, kiểu text', () => {
    const units = extractUnits(pageDoc()).filter((u) => u.nodeType === 'Composite');
    expect(units.map((u) => [u.nodeId, u.field, u.text])).toEqual([
      ['ch', 'param:index.0.label', 'Giới thiệu'],
      ['ch', 'param:index.1.label', 'Quỹ'],
      ['f', 'param:submitLabel', 'Đăng ký'],
      ['f', 'param:fields.0.label', 'Email của bạn'],
      ['f', 'param:fields.0.placeholder', 'ban@mail.com'],
    ]);
    expect(units.every((u) => u.flat && fieldValueKind(u.field) === 'text')).toBe(true);
  });

  it('không có đơn vị ma khi params để mặc định', () => {
    const d = docWith({
      root: { type: 'Section', tag: 'main', children: ['f'] },
      f: { type: 'Composite', composite: 'Form', parentId: 'root', slots: {}, params: {} },
    });
    expect(extractUnits(d)).toEqual([]);
  });
});

describe('đơn vị param trong instance', () => {
  const trees: ComponentTrees = new Map([
    [
      'footer',
      {
        rootId: 'froot',
        nodes: {
          froot: { ...base, id: 'froot', type: 'Section', tag: 'footer', children: ['ff'] } as unknown as Node,
          ff: { ...base, id: 'ff', type: 'Composite', composite: 'Form', parentId: 'froot', slots: {}, params: formParams } as unknown as Node,
        },
      },
    ],
  ]);
  const instDoc = (overrides: object = {}) =>
    docWith({
      root: { type: 'Section', tag: 'main', children: ['inst'] },
      inst: { type: 'Instance', componentId: 'footer', parentId: 'root', overrides, children: [] },
    });

  it('địa chỉ instanceId/localId, fromComponent theo override', () => {
    const units = extractUnits(instDoc({ ff: { params: { submitLabel: 'Join' } } }), trees);
    const byField = new Map(units.map((u) => [u.field, u]));
    expect(byField.get('param:submitLabel')).toMatchObject({
      nodeId: 'inst/ff', text: 'Join', fromComponent: false,
    });
    expect(byField.get('param:fields.0.label')).toMatchObject({ nodeId: 'inst/ff', fromComponent: true });
  });

  it('applyTranslations ghi vào overrides.params, không đụng cây component', () => {
    const d = instDoc();
    const out = applyTranslations(d, [
      { nodeId: 'inst/ff', field: 'param:fields.0.placeholder', value: 'you@mail.com' },
      { nodeId: 'inst/ff', field: 'param:submitLabel', value: 'Join' },
    ]);
    const ov = (out.nodes.inst as { overrides: Record<string, { params: Record<string, string> }> }).overrides.ff!;
    expect(ov.params).toEqual({ 'fields.0.placeholder': 'you@mail.com', submitLabel: 'Join' });
    expect((d.nodes.inst as { overrides: object }).overrides).toEqual({});

    const resolved = applyOverride(trees.get('footer')!.nodes.ff!, ov) as unknown as { params: typeof formParams };
    expect(resolved.params.submitLabel).toBe('Join');
    expect(resolved.params.fields[0]!.placeholder).toBe('you@mail.com');
    expect(formParams.submitLabel).toBe('Đăng ký');
  });

  it('schema override nhận đường dịch được và từ chối đường lạ', () => {
    const ok = zOp.safeParse({ op: 'setOverride', nodeId: 'inst', localId: 'ff', patch: { params: { 'fields.0.label': 'Email' } } });
    expect(ok.success).toBe(true);
    const bad = zOp.safeParse({ op: 'setOverride', nodeId: 'inst', localId: 'ff', patch: { params: { endpointKey: 'x' } } });
    expect(bad.success).toBe(false);
    const node = zNode.safeParse({
      ...base, style: { base: {} }, id: 'inst', type: 'Instance', componentId: 'footer', overrides: { ff: { params: { submitLabel: 'Join' } } },
    });
    expect(node.success).toBe(true);
  });
});

describe('applyTranslations trên doc', () => {
  it('thay param trên bản nhân bản, giữ doc gốc', () => {
    const d = pageDoc();
    const out = applyTranslations(d, [
      { nodeId: 'ch', field: 'param:index.1.label', value: 'The Fund' },
      { nodeId: 'f', field: 'param:fields.0.placeholder', value: 'you@mail.com' },
    ]);
    const ch = out.nodes.ch as unknown as { params: { index: { label: string; number: string }[] } };
    expect(ch.params.index[1]).toEqual({ label: 'The Fund', number: '02' });
    expect(ch.params.index[0]!.label).toBe('Giới thiệu');
    expect((d.nodes.ch as unknown as { params: { index: { label: string }[] } }).params.index[1]!.label).toBe('Quỹ');
    expect((out.nodes.f as unknown as { params: typeof formParams }).params.fields[0]!.placeholder).toBe('you@mail.com');
  });

  it('bỏ qua bản dịch mồ côi hoặc sai kiểu, không tạo ô mới', () => {
    const d = pageDoc();
    const out = applyTranslations(d, [
      { nodeId: 'f', field: 'param:fields.4.label', value: 'x' },
      { nodeId: 'f', field: 'param:endpointKey', value: 'evil' },
      { nodeId: 'ch', field: 'param:index.0.label', value: 42 },
    ]);
    expect((out.nodes.f as unknown as { params: unknown }).params).toEqual(formParams);
    expect((out.nodes.ch as unknown as { params: { index: { label: string }[] } }).params.index[0]!.label).toBe('Giới thiệu');
  });
});

describe('setTranslation shapeError cho param:*', () => {
  it('nhận chuỗi trong trần', () => {
    expect(shapeError('param:index.0.label', 'Intro')).toBeNull();
    expect(shapeError('param:successMessage', 'x'.repeat(300))).toBeNull();
  });
  it('từ chối không phải chuỗi, rỗng, quá trần, đường lạ', () => {
    expect(shapeError('param:submitLabel', [{ t: 'text', v: 'x' }])).not.toBeNull();
    expect(shapeError('param:submitLabel', '  ')).not.toBeNull();
    expect(shapeError('param:submitLabel', 'x'.repeat(81))).not.toBeNull();
    expect(shapeError('param:endpointKey', 'x')).not.toBeNull();
  });
});

describe('khoá ảnh chụp Release với dấu ":" trong field', () => {
  it('snapshotKey → entriesFromSnapshot khứ hồi nguyên field', () => {
    const snap = {
      [snapshotKey('en', 'ch', 'param:index.0.label')]: 'Intro',
      [snapshotKey('en', 'inst/ff', 'param:fields.0.placeholder')]: 'you@mail.com',
      [snapshotKey('en', 't', 'content')]: [{ t: 'text', v: 'Hi' }],
      [snapshotKey('de', 'ch', 'param:index.0.label')]: 'Einführung',
    };
    expect(entriesFromSnapshot(snap, 'en')).toEqual([
      { nodeId: 'ch', field: 'param:index.0.label', value: 'Intro' },
      { nodeId: 'inst/ff', field: 'param:fields.0.placeholder', value: 'you@mail.com' },
      { nodeId: 't', field: 'content', value: [{ t: 'text', v: 'Hi' }] },
    ]);
  });

  it('unitKey cùng dạng với khoá ảnh chụp (trừ locale)', () => {
    expect(unitKey('ch', 'param:index.0.label')).toBe('ch:param:index.0.label');
  });
});
