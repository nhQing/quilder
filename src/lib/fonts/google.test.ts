import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  addFace: vi.fn(),
  findFirst: vi.fn(),
}));
vi.mock('./service', () => ({
  addFace: m.addFace,
  slugify: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
}));
vi.mock('@/lib/db', () => ({ prisma: { fontFamily: { findFirst: m.findFirst } } }));

import { importGoogleFamily } from './google';
import { FontError } from './types';

const css = readFileSync(join(__dirname, '__fixtures__', 'css2-be-vietnam-pro.css'), 'utf8');
const actor = { email: 'a@b.c', sub: 's' };
const MSG =
  'Server không kết nối được Google Fonts. Hãy tải font về máy rồi dùng mục Tải file font.';

const res = (status: number, body: string | Uint8Array = '') =>
  new Response(body as BodyInit, { status });

/** css cho một weight cụ thể, lấy từ fixture. */
const cssFor = (weight: string, style = 'normal') =>
  css
    .replaceAll('font-weight: 400', `font-weight: ${weight}`)
    .replaceAll('font-style: normal', `font-style: ${style}`);

function ok(family = 'Be Vietnam Pro') {
  return {
    ok: true as const,
    dryRun: false,
    family: { id: 'f1', slug: 'be-vietnam-pro', cssName: family, token: 'font-be-vietnam-pro', created: true },
    faces: [{ weight: '400', style: 'normal' as const, subset: 'x', bytes: 3, replaced: false }],
    warnings: [] as { code: 'missing_vietnamese'; message: string }[],
  };
}

beforeEach(() => {
  m.addFace.mockReset();
  m.addFace.mockImplementation(async () => ok());
  m.findFirst.mockReset();
  m.findFirst.mockResolvedValue(null);
});

