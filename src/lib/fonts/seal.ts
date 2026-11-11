import type { Prisma, PrismaClient } from '@prisma/client';
import { unstable_cache } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/db';

import { fontFaceCss } from './css';
import {
  EMPTY_FONT_SEAL,
  FONTS_TAG,
  type FontSeal,
  type FontSealFace,
  type FontSealFamily,
} from './types';

const faceSchema = z.object({
  key: z.string().min(1),
  weight: z.string().min(1),
  style: z.enum(['normal', 'italic']),
  unicodeRange: z.string(),
});
const familySchema = z.object({
  slug: z.string().min(1),
  cssName: z.string().min(1),
  faces: z.array(z.unknown()),
});

/**
 * Đọc JSON `Release.fonts` (hoặc bất kỳ giá trị nào) thành FontSeal. Không ném: họ/face
 * sai hình dạng bị bỏ riêng; `null`/`undefined`/rác → rỗng.
 */
export function fontSealOf(json: unknown): FontSeal {
  if (!json || typeof json !== 'object') return EMPTY_FONT_SEAL;
  const raw = (json as { families?: unknown }).families;
  if (!Array.isArray(raw)) return EMPTY_FONT_SEAL;
  const families: FontSealFamily[] = [];
  for (const item of raw) {
    const fam = familySchema.safeParse(item);
    if (!fam.success) continue;
    const faces: FontSealFace[] = [];
    for (const f of fam.data.faces) {
      const face = faceSchema.safeParse(f);
      if (face.success) faces.push(face.data);
    }
    families.push({ slug: fam.data.slug, cssName: fam.data.cssName, faces });
  }
  return { families };
}

// ── Đọc từ DB ────────────────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * FontSeal của bản nháp, đọc thẳng `FontFamily` + `FontFace` (không cache). `db` cho phép
 * Publish chụp trong chính transaction của nó. `key` là `Asset.key` của file face.
 */
export async function readFontSeal(db: Db = prisma): Promise<FontSeal> {
  const rows = await db.fontFamily.findMany({
    orderBy: { slug: 'asc' },
    select: {
      slug: true,
      cssName: true,
      faces: {
        orderBy: [{ weight: 'asc' }, { style: 'asc' }, { unicodeRange: 'asc' }],
        select: { weight: true, style: true, unicodeRange: true, asset: { select: { key: true } } },
      },
    },
  });
  return fontSealOf({
    families: rows.map((f) => ({
      slug: f.slug,
      cssName: f.cssName,
      faces: f.faces.map((x) => ({
        key: x.asset.key,
        weight: x.weight,
        style: x.style,
        unicodeRange: x.unicodeRange,
      })),
    })),
  });
}

/** Bản nháp có cache; mọi thao tác ghi font gọi `revalidateTag(FONTS_TAG)`. */
export const draftFontSeal: () => Promise<FontSeal> = unstable_cache(
  () => readFontSeal(),
  ['font-seal'],
  { tags: [FONTS_TAG] },
);

/** `@font-face` của bản nháp — in ở `/render`, `/preview` và màn Font. */
export async function draftFontFaceCss(): Promise<string> {
  return fontFaceCss(await draftFontSeal());
}
