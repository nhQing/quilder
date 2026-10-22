import { describe, expect, it, vi } from 'vitest';

/**
 * `getEntryActivity` — tác giả, người tạo thật, người sửa, lịch sử; đọc gom, không N+1.
 *
 * Ca chính phải giữ: ĐỔI TÁC GIẢ (`entry.author`) ghi đè `createdBy`, nhưng "Người tạo"
 * vẫn là người bấm tạo bài — đọc từ dòng `entry.create` của nhật ký, không từ `createdBy`.
 */

const AT = new Date('2026-10-22T03:00:00.000Z');

vi.mock('@/lib/db', () => ({
  prisma: {
    auditLog: {
      // Dòng 'entry.create' đọc RIÊNG: bài sửa nhiều thì nó trôi khỏi 20 dòng gần nhất.
      findFirst: vi.fn(async () => ({ userId: 'u-nhap' })),
      findMany: vi.fn(async () => [
        { id: 'l3', userId: 'u-admin', action: 'entry.author', meta: { to: 'quynh@x.vn' }, createdAt: AT },
        { id: 'l2', userId: 'u-bien', action: 'entry.update', meta: { fields: ['title'], locales: [] }, createdAt: AT },
        { id: 'l1', userId: 'u-nhap', action: 'entry.create', meta: {}, createdAt: AT },
      ]),
    },
    user: {
      findMany: vi.fn(async () => [
        { id: 'u-nhap', email: 'nhap@x.vn', name: null, avatarAssetId: null, lockedAt: null },
        { id: 'u-bien', email: 'bien@x.vn', name: 'Biên tập', avatarAssetId: null, lockedAt: null },
        { id: 'u-admin', email: 'admin@x.vn', name: 'Admin', avatarAssetId: null, lockedAt: null },
        { id: 'u-quynh', email: 'quynh@x.vn', name: 'Quỳnh', avatarAssetId: 'av1', lockedAt: null },
      ]),
    },
    asset: { findMany: vi.fn(async () => [{ id: 'av1', url: 'https://cdn/q.webp' }]) },
  },
}));

const { getEntryActivity } = await import('./admin-queries');

describe('getEntryActivity', () => {
  it('tác giả là createdBy; người tạo thật lấy từ dòng entry.create', async () => {
    const a = await getEntryActivity({ id: 'e1', createdBy: 'quynh@x.vn', updatedBy: 'bien@x.vn' });
    expect(a.writer).toEqual({ name: 'Quỳnh', email: 'quynh@x.vn', avatarUrl: 'https://cdn/q.webp' });
    expect(a.createdBy).toEqual({ name: null, email: 'nhap@x.vn', avatarUrl: null });
    expect(a.updatedBy?.name).toBe('Biên tập');
    expect(a.history.map((h) => h.label)).toEqual(['Đổi tác giả', 'Sửa nội dung', 'Tạo bài']);
    expect(a.history[0]!.person?.name).toBe('Admin');
  });
});
