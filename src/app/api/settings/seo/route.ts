import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { updateSiteSeo, type SiteSeoPatch } from '@/lib/site/update-seo';

/**
 * Khối "Tên miền & SEO" của màn Cài đặt. Chỉ admin: robots.txt chặn sai một dòng là
 * site biến khỏi Google, và tên miền sai là canonical của mọi trang trỏ sai.
 */
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  let body: SiteSeoPatch;
  try {
    body = (await request.json()) as SiteSeoPatch;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await updateSiteSeo(auth.sub, {
    ...(typeof body.siteUrl === 'string' ? { siteUrl: body.siteUrl } : {}),
    ...(typeof body.theme === 'string' ? { theme: body.theme } : {}),
    ...(typeof body.seoTitleTemplate === 'string' ? { seoTitleTemplate: body.seoTitleTemplate } : {}),
    ...(typeof body.seoDescription === 'string' ? { seoDescription: body.seoDescription } : {}),
    // `null` có nghĩa ("về tự sinh"), nên kiểm `in` chứ không kiểm kiểu.
    ...('robotsTxt' in body ? { robotsTxt: typeof body.robotsTxt === 'string' ? body.robotsTxt : null } : {}),
    ...(body.sitemapRules && typeof body.sitemapRules === 'object'
      ? {
          sitemapRules: {
            include: Array.isArray(body.sitemapRules.include) ? body.sitemapRules.include.map(String) : [],
            exclude: Array.isArray(body.sitemapRules.exclude) ? body.sitemapRules.exclude.map(String) : [],
          },
        }
      : {}),
    confirmWarnings: body.confirmWarnings === true,
  });

  if (!result.ok) {
    const { ok: _ok, status, ...rest } = result;
    return NextResponse.json(rest, { status });
  }
  return NextResponse.json({ ok: true });
}
