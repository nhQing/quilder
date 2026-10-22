import { NextResponse } from 'next/server';

/** Một danh mục: xoá, và bật/tắt hiển thị. Vỏ mỏng quanh `taxonomy-write.ts`. */

import { requireAuth } from '@/lib/auth/guard';
import { deleteTaxonomy, setTaxonomyStatus } from '@/lib/collections/taxonomy-write';

export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const result = await deleteTaxonomy({ id, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  // `detached` để UI nói được "đã gỡ khỏi 12 bài", chứ không chỉ "đã xoá".
  return NextResponse.json({ ok: true, detached: result.detached });
}

/**
 * Bật/tắt hiển thị một danh mục.
 *
 * `PATCH` chứ không `PUT`: thân request chỉ mang MỘT field, và nó là một field
 * trong nhiều field của danh mục. `PUT` hứa thay cả tài nguyên, tức hứa rằng bỏ
 * `name` khỏi thân sẽ xoá tên.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: { published?: unknown };
  try {
    body = (await request.json()) as { published?: unknown };
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  if (typeof body.published !== 'boolean') {
    return NextResponse.json({ error: 'Thiếu trường published (boolean)' }, { status: 400 });
  }

  const { id } = await params;
  const result = await setTaxonomyStatus({ id, published: body.published, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, status: result.status });
}
