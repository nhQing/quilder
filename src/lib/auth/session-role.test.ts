import { describe, expect, it } from 'vitest';

import { can, lowerRole } from './session';

describe('lowerRole', () => {
  it('hạ quyền trong DB thì phiên bị hạ theo', () => {
    expect(lowerRole('admin', 'editor')).toBe('editor');
    expect(lowerRole('admin', 'viewer')).toBe('viewer');
    expect(lowerRole('editor', 'viewer')).toBe('viewer');
  });

  it('nâng quyền trong DB KHÔNG nâng phiên cũ', () => {
    // Token service mang role lúc được cấp. Nâng người cấp lên admin về sau
    // không được âm thầm biến mọi token họ từng cấp thành token admin.
    expect(lowerRole('editor', 'admin')).toBe('editor');
    expect(lowerRole('viewer', 'admin')).toBe('viewer');
  });

  it('role giống nhau thì giữ nguyên', () => {
    for (const role of ['viewer', 'editor', 'admin'] as const) {
      expect(lowerRole(role, role)).toBe(role);
    }
  });

  it('giá trị lạ trong DB tính là viewer', () => {
    expect(lowerRole('admin', 'superadmin')).toBe('viewer');
    expect(lowerRole('editor', '')).toBe('viewer');
  });

  it('admin bị hạ xuống editor thì mất quyền admin ngay', () => {
    expect(can(lowerRole('admin', 'editor'), 'admin')).toBe(false);
    expect(can(lowerRole('admin', 'editor'), 'write')).toBe(true);
  });
});
