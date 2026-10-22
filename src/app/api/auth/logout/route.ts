import { NextResponse } from 'next/server';

import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Xoá bằng maxAge 0 chứ không chỉ `delete`: một số proxy giữ lại cookie khi
  // chỉ có lệnh xoá mà không có giá trị rỗng đi kèm.
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(),
    path: '/',
    maxAge: 0,
  });
  return response;
}
