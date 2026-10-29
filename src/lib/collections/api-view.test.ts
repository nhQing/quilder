import { describe, expect, it } from 'vitest';

import { checkViewInput, mergeViewParams, normalizeViewQuery } from './api-view';

const merge = (stored: string, client: string, allow: string[]) =>
  mergeViewParams(stored, new URLSearchParams(client), allow);

describe('normalizeViewQuery', () => {
  it('bỏ dấu ? đầu và khoảng trắng, giữ nguyên thứ tự tham số', () => {
    const r = normalizeViewQuery('  ?fields=title,cover&populate[faq]=question&pageSize=20 ');
    expect(r).toEqual({ ok: true, query: 'fields=title%2Ccover&populate%5Bfaq%5D=question&pageSize=20' });
  });

  it('chuỗi rỗng là hợp lệ — view chỉ đổi tên đường gọi', () => {
    expect(normalizeViewQuery('')).toEqual({ ok: true, query: '' });
  });

  it('tham số API không biết bị từ chối — gõ "field=" thay vì "fields=" không được lọt im lặng', () => {
    const r = normalizeViewQuery('field=title');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('"field"');
  });

  it('nhận đủ các dạng có ngoặc', () => {
    expect(normalizeViewQuery('filter[price][gt]=10&populate[faq]=question').ok).toBe(true);
  });
});

describe('mergeViewParams', () => {
  it('client không gửi gì thì ra đúng query đã lưu', () => {
    const r = merge('fields=title&pageSize=20', '', []);
    expect(r.ok && r.params.toString()).toBe('fields=title&pageSize=20');
  });

  it('tham số không được cho phép bị 400, kèm danh sách được nhận', () => {
    const r = merge('fields=title', 'fields=title,body', ['page', 'locale']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('"fields"');
    expect(r.error).toContain('page, locale');
  });

  it('view không cho tham số nào thì nói đúng như vậy', () => {
    const r = merge('', 'page=2', []);
    expect(!r.ok && r.error).toContain('không nhận tham số nào');
  });

  it('tham số được phép THAY giá trị đã lưu', () => {
    const r = merge('pageSize=20&locale=vi', 'pageSize=5&locale=en', ['pageSize', 'locale']);
    expect(r.ok && r.params.get('pageSize')).toBe('5');
    expect(r.ok && r.params.getAll('locale')).toEqual(['en']);
  });

  it('sort của client thay CẢ danh sách sort đã lưu, không trộn', () => {
    const r = merge('sort=publishedAt:desc&sort=slug:asc', 'sort=updatedAt:desc', ['sort']);
    expect(r.ok && r.params.getAll('sort')).toEqual(['updatedAt:desc']);
  });

  it('filter của client CỘNG THÊM, không thay filter đã lưu — view không bị nới ra', () => {
    const r = merge('filter[featured][eq]=true', 'filter[featured][eq]=false&filter[price][gt]=5', ['filter']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.getAll('filter[featured][eq]')).toEqual(['true', 'false']);
    expect(r.params.get('filter[price][gt]')).toBe('5');
  });

  it('populate và fields không bao giờ cho client đổi — đó là phần view cố định', () => {
    expect(merge('', 'populate[faq]=secret', ['filter']).ok).toBe(false);
  });
});

describe('checkViewInput', () => {
  const ok = { key: 'mobile-news', name: 'Tin cho app', typeKey: 'news', query: '', allow: ['page'] };

  it('hợp lệ', () => {
    expect(checkViewInput(ok)).toEqual({ ok: true });
  });

  it('khoá chỉ chữ thường, số, gạch ngang — nó nằm trên URL', () => {
    expect(checkViewInput({ ...ok, key: 'Mobile News' }).ok).toBe(false);
    expect(checkViewInput({ ...ok, key: '-a' }).ok).toBe(false);
    expect(checkViewInput({ ...ok, key: 'a' }).ok).toBe(true);
  });

  it('thiếu tên hoặc loại bị từ chối', () => {
    expect(checkViewInput({ ...ok, name: '  ' }).ok).toBe(false);
    expect(checkViewInput({ ...ok, typeKey: '' }).ok).toBe(false);
  });

  it('tham số cho phép phải nằm trong danh sách biết trước', () => {
    expect(checkViewInput({ ...ok, allow: ['populate'] }).ok).toBe(false);
  });
});
