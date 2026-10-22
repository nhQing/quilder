import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  userCount: vi.fn(async () => 0),
  userCreate: vi.fn(async () => ({ id: 'u1', email: 'a@x.vn', role: 'admin', name: null })),
  ensureSiteDefaults: vi.fn(async (_tx: unknown, _opts: unknown) => ({ siteId: 's', created: [] })),
  ensureDesignTokens: vi.fn(async (_p: unknown) => 0),
  ensureEffects: vi.fn(async (_p: unknown) => 0),
  tokenRequired: vi.fn(() => false),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => {
  const tx = { user: { count: m.userCount, create: m.userCreate } };
  return {
    prisma: {
      user: { count: m.userCount },
      auditLog: { create: vi.fn(async () => ({})) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock('@/lib/auth/password', () => ({ hashPassword: async () => 'hash' }));
vi.mock('@/lib/auth/setup-policy', () => ({ setupTokenRequired: m.tokenRequired }));
vi.mock('@/lib/setup/defaults', () => ({ ensureSiteDefaults: m.ensureSiteDefaults }));
vi.mock('@/lib/setup/design-tokens', () => ({ ensureDesignTokens: m.ensureDesignTokens }));
vi.mock('@/lib/setup/effects', () => ({ ensureEffects: m.ensureEffects }));

import { setupToken } from '@/lib/auth/setup-token';
import { POST } from './route';

const SECRET = 'x'.repeat(40);
const GOOD = {
  siteName: 'Tiệm Bánh',
  siteUrl: 'https://banh.vn/',
  email: 'A@X.vn',
  password: 'mat-khau-du-dai',
};
const post = (body: unknown) =>
  POST(new Request('http://localhost/api/auth/setup', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_SECRET', SECRET);
  vi.stubEnv('SITE_URL', '');
  m.tokenRequired.mockReturnValue(false);
  m.userCount.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/auth/setup', () => {
  it('dev: không cần mã, tạo site với URL đã chuẩn hoá', async () => {
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect(m.ensureSiteDefaults).toHaveBeenCalledWith(expect.anything(), {
      name: 'Tiệm Bánh',
      siteUrl: 'https://banh.vn',
    });
    expect(m.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'a@x.vn', role: 'admin' }) }),
    );
  });

  it('production: thiếu mã → 403, không tạo gì', async () => {
    m.tokenRequired.mockReturnValue(true);
    const res = await post(GOOD);
    expect(res.status).toBe(403);
    expect((await res.json()).field).toBe('token');
    expect(m.ensureSiteDefaults).not.toHaveBeenCalled();
  });

  it('production: đúng mã → 200', async () => {
    m.tokenRequired.mockReturnValue(true);
    expect((await post({ ...GOOD, token: setupToken(SECRET) })).status).toBe(200);
  });

  it('đã có tài khoản → 409', async () => {
    m.userCount.mockResolvedValue(1);
    expect((await post(GOOD)).status).toBe(409);
  });

  it('URL có đường dẫn → 400 kèm field siteUrl', async () => {
    const res = await post({ ...GOOD, siteUrl: 'https://banh.vn/vi' });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('siteUrl');
  });

  it('thiếu tên site → 400 kèm field siteName', async () => {
    const res = await post({ ...GOOD, siteName: '  ' });
    expect((await res.json()).field).toBe('siteName');
  });

  it('env SITE_URL đã đặt: bỏ qua siteUrl trong body, kể cả khi nó sai', async () => {
    vi.stubEnv('SITE_URL', 'https://env.vn');
    const res = await post({ ...GOOD, siteUrl: 'rác' });
    expect(res.status).toBe(200);
    expect(m.ensureSiteDefaults).toHaveBeenCalledWith(expect.anything(), {
      name: 'Tiệm Bánh',
      siteUrl: undefined,
    });
  });

  it('đồng bộ effect lỗi: vẫn 200, kèm cảnh báo', async () => {
    m.ensureEffects.mockRejectedValueOnce(new Error('nổ'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect((await res.json()).warnings).toHaveLength(1);
  });

  it('mật khẩu ngắn → 400 kèm field password', async () => {
    const res = await post({ ...GOOD, password: 'ngan' });
    expect((await res.json()).field).toBe('password');
  });
});
