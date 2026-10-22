import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Upload trùng nội dung với ảnh đang ở thùng rác phải TỰ KHÔI PHỤC ảnh đó.
 *
 * Khoá S3 tính từ nội dung, nên người dùng tải lại đúng file đã bỏ vào rác sẽ
 * trúng hàng cũ. Nếu hàng cũ vẫn mang cờ trashedAt, ảnh "upload thành công" mà
 * không hiện trong picker. Test này khoá hành vi: xoá cờ, ghi AuditLog
 * `asset.restore` (via: upload), trả `restored: true`, và không ghi S3 lại.
 */

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  auditCreate: vi.fn(),
  ensureFolderRows: vi.fn(),
  putObject: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    asset: { findUnique: m.findUnique, update: m.update },
    auditLog: { create: m.auditCreate },
  },
}));
vi.mock('@/lib/builder/asset-folders', () => ({ ensureFolderRows: m.ensureFolderRows }));
vi.mock('@/lib/assets/s3', () => ({ putObject: m.putObject, objectUrl: (k: string) => `https://cdn/${k}` }));
vi.mock('@/lib/assets/sniff', () => ({ sniff: () => ({ mime: 'image/png', width: 10, height: 10 }) }));

import { uploadAsset } from './upload-asset';

const row = {
  id: 'a1', key: 'public/builder/x.png', url: 'https://cdn/x', mime: 'image/png',
  width: 10, height: 10, bytes: 3, folder: 'trang-chu',
};
const args = { bytes: new Uint8Array([1, 2, 3]), fileName: 'x.png', actorEmail: 'a@b.c', actorSub: 'u1' };

describe('uploadAsset: khôi phục từ thùng rác', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hàng trùng đang ở rác: xoá cờ, ghi audit, restored true', async () => {
    m.findUnique.mockResolvedValue({ ...row, trashedAt: new Date() });
    const r = await uploadAsset(args);

    expect(r.ok && r.asset.restored).toBe(true);
    expect(r.ok && r.asset.reused).toBe(true);
    expect(m.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { trashedAt: null, trashedBy: null },
    });
    expect(m.ensureFolderRows).toHaveBeenCalledWith(['trang-chu'], 'u1');
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    const audit = m.auditCreate.mock.calls[0]![0].data;
    expect(audit.action).toBe('asset.restore');
    expect(audit.meta).toMatchObject({ via: 'upload' });
    expect(m.putObject).not.toHaveBeenCalled();
  });

  it('hàng trùng không ở rác: không đụng cờ, không audit', async () => {
    m.findUnique.mockResolvedValue({ ...row, trashedAt: null });
    const r = await uploadAsset(args);

    expect(r.ok && r.asset.restored).toBeFalsy();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});
