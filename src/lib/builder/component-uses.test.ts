import { describe, expect, it } from 'vitest';

import type { Doc } from '@/lib/doc/types';

import { instancesOf } from './component-uses';

const node = (id: string, type: string, children: string[] = [], extra: Record<string, unknown> = {}) => ({
  id, type, parentId: null, children, props: {}, ...extra,
});

/*
 * root ─ s1 ─ hero(A)
 *      │    └ cta(B)
 *      └ s2 ─ quote(A)
 * `doc.nodes` cố ý xếp quote TRƯỚC hero: thứ tự phải theo trang, không theo khoá.
 */
const doc = {
  rootId: 'root',
  nodes: {
    quote: node('quote', 'Instance', [], { componentId: 'A', overrides: {} }),
    root: node('root', 'Section', ['s1', 's2']),
    s1: node('s1', 'Stack', ['hero', 'cta']),
    s2: node('s2', 'Stack', ['quote']),
    hero: node('hero', 'Instance', [], { componentId: 'A', overrides: {} }),
    cta: node('cta', 'Instance', [], { componentId: 'B', overrides: {} }),
  },
} as unknown as Doc;

describe('instancesOf', () => {
  it('trả các chỗ dùng theo thứ tự trên trang', () => {
    expect(instancesOf(doc, 'A')).toEqual(['hero', 'quote']);
    expect(instancesOf(doc, 'B')).toEqual(['cta']);
  });

  it('component không dùng trên trang → rỗng', () => {
    expect(instancesOf(doc, 'C')).toEqual([]);
  });
});
