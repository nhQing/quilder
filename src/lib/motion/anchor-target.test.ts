import { describe, expect, it } from 'vitest';

import { anchorOffset, FIELD_OFFSET, isFocusableTarget, SECTION_OFFSET } from './anchor-target';

const el = (tagName: string, attrs: Record<string, string> = {}) => ({
  tagName,
  hasAttribute: (name: string) => name in attrs,
  getAttribute: (name: string) => attrs[name] ?? null,
});

describe('isFocusableTarget', () => {
  it('nhận input, textarea, select, button', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']) {
      expect(isFocusableTarget(el(tag))).toBe(true);
    }
  });

  it('loại input ẩn và phần tử bị vô hiệu hoá', () => {
    expect(isFocusableTarget(el('INPUT', { type: 'hidden' }))).toBe(false);
    expect(isFocusableTarget(el('INPUT', { disabled: '' }))).toBe(false);
  });

  it('nhận phần tử có tabindex, loại phần tử thường', () => {
    expect(isFocusableTarget(el('DIV', { tabindex: '-1' }))).toBe(true);
    expect(isFocusableTarget(el('SECTION'))).toBe(false);
  });
});

describe('anchorOffset', () => {
  it('neo section giữ offset cũ', () => {
    expect(anchorOffset(false, 200)).toBe(SECTION_OFFSET);
  });

  it('trường nhập: tối thiểu -120', () => {
    expect(anchorOffset(true, 0)).toBe(FIELD_OFFSET);
    expect(anchorOffset(true, 54)).toBe(FIELD_OFFSET);
  });

  it('trường nhập: nav cao hơn thì theo nav cộng khoảng thở', () => {
    expect(anchorOffset(true, 150)).toBe(-174);
  });
});
