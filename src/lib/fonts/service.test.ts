import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InspectResult } from './inspect';
import { FontError, FALLBACKS } from './types';
import { SUBSET_UNICODE_RANGE } from './unicode';

/**
 * Dịch vụ font với Prisma, `uploadAsset`, `inspectFont`, `toWoff2` và `tokenUsage` giả.
 * `$transaction` chạy callback trên chính mock nên mọi lệnh ghi đều đếm được.
 */

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      fontFamily: { findFirst: fn(), findUnique: fn(), findMany: fn(), create: fn(), update: fn(), delete: fn() },
      fontFace: { create: fn(), update: fn(), delete: fn() },
      token: { findUnique: fn(), findMany: fn(), create: fn(), update: fn(), updateMany: fn(), deleteMany: fn() },
      auditLog: { create: fn() },
      site: { findFirst: fn() },
      $transaction: fn(),
    },
    uploadAsset: fn(),
    inspectFont: fn(),
    toWoff2: fn(),
    tokenUsage: fn(),
    tokenUsageMany: fn(),
    revalidateTag: fn(),
  };
});

vi.mock('@/lib/db', () => ({ prisma: m.prisma }));
vi.mock('@/lib/builder/upload-asset', () => ({ uploadAsset: m.uploadAsset }));
vi.mock('./inspect', () => ({ inspectFont: m.inspectFont }));
vi.mock('./convert', () => ({ toWoff2: m.toWoff2 }));
vi.mock('./usage', () => ({ tokenUsage: m.tokenUsage, tokenUsageMany: m.tokenUsageMany }));
vi.mock('next/cache', () => ({
  unstable_cache: (f: (...a: unknown[]) => unknown) => f,
  revalidateTag: m.revalidateTag,
}));

const { addFace, slugify, updateFamily, deleteFace, deleteFamily, listFonts } = await import('./service');
const { readFontSeal } = await import('./seal');

const actor = { email: 'a@b.c', sub: 'u1' };
const RANGE = SUBSET_UNICODE_RANGE;
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function inspected(over: Partial<InspectResult> = {}): InspectResult {
  return { format: 'ttf', family: 'Be Vietnam Pro', weight: '400', style: 'normal', variable: false, warnings: [], ...over };
}

const NONE = { pages: [], components: [] };
const USED = { pages: [{ id: 'p1', title: 'Trang chủ', href: '/builder/p1' }], components: [] };

beforeEach(() => {
  vi.clearAllMocks();
  const p = m.prisma;
  p.$transaction.mockImplementation(async (cb: (tx: typeof p) => unknown) => cb(p));
  p.fontFamily.findFirst.mockResolvedValue(null);
  p.fontFamily.findUnique.mockResolvedValue(null);
  p.fontFamily.findMany.mockResolvedValue([]);
  p.fontFamily.create.mockResolvedValue({ id: 'f1' });
  p.fontFace.create.mockResolvedValue({ id: 'face1' });
  p.fontFace.update.mockResolvedValue({ id: 'face0' });
  p.token.findUnique.mockResolvedValue(null);
  p.token.findMany.mockResolvedValue([]);
  p.site.findFirst.mockResolvedValue({ activeRelease: null });
  m.inspectFont.mockReturnValue(inspected());
  m.toWoff2.mockResolvedValue({ bytes: new Uint8Array(5), unicodeRange: RANGE });
  m.uploadAsset.mockResolvedValue({
    ok: true,
    asset: { id: 'a1', key: 'public/builder/bvp-12345678.woff2', bytes: 5 },
  });
  m.tokenUsage.mockResolvedValue(NONE);
  m.tokenUsageMany.mockImplementation(async (names: string[]) => new Map(names.map((n) => [n, NONE])));
});

const upload = (over: Record<string, unknown> = {}) =>
  addFace({ bytes, fileName: 'BeVietnamPro-Regular.ttf', licenseConfirmed: true, ...over }, actor);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof FontError) return e.code;
    throw e;
  }
  return 'không ném';
}

describe('slugify', () => {
  it('bỏ dấu tiếng Việt, chữ thường, nối bằng gạch', () => {
    expect(slugify('Bé Việt Nam Pro')).toBe('be-viet-nam-pro');
    expect(slugify('  Đồng  Hồ!! ')).toBe('dong-ho');
  });
});

