import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { buildExport } from '@/lib/transfer/export';
import { bundleFileName } from '@/lib/transfer/manifest';
import { zipStream } from '@/lib/transfer/zip';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const r = await buildExport(id, auth.email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  // Kiểm `block` TRƯỚC khi đụng `bundle` — nhánh doc-invalid không có bundle.
  if (r.issues.some((i) => i.level === 'block')) {
    return NextResponse.json({ error: 'Trang chưa xuất được — chạy bước kiểm trước', issues: r.issues }, { status: 409 });
  }
  const name = bundleFileName(r.bundle.page.slug, new Date());
  return new Response(zipStream(r.bundle, r.files), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
}
