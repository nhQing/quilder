import { NextResponse } from 'next/server';

/**
 * Tạo một view của API công khai. Chỉ admin — view quyết định app bên ngoài nhận được
 * gì, cùng tầm với cấp token. Token service bị chặn ở `requireAuth('admin')`.
 */

import { requireAuth } from '@/lib/auth/guard';
import { saveApiView } from '@/lib/collections/api-view-store';
import { readViewBody } from './body';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const body = await readViewBody(request);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });

  const result = await saveApiView({ input: body.input, note: body.note, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, view: result.view });
}
