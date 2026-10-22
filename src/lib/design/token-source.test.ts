import { describe, expect, it } from 'vitest';

import { allDeclaredNames, rootTokens, themeOnlyNames } from './token-source';

/**
 * Fixture cố ý dựng lại đúng hình dạng của `tokens.css` thật: một `:root` mang
 * theme tối, rồi một `[data-theme="light"]` ở cuối ghi đè vài token.
 */
const CSS = `
:root {
  --color-ink: #0b0b0f;
  --color-bone: #f4f1ea;
  /* FIGMA VAR Neutral/900 */
  --color-bg: var(--color-ink);
  --color-fg: var(--color-bone);
  --space-m: 1.5rem;
}

:root {
  --space-l: 2.25rem;
  --space-m: 1.6rem;
}

[data-theme="light"] {
  --color-bg: var(--color-bone);
  --color-fg: var(--color-ink);
  --color-only-light: #123456;
}
`;

describe('rootTokens', () => {
  it('KHÔNG để [data-theme="light"] ghi đè giá trị :root', () => {
    const t = rootTokens(CSS);
    // Đây là chính bug của 25/08/2026: bảng Token từng giữ giá trị theme sáng.
    expect(t.get('color-bg')?.value).toBe('var(--color-ink)');
    expect(t.get('color-fg')?.value).toBe('var(--color-bone)');
  });

  it('vẫn để một :root sau ghi đè :root trước — đó là cascade thật', () => {
    expect(rootTokens(CSS).get('space-m')?.value).toBe('1.6rem');
    expect(rootTokens(CSS).get('space-l')?.value).toBe('2.25rem');
  });

  it('KHÔNG để :root trong @media ghi đè giá trị gốc', () => {
    // Bộ token live đổi `--lv-gutter` 100 → 24 dưới 1200px. Bảng Token phải giữ
    // giá trị GỐC; giá trị theo khổ màn là việc của cascade lúc chạy.
    const css = `
      :root { --lv-gutter: 100px; }
      @media (max-width: 1199px) { :root { --lv-gutter: 24px; } }`;
    expect(rootTokens(css).get('lv-gutter')?.value).toBe('100px');
  });

  it('bỏ hẳn token chỉ tồn tại trong khối theme', () => {
    expect(rootTokens(CSS).has('color-only-light')).toBe(false);
  });

  it('giữ comment provenance', () => {
    expect(rootTokens(CSS).get('color-bg')?.comment).toBe('FIGMA VAR Neutral/900');
  });
});

describe('allDeclaredNames', () => {
  it('gồm cả token của khối theme — "tên có tồn tại" khác "giá trị đang dùng"', () => {
    const names = allDeclaredNames(CSS);
    expect(names.has('color-only-light')).toBe(true);
    expect(names.has('color-bg')).toBe(true);
  });
});

describe('themeOnlyNames', () => {
  it('nêu đúng token thiếu ở :root', () => {
    expect(themeOnlyNames(CSS)).toEqual(['color-only-light']);
  });
});