describe('addFace', () => {
  it('họ mới: tạo FontFamily, FontFace và token font-<slug> hạng font', async () => {
    const r = await upload();

    expect(m.prisma.fontFamily.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'be-vietnam-pro',
          cssName: 'Be Vietnam Pro',
          fallback: FALLBACKS.sans,
          source: 'upload',
          licenseConfirmedBy: 'a@b.c',
          createdBy: 'a@b.c',
        }),
      }),
    );
    expect(m.prisma.token.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'font-be-vietnam-pro',
          value: `"Be Vietnam Pro", ${FALLBACKS.sans}`,
          category: 'font',
          custom: true,
          aiDescription: expect.stringContaining('Họ font Be Vietnam Pro'),
        }),
      }),
    );
    expect(m.prisma.fontFace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: 'f1', weight: '400', style: 'normal', unicodeRange: RANGE, subset: '', assetId: 'a1',
        }),
      }),
    );
    // File đã cắt là woff2: tên file đổi đuôi, nằm ở thư mục fonts/<slug>.
    expect(m.uploadAsset).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'BeVietnamPro-Regular.woff2', folder: 'fonts/be-vietnam-pro', actorSub: 'u1' }),
    );
    expect(m.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'font.face.add', userId: 'u1' }) }),
    );
    expect(r).toEqual({
      ok: true,
      dryRun: false,
      family: { id: 'f1', slug: 'be-vietnam-pro', cssName: 'Be Vietnam Pro', token: 'font-be-vietnam-pro', created: true },
      faces: [{ weight: '400', style: 'normal', subset: '', bytes: 5, replaced: false }],
      warnings: [],
    });
  });

  it('(Review Focus 1) tên họ chỉ khác hoa thường → thêm face vào họ cũ, created false', async () => {
    m.inspectFont.mockReturnValue(inspected({ family: 'GILROY', weight: '400' }));
    m.prisma.fontFamily.findMany.mockResolvedValue([
      { id: 'b1', slug: 'be-vietnam-pro', cssName: 'Be Vietnam Pro', source: 'upload', faces: [] },
      {
        id: 'g1', slug: 'gilroy', cssName: 'gilroy', source: 'upload',
        faces: [{ id: 'face0', weight: '700', style: 'normal', unicodeRange: RANGE }],
      },
    ]);

    const r = await upload({ fileName: 'gilroy-regular.otf' });

    expect(m.prisma.fontFamily.create).not.toHaveBeenCalled();
    expect(m.prisma.token.create).not.toHaveBeenCalled();
    expect(m.prisma.fontFace.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ familyId: 'g1', weight: '400' }) }),
    );
    expect(r.family).toEqual({ id: 'g1', slug: 'gilroy', cssName: 'gilroy', token: 'font-gilroy', created: false });
    expect(r.faces[0]!.replaced).toBe(false);
  });

  it('tên có "_" không khớp tên có "-" (không dùng ILIKE): "My-Font" khi đã có "My_Font" → họ mới', async () => {
    m.inspectFont.mockReturnValue(inspected({ family: 'My-Font' }));
    const myUnderscore = { id: 'u1', slug: 'my-font-x', cssName: 'My_Font', source: 'upload', faces: [] };
    m.prisma.fontFamily.findMany.mockResolvedValue([
      myUnderscore,
      { id: 'u2', slug: 'my-font-y', cssName: 'My%', source: 'upload', faces: [] },
    ]);
    m.prisma.fontFamily.findFirst.mockResolvedValue(myUnderscore);

    const r = await upload();

    expect(m.prisma.fontFamily.findFirst).not.toHaveBeenCalled();
    expect(m.prisma.fontFamily.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() }),
    );
    expect(m.prisma.fontFamily.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cssName: 'My-Font', slug: 'my-font' }) }),
    );
    expect(r.family.created).toBe(true);
  });

  it('"My_Font" khi đã có "My-Font" → không nhét face vào "My-Font" (ILIKE coi "_" là ký tự đại diện)', async () => {
    m.inspectFont.mockReturnValue(inspected({ family: 'My_Font' }));
    const myDash = { id: 'd1', slug: 'my-font', cssName: 'My-Font', source: 'upload', faces: [] };
    m.prisma.fontFamily.findMany.mockResolvedValue([myDash]);
    // Đúng thứ Postgres trả cho `cssName ILIKE 'My_Font'` nếu service còn dùng `mode: 'insensitive'`.
    m.prisma.fontFamily.findFirst.mockResolvedValue(myDash);
    m.prisma.fontFamily.findUnique.mockResolvedValue({ cssName: 'My-Font' }); // slug my-font đã có chủ

    expect(await codeOf(upload())).toBe('slug_taken');
    expect(m.prisma.fontFace.create).not.toHaveBeenCalled();
    expect(m.uploadAsset).not.toHaveBeenCalled();
  });

  it('trùng (weight, style, unicodeRange) → thay assetId, replaced true, không tạo face mới', async () => {
    m.prisma.fontFamily.findMany.mockResolvedValue([{
      id: 'f1', slug: 'be-vietnam-pro', cssName: 'Be Vietnam Pro', source: 'upload',
      faces: [{ id: 'face0', weight: '400', style: 'normal', unicodeRange: RANGE }],
    }]);

    const r = await upload();

    expect(m.prisma.fontFace.create).not.toHaveBeenCalled();
    expect(m.prisma.fontFace.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'face0' }, data: expect.objectContaining({ assetId: 'a1' }) }),
    );
    expect(r.faces[0]!.replaced).toBe(true);
    expect(m.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'font.face.replace' }) }),
    );
  });

  describe('replaceFaceId ("Thay file")', () => {
    const fam = (faces: { id: string; weight?: string; unicodeRange: string }[]) => [{
      id: 'f1', slug: 'be-vietnam-pro', cssName: 'Be Vietnam Pro', source: 'upload',
      faces: faces.map((f) => ({ weight: '400', style: 'normal', ...f })),
    }];

    it('file mới ra dải khác (woff2 "" → TTF đã cắt): ghi đè face đó, không thêm face', async () => {
      m.prisma.fontFamily.findMany.mockResolvedValue(fam([{ id: 'face0', unicodeRange: '' }]));
      m.inspectFont.mockReturnValue(inspected({ weight: '500', warnings: ['missing_vietnamese'] }));

      const r = await upload({ replaceFaceId: 'face0' });

      expect(m.prisma.fontFace.create).not.toHaveBeenCalled();
      expect(m.prisma.fontFace.update).toHaveBeenCalledWith({
        where: { id: 'face0' },
        // weight/kiểu giữ của face cũ (không đè), dải và file theo file mới.
        data: { assetId: 'a1', subset: '', warnings: ['missing_vietnamese'], unicodeRange: RANGE, weight: '400', style: 'normal' },
      });
      expect(r.faces[0]).toMatchObject({ weight: '400', replaced: true });
      expect(m.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'font.face.replace', targetId: 'face0' }) }),
      );
    });

    it('weight/style gửi kèm thì đè', async () => {
      m.prisma.fontFamily.findMany.mockResolvedValue(fam([{ id: 'face0', unicodeRange: '' }]));
      await upload({ replaceFaceId: 'face0', weight: '700', style: 'italic' });
      expect(m.prisma.fontFace.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ weight: '700', style: 'italic' }) }),
      );
    });

    it('face khác đã mang đúng descriptor mới → xoá bản trùng đó trong cùng transaction', async () => {
      m.prisma.fontFamily.findMany.mockResolvedValue(fam([{ id: 'face0', unicodeRange: '' }, { id: 'face1', unicodeRange: RANGE }]));
      await upload({ replaceFaceId: 'face0' });
      expect(m.prisma.fontFace.delete).toHaveBeenCalledWith({ where: { id: 'face1' } });
      expect(m.prisma.fontFace.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'face0' } }));
    });

    it('face không thuộc họ được chọn → not_found, không tải lên', async () => {
      m.prisma.fontFamily.findMany.mockResolvedValue(fam([{ id: 'face0', unicodeRange: '' }]));
      expect(await codeOf(upload({ replaceFaceId: 'face-of-other-family' }))).toBe('not_found');
      // họ chưa có (tên lạ) cũng vậy
      m.prisma.fontFamily.findMany.mockResolvedValue([]);
      expect(await codeOf(upload({ replaceFaceId: 'face0' }))).toBe('not_found');
      expect(m.uploadAsset).not.toHaveBeenCalled();
      expect(m.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('dryRun báo replaced true dù dải đoán được khác, không ghi gì', async () => {
      m.prisma.fontFamily.findMany.mockResolvedValue(fam([{ id: 'face0', unicodeRange: '' }]));
      const r = await upload({ replaceFaceId: 'face0', dryRun: true });
      expect(r.faces[0]!.replaced).toBe(true);
      expect(m.uploadAsset).not.toHaveBeenCalled();
      expect(m.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it("family 'Inter' → name_reserved", async () => {
    expect(await codeOf(upload({ family: 'Inter' }))).toBe('name_reserved');
    expect(m.uploadAsset).not.toHaveBeenCalled();
  });

  it('token font-x tĩnh đã có → slug_taken', async () => {
    m.inspectFont.mockReturnValue(inspected({ family: 'X' }));
    m.prisma.token.findUnique.mockResolvedValue({ id: 't1', name: 'font-x', value: 'serif', custom: false, category: 'typography' });
    expect(await codeOf(upload())).toBe('slug_taken');
    expect(m.uploadAsset).not.toHaveBeenCalled();
  });

  it('adoptToken + token tự tạo cùng tên → nhận lại hàng đó, đổi hạng font, giữ value', async () => {
    m.inspectFont.mockReturnValue(inspected({ family: 'gilroy', format: 'otf' }));
    m.prisma.token.findUnique.mockResolvedValue({
      id: 't1', name: 'font-gilroy', value: 'gilroy, system-ui, sans-serif', custom: true, category: 'typography',
    });

    const r = await upload({ adoptToken: true });

    expect(m.prisma.token.create).not.toHaveBeenCalled();
    expect(m.prisma.token.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: expect.objectContaining({ category: 'font' }) }),
    );
    const data = m.prisma.token.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('value');
    expect(r.family.created).toBe(true);
  });

  it('adoptToken nhưng token tĩnh → vẫn slug_taken', async () => {
    m.inspectFont.mockReturnValue(inspected({ family: 'X' }));
    m.prisma.token.findUnique.mockResolvedValue({ id: 't1', name: 'font-x', value: 'serif', custom: false, category: 'font' });
    expect(await codeOf(upload({ adoptToken: true }))).toBe('slug_taken');
  });

  it('thiếu licenseConfirmed (upload) → license_required; nguồn google → không cần', async () => {
    expect(await codeOf(upload({ licenseConfirmed: false }))).toBe('license_required');
    expect(m.uploadAsset).not.toHaveBeenCalled();

    m.inspectFont.mockReturnValue(inspected({ format: 'woff2' }));
    const r = await upload({
      licenseConfirmed: false,
      source: 'google',
      googleFamily: 'Be Vietnam Pro',
      licenseNote: 'Google Fonts (OFL/Apache)',
      prepared: { unicodeRange: 'U+0102-0103', subset: 'vietnamese' },
    });
    expect(r.faces[0]!.subset).toBe('vietnamese');
    expect(m.toWoff2).not.toHaveBeenCalled();
    expect(m.prisma.fontFamily.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'google', googleFamily: 'Be Vietnam Pro', licenseConfirmedBy: null }),
      }),
    );
    expect(m.prisma.fontFace.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unicodeRange: 'U+0102-0103', subset: 'vietnamese' }) }),
    );
  });

  it('face có unicode-range: inspect chỉ kiểm chữ trong dải; extraWarnings gộp vào cảnh báo lưu và trả về', async () => {
    m.inspectFont.mockReturnValue(inspected({ format: 'woff2', warnings: ['restricted_embedding'] }));
    const r = await upload({
      source: 'google',
      prepared: { unicodeRange: 'U+0000-00FF', subset: 'latin' },
      extraWarnings: ['missing_vietnamese', 'restricted_embedding'],
    });
    expect(m.inspectFont).toHaveBeenCalledWith(bytes, { unicodeRange: 'U+0000-00FF' });
    expect(m.prisma.fontFace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warnings: ['restricted_embedding', 'missing_vietnamese'] }),
      }),
    );
    expect(r.warnings.map((w) => w.code)).toEqual(['restricted_embedding', 'missing_vietnamese']);
  });

  it("fallback 'x; }' → bad_fallback", async () => {
    expect(await codeOf(upload({ fallback: 'x; }' }))).toBe('bad_fallback');
  });

  it('(Review Focus 5) dryRun không ghi gì: không upload, không create/update, không audit', async () => {
    m.prisma.fontFamily.findMany.mockResolvedValue([{
      id: 'f1', slug: 'be-vietnam-pro', cssName: 'Be Vietnam Pro', source: 'upload',
      faces: [{ id: 'face0', weight: '400', style: 'normal', unicodeRange: RANGE }],
    }]);
    m.inspectFont.mockReturnValue(inspected({ warnings: ['missing_vietnamese'] }));

    const r = await upload({ dryRun: true, licenseConfirmed: false });

    expect(m.uploadAsset).not.toHaveBeenCalled();
    expect(m.toWoff2).not.toHaveBeenCalled();
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
    for (const model of ['fontFamily', 'fontFace', 'token'] as const) {
      const t = m.prisma[model] as Record<string, ReturnType<typeof vi.fn>>;
      for (const op of ['create', 'update', 'updateMany', 'delete', 'deleteMany']) {
        if (t[op]) expect(t[op], `${model}.${op}`).not.toHaveBeenCalled();
      }
    }
    expect(m.prisma.auditLog.create).not.toHaveBeenCalled();
    expect(m.revalidateTag).not.toHaveBeenCalled();

    expect(r.dryRun).toBe(true);
    expect(r.family.slug).toBe('be-vietnam-pro');
    expect(r.faces).toEqual([{ weight: '400', style: 'normal', subset: '', bytes: bytes.length, replaced: true }]);
    expect(r.warnings.map((w) => w.code)).toEqual(['missing_vietnamese']);
  });

  it('ghi xong gọi revalidateTag("fonts")', async () => {
    await upload();
    expect(m.revalidateTag).toHaveBeenCalledWith('fonts');
  });
});

