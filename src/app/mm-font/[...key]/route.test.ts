import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ getObject: vi.fn() }));
vi.mock('@/lib/assets/s3', () => ({ getObject: m.getObject }));

const { GET } = await import('./route');
const { FONT_CACHE_CONTROL } = await import('@/lib/fonts/types');

const call = (key: string[], headers: Record<string, string> = {}) =>
  GET(new Request('http://x/mm-font/' + key.join('/'), { headers }), {
    params: Promise.resolve({ key }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.getObject.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe('GET /mm-font/[...key]', () => {
  it('khoá hợp lệ → 200, font/woff2, cache bất biến, có etag', async () => {
    const res = await call(['public', 'builder', 'a-12345678.woff2']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('font/woff2');
    expect(res.headers.get('cache-control')).toBe(FONT_CACHE_CONTROL);
    expect(res.headers.get('etag')).toBeTruthy();
    expect(m.getObject).toHaveBeenCalledWith('public/builder/a-12345678.woff2');
  });

  it.each([
    [['public', '..', 'secret.woff2']],
    [['public', '', 'a.woff2']],
    [['public\\a.woff2']],
    [['private', 'a.woff2']],
    [['public', 'a.png']],
    [['public', 'a/../b.woff2']],
    [['public', '../x.woff2']],
    [['public', 'a//b.woff2']],
    [['public', 'a b.woff2']],
  ])('khoá không hợp lệ %j → 404, không đọc kho', async (key) => {
    const res = await call(key);
    expect(res.status).toBe(404);
    expect(m.getObject).not.toHaveBeenCalled();
  });

  it('getObject ném → 404', async () => {
    m.getObject.mockRejectedValue(Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' }));
    expect((await call(['public', 'a.woff2'])).status).toBe(404);
  });

  it('có X-Content-Type-Options: nosniff', async () => {
    const res = await call(['public', 'builder', 'a-12345678.woff2']);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('object không có (NoSuchKey) → 404, không log; kho lỗi khác → vẫn 404 nhưng console.error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      m.getObject.mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
      expect((await call(['public', 'a.woff2'])).status).toBe(404);
      expect(log).not.toHaveBeenCalled();

      m.getObject.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { name: 'Error' }));
      expect((await call(['public', 'a.woff2'])).status).toBe(404);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toContain('public/a.woff2');
    } finally {
      log.mockRestore();
    }
  });

  it('if-none-match trùng etag → 304', async () => {
    const first = await call(['public', 'a.woff2']);
    const etag = first.headers.get('etag')!;
    const res = await call(['public', 'a.woff2'], { 'if-none-match': etag });
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(etag);
  });
});
