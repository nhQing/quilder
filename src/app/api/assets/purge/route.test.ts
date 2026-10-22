import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  previewPurge: vi.fn(async (_arg: unknown) => ({ deletable: [], blocked: [], oldReleases: [] })),
  purgeAssets: vi.fn(async (_ids: unknown, _actor: unknown, _token: unknown) => ({
    purged: ['a'],
    skipped: [],
    s3Failed: [],
    held: [],
  })),
  retryPurgeS3: vi.fn(async (_keys: unknown, _actor: unknown) => ({ deleted: ['k'], skipped: [], failed: [] })),
  sweepAssetHolds: vi.fn(async () => ({ deleted: [], released: [], failed: [], kept: 0 })),
  after: vi.fn((fn: () => unknown) => void fn()),
  PurgeConfirmError: class extends Error {
    constructor(readonly reason: string) {
      super(`xác nhận: ${reason}`);
    }
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/guard', () => ({ requireAuth: m.auth }));
vi.mock('@/lib/builder/asset-trash', () => ({
  MAX_PURGE_BATCH: 100,
  previewPurge: m.previewPurge,
  purgeAssets: m.purgeAssets,
  retryPurgeS3: m.retryPurgeS3,
  sweepAssetHolds: m.sweepAssetHolds,
  PurgeConfirmError: m.PurgeConfirmError,
}));
// `after()` thật ném khi không có request scope của Next; ở đây chạy ngay.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: m.after }));

import { POST as RETRY } from './retry/route';
import { POST } from './route';

const ADMIN = { sub: 'u1', email: 'a@x.com', role: 'admin' };
const post = (fn: typeof POST, body: unknown) =>
  fn(new Request('http://localhost/api/assets/purge', { method: 'POST', body: JSON.stringify(body) }));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue(ADMIN);
});

describe('POST /api/assets/purge', () => {
  it('editor -> 403, không gọi logic', async () => {
    m.auth.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }));
    const res = await post(POST, { ids: ['a'], confirmToken: 't' });
    expect(res.status).toBe(403);
    expect(m.auth).toHaveBeenCalledWith('admin');
    expect(m.purgeAssets).not.toHaveBeenCalled();
  });

  it('token service -> 403 dù là admin', async () => {
    m.auth.mockResolvedValue({ ...ADMIN, kind: 'service' });
    expect((await post(POST, { ids: ['a'], confirmToken: 't' })).status).toBe(403);
    expect(m.purgeAssets).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ ids: [] }],
    [{ ids: [''] }],
    [{ ids: 'a' }],
    [{ dryRun: true }],
    [{ all: true }],
    // Xoá thật mà không có token: phải xem trước đã.
    [{ ids: ['a'] }],
    [{ ids: ['a'], confirmToken: '' }],
  ])(
    'đầu vào sai %j -> 400',
    async (body) => {
      expect((await post(POST, body)).status).toBe(400);
      expect(m.purgeAssets).not.toHaveBeenCalled();
    },
  );

  it('JSON hỏng -> 400', async () => {
    const res = await POST(new Request('http://x/api/assets/purge', { method: 'POST', body: '{' }));
    expect(res.status).toBe(400);
  });

  it('quá 100 id -> 400; đúng 100 thì qua; trùng được khử', async () => {
    expect((await post(POST, { ids: ids(101), confirmToken: 't' })).status).toBe(400);
    expect((await post(POST, { ids: ids(100), confirmToken: 't' })).status).toBe(200);
    await post(POST, { ids: ['a', 'a', 'b'], confirmToken: 't' });
    expect(m.purgeAssets).toHaveBeenLastCalledWith(['a', 'b'], { email: 'a@x.com', sub: 'u1' }, 't');
  });

  it('danh sách đổi từ lúc xem trước → 409 kèm lý do, không dọn', async () => {
    m.purgeAssets.mockRejectedValueOnce(new m.PurgeConfirmError('changed'));
    const res = await post(POST, { ids: ['a'], confirmToken: 't' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: 'changed' });
    expect(m.sweepAssetHolds).not.toHaveBeenCalled();
  });

  it('xoá xong thì dọn AssetHold SAU phản hồi', async () => {
    expect((await post(POST, { ids: ['a'], confirmToken: 't' })).status).toBe(200);
    expect(m.after).toHaveBeenCalledTimes(1);
    expect(m.sweepAssetHolds).toHaveBeenCalledWith({ actor: { email: 'a@x.com', sub: 'u1' } });
  });

  it('dryRun trả preview, không xoá', async () => {
    const res = await post(POST, { dryRun: true, ids: ['a'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletable: [], blocked: [], oldReleases: [] });
    expect(m.previewPurge).toHaveBeenCalledWith({ ids: ['a'] });
    expect(m.purgeAssets).not.toHaveBeenCalled();
  });

  it('dryRun + all', async () => {
    expect((await post(POST, { dryRun: true, all: true })).status).toBe(200);
    expect(m.previewPurge).toHaveBeenCalledWith({ all: true });
  });
});

describe('POST /api/assets/purge/retry', () => {
  it('admin gọi được; quá 100 key -> 400; rỗng -> 400', async () => {
    expect((await post(RETRY, { keys: ['k'] })).status).toBe(200);
    expect((await post(RETRY, { keys: ids(101) })).status).toBe(400);
    expect((await post(RETRY, { keys: [] })).status).toBe(400);
  });
});
