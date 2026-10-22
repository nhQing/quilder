import { describe, expect, it } from 'vitest';

import * as foundations from './foundations';
import { isEmittableOverride } from './foundations';

/*
 * Mục Nền tảng bị gỡ ngày 13/10/2026 — xem docblock đầu `foundations.ts`. Hai nửa
 * phải đi cùng nhau: không còn đường SỬA, nhưng giá trị đã sửa trước đó VẪN phát ra
 * site. Mất nửa sau là site lật sang nền gần đen (`color-bg` đang được đè thành
 * `#ffffff` trên nền gốc `--color-ink`), ở mọi release kể cả khi rollback.
 */
describe('giá trị đè đóng băng', () => {
  // Đúng 7 hàng đang có `baseValue` trong DB lúc gỡ, cộng các biến còn lại của mục cũ.
  const LIVE: [string, string][] = [
    ['color-bg', '#ffffff'],
    ['color-fg', '#1d1d1d'],
    ['color-accent', '#8430d3'],
    ['color-accent-cool', '#e017eb'],
    ['color-muted', '#232323'],
    ['radius-m', '0px'],
    ['space-m', '1rem'],
    ['font-body', '"SF Pro Text", system-ui, sans-serif'],
    ['font-display', '"SF Pro Display", system-ui, sans-serif'],
    ['step-0', 'clamp(0.95rem, 0.9rem + 0.22vw, 1.08rem)'],
    ['leading-body', '1.62'],
    ['measure', '62ch'],
  ];

  it('mọi giá trị đang đè vẫn được phát', () => {
    for (const [name, value] of LIVE) expect(isEmittableOverride(name, value), name).toBe(true);
  });

  it('chỉ 12 biến của mục cũ — token tĩnh khác không được đè', () => {
    expect(isEmittableOverride('mm-surface', '#ffffff')).toBe(false);
    expect(isEmittableOverride('lv-brand', '#6937ff')).toBe(false);
  });

  /*
   * Giá trị đi THẲNG vào một chuỗi stylesheet. Dữ liệu có thể vào bảng bằng
   * `prisma studio` hay một script, nên luật kiểm theo kiểu vẫn giữ ở đầu ra.
   */
  it('vẫn kiểm theo kiểu khi phát', () => {
    expect(isEmittableOverride('color-bg', 'var(--color-ink)')).toBe(false);
    expect(isEmittableOverride('color-bg', 'rgb(11 11 15)')).toBe(false);
    expect(isEmittableOverride('space-m', '24')).toBe(false);
    expect(isEmittableOverride('leading-body', '1.62rem')).toBe(false);
    expect(isEmittableOverride('step-0', 'clamp(1rem, 2vw, 3rem)')).toBe(false);
    expect(isEmittableOverride('font-body', 'x; background: url(evil)')).toBe(false);
    expect(isEmittableOverride('font-display', 'x} body{display:none')).toBe(false);
    expect(isEmittableOverride('font-display', 'a /* c */ b')).toBe(false);
    expect(isEmittableOverride('font-body', '   ')).toBe(false);
    expect(isEmittableOverride('font-body', 'a'.repeat(201))).toBe(false);
  });

  it('không còn xuất ra thứ gì để SỬA', () => {
    const api = foundations as Record<string, unknown>;
    for (const gone of ['FOUNDATIONS', 'FOUNDATION_BY_NAME', 'FOUNDATION_GROUPS', 'FOUNDATION_PRESETS', 'validateFoundationValue', 'presetsFor']) {
      expect(api[gone], gone).toBeUndefined();
    }
  });
});
