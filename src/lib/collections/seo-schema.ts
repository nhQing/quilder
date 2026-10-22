/**
 * Zod của field `seo` — tách khỏi `seo.ts` để các file thuần đọc JSONB (`i18n.ts`, form
 * admin) không kéo zod theo. Luật đọc và luật ghi vẫn dùng chung hằng số và
 * `normalizeCanonical` của `seo.ts`.
 */

import { z } from 'zod';

import { SEO_LIMITS, charCount, isJsonLd, normalizeCanonical, type SeoValue } from './seo';

/* ── validator ─────────────────────────────────────────────────────────── */

const zJsonObject = z.record(z.string(), z.unknown());

const zSeoRaw = z
  .object({
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    keywords: z.string().optional(),
    ogImage: z.object({ assetId: z.string().optional(), alt: z.string().optional() }).strip().optional(),
    canonicalUrl: z.string().optional(),
    noindex: z.boolean().optional(),
    structuredData: z.union([zJsonObject, z.array(zJsonObject)]).optional(),
  })
  .strip();

/**
 * Zod cho GIÁ TRỊ của một field `seo`, áp ở mọi đường ghi — bản gốc lẫn lớp phủ.
 *
 * Chuẩn hoá và kiểm trong CÙNG một `.transform`: canonical phải được kiểm trên chuỗi
 * gốc rồi mới được cắt về đường dẫn, và hai bước tách nhau thì bước sau không biết
 * bước trước đã cắt gì. Lỗi gắn `path` của ô con, nên người dùng đọc được
 * `seo.metaTitle: …` thay vì một câu chung cho cả khối.
 */
export function zSeoValue(siteHost: string | null): z.ZodType<SeoValue, z.ZodTypeDef, unknown> {
  return zSeoRaw.transform((v, ctx) => {
    const out: SeoValue = {};
    const text = (
      key: 'metaTitle' | 'metaDescription' | 'keywords',
      max: number,
      label: string,
    ) => {
      const s = v[key]?.trim();
      if (!s) return;
      const n = charCount(s);
      if (n > max) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${label} dài quá ${max} ký tự (đang có ${n})` });
        return;
      }
      out[key] = s;
    };
    text('metaTitle', SEO_LIMITS.titleMax, 'Tiêu đề SEO');
    text('metaDescription', SEO_LIMITS.descMax, 'Mô tả SEO');
    text('keywords', SEO_LIMITS.keywordsMax, 'Từ khoá');

    const assetId = v.ogImage?.assetId?.trim();
    const alt = v.ogImage?.alt?.trim();
    if (alt && charCount(alt) > SEO_LIMITS.altMax) {
      ctx.addIssue({
        code: 'custom',
        path: ['ogImage', 'alt'],
        message: `Mô tả ảnh dài quá ${SEO_LIMITS.altMax} ký tự (đang có ${charCount(alt)})`,
      });
    } else if (assetId || alt) {
      out.ogImage = { ...(assetId ? { assetId } : {}), ...(alt ? { alt } : {}) };
    }

    if (v.canonicalUrl?.trim()) {
      const c = normalizeCanonical(v.canonicalUrl, siteHost);
      if (c.ok) out.canonicalUrl = c.path;
      else ctx.addIssue({ code: 'custom', path: ['canonicalUrl'], message: c.error });
    }

    if (v.noindex === true) out.noindex = true;

    // `{}` / `[{}]` bị bỏ như ô trống — xem `isJsonLd`.
    if (v.structuredData !== undefined && isJsonLd(v.structuredData)) {
      const n = JSON.stringify(v.structuredData).length;
      if (n > SEO_LIMITS.structuredMax) {
        ctx.addIssue({
          code: 'custom',
          path: ['structuredData'],
          message: `Dữ liệu có cấu trúc quá lớn (${n} ký tự, tối đa ${SEO_LIMITS.structuredMax})`,
        });
      } else {
        out.structuredData = v.structuredData;
      }
    }

    return out;
  });
}

