import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Xoá token: chặn token của họ font, và báo chỗ dùng gồm cả component. */

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  tokenFind: vi.fn(),
  tokenDelete: vi.fn(),
  familyFind: vi.fn(),
  audit: vi.fn(),
  tokenUsage: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireAuth: m.auth }));
vi.mock('@/lib/db', () => ({
  prisma: {
    token: { findUnique: m.tokenFind, delete: m.tokenDelete },
    fontFamily: { findUnique: m.familyFind },
    auditLog: { create: m.audit },
  },
}));
vi.mock('@/lib/fonts/usage', () => ({ tokenUsage: m.tokenUsage }));
vi.mock('next/cache', () => ({ unstable_cache: (f: unknown) => f, revalidateTag: vi.fn() }));

const { DELETE } = await import('./route');

const call = () => DELETE(new Request('http://x/api/design-tokens/t1', { method: 'DELETE' }), {
  params: Promise.resolve({ id: 't1' }),
});

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ sub: 'u1', email: 'a@b.c' });
  m.familyFind.mockResolvedValue(null);
  m.tokenUsage.mockResolvedValue({ pages: [], components: [] });
});

describe('DELETE /api/design-tokens/[id]', () => {
  it('token thuộc một FontFamily → 409, không xoá', async () => {
    m.tokenFind.mockResolvedValue({ id: 't1', name: 'font-gilroy', value: '"gilroy", serif', custom: true });
    m.familyFind.mockResolvedValue({ id: 'f1' });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('"font-gilroy" thuộc họ font, xoá ở Cài đặt › Font.');
    expect(m.familyFind).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'gilroy' } }));
    expect(m.tokenDelete).not.toHaveBeenCalled();
  });

  it('còn dùng ở component → 409, lời nhắn liệt kê cả component', async () => {
    m.tokenFind.mockResolvedValue({ id: 't1', name: 'brand-500', value: '#123456', custom: true });
    m.tokenUsage.mockResolvedValue({
      pages: [{ id: 'p1', title: 'Trang chủ', href: '/builder/p1' }],
      components: [{ id: 'c1', title: 'Thẻ tin', href: '/builder/components/c1' }],
    });
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toContain('1 trang, 1 component');
    expect(body.error).toContain('Thẻ tin');
    expect(body.components).toHaveLength(1);
    expect(m.tokenDelete).not.toHaveBeenCalled();
  });

  it('không ai dùng → xoá và ghi audit', async () => {
    m.tokenFind.mockResolvedValue({ id: 't1', name: 'brand-500', value: '#123456', custom: true });
    const res = await call();
    expect(res.status).toBe(200);
    expect(m.tokenDelete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(m.audit).toHaveBeenCalled();
  });
});
