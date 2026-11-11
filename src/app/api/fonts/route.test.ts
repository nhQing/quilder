import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  addFace: vi.fn(),
  listFonts: vi.fn(),
  fetchUrlBytes: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireAuth: m.auth }));
vi.mock('@/lib/fonts/service', () => ({ addFace: m.addFace, listFonts: m.listFonts }));
vi.mock('@/lib/assets/fetch-url', () => ({ fetchUrlBytes: m.fetchUrlBytes }));

const { GET, POST } = await import('./route');
const { FontError, FALLBACKS } = await import('@/lib/fonts/types');
const { serviceMayReach } = await import('@/lib/auth/service-scope');

const RESULT = {
  ok: true,
  dryRun: false,
  family: { id: 'f1', slug: 'gilroy', cssName: 'Gilroy', token: 'font-gilroy', created: true },
  faces: [],
  warnings: [],
};

function form(fields: Record<string, string>, file = true) {
  const fd = new FormData();
  if (file) fd.set('file', new File([new Uint8Array([1, 2, 3])], 'Gilroy.ttf'));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request('http://x/api/fonts', { method: 'POST', body: fd });
}

const json = (body: unknown) =>
  new Request('http://x/api/fonts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ sub: 'u1', email: 'a@b.c', role: 'editor' });
  m.addFace.mockResolvedValue(RESULT);
});

describe('POST /api/fonts', () => {
  it('multipart hợp lệ → 200, thân là FontUploadResult', async () => {
    const res = await POST(
      form({ licenseConfirmed: 'true', weight: '700', style: 'italic', fallback: 'serif' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RESULT);
    expect(m.auth).toHaveBeenCalledWith('write');
    expect(m.addFace).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'Gilroy.ttf',
        weight: '700',
        style: 'italic',
        fallback: FALLBACKS.serif,
        licenseConfirmed: true,
        dryRun: false,
      }),
      { email: 'a@b.c', sub: 'u1' },
    );
  });

  it('fallback lạ đi thẳng xuống service', async () => {
    await POST(form({ licenseConfirmed: 'true', fallback: 'Arial, sans-serif' }));
    expect(m.addFace).toHaveBeenCalledWith(
      expect.objectContaining({ fallback: 'Arial, sans-serif' }),
      expect.anything(),
    );
  });

  it('FontError name_reserved → 409 + code', async () => {
    m.addFace.mockRejectedValue(new FontError('name_reserved', 'Tên dành riêng'));
    const res = await POST(form({ licenseConfirmed: 'true' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Tên dành riêng', code: 'name_reserved' });
  });

  it('weight sai → 422 bad_weight, không gọi service', async () => {
    const res = await POST(form({ licenseConfirmed: 'true', weight: '5000' }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('bad_weight');
    expect(m.addFace).not.toHaveBeenCalled();
  });

  it('style sai → 422, không gọi service', async () => {
    const res = await POST(form({ licenseConfirmed: 'true', style: 'oblique' }));
    expect(res.status).toBe(422);
    expect(m.addFace).not.toHaveBeenCalled();
  });

  it('thiếu file → 400', async () => {
    const res = await POST(form({ licenseConfirmed: 'true' }, false));
    expect(res.status).toBe(400);
  });

  it('viewer → 403 theo requireAuth', async () => {
    m.auth.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }));
    const res = await POST(form({ licenseConfirmed: 'true' }));
    expect(res.status).toBe(403);
    expect(m.addFace).not.toHaveBeenCalled();
  });

  it('JSON sourceUrl → tải rồi addFace', async () => {
    m.fetchUrlBytes.mockResolvedValue({ ok: true, bytes: new Uint8Array([9]), fileName: 'x.woff2' });
    const res = await POST(json({ sourceUrl: 'https://e.com/x.woff2', licenseConfirmed: true }));
    expect(res.status).toBe(200);
    expect(m.addFace).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'x.woff2', licenseConfirmed: true }),
      expect.anything(),
    );
  });

  it('JSON sourceUrl tải lỗi → status của helper', async () => {
    m.fetchUrlBytes.mockResolvedValue({ ok: false, status: 502, error: 'hỏng' });
    const res = await POST(json({ sourceUrl: 'https://e.com/x.woff2', licenseConfirmed: true }));
    expect(res.status).toBe(502);
    expect(m.addFace).not.toHaveBeenCalled();
  });

  it('JSON google → 501 (Task 8)', async () => {
    const res = await POST(json({ google: { family: 'Inter' }, licenseConfirmed: true }));
    expect(res.status).toBe(501);
  });
});

describe('GET /api/fonts', () => {
  it('đòi quyền read, trả danh sách', async () => {
    m.listFonts.mockResolvedValue([{ cssName: 'Inter' }]);
    const res = await GET();
    expect(m.auth).toHaveBeenCalledWith('read');
    expect(await res.json()).toEqual({ fonts: [{ cssName: 'Inter' }] });
  });
});

describe('serviceMayReach', () => {
  it('cho POST và GET /api/fonts, không cho đường khác', () => {
    expect(serviceMayReach('/api/fonts', 'POST')).toBe(true);
    expect(serviceMayReach('/api/fonts', 'GET')).toBe(true);
    expect(serviceMayReach('/api/fonts', 'DELETE')).toBe(false);
    expect(serviceMayReach('/api/fonts/abc', 'DELETE')).toBe(false);
  });
});
