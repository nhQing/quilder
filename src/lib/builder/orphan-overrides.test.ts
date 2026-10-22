import { describe, expect, it } from 'vitest';

import { clearOverrideOps, findOrphanOverrides, type ComponentNodeIds } from './orphan-overrides';
import type { Doc } from '@/lib/doc/types';

/**
 * Override mồ côi — trỏ tới `localId` không còn trong cây component.
 *
 * Renderer bỏ qua chúng khi vẽ (đúng: ném ở đó làm trắng cả trang vì một chuỗi
 * không ai đọc). Hệ quả là không ai biết chúng tồn tại, và chúng tích lại theo từng
 * lần dọn cây component.
 */

const instance = (id: string, componentId: string, overrides: Record<string, unknown>) => ({
  id,
  type: 'Instance' as const,
  componentId,
  overrides,
  parentId: null,
  children: [],
  effects: [],
  style: { base: {} },
});

const doc = (nodes: Record<string, unknown>): Doc =>
  ({ schemaVersion: 1, rootId: Object.keys(nodes)[0]!, nodes }) as unknown as Doc;

const comps = (m: Record<string, string[]>): ComponentNodeIds =>
  new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]));

describe('findOrphanOverrides', () => {
  it('bắt override trỏ tới localId đã bị xoá', () => {
    const found = findOrphanOverrides(
      doc({ i1: instance('i1', 'c1', { p2: { content: [] } }) }),
      comps({ c1: ['p1'] }),
    );
    expect(found).toEqual([{ nodeId: 'i1', localId: 'p2', componentId: 'c1' }]);
  });

  it('KHÔNG báo override còn đích', () => {
    expect(
      findOrphanOverrides(
        doc({ i1: instance('i1', 'c1', { p1: { content: [] } }) }),
        comps({ c1: ['p1', 'p2'] }),
      ),
    ).toEqual([]);
  });

  it('component VẮNG MẶT thì bỏ qua, không tính là mồ côi', () => {
    // Component chưa được nạp là chuyện khác hẳn với node đã bị xoá. Gộp hai chuyện
    // đó lại sẽ báo cả một cây override lành mạnh là rác — và người dùng bấm "gỡ
    // tất cả" thì mất thật.
    expect(
      findOrphanOverrides(doc({ i1: instance('i1', 'c-khong-co', { p1: {} }) }), comps({ c1: ['p1'] })),
    ).toEqual([]);
  });

  it('node không phải Instance thì bỏ qua', () => {
    expect(
      findOrphanOverrides(
        doc({ t1: { id: 't1', type: 'Text', parentId: null, children: [], style: { base: {} } } }),
        comps({ c1: ['p1'] }),
      ),
    ).toEqual([]);
  });

  it('instance không có override nào', () => {
    expect(findOrphanOverrides(doc({ i1: instance('i1', 'c1', {}) }), comps({ c1: ['p1'] }))).toEqual(
      [],
    );
  });

  it('nhiều instance, nhiều mồ côi — gom đủ', () => {
    const found = findOrphanOverrides(
      doc({
        i1: instance('i1', 'c1', { mat1: {}, p1: {} }),
        i2: instance('i2', 'c1', { mat2: {} }),
      }),
      comps({ c1: ['p1'] }),
    );
    expect(found).toHaveLength(2);
    expect(found.map((o) => o.localId).sort()).toEqual(['mat1', 'mat2']);
  });
});

describe('clearOverrideOps', () => {
  it('sinh setOverride với patch null — đúng op mà panel và AI dùng', () => {
    // Không thêm op mới cho "gỡ hàng loạt": nó là N lần của cùng một thao tác, nên
    // nó phải undo được bằng đúng cơ chế đó.
    expect(clearOverrideOps([{ nodeId: 'i1', localId: 'p2' }])).toEqual([
      { op: 'setOverride', nodeId: 'i1', localId: 'p2', patch: null },
    ]);
  });

  it('danh sách rỗng ra mảng rỗng, không ra một op vô nghĩa', () => {
    expect(clearOverrideOps([])).toEqual([]);
  });

  it('giữ đúng thứ tự đầu vào', () => {
    const ops = clearOverrideOps([
      { nodeId: 'a', localId: 'x' },
      { nodeId: 'b', localId: 'y' },
    ]);
    expect(ops.map((o) => o.nodeId)).toEqual(['a', 'b']);
  });
});
