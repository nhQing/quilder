import { describe, expect, it } from 'vitest';
import { cssFamilyName, fontFaceCss } from './css';
import { EMPTY_FONT_SEAL, type FontSeal } from './types';

const face = (key: string, weight = '400', unicodeRange = '') => ({
  key,
  weight,
  style: 'normal' as const,
  unicodeRange,
});

describe('fontFaceCss', () => {
  it('họ hai face ra hai khối @font-face', () => {
    const seal: FontSeal = {
      families: [
        {
          slug: 'x',
          cssName: 'X',
          faces: [
            face('public/builder/x-ab12cd34.woff2', '400', 'U+0000-00FF'),
            face('public/builder/y-ab12cd34.woff2', '700'),
          ],
        },
      ],
    };
    const css = fontFaceCss(seal);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('font-display: swap;');
    expect(css).toContain('src: url("/mm-font/public/builder/x-ab12cd34.woff2") format("woff2");');
    expect(css).toContain('unicode-range: U+0000-00FF;');
  });

  it('unicodeRange rỗng thì không có dòng unicode-range', () => {
    const css = fontFaceCss({
      families: [{ slug: 'x', cssName: 'X', faces: [face('public/a.woff2')] }],
    });
    expect(css).not.toContain('unicode-range');
  });

  it('escape nháy kép và gạch chéo ngược', () => {
    const css = fontFaceCss({
      families: [{ slug: 'x', cssName: 'Be "Vietnam" \\ Pro', faces: [face('public/a.woff2')] }],
    });
    expect(css).toContain('font-family: "Be \\"Vietnam\\" \\\\ Pro";');
  });

  it('tên chứa </style> không thoát khỏi thẻ style', () => {
    const css = fontFaceCss({
      families: [{ slug: 'x', cssName: 'a</style><script>', faces: [face('public/a.woff2')] }],
    });
    expect(css).not.toContain('</style');
    expect(cssFamilyName('<')).toBe('"\\3c "');
  });

  it('khoá có " hoặc ) thì bỏ face đó', () => {
    const css = fontFaceCss({
      families: [
        {
          slug: 'x',
          cssName: 'X',
          faces: [face('public/a").woff2'), face('public/a)b.woff2'), face('public/ok.woff2')],
        },
      ],
    });
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).toContain('public/ok.woff2');
  });

  it('seal rỗng ra chuỗi rỗng', () => {
    expect(fontFaceCss(EMPTY_FONT_SEAL)).toBe('');
  });

  it('xáo thứ tự vẫn ra cùng chuỗi', () => {
    const a = { slug: 'a', cssName: 'A', faces: [face('public/a4.woff2', '400'), face('public/a7.woff2', '700')] };
    const b = { slug: 'b', cssName: 'B', faces: [face('public/b.woff2')] };
    const one = fontFaceCss({ families: [a, b] });
    const two = fontFaceCss({ families: [{ ...b }, { ...a, faces: [...a.faces].reverse() }] });
    expect(two).toBe(one);
  });
});
