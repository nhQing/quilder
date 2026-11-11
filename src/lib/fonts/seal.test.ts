import { describe, expect, it } from 'vitest';
import { fontSealOf } from './seal';
import { EMPTY_FONT_SEAL } from './types';

const good = {
  slug: 'a',
  cssName: 'A',
  faces: [{ key: 'public/a.woff2', weight: '400', style: 'normal', unicodeRange: '' }],
};

describe('fontSealOf', () => {
  it('null/undefined/rác ra rỗng', () => {
    expect(fontSealOf(null)).toEqual(EMPTY_FONT_SEAL);
    expect(fontSealOf(undefined)).toEqual(EMPTY_FONT_SEAL);
    expect(fontSealOf({ families: 'x' })).toEqual(EMPTY_FONT_SEAL);
    expect(fontSealOf('x')).toEqual(EMPTY_FONT_SEAL);
  });
  it('họ thiếu slug bị bỏ, họ còn lại giữ nguyên', () => {
    const seal = fontSealOf({ families: [{ cssName: 'B', faces: [] }, good] });
    expect(seal.families).toEqual([good]);
  });
  it('face style oblique bị bỏ', () => {
    const seal = fontSealOf({
      families: [
        {
          ...good,
          faces: [
            ...good.faces,
            { key: 'public/b.woff2', weight: '400', style: 'oblique', unicodeRange: '' },
          ],
        },
      ],
    });
    expect(seal.families[0]!.faces).toHaveLength(1);
  });
});
