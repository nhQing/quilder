import { describe, expect, it } from 'vitest';

import { activityLabel, personLabel } from './entry-activity';

describe('activityLabel — dòng nhật ký đọc được cho biên tập viên', () => {
  it('tạo, đăng, gỡ, lưu trữ, khôi phục, đổi tác giả', () => {
    expect(activityLabel('entry.create', {})).toBe('Tạo bài');
    expect(activityLabel('entry.published', {})).toBe('Đăng');
    expect(activityLabel('entry.draft', {})).toBe('Gỡ xuống bản nháp');
    expect(activityLabel('entry.archive', {})).toBe('Đưa vào lưu trữ');
    expect(activityLabel('entry.unarchive', {})).toBe('Khôi phục từ lưu trữ');
    expect(activityLabel('entry.author', {})).toBe('Đổi tác giả');
  });

  it('sửa: nói rõ bản gốc hay bản dịch nào', () => {
    expect(activityLabel('entry.update', { fields: ['title'], locales: [] })).toBe('Sửa nội dung');
    expect(activityLabel('entry.update', { fields: [], locales: ['en'] })).toBe('Sửa bản EN');
    expect(activityLabel('entry.update', { fields: ['title'], locales: ['en'] })).toBe('Sửa nội dung và bản EN');
    expect(activityLabel('entry.update', { fields: [], locales: [] })).toBe('Đổi danh mục');
  });

  it('bản dịch: đăng / gỡ theo ngôn ngữ', () => {
    expect(activityLabel('entry.locale.published', { locale: 'en' })).toBe('Đăng bản EN');
    expect(activityLabel('entry.locale.draft', { locale: 'en' })).toBe('Gỡ bản EN xuống bản nháp');
  });

  it('meta rác hoặc action lạ: không ném, trả nguyên action', () => {
    expect(activityLabel('entry.update', null)).toBe('Sửa nội dung');
    expect(activityLabel('entry.khac', 'rác')).toBe('entry.khac');
  });
});

describe('personLabel', () => {
  it('tên, rơi về email; tài khoản đã xoá thì nói ra', () => {
    expect(personLabel({ name: ' Quỳnh ', email: 'q@x.vn' })).toBe('Quỳnh');
    expect(personLabel({ name: null, email: 'q@x.vn' })).toBe('q@x.vn');
    expect(personLabel(null)).toBe('Tài khoản đã xoá');
  });
});
