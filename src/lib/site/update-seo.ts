import 'server-only';

/**
 * Lưu khối "Tên miền & SEO" của màn Cài đặt: URL site, template tiêu đề, mô tả mặc
 * định, robots.txt, luật sitemap.
 *
 * Tách khỏi `updateSiteSettings` vì khối này có một luồng mà khối kia không có:
 * robots.txt có CẢNH BÁO (chặn cả site, thiếu Sitemap) — lưu được, nhưng chỉ khi
 * người dùng đã thấy và xác nhận. Lần gửi đầu trả 409 kèm `warnings`; lần gửi lại với
 * `confirmWarnings: true` mới ghi.
 *
 * Mọi field: vắng mặt = giữ nguyên. Chuỗi rỗng = xoá (về hành vi mặc định).
 */

import type { Prisma } from '@prisma/client';
import { revalidateTag } from 'next/cache';

import { prisma } from '@/lib/db';
import { lintRobotsTxt } from './robots';
import { normalizeSiteUrl, resolveOrigin, SITE_SETTINGS_TAG, siteUrlFromEnv } from './origin';
import { checkTitleTemplate, MAX_SEO_DESCRIPTION } from './seo-template';
import { checkSitemapRules, parseSitemapRules } from './sitemap-rules';
import { SITE_THEMES } from './theme';

export interface SiteSeoPatch {
  siteUrl?: string;
  theme?: string;
  seoTitleTemplate?: string;
  seoDescription?: string;
  /** `null` = về tự sinh. */
  robotsTxt?: string | null;
  sitemapRules?: { include: string[]; exclude: string[] };
  confirmWarnings?: boolean;
}

export type SiteSeoResult =
  | { ok: true }
  | { ok: false; status: number; error: string; field?: keyof SiteSeoPatch; warnings?: string[] };

const lines = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean);

export async function updateSiteSeo(actorSub: string, patch: SiteSeoPatch): Promise<SiteSeoResult> {
  const site = await prisma.site.findFirst({
    select: {
      id: true, siteUrl: true, seoTitleTemplate: true, seoDescription: true, robotsTxt: true, sitemapRules: true,
      theme: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!site) return { ok: false, status: 404, error: 'Chưa có site. Chạy màn cài đặt trước.' };

  const data: Prisma.SiteUpdateInput = {};

  /* ── URL site ─────────────────────────────────────────────────────── */
  if (patch.siteUrl !== undefined) {
    if (siteUrlFromEnv()) {
      return {
        ok: false,
        status: 409,
        field: 'siteUrl',
        error: 'URL site đang bị biến môi trường SITE_URL ghi đè — đổi ở env của server.',
      };
    }
    const url = normalizeSiteUrl(patch.siteUrl);
    if (!url) {
      return {
        ok: false,
        status: 400,
        field: 'siteUrl',
        error: 'URL site phải có dạng https://ten-mien.vn — có http:// hoặc https://, không có đường dẫn phía sau.',
      };
    }
    data.siteUrl = url;
    // `primaryDomain` là nhãn hiển thị cũ; giữ nó khớp để không có hai câu trả lời.
    data.primaryDomain = new URL(url).host;
  }

  // Gốc dùng để kiểm robots/sitemap: giá trị SẮP lưu nếu có, không thì giá trị đang chạy.
  const origin = resolveOrigin(process.env.SITE_URL, (data.siteUrl as string | undefined) ?? site.siteUrl).origin;

  /* ── Theme ──────────────────────────────────────────────────────────── */
  if (patch.theme !== undefined) {
    if (!(SITE_THEMES as readonly string[]).includes(patch.theme)) {
      return { ok: false, status: 400, field: 'theme', error: 'Theme phải là light, dark hoặc system.' };
    }
    data.theme = patch.theme;
  }

  /* ── SEO mặc định ─────────────────────────────────────────────────── */
  if (patch.seoTitleTemplate !== undefined) {
    const bad = checkTitleTemplate(patch.seoTitleTemplate);
    if (bad) return { ok: false, status: 400, field: 'seoTitleTemplate', error: bad };
    data.seoTitleTemplate = patch.seoTitleTemplate.trim() || null;
  }
  if (patch.seoDescription !== undefined) {
    const d = patch.seoDescription.trim();
    if (d.length > MAX_SEO_DESCRIPTION) {
      return { ok: false, status: 400, field: 'seoDescription', error: `Mô tả tối đa ${MAX_SEO_DESCRIPTION} ký tự.` };
    }
    data.seoDescription = d || null;
  }

  /* ── robots.txt ───────────────────────────────────────────────────── */
  if (patch.robotsTxt !== undefined) {
    if (patch.robotsTxt === null || !patch.robotsTxt.trim()) {
      data.robotsTxt = null;
    } else {
      const text = patch.robotsTxt.replace(/\r\n/g, '\n');
      const { errors, warnings } = lintRobotsTxt(text, origin);
      if (errors.length) return { ok: false, status: 400, field: 'robotsTxt', error: errors.join(' ') };
      if (warnings.length && !patch.confirmWarnings) {
        return { ok: false, status: 409, field: 'robotsTxt', error: 'robots.txt có cảnh báo cần xác nhận.', warnings };
      }
      data.robotsTxt = text.endsWith('\n') ? text : `${text}\n`;
    }
  }

  /* ── sitemap ──────────────────────────────────────────────────────── */
  if (patch.sitemapRules !== undefined) {
    const rules = { include: lines(patch.sitemapRules.include ?? []), exclude: lines(patch.sitemapRules.exclude ?? []) };
    const errors = checkSitemapRules(rules, origin);
    if (errors.length) return { ok: false, status: 400, field: 'sitemapRules', error: errors.join(' ') };
    data.sitemapRules = rules;
  }

  if (!Object.keys(data).length) return { ok: true };

  await prisma.$transaction([
    prisma.site.update({ where: { id: site.id }, data }),
    prisma.auditLog.create({
      data: {
        userId: actorSub,
        action: 'site.seo.update',
        targetType: 'Site',
        targetId: site.id,
        meta: {
          // Trước VÀ sau — cùng quy ước với `site.settings.update`.
          before: {
            siteUrl: site.siteUrl,
            theme: site.theme,
            seoTitleTemplate: site.seoTitleTemplate,
            seoDescription: site.seoDescription,
            robotsTxt: site.robotsTxt,
            sitemapRules: parseSitemapRules(site.sitemapRules) as unknown as Prisma.InputJsonValue,
          },
          after: data as Prisma.InputJsonValue,
        },
      },
    }),
  ]);

  revalidateTag(SITE_SETTINGS_TAG);
  // Tên miền đổi thì cache trang (canonical, og:url) cũng phải dựng lại.
  if (data.siteUrl !== undefined || data.theme !== undefined) revalidateTag('release');
  return { ok: true };
}
