import { NextResponse } from 'next/server';

/**
 * Tạo trang mới.
 *
 * Vỏ HTTP mỏng quanh `createPage()` trong `@/lib/builder/create-page`. Toàn bộ
 * luật — chuẩn hoá slug, kiểm trùng, dựng doc trống, ghi audit — nằm ở đó, vì tool
 * MCP `create_page` cũng gọi đúng hàm ấy.
 *
 * Không chép luật vào đây. Hai bản của một luật sẽ trôi khỏi nhau, và bản ít được
 * nhớ tới là bản mà người sau đọc.
 */

import { requireAuth } from '@/lib/auth/guard';
import { createPage } from '@/lib/builder/create-page';

export const dynamic = 'force-dynamic';

interface Body {
  title?: string;
  slug?: string;
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

  const result = await createPage({
    title: body.title ?? '',
    slug: body.slug,
    actorEmail: auth.email,
    actorSub: auth.sub,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, page: result.page });
}
