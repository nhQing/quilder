import { describe, expect, it } from 'vitest';

import { defaultImageSizes } from './image-sizes';

describe('defaultImageSizes', () => {
  it('node.sizes của tác giả luôn thắng', () => {
    expect(defaultImageSizes('(min-width: 1024px) 937px, 90vw', 2811)).toBe('(min-width: 1024px) 937px, 90vw');
  });
  it('không có sizes: khung nhìn, chặn trên ở cỡ gốc', () => {
    expect(defaultImageSizes(undefined, 2811)).toBe('(max-width: 2811px) 100vw, 2811px');
    expect(defaultImageSizes('  ', 426)).toBe('(max-width: 426px) 100vw, 426px');
  });
  it('không biết cỡ gốc: 100vw', () => {
    expect(defaultImageSizes(undefined, null)).toBe('100vw');
  });
});
