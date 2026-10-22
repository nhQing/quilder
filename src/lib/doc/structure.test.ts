import { describe, expect, it } from 'vitest';

import { structuralIssues } from './structure';

const n = (id: string, parentId: string | null, children: string[] = []) => ({ id, parentId, children });

describe('structuralIssues', () => {
  it('cây lành: không có lỗi', () => {
    expect(structuralIssues({ rootId: 'r', nodes: { r: n('r', null, ['a']), a: n('a', 'r') } })).toEqual([]);
  });

  it('rootId không trỏ tới node nào', () => {
    expect(structuralIssues({ rootId: 'r', nodes: {} }).map((i) => i.code)).toEqual(['no-root']);
  });

  it('mồ côi, cha không có, không nằm trong children của cha', () => {
    const codes = structuralIssues({
      rootId: 'r',
      nodes: { r: n('r', null, []), a: n('a', null), b: n('b', 'x'), c: n('c', 'r') },
    }).map((i) => i.code);
    expect(codes).toEqual(['orphan', 'bad-parent', 'not-in-parent']);
  });

  it('con không tồn tại, con trùng', () => {
    const codes = structuralIssues({ rootId: 'r', nodes: { r: n('r', null, ['a', 'a', 'z']), a: n('a', 'r') } }).map((i) => i.code);
    expect(codes).toEqual(['duplicate-child', 'bad-child']);
  });

  it('cycle', () => {
    const issues = structuralIssues({ rootId: 'r', nodes: { r: n('r', null, ['a']), a: n('a', 'b', ['b']), b: n('b', 'a', ['a']) } });
    expect(issues.some((i) => i.code === 'cycle')).toBe(true);
  });
});
