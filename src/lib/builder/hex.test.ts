import { describe, expect, it } from 'vitest';

import { dropAlpha, hasAlpha, normalizeHex, toPickerHex } from './hex';

describe('normalizeHex', () => {
  it('nở dạng viết tắt 3 và 4 chữ số', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('#f0c8')).toBe('#ff00cc88');
  });

  it('nhận thiếu dấu # và hạ về chữ thường', () => {
    expect(normalizeHex('0D1321')).toBe('#0d1321');
    expect(normalizeHex('  #FF4D2E  ')).toBe('#ff4d2e');
  });

  it('giữ nguyên 6 và 8 chữ số', () => {
    expect(normalizeHex('#0d1321')).toBe('#0d1321');
    expect(normalizeHex('#0d132180')).toBe('#0d132180');
  });

  /*
   * Mọi thứ ở đây từng làm bánh xe nhảy về đen mà không một dòng lỗi — xem
   * docblock của file. Đó là lý do hàm này trả `null` chứ không trả một màu.
   */
  it('trả null cho thứ không phải hex', () => {
    for (const bad of ['', '   ', 'var(--color-ink)', 'rgb(1 2 3)', '#ab', '#abcde', '#zzz', '#0d13218']) {
      expect(normalizeHex(bad), bad).toBeNull();
    }
  });
});

describe('hasAlpha', () => {
  it('chỉ true khi có alpha VÀ alpha không phải ff', () => {
    expect(hasAlpha('#0d132180')).toBe(true);
    expect(hasAlpha('#0d1321ff')).toBe(false);
    expect(hasAlpha('#0d1321')).toBe(false);
    expect(hasAlpha('khong-phai-hex')).toBe(false);
  });
});

describe('dropAlpha', () => {
  it('cắt kênh alpha, giữ nguyên hex 6', () => {
    expect(dropAlpha('#0d132180')).toBe('#0d1321');
    expect(dropAlpha('#abc')).toBe('#aabbcc');
    expect(dropAlpha('var(--x)')).toBeNull();
  });
});

describe('toPickerHex', () => {
  it('dùng giá trị hiện tại khi nó đọc được', () => {
    expect(toPickerHex('#ABC', '#000000')).toBe('#aabbcc');
  });

  it('rơi về fallback khi giá trị là token hay var()', () => {
    expect(toPickerHex('var(--color-ink)', '#ff4d2e')).toBe('#ff4d2e');
    expect(toPickerHex('', '#ff4d2e')).toBe('#ff4d2e');
  });

  it('fallback hỏng nữa thì vẫn trả một hex hợp lệ, không trả rỗng', () => {
    expect(toPickerHex('var(--a)', 'var(--b)')).toBe('#000000');
  });

  it('bản không-alpha luôn trả 6 chữ số; bản alpha luôn trả 8', () => {
    expect(toPickerHex('#0d132180', '#000000')).toBe('#0d1321');
    expect(toPickerHex('#0d1321', '#000000', true)).toBe('#0d1321ff');
    expect(toPickerHex('#0d132180', '#000000', true)).toBe('#0d132180');
  });
});
