import { describe, expect, it, vi } from 'vitest';

/*
 * Composite của GÓI DỰ ÁN: registry gộp lõi + gói, validator nhận tên của gói và từ chối
 * tên bịa. Giả lập một gói mang composite `ExampleHello` (cùng hình dạng với gói mẫu
 * projects/example) — test không phụ thuộc QUILDER_PROJECT đang đặt gì.
 */
const hello = vi.hoisted(() => ({ key: 'ExampleHello' }));

vi.mock('@/lib/project/active', async () => {
  const { z } = await import('zod');
  const actual = await vi.importActual<typeof import('@/lib/project/active')>('@/lib/project/active');
  const composite = {
    key: hello.key,
    params: z.object({ greeting: z.string().default('Xin chào') }).strict().catch({ greeting: 'Xin chào' }),
    description: 'Khối chào của gói mẫu.',
    translatableParams: [['greeting', 120]] as const,
    Component: () => null,
  };
  return {
    ...actual,
    activeProject: { name: 'example', composites: [composite] },
    projectComposites: () => [composite],
    projectComposite: (key: string) => (key === hello.key ? composite : undefined),
  };
});

vi.mock('@/lib/db', () => ({
  prisma: {
    token: { findMany: vi.fn().mockResolvedValue([]) },
    collectionType: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { checkProject } from '@/lib/project/active';
import { listParamPaths, paramMaxLength } from '@/lib/render/param-paths';
import { CURRENT_SCHEMA_VERSION, type Doc } from '@/lib/doc/types';
import { validateOps } from '@/lib/doc/validate';
import { compositeCatalog, isKnownComposite, parseCompositeParams } from './registry';

const doc = (): Doc =>
  ({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: { root: { id: 'root', type: 'Section', tag: 'main', parentId: null, children: [], effects: [], style: { base: {} } } },
  }) as unknown as Doc;

const insert = (composite: string) => [
  {
    op: 'insertNode',
    parentId: 'root',
    index: 0,
    node: { id: 'c1', type: 'Composite', composite, params: {}, slots: {}, parentId: 'root', children: [], effects: [], style: { base: {} } },
  },
];

describe('registry gộp lõi + gói', () => {
  it('nhận composite lõi và của gói, không nhận tên bịa', () => {
    expect(isKnownComposite('Form')).toBe(true);
    expect(isKnownComposite('ExampleHello')).toBe(true);
    expect(isKnownComposite('KhongCo')).toBe(false);
  });

  it('parse params bằng schema của gói', () => {
    expect(parseCompositeParams('ExampleHello', {})).toEqual({ greeting: 'Xin chào' });
  });

  it('danh mục cho AI có cả composite của gói', () => {
    const hit = compositeCatalog().find((c) => c.key === 'ExampleHello');
    expect(hit).toMatchObject({ implemented: true, about: 'Khối chào của gói mẫu.' });
  });

  it('chữ dịch được của gói đi vào bảng trắng param', () => {
    expect(paramMaxLength('greeting')).toBe(120);
    expect(listParamPaths('ExampleHello', { greeting: 'Chào' })).toEqual([{ path: 'greeting', text: 'Chào' }]);
  });

  it('gói khai trùng tên composite lõi thì ném lúc nạp', () => {
    expect(() => checkProject({ name: 'x', composites: [{ key: 'Form' } as never] }, ['Form'])).toThrow(/trùng tên/);
  });
});

describe('validator', () => {
  it('chèn composite của gói: được', async () => {
    const r = await validateOps(doc(), insert('ExampleHello'), 'human');
    expect(r.ok, JSON.stringify(!r.ok && r.issues)).toBe(true);
  });

  it('chèn composite không có ở đâu: bị từ chối, câu lỗi nêu tên', async () => {
    const r = await validateOps(doc(), insert('KhongCo'), 'human');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.map((i) => i.message).join(' ')).toContain('KhongCo');
  });
});
