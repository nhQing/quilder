import { NextResponse } from 'next/server';

/** Sửa cấu trúc field. Trả `warnings` để form hiện được "field bị ẩn, dữ liệu còn đó". */

import { requireAuth } from '@/lib/auth/guard';
import { deleteCollectionType, updateCollectionSchema } from '@/lib/collections/type-write';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { key } = await params;

  let body: { schema?: unknown; titleField?: string };
  try {
    body = (await request.json()) as { schema?: unknown; titleField?: string };
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await updateCollectionSchema({
    typeKey: key,
    schema: body.schema,
    titleField: body.titleField,
    actorEmail: auth.email,
    actorSub: auth.sub,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, warnings: result.warnings });
}

/**
 * Xoá một loại nội dung. Từ chối khi còn entry — luật ở `deleteCollectionType`.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { key } = await params;
  const result = await deleteCollectionType({ key, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, deletedTaxonomies: result.deletedTaxonomies });
}
