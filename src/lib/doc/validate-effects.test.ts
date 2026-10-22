import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    token: { findMany: vi.fn().mockResolvedValue([]) },
    effectPreset: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { validateOps } from './validate';
import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

/**
 * Params, `appliesTo` và `conflicts` của effect được KIỂM khi ghi (08/10/2026).
 *
 * Trước đó tầng ngữ nghĩa chỉ kiểm key có trong registry: `counter` với `duration: 99`
 * vào thẳng DB, rồi `EffectRuntime` bỏ effect trên trình duyệt — "effect không chạy",
 * không lỗi nào để lần. Manifest đã khai đủ cả ba thứ, chỉ chưa ai đọc chúng ở đây.
 */

function doc(extra: Record<string, unknown> = {}): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'Section', parentId: null, children: ['t', 'img'], effects: [], style: { base: {} } },
      t: { id: 't', type: 'Text', parentId: 'root', children: [], effects: [], style: { base: {} }, tag: 'p', content: [] },
      img: {
        id: 'img', type: 'Section', parentId: 'root', children: [], style: { base: {} },
        effects: [{ id: 'px1', effect: 'parallax', params: {} }],
        ...extra,
      },
    },
  } as unknown as Doc;
}

const attach = (nodeId: string, effect: string, params: Record<string, unknown> = {}, id = 'e1') => ({
  op: 'attachEffect',
  nodeId,
  attachment: { id, effect, params },
});

const codes = (r: Awaited<ReturnType<typeof validateOps>>) => (r.issues ?? []).map((i) => i.code);

describe('validateOps — params của effect', () => {
  it('params đúng thì qua', async () => {
    const r = await validateOps(doc(), [attach('t', 'counter', { to: 100, duration: 2 })], 'ai');
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it('params vượt giới hạn bị chặn, và câu lỗi chỉ đúng tham số', async () => {
    const r = await validateOps(doc(), [attach('t', 'counter', { to: 100, duration: 99 })], 'ai');
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('effect-params');
    expect(r.issues!.find((i) => i.code === 'effect-params')!.message).toContain('duration');
  });

  it('thiếu tham số bắt buộc bị chặn — counter không có `to` là vô nghĩa', async () => {
    const r = await validateOps(doc(), [attach('t', 'counter', {})], 'human');
    expect(codes(r)).toContain('effect-params');
    expect(r.issues!.find((i) => i.code === 'effect-params')!.message).toContain('to');
  });

  it('updateEffect cũng bị kiểm, kể cả instance vừa gắn trong cùng batch', async () => {
    const r = await validateOps(
      doc(),
      [
        attach('t', 'counter', { to: 10 }, 'c1'),
        { op: 'updateEffect', nodeId: 't', instanceId: 'c1', params: { to: 10, decimals: 9 } },
      ],
      'ai',
    );
    expect(codes(r)).toContain('effect-params');
    expect(r.issues!.find((i) => i.code === 'effect-params')!.index).toBe(1);
  });

  it('updateEffect với params đúng thì qua', async () => {
    const r = await validateOps(
      doc(),
      [{ op: 'updateEffect', nodeId: 'img', instanceId: 'px1', params: { speed: 0.4 } }],
      'ai',
    );
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });
});

describe('validateOps — appliesTo của effect', () => {
  it('counter chỉ gắn vào Text', async () => {
    const r = await validateOps(doc(), [attach('root', 'counter', { to: 5 })], 'ai');
    expect(codes(r)).toContain('effect-applies-to');
  });
});

describe('validateOps — conflicts của effect', () => {
  it('rail-pin đã gắn thì không gắn thêm image-sequence (xung đột khai ở manifest)', async () => {
    const r = await validateOps(
      doc(),
      [attach('img', 'rail-pin', {}, 'r1'), attach('img', 'image-sequence', { frames: ['a'] }, 'e2')],
      'ai',
    );
    expect(codes(r)).toContain('effect-conflict');
    expect(r.issues!.find((i) => i.code === 'effect-conflict')!.message).toContain('rail-pin');
  });

  it('gỡ effect xung đột trước trong cùng batch thì gắn được', async () => {
    const r = await validateOps(
      doc(),
      [
        attach('img', 'rail-pin', {}, 'r1'),
        { op: 'detachEffect', nodeId: 'img', instanceId: 'r1' },
        attach('img', 'image-sequence', { frames: ['a'] }, 'e2'),
      ],
      'ai',
    );
    expect(codes(r)).not.toContain('effect-conflict');
  });

  it('xung đột hai chiều: magnetic khai conflicts tilt, gắn tilt sau magnetic cũng bị chặn', async () => {
    const r = await validateOps(doc(), [attach('t', 'magnetic', {}, 'm1'), attach('t', 'tilt', {}, 't1')], 'ai');
    expect(codes(r)).toContain('effect-conflict');
  });
});
