import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { buildExport } from '@/lib/transfer/export';
import { takeExport } from '@/lib/transfer/export-cache';
import { bundleFileName } from '@/lib/transfer/manifest';
import { zipStream } from '@/lib/transfer/zip';

export const dynamic = 'force-dynamic';

/**
 * Tổng byte media sẽ NÉN vào zip — để hộp thoại tính % lúc tải. Media nén kiểu "store" nên con
 * số này sát cỡ zip thật; đếm theo entry (file trùng nội dung chỉ nén một lần).
 */
const MEDIA_BYTES_HEADER = 'x-export-media-bytes';

function mediaBytes(assets: { file: string; bytes: number }[]): number {
  const byEntry = new Map<string, number>();
  for (const a of assets) byEntry.set(a.file, a.bytes);
  let sum = 0;
  for (const b of byEntry.values()) sum += b;
  return sum;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  // Có token của lượt kiểm thì dùng lại gói đó, stream ngay. Không có / hết hạn → dựng lại như cũ.
  const cached = takeExport(new URL(req.url).searchParams.get('token'), id, auth.email);
  let bundle;
  let files;
  if (cached) {
    ({ bundle, files } = cached);
  } else {
    const r = await buildExport(id, auth.email);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    // Kiểm `block` TRƯỚC khi đụng `bundle` — nhánh doc-invalid không có bundle.
    if (r.issues.some((i) => i.level === 'block')) {
      return NextResponse.json({ error: 'Trang chưa xuất được — chạy bước kiểm trước', issues: r.issues }, { status: 409 });
    }
    ({ bundle, files } = r);
  }
  const name = bundleFileName(bundle.page.slug, new Date());
  return new Response(zipStream(bundle, files), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      [MEDIA_BYTES_HEADER]: String(mediaBytes(bundle.assets)),
    },
  });
}
