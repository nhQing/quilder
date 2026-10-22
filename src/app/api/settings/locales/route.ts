import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { createLocale } from '@/lib/i18n/locale-admin';

/** Thêm ngôn ngữ (ở trạng thái tắt). Chỉ admin — xem locale-admin.ts. */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => null)) as { code?: unknown; label?: unknown } | null;
  if (!body || typeof body.code !== 'string' || typeof body.label !== 'string') {
    return NextResponse.json({ error: 'Cần `code` và `label` dạng chuỗi.' }, { status: 400 });
  }

  const r = await createLocale(auth.sub, { code: body.code, label: body.label });
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
