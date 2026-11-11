import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  interLatinExtWoff2,
  interLatinWoff2,
  interVietnameseWoff2,
} from '../../../tests/fixtures/fonts/make-fixtures';

/** dryRun của Google dùng luật THẬT của service (Prisma giả, không mock ./service). */
const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      fontFamily: { findMany: fn(), findUnique: fn(), create: fn() },
      fontFace: { create: fn(), update: fn() },
      token: { findUnique: fn(), create: fn(), updateMany: fn() },
      auditLog: { create: fn() },
      $transaction: fn(),
    },
    uploadAsset: fn(),
  };
});
vi.mock('@/lib/db', () => ({ prisma: m.prisma }));
vi.mock('@/lib/builder/upload-asset', () => ({ uploadAsset: m.uploadAsset, MAX_ASSET_BYTES: 10 * 1024 * 1024 }));
vi.mock('./usage', () => ({ tokenUsage: vi.fn(), tokenUsageMany: vi.fn() }));
vi.mock('next/cache', () => ({
  unstable_cache: (f: (...a: unknown[]) => unknown) => f,
  revalidateTag: vi.fn(),
}));

const { importGoogleFamily } = await import('./google');

const css = readFileSync(join(__dirname, '__fixtures__', 'css2-be-vietnam-pro.css'), 'utf8');
const actor = { email: 'a@b.c', sub: 'u1' };
const cssAs = (name: string) => css.replaceAll("'Be Vietnam Pro'", `'${name}'`);
const fetchOf = (body: string) =>
  (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.fontFamily.findMany.mockResolvedValue([]);
  m.prisma.fontFamily.findUnique.mockResolvedValue(null);
  m.prisma.token.findUnique.mockResolvedValue(null);
  m.prisma.$transaction.mockImplementation(async (cb: (tx: typeof m.prisma) => unknown) => cb(m.prisma));
  m.prisma.fontFamily.create.mockResolvedValue({ id: 'f1' });
  m.prisma.fontFace.create.mockResolvedValue({ id: 'face1' });
  m.uploadAsset.mockImplementation(async ({ fileName, bytes }: { fileName: string; bytes: Uint8Array }) => ({
    ok: true,
    asset: { id: `a-${fileName}`, key: `public/fonts/${fileName}`, bytes: bytes.length },
  }));
});

/** Bỏ khối `/* <subset> *\/` khỏi phản hồi css2. */
const cssWithout = (subset: string) => css.replace(new RegExp(`/\\* ${subset} \\*/[^}]*}\\s*`), '');

/** css2 + file thật của Inter theo từng subset (Google chia đúng như vậy). */
function fetchReal(body: string) {
  const fileOf: Record<string, Uint8Array> = {};
  for (const [subset, bytes] of [
    ['vietnamese', interVietnameseWoff2()],
    ['latin-ext', interLatinExtWoff2()],
    ['latin', interLatinWoff2()],
  ] as const) {
    const url = new RegExp(`/\\* ${subset} \\*/[^}]*url\\(([^)]+)\\)`).exec(body)?.[1];
    if (url) fileOf[url] = bytes;
  }
  return (async (u: RequestInfo | URL) => {
    const url = String(u);
    if (url.startsWith('https://fonts.googleapis.com/css2')) return new Response(body, { status: 200 });
    return new Response((fileOf[url] ?? new Uint8Array()) as BodyInit, { status: 200 });
  }) as unknown as typeof fetch;
}

describe('importGoogleFamily — cảnh báo tiếng Việt (inspect thật, file Inter thật)', () => {
  it('họ có bộ vietnamese: không face nào missing_vietnamese — kết quả và FontFace.warnings khớp', async () => {
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro', weights: [400], italic: false }, actor, fetchReal(css));
    expect(out.warnings.map((w) => w.code)).not.toContain('missing_vietnamese');
    const stored = m.prisma.fontFace.create.mock.calls.map((c) => c[0].data.warnings as string[]);
    expect(stored).toHaveLength(3);
    for (const w of stored) expect(w).not.toContain('missing_vietnamese');
  });

  it('họ KHÔNG có bộ vietnamese: cảnh báo cấp họ, gắn vào mọi face đã lưu', async () => {
    const body = cssWithout('vietnamese');
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro', weights: [400], italic: false }, actor, fetchReal(body));
    expect(out.warnings.map((w) => w.code)).toContain('missing_vietnamese');
    const stored = m.prisma.fontFace.create.mock.calls.map((c) => c[0].data.warnings as string[]);
    expect(stored).toHaveLength(2);
    for (const w of stored) expect(w).toContain('missing_vietnamese');
  });

  it('dryRun cũng báo cảnh báo cấp họ', async () => {
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro', dryRun: true }, actor, fetchOf(cssWithout('vietnamese')));
    expect(out.warnings.map((w) => w.code)).toContain('missing_vietnamese');
    const ok = await importGoogleFamily({ family: 'Be Vietnam Pro', dryRun: true }, actor, fetchOf(css));
    expect(ok.warnings.map((w) => w.code)).not.toContain('missing_vietnamese');
  });
});

describe('importGoogleFamily dryRun (luật service)', () => {
  it('họ mới hợp lệ → created, replaced false, không ghi gì', async () => {
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro', dryRun: true }, actor, fetchOf(css));
    expect(out.dryRun).toBe(true);
    expect(out.family).toMatchObject({ slug: 'be-vietnam-pro', token: 'font-be-vietnam-pro', created: true });
    expect(out.faces.map((f) => [f.subset, f.replaced])).toEqual([
      ['vietnamese', false],
      ['latin-ext', false],
      ['latin', false],
    ]);
    expect(m.uploadAsset).not.toHaveBeenCalled();
  });

  it('"Inter" → name_reserved', async () => {
    await expect(
      importGoogleFamily({ family: 'Inter', dryRun: true }, actor, fetchOf(cssAs('Inter'))),
    ).rejects.toMatchObject({ code: 'name_reserved' });
  });

  it("fallback 'x; }' → bad_fallback", async () => {
    await expect(
      importGoogleFamily({ family: 'Be Vietnam Pro', dryRun: true, fallback: 'x; }' }, actor, fetchOf(css)),
    ).rejects.toMatchObject({ code: 'bad_fallback' });
  });

  it('token font-<slug> đã có → slug_taken', async () => {
    m.prisma.token.findUnique.mockResolvedValue({ id: 't1', custom: true });
    await expect(
      importGoogleFamily({ family: 'Be Vietnam Pro', dryRun: true }, actor, fetchOf(css)),
    ).rejects.toMatchObject({ code: 'slug_taken' });
  });

  it('face đã có → replaced true, họ cũ không tạo mới', async () => {
    const vnRange = /unicode-range: (U\+0102[^;]*);/.exec(css)![1]!;
    m.prisma.fontFamily.findMany.mockResolvedValue([{
      id: 'f9',
      slug: 'be-vietnam-pro',
      cssName: 'Be Vietnam Pro',
      source: 'google',
      faces: [{ id: 'x', weight: '400', style: 'normal', unicodeRange: vnRange }],
    }]);
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro', dryRun: true }, actor, fetchOf(css));
    expect(out.family).toMatchObject({ id: 'f9', created: false });
    expect(out.faces.map((f) => [f.subset, f.replaced])).toEqual([
      ['vietnamese', true],
      ['latin-ext', false],
      ['latin', false],
    ]);
  });
});
