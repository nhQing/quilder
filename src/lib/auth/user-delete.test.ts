import { describe, expect, it } from 'vitest';

import { DELETE_AFTER_DAYS, deleteEligibility } from './user-delete';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-19T10:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('deleteEligibility — xoá tài khoản đã khoá đủ lâu (19/11/2026)', () => {
  it('mốc là 30 ngày', () => {
    expect(DELETE_AFTER_DAYS).toBe(30);
  });

  it('đã khoá đủ 30 ngày, không đứng tên bài nào: xoá được', () => {
    expect(deleteEligibility({ lockedAt: ago(30), entryCount: 0, isSelf: false, now: NOW })).toEqual({ ok: true });
    expect(deleteEligibility({ lockedAt: ago(400), entryCount: 0, isSelf: false, now: NOW })).toEqual({ ok: true });
  });

  it('chưa khoá: không xoá — phải khoá trước', () => {
    const r = deleteEligibility({ lockedAt: null, entryCount: 0, isSelf: false, now: NOW });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/chưa bị khoá/i);
  });

  it('khoá chưa đủ 30 ngày: nói ngày xoá được', () => {
    const r = deleteEligibility({ lockedAt: ago(29.5), entryCount: 0, isSelf: false, now: NOW });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/30 ngày/);
    expect(!r.ok && r.availableAt?.getTime()).toBe(ago(29.5).getTime() + 30 * DAY);
  });

  it('còn đứng tên bài viết: không xoá — tên tác giả trên site sẽ mồ côi (khoá ngoại Restrict)', () => {
    const r = deleteEligibility({ lockedAt: ago(90), entryCount: 3, isSelf: false, now: NOW });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/3 bài/);
  });

  it('không tự xoá chính mình', () => {
    expect(deleteEligibility({ lockedAt: ago(90), entryCount: 0, isSelf: true, now: NOW }).ok).toBe(false);
  });
});