const family = (faces: { id: string; weight?: string }[]) => ({
  id: 'f1', slug: 'gilroy', cssName: 'gilroy', fallback: FALLBACKS.sans, source: 'upload',
  faces: faces.map((f) => ({ weight: '400', style: 'normal', unicodeRange: '', ...f })),
});

describe('deleteFace', () => {
  it('face cuối của họ đang dùng → in_use, không xoá', async () => {
    m.prisma.fontFamily.findUnique.mockResolvedValue(family([{ id: 'face0' }]));
    m.tokenUsage.mockResolvedValue(USED);
    expect(await codeOf(deleteFace('f1', 'face0', actor))).toBe('in_use');
    expect(m.tokenUsage).toHaveBeenCalledWith('font-gilroy');
    expect(m.prisma.fontFace.delete).not.toHaveBeenCalled();
  });

  it('face không phải cuối → xoá, audit, revalidate', async () => {
    m.prisma.fontFamily.findUnique.mockResolvedValue(family([{ id: 'face0' }, { id: 'face1', weight: '700' }]));
    m.tokenUsage.mockResolvedValue(USED);
    await deleteFace('f1', 'face0', actor);
    expect(m.prisma.fontFace.delete).toHaveBeenCalledWith({ where: { id: 'face0' } });
    expect(m.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'font.face.delete' }) }),
    );
    expect(m.revalidateTag).toHaveBeenCalledWith('fonts');
  });
});

