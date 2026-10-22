import { describe, expect, it } from 'vitest';

import { detachOps } from './detach-instance';
import type { ComponentTree } from '@/lib/render/components';
import type { Doc } from '@/lib/doc/types';

/**
 * Tách instance thành node thường.
 *
 * Không có op `detachInstance`: detach là `insertNode` × N cộng `removeNode`, đều là
 * op đã có. Nhờ vậy `invert()` cho undo miễn phí — và đó là chỗ ta hơn cả bốn công
 * cụ có detach, vì cả bốn đều một chiều (docs/BENCHMARK.md §1.1).
 */

const text = (id: string, v: string, parentId: string | null = null) => ({
  id,
  type: 'Text' as const,
  tag: 'p' as const,
  parentId,
  children: [],
  effects: [],
  style: { base: {} },
  content: [{ t: 'text' as const, v }],
});

const tree: ComponentTree = {
  rootId: 'p1',
  nodes: {
    p1: {
      id: 'p1',
      type: 'Section',
      tag: 'section',
      parentId: null,
      children: ['p2'],
      effects: [],
      style: { base: {} },
    } as never,
    // `parentId` phải trỏ đúng cha: `presetToOps` đọc
    // `tree.nodes[source.parentId].children` để tìm vị trí chèn. Bản đầu của test
    // này để `null` và ném ngay — đúng bất biến mà validator cưỡng chế trên cây
    // thật, nên fixture sai chứ không phải code sai.
    p2: text('p2', 'chữ của component', 'p1') as never,
  },
};

const docWith = (overrides: Record<string, unknown>): Doc =>
  ({
    schemaVersion: 1,
    rootId: 'root',
    nodes: {
      root: {
        id: 'root',
        type: 'Section',
        tag: 'main',
        parentId: null,
        children: ['before', 'inst'],
        effects: [],
        style: { base: {} },
      },
      before: text('before', 'anh em trước', 'root'),
      inst: {
        id: 'inst',
        type: 'Instance',
        componentId: 'c1',
        overrides,
        parentId: 'root',
        children: [],
        effects: [],
        style: { base: {} },
      },
    },
  }) as unknown as Doc;

describe('detachOps', () => {
  it('sinh insertNode cho mọi node của cây, rồi removeNode instance', () => {
    const plan = detachOps(docWith({}), 'inst', tree);
    const kinds = plan.ops.map((o) => o.op);

    expect(kinds.filter((k) => k === 'insertNode')).toHaveLength(2);
    expect(kinds.at(-1)).toBe('removeNode');
    expect(plan.nodeCount).toBe(2);
  });

  it('xoá instance ở BƯỚC CUỐI, không phải bước đầu', () => {
    // Xoá trước thì `index` không còn đúng, và cây trung gian có một khoảng trống
    // mà validator cấu trúc phải đi qua.
    const plan = detachOps(docWith({}), 'inst', tree);
    expect(plan.ops.findIndex((o) => o.op === 'removeNode')).toBe(plan.ops.length - 1);
  });

  it('chèn vào ĐÚNG vị trí của instance, không phải cuối', () => {
    const plan = detachOps(docWith({}), 'inst', tree);
    const first = plan.ops.find((o) => o.op === 'insertNode') as { index: number; parentId: string };
    expect(first.parentId).toBe('root');
    expect(first.index).toBe(1);
  });

  it('ÁP override vào cây trước khi chèn', () => {
    // Không áp thì detach âm thầm hoàn nguyên mọi ghi đè về nội dung component —
    // một mất mát dữ liệu trông như thành công.
    const plan = detachOps(
      docWith({ p2: { content: [{ t: 'text', v: 'chữ đã ghi đè' }] } }),
      'inst',
      tree,
    );
    expect(plan.appliedOverrides).toBe(1);
    expect(JSON.stringify(plan.ops)).toContain('chữ đã ghi đè');
    expect(JSON.stringify(plan.ops)).not.toContain('chữ của component');
  });

  it('id mới KHÔNG đụng id đang có trong doc', () => {
    const plan = detachOps(docWith({}), 'inst', tree);
    const existing = new Set(['root', 'before', 'inst']);
    for (const op of plan.ops) {
      if (op.op !== 'insertNode') continue;
      expect(existing.has((op as { node: { id: string } }).node.id)).toBe(false);
    }
  });

  it('ném khi node không phải Instance', () => {
    expect(() => detachOps(docWith({}), 'before', tree)).toThrow(/không phải Instance/);
  });

  it('ném khi cây component không có gốc', () => {
    // Tách một instance mồ côi sẽ chèn cây rỗng rồi xoá instance — tức xoá nội dung
    // mà trông như đã tách.
    expect(() => detachOps(docWith({}), 'inst', { rootId: 'x', nodes: {} })).toThrow(/node gốc/);
  });

  it('ném khi node không tồn tại', () => {
    expect(() => detachOps(docWith({}), 'khong-co', tree)).toThrow(/Không có node/);
  });
});
