import { NextResponse } from 'next/server';

/** Thứ tự thẻ trên màn Kho dữ liệu. POST vì nó ghi đè cả danh sách, không sửa một phần. */

import { requireAuth } from '@/lib/auth/guard';
import { reorderCollectionCards } from '@/lib/collections/reorder';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: { kind?: string; keys?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  if (body.kind !== 'type' && body.kind !== 'group') {
    return NextResponse.json({ error: 'kind phải là type hoặc group' }, { status: 400 });
  }

  const result = await reorderCollectionCards(body.kind, body.keys);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, count: result.count });
}
