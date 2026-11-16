import { describe, expect, it } from 'vitest';

import { bulkTargets } from './bulk-status';

const rows = [
  { id: 'a', status: 'draft' },
  { id: 'b', status: 'published' },
  { id: 'c', status: 'draft' },
];

describe('bulkTargets', () => {
  it('toàn nháp → không có gì để "chuyển về nháp", đăng được cả', () => {
    const t = bulkTargets(rows, ['a', 'c']);
    expect(t.draft).toEqual([]);
    expect(t.publish).toEqual(['a', 'c']);
    expect(t.archive).toEqual(['a', 'c']);
  });

  it('toàn đã đăng → không có gì để "đăng"', () => {
    const t = bulkTargets(rows, ['b']);
    expect(t.publish).toEqual([]);
    expect(t.draft).toEqual(['b']);
  });

  it('lẫn lộn → mỗi hành động chỉ nhận dòng nó đổi được', () => {
    const t = bulkTargets(rows, ['a', 'b', 'c']);
    expect(t.publish).toEqual(['a', 'c']);
    expect(t.draft).toEqual(['b']);
    expect(t.archive).toEqual(['a', 'b', 'c']);
  });

  it('id không còn trên trang → gửi cho cả hai, để server quyết', () => {
    const t = bulkTargets(rows, ['zz']);
    expect(t.publish).toEqual(['zz']);
    expect(t.draft).toEqual(['zz']);
  });
});
