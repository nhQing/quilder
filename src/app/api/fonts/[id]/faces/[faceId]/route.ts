import { NextResponse } from 'next/server';

/** Xoá một face của họ font (§10). Quyền `write`; xoá cả họ ở `../../route.ts` cần admin. */

import { requireAuth } from '@/lib/auth/guard';
import { fontErrorResponse } from '@/lib/fonts/http';
import { deleteFace } from '@/lib/fonts/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; faceId: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const { id, faceId } = await params;
  try {
    await deleteFace(id, faceId, { email: auth.email, sub: auth.sub });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fontErrorResponse(e);
  }
}
