import { describe, expect, it } from 'vitest';

import { stats } from './timing';

describe('stats', () => {
  it('rỗng thì không có phân vị', () => {
    expect(stats([])).toEqual({ n: 0, p50: null, p95: null });
  });

  it('p50 và p95 theo phương pháp nearest-rank', () => {
    const samples = Array.from({ length: 20 }, (_, i) => (i + 1) * 10); // 10..200
    expect(stats(samples)).toEqual({ n: 20, p50: 100, p95: 190 });
  });

  it('không phụ thuộc thứ tự mẫu', () => {
    expect(stats([300, 100, 200])).toEqual(stats([100, 200, 300]));
  });
});
