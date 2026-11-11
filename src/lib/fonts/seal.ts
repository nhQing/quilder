import { z } from 'zod';
import { EMPTY_FONT_SEAL, type FontSeal, type FontSealFace, type FontSealFamily } from './types';

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