describe('importGoogleFamily', () => {
  it('variable 200 → một lượt css2, mỗi file được addFace', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      calls.push(url);
      if (url.startsWith('https://fonts.googleapis.com/css2')) return res(200, css);
      return res(200, new Uint8Array([1, 2, 3]));
    }) as unknown as typeof fetch;
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro' }, actor, fetchImpl);
    const cssCalls = calls.filter((u) => u.includes('css2'));
    expect(cssCalls).toHaveLength(1);
    expect(decodeURIComponent(cssCalls[0]!)).toContain('family=Be+Vietnam+Pro:ital,wght@0,100..900;1,100..900');
    expect(cssCalls[0]!).toContain('display=swap');
    // 5 khối trong fixture, 3 subset được giữ.
    expect(m.addFace).toHaveBeenCalledTimes(3);
    const arg = m.addFace.mock.calls[0]![0];
    expect(arg).toMatchObject({
      source: 'google',
      googleFamily: 'Be Vietnam Pro',
      family: 'Be Vietnam Pro',
      licenseConfirmed: true,
      licenseNote: 'Google Fonts (OFL/Apache)',
      prepared: { subset: 'vietnamese' },
    });
    expect(arg.prepared.unicodeRange).toMatch(/^U\+0102/);
    expect(arg.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(out.faces).toHaveLength(3);
    expect(out.family.created).toBe(true);
  });

  it('không lấy italic → URL không có ital', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: RequestInfo | URL) => {
      urls.push(String(u));
      return String(u).includes('css2') ? res(200, css) : res(200, new Uint8Array([1]));
    }) as typeof fetch;
    await importGoogleFamily({ family: 'Be Vietnam Pro', italic: false }, actor, fetchImpl);
    expect(decodeURIComponent(urls[0]!)).toContain('Be+Vietnam+Pro:wght@100..900');
    expect(urls[0]!).not.toContain('ital');
  });

  it('variable 400 → thử từng weight, giữ 400 và 700', async () => {
    const cssUrls: string[] = [];
    const fetchImpl = (async (u: RequestInfo | URL) => {
      const url = decodeURIComponent(String(u));
      if (!url.includes('css2')) return res(200, new Uint8Array([9]));
      cssUrls.push(url);
      if (url.includes('100..900')) return res(400);
      if (url.includes(':wght@400')) return res(200, cssFor('400'));
      if (url.includes(':wght@700')) return res(200, cssFor('700'));
      return res(400);
    }) as typeof fetch;
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro', italic: false }, actor, fetchImpl);
    const weights = m.addFace.mock.calls.map((c) => c[0].weight);
    expect(new Set(weights)).toEqual(new Set(['400', '700']));
    expect(m.addFace).toHaveBeenCalledTimes(6);
    // 1 lượt variable + 9 weight (normal)
    expect(cssUrls).toHaveLength(10);
    expect(out.faces.length).toBe(6);
  });

  it('có weights → chỉ thử các weight đó', async () => {
    const cssUrls: string[] = [];
    const fetchImpl = (async (u: RequestInfo | URL) => {
      const url = decodeURIComponent(String(u));
      if (!url.includes('css2')) return res(200, new Uint8Array([9]));
      cssUrls.push(url);
      return res(200, cssFor('500'));
    }) as typeof fetch;
    await importGoogleFamily({ family: 'Be Vietnam Pro', weights: [500], italic: false }, actor, fetchImpl);
    expect(cssUrls).toHaveLength(1);
    expect(cssUrls[0]!).toContain(':wght@500');
  });

  it('mọi tổ hợp 400 → google_not_found', async () => {
    const fetchImpl = (async () => res(400)) as typeof fetch;
    await expect(importGoogleFamily({ family: 'Nope Nope' }, actor, fetchImpl)).rejects.toMatchObject({
      code: 'google_not_found',
      status: 404,
    });
    expect(m.addFace).not.toHaveBeenCalled();
  });

  it('fetchImpl ném → google_unreachable với đúng lời nhắn', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const err = await importGoogleFamily({ family: 'Inter' }, actor, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(FontError);
    expect(err.code).toBe('google_unreachable');
    expect(err.message).toBe(MSG);
  });

  it('quá 10 giây → google_unreachable', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = (() => new Promise(() => {})) as unknown as typeof fetch;
      const p = importGoogleFamily({ family: 'Inter' }, actor, fetchImpl).catch((e) => e);
      await vi.advanceTimersByTimeAsync(10_001);
      const err = await p;
      expect(err).toMatchObject({ code: 'google_unreachable', message: MSG });
    } finally {
      vi.useRealTimers();
    }
  });

  it('file không nằm trên fonts.gstatic.com thì không tải', async () => {
    const evil = css.replaceAll('https://fonts.gstatic.com', 'https://evil.example');
    const fetchImpl = vi.fn(async (u: RequestInfo | URL) =>
      String(u).includes('css2') ? res(200, evil) : res(200, new Uint8Array([1])),
    ) as unknown as typeof fetch;
    await expect(importGoogleFamily({ family: 'X' }, actor, fetchImpl)).rejects.toMatchObject({
      code: 'google_not_found',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('61 file → chỉ nhập 60, có cảnh báo', async () => {
    const block = (i: number) => `/* latin */
@font-face {
  font-family: 'Big';
  font-style: normal;
  font-weight: ${i + 1};
  src: url(https://fonts.gstatic.com/s/big/v1/f${i}.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;
    const big = Array.from({ length: 61 }, (_, i) => block(i)).join('\n');
    const fetchImpl = (async (u: RequestInfo | URL) =>
      String(u).includes('css2') ? res(200, big) : res(200, new Uint8Array([1]))) as typeof fetch;
    const out = await importGoogleFamily({ family: 'Big' }, actor, fetchImpl);
    expect(m.addFace).toHaveBeenCalledTimes(60);
    expect(out.warnings.map((w) => w.code)).toContain('google_truncated');
  });

  it('dryRun không tải file, không gọi addFace, trả danh sách face', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: RequestInfo | URL) => {
      urls.push(String(u));
      return res(200, css);
    }) as typeof fetch;
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro', dryRun: true }, actor, fetchImpl);
    expect(urls).toHaveLength(1);
    expect(m.addFace).not.toHaveBeenCalled();
    expect(out.dryRun).toBe(true);
    expect(out.faces.map((f) => f.subset)).toEqual(['vietnamese', 'latin-ext', 'latin']);
    expect(out.family).toMatchObject({
      slug: 'be-vietnam-pro',
      cssName: 'Be Vietnam Pro',
      token: 'font-be-vietnam-pro',
      created: true,
    });
  });

  it('gộp kết quả: created nếu có lần tạo, cảnh báo không trùng', async () => {
    let n = 0;
    m.addFace.mockImplementation(async () => {
      n += 1;
      const r = ok();
      r.family.created = n === 1;
      return { ...r, warnings: [{ code: 'missing_vietnamese' as const, message: 'm' }] };
    });
    const fetchImpl = (async (u: RequestInfo | URL) =>
      String(u).includes('css2') ? res(200, css) : res(200, new Uint8Array([1]))) as typeof fetch;
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro' }, actor, fetchImpl);
    expect(out.family.created).toBe(true);
    expect(out.warnings).toHaveLength(1);
  });
});
