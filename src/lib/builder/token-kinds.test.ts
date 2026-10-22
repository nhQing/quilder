import { describe, expect, it } from 'vitest';

import { matchToken, shortTokenValue, tokensOfKind } from './token-kinds';

const T = [
  { name: 'space-m', value: '1rem', category: 'space' },
  { name: 'gutter', value: 'clamp(1.15rem, 0.6rem + 2.6vw, 3.5rem)', category: 'space' },
  { name: 'color-bg', value: '#ffffff', category: 'color' },
  { name: 'tracking-tight', value: '-0.02em', category: 'typography' },
  { name: 'font-display', value: '"Gilroy"', category: 'typography' },
  { name: 'dur-fast', value: '0.28s', category: 'duration' },
];

describe('tokensOfKind', () => {
  it('không khai loại thì không có token nào — không bao giờ "tất cả"', () => {
    expect(tokensOfKind(T, undefined)).toEqual([]);
  });

  it('lọc theo category', () => {
    expect(tokensOfKind(T, 'space').map((t) => t.name)).toEqual(['space-m', 'gutter']);
  });

  it('tracking chỉ lấy tracking-*, không lấy font-*', () => {
    expect(tokensOfKind(T, 'tracking').map((t) => t.name)).toEqual(['tracking-tight']);
  });
});

describe('shortTokenValue', () => {
  it('clamp() thành khoảng', () => {
    expect(shortTokenValue('clamp(1.15rem, 0.6rem + 2.6vw, 3.5rem)')).toBe('1.15–3.5rem ↔');
    expect(shortTokenValue('clamp(6rem, 4rem + 9vw, 12rem)')).toBe('6–12rem ↔');
  });

  it('khác đơn vị thì giữ cả hai', () => {
    expect(shortTokenValue('clamp(16px, 1rem + 1vw, 2rem)')).toBe('16px–2rem ↔');
  });

  it('giá trị thường giữ nguyên, dài quá thì cắt', () => {
    expect(shortTokenValue('1rem')).toBe('1rem');
    expect(shortTokenValue('cubic-bezier(0.34, 1.56, 0.64, 1) and more')).toMatch(/…$/);
  });
});

describe('matchToken', () => {
  it('khớp tên hoặc giá trị', () => {
    expect(matchToken(T[0]!, 'SPACE')).toBe(true);
    expect(matchToken(T[2]!, 'fff')).toBe(true);
    expect(matchToken(T[2]!, 'space')).toBe(false);
  });
});
