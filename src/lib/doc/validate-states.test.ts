import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    token: { findMany: vi.fn().mockResolvedValue([]) },
    effectPreset: { findMany: vi.fn().mockResolvedValue([]) },
    effect: {
      findMany: vi.fn().mockResolvedValue([
        { key: 'steps', statesWritten: ['step-active', 'step-inactive'] },
        { key: 'show-more', statesWritten: ['more-open'] },
      ]),
    },
  },
}));

import { validateOps } from './validate';
import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

/**
 * State do effect ghi áp cho node mang cờ VÀ cả cây con của nó (`css.ts` phát thêm
 * dạng `[data-x] [data-n]`). Nên node bên trong một node có effect cũng được style
 * theo state của effect đó — vòng số, tiêu đề, khung mô tả trong một bước của `steps`.
 */
function doc(): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'Section', parentId: null, children: ['wrap', 'lone'], effects: [], style: { base: {} } },
      wrap: {
        id: 'wrap', type: 'Stack', parentId: 'root', children: ['step'], style: { base: {} },
        effects: [{ id: 's1', effect: 'steps', params: {} }],
      },
      step: { id: 'step', type: 'Stack', parentId: 'wrap', children: ['body'], effects: [], style: { base: {} } },
      body: { id: 'body', type: 'Stack', parentId: 'step', children: [], effects: [], style: { base: {} } },
      lone: { id: 'lone', type: 'Stack', parentId: 'root', children: [], effects: [], style: { base: {} } },
    },
  } as unknown as Doc;
}

const setState = (nodeId: string, state: string) => ({
  op: 'setStyle',
  nodeId,
  target: { state },
  patch: { size: { height: 'auto' } },
});

const codes = (r: Awaited<ReturnType<typeof validateOps>>) => (r.issues ?? []).map((i) => i.code);

describe('validateOps — state của effect trên tổ tiên', () => {
  it('node con style được theo state mà effect của tổ tiên ghi', async () => {
    const r = await validateOps(doc(), [setState('body', 'step-active')], 'ai');
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it('state không effect nào trong chuỗi tổ tiên ghi thì vẫn bị chặn', async () => {
    const r = await validateOps(doc(), [setState('body', 'more-open')], 'ai');
    expect(codes(r)).toContain('unknown-state');
  });

  it('không node nào trong chuỗi tổ tiên có effect thì vẫn là state-no-effect', async () => {
    const r = await validateOps(doc(), [setState('lone', 'step-active')], 'ai');
    expect(codes(r)).toContain('state-no-effect');
  });

  it('effect gắn lên tổ tiên trong cùng batch cũng tính', async () => {
    const r = await validateOps(
      doc(),
      [
        { op: 'attachEffect', nodeId: 'step', attachment: { id: 'm1', effect: 'show-more', params: {} } },
        setState('body', 'more-open'),
      ],
      'ai',
    );
    expect(codes(r)).not.toContain('unknown-state');
    expect(codes(r)).not.toContain('state-no-effect');
  });
});
