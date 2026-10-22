import { NextResponse } from 'next/server';

/**
 * Sửa cấu hình site.
 *
 * `admin`, không phải `write`: `globals` giữ số giấy phép và hotline — chuỗi có
 * nghĩa pháp lý, xuất hiện ở nhiều nơi. Nó không nên nằm sau cùng một quyền với
 * "sửa tiêu đề trang".
 *
 * GET trả về khoá nào đang được dùng ở đâu, để màn hình cảnh báo được TRƯỚC khi
 * người dùng xoá một khoá.
 */

import { requireAuth } from '@/lib/auth/guard';
import { siteGlobalUsage, updateSiteSettings } from '@/lib/builder/site-settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const usage = await siteGlobalUsage();
  return NextResponse.json({ ok: true, usage: [...usage.values()] });
}

interface Body {
  name?: string;
  primaryDomain?: string;
  globals?: Record<string, unknown>;
  /** `null` = bỏ favicon. Vắng mặt = giữ nguyên. */
  faviconAssetId?: string | null;
  ogImageId?: string | null;
  builderLogoAssetId?: string | null;
  builderFaviconAssetId?: string | null;
  builderFaviconUseSite?: boolean;
  force?: boolean;
}

export async function PATCH(request: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await updateSiteSettings({
    session: auth,
    name: body.name,
    primaryDomain: body.primaryDomain,
    globals: body.globals,
    // Truyền khoá CHỈ KHI body có nó: `updateSiteSettings` phân biệt "vắng mặt" với
    // `null`, và spread một `undefined` vào object vẫn tạo ra khoá — đủ để một
    // request không nhắc gì tới favicon lại xoá favicon.
    ...('faviconAssetId' in body ? { faviconAssetId: body.faviconAssetId ?? null } : {}),
    ...('ogImageId' in body ? { ogImageId: body.ogImageId ?? null } : {}),
    ...('builderLogoAssetId' in body ? { builderLogoAssetId: body.builderLogoAssetId ?? null } : {}),
    ...('builderFaviconAssetId' in body ? { builderFaviconAssetId: body.builderFaviconAssetId ?? null } : {}),
    ...(typeof body.builderFaviconUseSite === 'boolean' ? { builderFaviconUseSite: body.builderFaviconUseSite } : {}),
    force: body.force,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.inUse ? { inUse: result.inUse } : {}) },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    note:
      body.globals !== undefined
        ? 'Đã lưu. `globals` được niêm phong theo release — site thật đổi khi bấm Publish.'
        : 'Đã lưu.',
  });
}
