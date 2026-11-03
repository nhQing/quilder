import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { token: { findMany: vi.fn().mockResolvedValue([]) } } }));

import { validateOps } from './validate';
import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

/** `setStyle.part` — chỉ Composite có phần đó, và chỉ với lớp cố định (không inView/state). */

function doc(): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'Section', tag: 'main', parentId: null, children: ['f', 't'], effects: [], style: { base: {} } },
      f: { id: 'f', type: 'Composite', composite: 'Form', params: {}, slots: {}, parentId: 'root', children: [], effects: [], style: { base: {} } },
      t: { id: 't', type: 'Text', tag: 'p', parentId: 'root', children: [], effects: [], style: { base: {} }, content: [{ t: 'text', v: 'x' }] },
    },
  } as unknown as Doc;
}
const patch = { fill: { color: { hex: '#ff0000' } } } as never;
const run = (op: Record<string, unknown>) =>
  validateOps(doc(), [{ op: 'setStyle', patch, ...op } as never], 'human');

describe('validateOps — setStyle.part', () => {
  it('part hợp lệ trên Form đi qua (base và hover)', async () => {
    expect((await run({ nodeId: 'f', target: 'base', part: 'submit' })).ok).toBe(true);
    expect((await run({ nodeId: 'f', target: 'hover', part: 'input' })).ok).toBe(true);
  });

  it('part lạ → lỗi nêu danh sách phần hợp lệ', async () => {
    const r = await run({ nodeId: 'f', target: 'base', part: 'nope' });
    expect(r.ok).toBe(false);
    const msg = r.issues?.find((i) => i.code === 'unknown-part')?.message ?? '';
    expect(msg).toContain('submit');
    expect(msg).toContain('dialog');
  });

  it('part trên node Text → lỗi', async () => {
    const r = await run({ nodeId: 't', target: 'base', part: 'submit' });
    expect(r.ok).toBe(false);
    expect(r.issues?.some((i) => i.code === 'part-not-composite')).toBe(true);
  });

  it('part + inView hoặc {state} → lỗi', async () => {
    expect((await run({ nodeId: 'f', target: 'inView', part: 'submit' })).ok).toBe(false);
    const r = await run({ nodeId: 'f', target: { state: 'collapsed' }, part: 'submit' });
    expect(r.ok).toBe(false);
    expect(r.issues?.some((i) => i.code === 'part-target')).toBe(true);
  });

  it('schema: insertNode mang style.parts hợp lệ', async () => {
    const r = await validateOps(
      doc(),
      [{
        op: 'insertNode', parentId: 'root', index: 0,
        node: {
          id: 'f2', type: 'Composite', composite: 'Form', params: {}, slots: {}, parentId: 'root',
          children: [], effects: [], style: { base: {}, parts: { submit: { base: patch } } },
        },
      } as never],
      'human',
    );
    expect(r.ok).toBe(true);
  });
});
