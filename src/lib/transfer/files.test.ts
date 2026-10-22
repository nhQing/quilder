import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: {} }));

const uploadAsset = vi.fn();
vi.mock('@/lib/builder/upload-asset', async (orig) => ({
  ...(await orig<typeof import('@/lib/builder/upload-asset')>()),
  uploadAsset: (a: unknown) => uploadAsset(a),
}));

const bytes = new Uint8Array([1, 2, 3, 4]);
const sha = createHash('sha256').update(bytes).digest('hex');
const actor = { email: 'a@b.c', sub: 'u1' };
const base = { bytes, sha256: sha, name: 'anh.png', folder: null, actor };

describe('giới hạn file khi nhập', () => {
  it('IMPORT_FILE_LIMIT bằng MAX_ASSET_BYTES của kho — lệch là preview báo "nhận được" mà tải lên bị từ chối', async () => {
    const { IMPORT_FILE_LIMIT } = await import('./compat');
    const { MAX_ASSET_BYTES } = await import('@/lib/builder/upload-asset');
    expect(IMPORT_FILE_LIMIT).toBe(MAX_ASSET_BYTES);
  });
});

describe('storeImportFile', () => {
  beforeEach(() => uploadAsset.mockReset());

  it('sha256 lệch → 422 file-corrupt, không chạm kho', async () => {
    const { storeImportFile } = await import('./files');
    const r = await storeImportFile({ ...base, sha256: 'a'.repeat(64) });
    expect(r.status).toBe(422);
    expect((r.body as { issues: { code: string }[] }).issues[0]!.code).toBe('file-corrupt');
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it('kho báo 413 → file-too-large', async () => {
    uploadAsset.mockResolvedValue({ ok: false, status: 413, error: 'lớn' });
    const { storeImportFile } = await import('./files');
    const r = await storeImportFile(base);
    expect(r.status).toBe(413);
    expect((r.body as { issues: { code: string }[] }).issues[0]!.code).toBe('file-too-large');
  });

  it('kho báo 415 → file-rejected kèm lý do là dòng đầu', async () => {
    uploadAsset.mockResolvedValue({ ok: false, status: 415, error: 'Không nhận dạng\n\nchi tiết' });
    const { storeImportFile } = await import('./files');
    const r = await storeImportFile(base);
    expect(r.status).toBe(415);
    const i = (r.body as { issues: { code: string; vars: { reason: string } }[] }).issues[0]!;
    expect(i.code).toBe('file-rejected');
    expect(i.vars.reason).toBe('Không nhận dạng');
  });

  it('lỗi khác (thư mục sai) → giữ status, không có issue', async () => {
    uploadAsset.mockResolvedValue({ ok: false, status: 400, error: 'Thư mục sai' });
    const { storeImportFile } = await import('./files');
    const r = await storeImportFile(base);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'Thư mục sai', issues: [] });
  });

  it('khoá sinh ra khác khoá đoán → 500', async () => {
    uploadAsset.mockResolvedValue({ ok: true, asset: { id: 'x', key: 'khac.png' } });
    const { storeImportFile } = await import('./files');
    const r = await storeImportFile(base);
    expect(r.status).toBe(500);
  });

  it('thành công → { assetId, key }, folder được chuyển nguyên', async () => {
    const { assetKeyBase, assetKeyFromDigest } = await import('@/lib/assets/key');
    const key = assetKeyFromDigest(assetKeyBase('anh.png'), sha);
    uploadAsset.mockResolvedValue({ ok: true, asset: { id: 'x', key } });
    const { storeImportFile } = await import('./files');
    const r = await storeImportFile({ ...base, folder: 'blog' });
    expect(r).toEqual({ status: 200, body: { assetId: 'x', key } });
    expect(uploadAsset).toHaveBeenCalledWith(expect.objectContaining({ folder: 'blog', actorSub: 'u1', actorEmail: 'a@b.c' }));
  });
});