describe('deleteFamily', () => {
  it('họ đang dùng → in_use, extra.usage có danh sách', async () => {
    m.prisma.fontFamily.findUnique.mockResolvedValue(family([{ id: 'face0' }]));
    m.tokenUsage.mockResolvedValue(USED);
    let err: unknown;
    try {
      await deleteFamily('f1', actor);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FontError);
    expect((err as FontError).code).toBe('in_use');
    expect((err as FontError).extra?.usage).toEqual(USED);
    expect(m.prisma.fontFamily.delete).not.toHaveBeenCalled();
  });

  it('họ không còn dùng → xoá họ và token, audit, revalidate', async () => {
    m.prisma.fontFamily.findUnique.mockResolvedValue(family([{ id: 'face0' }]));
    await deleteFamily('f1', actor);
    expect(m.prisma.token.deleteMany).toHaveBeenCalledWith({ where: { name: 'font-gilroy' } });
    expect(m.prisma.fontFamily.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    expect(m.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'font.family.delete' }) }),
    );
    expect(m.revalidateTag).toHaveBeenCalledWith('fonts');
  });
});

describe('updateFamily', () => {
  it('đổi cssName → cập nhật value token, giữ phần fallback; audit; revalidate', async () => {
    m.prisma.fontFamily.findUnique.mockResolvedValue(family([{ id: 'face0' }]));
    m.prisma.token.findUnique.mockResolvedValue({ id: 't1', name: 'font-gilroy', value: 'gilroy, Georgia, serif', custom: true });
    await updateFamily('f1', { cssName: 'Gilroy Web' }, actor);
    expect(m.prisma.fontFamily.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'f1' }, data: expect.objectContaining({ cssName: 'Gilroy Web' }) }),
    );
    expect(m.prisma.token.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: expect.objectContaining({ value: '"Gilroy Web", Georgia, serif' }) }),
    );
    expect(m.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'font.family.update' }) }),
    );
    expect(m.revalidateTag).toHaveBeenCalledWith('fonts');
  });

  it('đổi cssName trùng họ khác (không phân biệt hoa thường) → name_reserved', async () => {
    m.prisma.fontFamily.findUnique.mockResolvedValue(family([{ id: 'face0' }]));
    m.prisma.fontFamily.findMany.mockResolvedValue([
      { id: 'f1', cssName: 'gilroy', faces: [] },
      { id: 'f2', cssName: 'Be Vietnam Pro', faces: [] },
    ]);
    expect(await codeOf(updateFamily('f1', { cssName: 'be  vietnam pro' }, actor))).toBe('name_reserved');
    expect(m.prisma.fontFamily.update).not.toHaveBeenCalled();
  });

  it('đổi fallback → value token mang fallback mới', async () => {
    m.prisma.fontFamily.findUnique.mockResolvedValue(family([{ id: 'face0' }]));
    m.prisma.token.findUnique.mockResolvedValue({ id: 't1', name: 'font-gilroy', value: `"gilroy", ${FALLBACKS.sans}`, custom: true });
    await updateFamily('f1', { fallback: FALLBACKS.serif }, actor);
    expect(m.prisma.token.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ value: `"gilroy", ${FALLBACKS.serif}` }) }),
    );
  });
});

