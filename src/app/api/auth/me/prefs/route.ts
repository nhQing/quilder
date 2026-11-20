import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';
import { isEntrySort, withEntrySort } from '@/lib/collections/entry-sort';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Tuỳ chọn xem của CHÍNH tài khoản đang đăng nhập (`User.prefs`).
 *
 * Không nhận id trong URL: mỗi người chỉ sửa được tuỳ chọn của mình, nên không có
 * gì để kiểm quyền ngoài "đã đăng nhập". Quyền `read` là đủ — đổi thứ tự bảng không
 * ghi gì vào nội dung, và người chỉ xem cũng cần chọn cách xem.
 *
 * Token service (MCP) không có tuỳ chọn xem: nó không nhìn bảng. Middleware cũng
 * không cho nó tới đây (`service-scope.ts`); chặn lại ở route để không phụ thuộc
 * một allowlist ở xa.
 *
 * Chỉ nhận khoá đã biết, mỗi khoá kiểm giá trị riêng: `prefs` là JSON tự do trong DB,
 * và một route ghi thẳng body vào đó là cửa cho mọi thứ rác.
 */
export async function PATCH(request: Request) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  if (auth.kind === 'service') {
    return NextResponse.json({ error: 'Token service không có tuỳ chọn xem' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { entrySort?: unknown } | null;
  if (!body || !isEntrySort(body.entrySort)) {
    return NextResponse.json({ error: 'entrySort phải là created hoặc updated' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { prefs: true } });
  if (!user) return NextResponse.json({ error: 'Không có tài khoản này' }, { status: 404 });

  const prefs = withEntrySort(user.prefs, body.entrySort);
  await prisma.user.update({ where: { id: auth.sub }, data: { prefs: prefs as object } });

  return NextResponse.json({ ok: true, prefs });
}
