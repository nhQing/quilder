import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { buildExport } from '@/lib/transfer/export';
import { bundleFileName } from '@/lib/transfer/manifest';

export const dynamic = 'force-dynamic';

/** Kiểm trước khi xuất — chưa tải gì. Lỗi trả về thành chữ kèm chỗ xảy ra (spec §5.1). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const r = await buildExport(id, auth.email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const blocked = r.issues.some((i) => i.level === 'block');
  return NextResponse.json({
    ok: !blocked,
    issues: r.issues,
    // Khi bị chặn, `bundle` có thể không có (doc-invalid) — không đọc.
    summary: blocked ? null : {
      files: r.files.length,
      bytes: r.bundle.assets.reduce((s, a) => s + a.bytes, 0),
      fileName: bundleFileName(r.bundle.page.slug, new Date()),
    },
  });
}
