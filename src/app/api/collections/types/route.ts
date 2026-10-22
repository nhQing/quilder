import { NextResponse } from 'next/server';

/**
 * Loại nội dung: đọc danh sách, tạo mới.
 *
 * Vỏ HTTP MỎNG quanh `getCollectionTypes()` và `createCollectionType()`. Toàn bộ
 * luật nằm ở đó, vì tool MCP cũng gọi đúng hai hàm ấy. Không chép luật vào đây:
 * hai bản của một luật sẽ trôi khỏi nhau, và bản ít được nhớ tới là bản mà người
 * sau đọc.
 */

import { requireAuth } from '@/lib/auth/guard';
import { getCollectionTypes } from '@/lib/collections/queries';
import { createCollectionType } from '@/lib/collections/type-write';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ types: await getCollectionTypes() });
}

interface Body {
  key?: string;
  name?: string;
  namePlural?: string;
  icon?: string;
  singleton?: boolean;
}

export async function POST(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await createCollectionType({
    key: body.key ?? '',
    name: body.name ?? '',
    namePlural: body.namePlural ?? '',
    icon: body.icon,
    singleton: body.singleton,
    actorEmail: auth.email,
    actorSub: auth.sub,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, type: result.type });
}
