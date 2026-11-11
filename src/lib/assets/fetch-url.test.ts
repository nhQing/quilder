import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { fetchUrlBytes } = await import('./fetch-url');

describe('fetchUrlBytes (SSRF)', () => {
  it.each([
    'http://127.0.0.1/a.woff2',
    'http://10.0.0.5/a.woff2',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.1/x',
    'http://[::1]/x',
    'http://localhost/x',
    'ftp://example.com/x',
  ])('chặn %s mà không gọi fetch', async (url) => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const r = await fetchUrlBytes(url, 'Font');
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('URL hỏng → 400', async () => {
    const r = await fetchUrlBytes('không phải url');
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});
