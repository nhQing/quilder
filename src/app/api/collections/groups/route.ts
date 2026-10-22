import { NextResponse } from 'next/server';

/** Upsert nhóm field dùng lại. PUT vì nó idempotent theo `key`. */

import { requireAuth } from '@/lib/auth/guard';
import { upsertFieldGroup } from '@/lib/collections/type-write';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: { key?: string; name?: string; schema?: unknown; icon?: string; allowEmpty?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await upsertFieldGroup({
    key: body.key ?? '',
    name: body.name ?? '',
    schema: body.schema ?? [],
    icon: body.icon,
    allowEmpty: body.allowEmpty,
    actorSub: auth.sub,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, group: result.group });
}
