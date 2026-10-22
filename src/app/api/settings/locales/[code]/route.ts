import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { deleteLocale, setLocaleEnabled } from '@/lib/i18n/locale-admin';

/** Bật/tắt (PATCH `{ enabled }`) và xoá một ngôn ngữ. Chỉ admin — xem locale-admin.ts. */
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;
  const { code } = await params;

  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Cần `enabled` dạng boolean.' }, { status: 400 });
  }

  const r = await setLocaleEnabled(auth.sub, code, body.enabled);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;
  const { code } = await params;

  const r = await deleteLocale(auth.sub, code);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
