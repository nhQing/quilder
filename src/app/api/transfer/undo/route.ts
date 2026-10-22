import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { undoImport } from '@/lib/transfer/undo';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as { importId?: unknown };
  if (typeof body.importId !== 'string') return NextResponse.json({ error: 'Thiếu importId' }, { status: 400 });
  const r = await undoImport({ importId: body.importId, session: auth });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
