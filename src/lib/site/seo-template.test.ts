import { describe, expect, it } from 'vitest';

import { applyTitleTemplate, checkTitleTemplate } from './seo-template';

describe('checkTitleTemplate', () => {
  it('rỗng là hợp lệ (tắt)', () => {
    expect(checkTitleTemplate('')).toBeNull();
    expect(checkTitleTemplate('   ')).toBeNull();
  });

  it('cần đúng một %s', () => {
    expect(checkTitleTemplate('%s · Bánh')).toBeNull();
    expect(checkTitleTemplate('Bánh')).not.toBeNull();
    expect(checkTitleTemplate('%s %s')).not.toBeNull();
  });

  it('trần độ dài', () => {
    expect(checkTitleTemplate('%s' + 'x'.repeat(200))).not.toBeNull();
  });
});

describe('applyTitleTemplate', () => {
  it('bọc tiêu đề', () => {
    expect(applyTitleTemplate('%s · Bánh', 'Giới thiệu')).toBe('Giới thiệu · Bánh');
  });

  it('template trống hoặc sai thì giữ nguyên tiêu đề', () => {
    expect(applyTitleTemplate(null, 'A')).toBe('A');
    expect(applyTitleTemplate('không có chỗ', 'A')).toBe('A');
  });
});
