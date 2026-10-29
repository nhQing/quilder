import { NextResponse } from 'next/server';

/** Một danh mục: xoá, bật/tắt hiển thị, và đặt tên theo ngôn ngữ. Vỏ mỏng quanh `taxonomy-write.ts`. */

import { requireAuth } from '@/lib/auth/guard';
import { deleteTaxonomy, setTaxonomyLocaleName, setTaxonomyStatus } from '@/lib/collections/taxonomy-write';

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
 * Bật/tắt hiển thị (`{ published }`), HOẶC đặt tên theo ngôn ngữ (`{ locale, name }`,
 * `name: null` hoặc rỗng là gỡ bản dịch). Một request làm đúng một việc — hai việc
 * có hai dòng audit khác nhau, và gộp chúng là một request nửa thành nửa hỏng.
 *
 * `PATCH` chứ không `PUT`: thân request chỉ mang MỘT field, và nó là một field
 * trong nhiều field của danh mục. `PUT` hứa thay cả tài nguyên, tức hứa rằng bỏ
 * `name` khỏi thân sẽ xoá tên.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: { published?: unknown; locale?: unknown; name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  if (body.locale !== undefined) {
    if (typeof body.locale !== 'string' || !body.locale) {
      return NextResponse.json({ error: 'locale phải là mã ngôn ngữ' }, { status: 400 });
    }
    if (body.name !== null && typeof body.name !== 'string') {
      return NextResponse.json({ error: 'Thiếu trường name (chuỗi, hoặc null để gỡ)' }, { status: 400 });
    }
    const { id } = await params;
    const result = await setTaxonomyLocaleName({
      id, locale: body.locale, name: body.name, actorSub: auth.sub,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, i18n: result.i18n });
  }

  if (typeof body.published !== 'boolean') {
    return NextResponse.json({ error: 'Thiếu trường published (boolean)' }, { status: 400 });
  }

  const { id } = await params;
  const result = await setTaxonomyStatus({ id, published: body.published, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, status: result.status });
}
