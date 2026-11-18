import { NextResponse } from 'next/server';

/** Xoá một nhóm field dùng lại. Từ chối (409) khi còn loại/nhóm khác đang dùng nó. */

import { requireAuth } from '@/lib/auth/guard';
import { deleteFieldGroup } from '@/lib/collections/type-write';

export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { key } = await params;
  const result = await deleteFieldGroup({ key, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
