import { NextResponse } from 'next/server';

/**
 * Lịch sử sửa một trang.
 *
 * `read` chứ không `write`: xem lịch sử là việc của bất cứ ai xem được builder.
 * Lùi bản mới cần `write` — xem route `../revert`.
 */

import { requireAuth } from '@/lib/auth/guard';
import { listPageVersions } from '@/lib/builder/page-history';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  return NextResponse.json({ ok: true, versions: await listPageVersions(id) });
}
