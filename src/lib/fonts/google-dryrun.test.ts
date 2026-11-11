import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** dryRun của Google dùng luật THẬT của service (Prisma giả, không mock ./service). */
const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      fontFamily: { findFirst: fn(), findUnique: fn() },
      token: { findUnique: fn() },
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
  m.prisma.fontFamily.findFirst.mockResolvedValue(null);
  m.prisma.fontFamily.findUnique.mockResolvedValue(null);
  m.prisma.token.findUnique.mockResolvedValue(null);
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
    m.prisma.fontFamily.findFirst.mockResolvedValue({
      id: 'f9',
      slug: 'be-vietnam-pro',
      cssName: 'Be Vietnam Pro',
      source: 'google',
      faces: [{ id: 'x', weight: '400', style: 'normal', unicodeRange: vnRange }],
    });
    const out = await importGoogleFamily({ family: 'Be Vietnam Pro', dryRun: true }, actor, fetchOf(css));
    expect(out.family).toMatchObject({ id: 'f9', created: false });
    expect(out.faces.map((f) => [f.subset, f.replaced])).toEqual([
      ['vietnamese', true],
      ['latin-ext', false],
      ['latin', false],
    ]);
  });
});
