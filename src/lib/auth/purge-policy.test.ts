import { describe, expect, it } from 'vitest';

import { canPurgeContent, PURGE_DENIED } from './session';

/** 23/11/2026: xoá hẳn trang và bài viết chỉ dành cho Quản trị. Lưu trữ thì vai Sửa vẫn làm. */
describe('canPurgeContent — ai được xoá hẳn trang / bài viết', () => {
  it('Quản trị đăng nhập: được', () => {
    expect(canPurgeContent({ role: 'admin', kind: 'user' })).toBe(true);
    expect(canPurgeContent({ role: 'admin' })).toBe(true);
  });

  it('Sửa và Xem: không', () => {
    expect(canPurgeContent({ role: 'editor', kind: 'user' })).toBe(false);
    expect(canPurgeContent({ role: 'viewer', kind: 'user' })).toBe(false);
  });

  it('token service (AI) không xoá hẳn được, kể cả token do admin cấp', () => {
    expect(canPurgeContent({ role: 'admin', kind: 'service' })).toBe(false);
  });

  it('câu từ chối nói rõ ai được và lối khác là lưu trữ', () => {
    expect(PURGE_DENIED).toMatch(/Quản trị/);
    expect(PURGE_DENIED).toMatch(/lưu trữ/i);
  });
});
