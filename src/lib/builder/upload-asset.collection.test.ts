import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Thư viện (/api/assets → `uploadAsset`) không nhận TTC: `sniff` nhận dạng nó chỉ để module
 * font báo `collection_unsupported` cho rõ. Từ chối phải xảy ra TRƯỚC khi chạm S3 hay DB.
 */

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  auditCreate: vi.fn(),
  putObject: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    asset: { findUnique: m.findUnique, create: m.create },
    auditLog: { create: m.auditCreate },
  },
}));
vi.mock('@/lib/builder/asset-folders', () => ({ ensureFolderRows: vi.fn() }));
vi.mock('@/lib/assets/s3', () => ({ putObject: m.putObject, objectUrl: (k: string) => `https://cdn/${k}` }));

import { uploadAsset } from './upload-asset';

const TTC = new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 16]);

describe('uploadAsset: TTC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('font/collection → 415, không ghi S3/DB', async () => {
    const r = await uploadAsset({ bytes: TTC, fileName: 'family.ttc', actorEmail: 'a@b.c', actorSub: 'u1' });
    expect(r).toMatchObject({ ok: false, status: 415 });
    expect(!r.ok && r.error).toContain('TTC');
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.putObject).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
});
