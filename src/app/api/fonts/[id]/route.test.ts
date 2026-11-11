import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ auth: vi.fn(), updateFamily: vi.fn(), deleteFamily: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireAuth: m.auth }));
vi.mock('@/lib/fonts/service', () => ({
  updateFamily: m.updateFamily,
  deleteFamily: m.deleteFamily,
}));

const { PATCH, DELETE } = await import('./route');
const { FontError, FALLBACKS } = await import('@/lib/fonts/types');

const ctx = { params: Promise.resolve({ id: 'f1' }) };
const patch = (body: unknown) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ sub: 'u1', email: 'a@b.c' });
});

describe('/api/fonts/[id]', () => {
  it('PATCH quyền write, map fallback từ khoá', async () => {
    const res = await patch({ fallback: 'mono', licenseNote: 'ok' });
    expect(res.status).toBe(200);
    expect(m.auth).toHaveBeenCalledWith('write');
    expect(m.updateFamily).toHaveBeenCalledWith(
      'f1',
      { fallback: FALLBACKS.mono, licenseNote: 'ok' },
      { email: 'a@b.c', sub: 'u1' },
    );
  });

  it('PATCH licenseNote quá 500 ký tự → 422, không gọi service', async () => {
    expect((await patch({ licenseNote: 'x'.repeat(501) })).status).toBe(422);
    expect(m.updateFamily).not.toHaveBeenCalled();
  });

  it('PATCH FontError → mã của §10', async () => {
    m.updateFamily.mockRejectedValue(new FontError('bad_fallback', 'x'));
    expect((await patch({ fallback: '};evil' })).status).toBe(422);
  });

  it('DELETE đòi admin; token service/không đủ quyền → 403, không xoá', async () => {
    m.auth.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }));
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), ctx);
    expect(m.auth).toHaveBeenCalledWith('admin');
    expect(res.status).toBe(403);
    expect(m.deleteFamily).not.toHaveBeenCalled();
  });

  it('DELETE in_use → 409', async () => {
    m.deleteFamily.mockRejectedValue(new FontError('in_use', 'đang dùng'));
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('in_use');
  });
});
