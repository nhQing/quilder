import { NextResponse } from 'next/server';

/**
 * Đăng nhập bằng email + mật khẩu.
 *
 * Chạy trên Node (không phải Edge) vì kiểm mật khẩu dùng `node:crypto`.
 *
 * Google OAuth từng là đường chính theo plan (đã bỏ — chỉ email + mật khẩu);
 * nó cần GOOGLE_CLIENT_ID/SECRET nên chưa bật được. Đường mật khẩu này là dự
 * phòng, và cũng là cách duy nhất để có tài khoản đầu tiên.
 */

import { prisma } from '@/lib/db';
import { clientIp } from '@/lib/client-ip';
import { peekRateLimit, rateLimit } from '@/lib/ratelimit';
import { verifyPassword } from '@/lib/auth/password';
import {
  REMEMBER_MAX_AGE, SESSION_COOKIE, SESSION_MAX_AGE, sessionCookieSecure, signSession, type Role,
} from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LOGIN_WINDOW_MS = 15 * 60_000;

interface Body {
  email?: string;
  password?: string;
  remember?: boolean;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || !password) {
    return NextResponse.json({ error: 'Thiếu email hoặc mật khẩu' }, { status: 400 });
  }

  /*
   * Trần số lần SAI, kiểm TRƯỚC khi đụng DB hay băm mật khẩu.
   *
   * Hai gáo, vì hai kiểu dò khác nhau: một máy thử nhiều email (gáo IP), và nhiều
   * máy cùng thử một email (gáo email). Gáo email chặt hơn: 5 lần sai/15 phút vẫn
   * đủ cho người gõ nhầm, và đổ lại một lượt mỗi 3 phút.
   *
   * Chỉ lần sai mới tiêu lượt (`invalid()` bên dưới). Đăng nhập đúng không tốn gì:
   * cả văn phòng sau một NAT đăng nhập buổi sáng không được khoá lẫn nhau.
   *
   * Cùng câu trả lời 429 cho email có và không có tài khoản — khác nhau là tiết lộ
   * email nào tồn tại, đúng thứ `invalid()` tồn tại để che.
   */
  const throttles = [
    [`login:ip:${clientIp(request.headers)}`, 20],
    [`login:email:${email}`, 5],
  ] as const;
  for (const [key, limit] of throttles) {
    const quota = peekRateLimit(key, limit, LOGIN_WINDOW_MS);
    if (!quota.ok) {
      return NextResponse.json(
        { error: `Sai quá nhiều lần. Thử lại sau ${quota.retryAfter} giây.` },
        { status: 429, headers: { 'retry-after': String(quota.retryAfter) } },
      );
    }
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, passwordHash: true, lockedAt: true },
  });

  // Cùng một thông báo cho "không có tài khoản" và "sai mật khẩu": phân biệt hai
  // cái cho phép dò xem email nào tồn tại trong hệ thống.
  const invalid = () => {
    for (const [key, limit] of throttles) rateLimit(key, limit, LOGIN_WINDOW_MS);
    return NextResponse.json({ error: 'Email hoặc mật khẩu không đúng' }, { status: 401 });
  };

  if (!user?.passwordHash) {
    // Vẫn tốn thời gian băm một chuỗi giả, để thời gian phản hồi không tiết lộ
    // tài khoản có tồn tại hay không.
    await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    return invalid();
  }

  if (!(await verifyPassword(password, user.passwordHash))) return invalid();

  /*
   * Tài khoản đã khoá: kiểm SAU khi đã xác minh mật khẩu, và trả về cùng câu lỗi
   * chung.
   *
   * Kiểm trước thì thời gian phản hồi tiết lộ email nào có tài khoản — đúng thứ
   * mà `invalid()` ở trên tồn tại để che, kể cả chuỗi băm giả kia. Và nói thẳng
   * "tài khoản đã bị khoá" cũng tiết lộ y như vậy.
   *
   * Người bị khoá không cần route này giải thích: họ biết tìm ai trong công ty,
   * và admin thấy trạng thái ấy trong bảng tài khoản.
   */
  if (user.lockedAt) return invalid();

  /*
   * `remember === true` một cách TƯỜNG MINH, không phải bất cứ giá trị thật nào.
   *
   * Thân request là JSON không tin được; `"false"`, `0` hay `"no"` đều là những
   * thứ một client viết ẩu có thể gửi, và với phép kiểm thật/giả thông thường thì
   * chuỗi `"false"` là THẬT. Một phiên 30 ngày cấp nhầm do đọc sai một chuỗi là
   * loại lỗi không ai phát hiện ra, vì nó không có triệu chứng nào.
   */
  const remember = body.remember === true;
  const maxAge = remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE;

  // Hạn của JWT và hạn của cookie phải là CÙNG một số. Lệch nhau thì hoặc cookie
  // còn sống mang một token đã hết hạn (người dùng bị đá ra giữa chừng, không rõ
  // lý do), hoặc token còn hạn mà cookie đã bị trình duyệt xoá.
  const token = await signSession(
    {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      name: user.name ?? undefined,
    },
    maxAge,
  );

  const response = NextResponse.json({
    ok: true,
    user: { email: user.email, name: user.name, role: user.role },
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Production thì Secure, trừ môi trường nội bộ chạy http có chủ ý — xem sessionCookieSecure.
    secure: sessionCookieSecure(),
    path: '/',
    maxAge,
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id, action: 'auth.login', targetType: 'User',
      // `remember` vào nhật ký: một phiên sống 30 ngày là thứ admin phải thấy được
      // là đang tồn tại, chứ không phải suy ra từ việc ai đó lâu không đăng nhập.
      targetId: user.id, meta: { email: user.email, remember },
    },
  });

  return response;
}
