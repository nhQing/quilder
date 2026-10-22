import { beforeAll, describe, expect, it } from 'vitest';

import { CONFIRM_TTL_MS, issueConfirm, verifyConfirm } from './confirm-token';

beforeAll(() => {
  process.env.AUTH_SECRET = 'day-la-mot-auth-secret-du-dai-de-test-confirm';
});

const plan = { ids: ['a1', 'b2'], oldReleases: [{ id: 'r9', label: 'Publish 01/10' }] };
const NOW = 1_800_000_000_000;

describe('confirm token', () => {
  it('token của đúng danh sách thì qua', () => {
    const token = issueConfirm('assets.purge', plan, NOW);
    expect(verifyConfirm(token, 'assets.purge', plan, NOW + 1000)).toEqual({ ok: true });
  });

  it('không phụ thuộc thứ tự khoá', () => {
    const token = issueConfirm('assets.purge', plan, NOW);
    const reordered = { oldReleases: [{ label: 'Publish 01/10', id: 'r9' }], ids: ['a1', 'b2'] };
    expect(verifyConfirm(token, 'assets.purge', reordered, NOW).ok).toBe(true);
  });

  it('có release mới tham chiếu tới ảnh thì token không còn khớp', () => {
    // Đúng khe giữa lúc xem trước và lúc bấm xoá mà token này tồn tại để đóng.
    const token = issueConfirm('assets.purge', plan, NOW);
    const later = { ...plan, oldReleases: [...plan.oldReleases, { id: 'r10', label: 'Publish 02/10' }] };
    expect(verifyConfirm(token, 'assets.purge', later, NOW)).toEqual({ ok: false, reason: 'changed' });
  });

  it('token của hành động khác không dùng được', () => {
    const token = issueConfirm('pages.purge', plan, NOW);
    expect(verifyConfirm(token, 'assets.purge', plan, NOW)).toEqual({ ok: false, reason: 'changed' });
  });

  it('hết hạn sau 5 phút', () => {
    const token = issueConfirm('assets.purge', plan, NOW);
    expect(verifyConfirm(token, 'assets.purge', plan, NOW + CONFIRM_TTL_MS - 1).ok).toBe(true);
    expect(verifyConfirm(token, 'assets.purge', plan, NOW + CONFIRM_TTL_MS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('sửa hạn trong token thì chữ ký không khớp', () => {
    const token = issueConfirm('assets.purge', plan, NOW);
    const [, mac] = token.split('.');
    const forged = `${(NOW + 10 * CONFIRM_TTL_MS).toString(36)}.${mac}`;
    expect(verifyConfirm(forged, 'assets.purge', plan, NOW + 2 * CONFIRM_TTL_MS)).toEqual({
      ok: false,
      reason: 'changed',
    });
  });

  it('thiếu hoặc hỏng thì từ chối', () => {
    expect(verifyConfirm(undefined, 'x', plan, NOW).ok).toBe(false);
    expect(verifyConfirm('', 'x', plan, NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyConfirm('khong-co-dau-cham', 'x', plan, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });
});
