import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { parseImportTarget } from './target';

describe('parseImportTarget', () => {
  it('nhận đúng hai dạng hợp lệ', () => {
    expect(parseImportTarget({ kind: 'existing', pageId: 'p1', extra: 1 })).toEqual({ kind: 'existing', pageId: 'p1' });
    expect(parseImportTarget({ kind: 'new', slug: 's', title: 'T' })).toEqual({ kind: 'new', slug: 's', title: 'T' });
  });
  it('mọi thứ khác là null', () => {
    const bads: unknown[] = [undefined, null, 'x', 5, [], {}, { kind: 'existing' }, { kind: 'existing', pageId: 1 }, { kind: 'new', slug: 's' }, { kind: 'other', pageId: 'p' }];
    for (const bad of bads) expect(parseImportTarget(bad)).toBeNull();
  });
});
