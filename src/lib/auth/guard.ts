import 'server-only';

/**
 * Kiểm quyền trong route handler.
 *
 * Middleware chỉ trả lời "có phiên hợp lệ không". Nó chạy trên Edge nên không
 * đọc được database, và cũng không nên biết route nào cần quyền gì — nhét bảng
 * phân quyền vào middleware là đặt nó xa chỗ nó có hiệu lực.
 *
 * Vì vậy mỗi route tự khai quyền tối thiểu của mình, ngay dòng đầu.
 */

import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { liveSessionRole } from './service-token';
import {
  can, SESSION_COOKIE, verifySession,
  type REQUIRED_ROLE, type SessionPayload,
} from './session';

export type Action = keyof typeof REQUIRED_ROLE;

/**
 * Bearer được ưu tiên hơn cookie.
 *
 * Thứ tự này có chủ đích: khi gọi API bằng token service từ một máy đang đồng
 * thời có cookie đăng nhập (ví dụ script chạy trong bối cảnh trình duyệt), thứ
 * được nêu tường minh phải thắng thứ được mang theo ngầm. Ngược lại sẽ là nguồn
 * của những lỗi "sao nó lại ghi dưới tên người khác" rất khó lần.
 */
export async function getSession(): Promise<SessionPayload | null> {
  let session: SessionPayload | null = null;

  const header = (await headers()).get('authorization');
  if (header) {
    const [scheme, ...rest] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer') {
      const token = rest.join(' ').trim();
      if (token) session = await verifySession(token);
    }
  }
  if (!session) {
    const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
    if (cookie) session = await verifySession(cookie);
  }
  if (!session) return null;

  // Middleware chỉ xác minh được CHỮ KÝ — nó chạy trên Edge và không đọc được
  // database, nên một token đã thu hồi vẫn qua được cửa đó. Chỗ thu hồi thật sự
  // có hiệu lực là đây, và vì vậy mọi trang cần bảo vệ đều phải gọi getSession
  // chứ không được chỉ dựa vào middleware.
  const role = await liveSessionRole(session);
  if (!role) return null;

  // Role trong JWT là role lúc đăng nhập. Hạ quyền thì từ request này trở đi
  // phiên mang role mới — mọi `can()` phía sau đều đọc từ đây.
  return role === session.role ? session : { ...session, role };
}

/**
 * Trả về phiên, hoặc một Response lỗi để route trả thẳng ra.
 *
 * Dùng:
 *   const auth = await requireAuth('publish');
 *   if (auth instanceof NextResponse) return auth;
 */
export async function requireAuth(
  action: Action,
): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 });
  }
  // Lớp thứ hai sau allowlist ở middleware (`service-scope.ts`): kể cả khi ai đó
  // nới allowlist, máy vẫn không publish, rollback hay quản trị được — dù người cấp
  // token là admin. Đây là ranh giới "AI không publish" ở tầng HTTP.
  if (session.kind === 'service' && (action === 'publish' || action === 'admin')) {
    return NextResponse.json(
      { error: 'Token service không được publish, rollback hay làm việc quản trị' },
      { status: 403 },
    );
  }
  if (!can(session.role, action)) {
    // 403 chứ không phải 401: đã biết bạn là ai, chỉ là không đủ quyền. Trả 401
    // ở đây sẽ khiến client tưởng phiên hỏng và đá ra trang đăng nhập.
    return NextResponse.json(
      { error: `Quyền "${session.role}" không thực hiện được hành động này` },
      { status: 403 },
    );
  }
  return session;
}