describe('listFonts', () => {
  it('họ tải lên trước, Inter có sẵn sau; unpublished so với Release.fonts của release đang active', async () => {
    const row = (slug: string, cssName: string, key: string) => ({
      id: `id-${slug}`, slug, cssName, fallback: FALLBACKS.sans, source: 'upload', licenseNote: null, licenseConfirmedBy: 'a@b.c',
      faces: [{ id: `face-${slug}`, weight: '400', style: 'normal', unicodeRange: '', subset: '', warnings: [], asset: { key, bytes: 10 } }],
    });
    m.prisma.fontFamily.findMany.mockResolvedValue([row('a', 'A', 'public/builder/a.woff2'), row('b', 'B', 'public/builder/b2.woff2')]);
    m.prisma.site.findFirst.mockResolvedValue({
      activeRelease: {
        fonts: {
          families: [
            { slug: 'a', cssName: 'A', faces: [{ key: 'public/builder/a.woff2', weight: '400', style: 'normal', unicodeRange: '' }] },
            { slug: 'b', cssName: 'B', faces: [{ key: 'public/builder/b1.woff2', weight: '400', style: 'normal', unicodeRange: '' }] },
          ],
        },
      },
    });

    const list = await listFonts();
    expect(list.map((f) => [f.cssName, f.source, f.unpublished])).toEqual([
      ['A', 'upload', false],
      ['B', 'upload', true],
      ['Inter Variable', 'builtin', false],
    ]);
    expect(list[0]).toMatchObject({ id: 'id-a', token: 'font-a', faces: [{ id: 'face-a', bytes: 10 }] });
    expect(list[2]).toMatchObject({ id: null, token: 'font-body' });
  });
});

describe('readFontSeal', () => {
  it('đọc FontFamily + FontFace thành FontSeal, khoá là Asset.key', async () => {
    m.prisma.fontFamily.findMany.mockResolvedValue([
      { slug: 'gilroy', cssName: 'gilroy', faces: [{ weight: '700', style: 'normal', unicodeRange: '', asset: { key: 'public/builder/g.woff2' } }] },
    ]);
    expect(await readFontSeal()).toEqual({
      families: [
        { slug: 'gilroy', cssName: 'gilroy', faces: [{ key: 'public/builder/g.woff2', weight: '700', style: 'normal', unicodeRange: '' }] },
      ],
    });
  });
});
