/**
 * Phiên đăng nhập: JWT ký, đặt trong cookie httpOnly.
 *
 * ## Vì sao KHÔNG tái dùng được pattern của app quản trị cũ
 *
 * Repo đó giữ token trong Zustand + localStorage và chặn bằng `AuthGuard` trong
 * `useEffect`. Middleware chạy TRƯỚC React và không đọc được localStorage, nên
 * cổng chặn sẽ chỉ là client-side — tắt JavaScript là đi thẳng vào. Với một công
 * cụ publish được lên site của công ty tài chính thì đó không phải là cổng.
 *
 * Cookie httpOnly thì middleware đọc được, và JavaScript trong trang thì không —
 * XSS không lấy được token.
 *
 * File này dùng `jose` nên chạy được trên CẢ Edge (middleware) lẫn Node (route
 * handler). Kiểm mật khẩu nằm ở `password.ts` và chỉ chạy trên Node.
 */

import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = 'mm_session';

/**
 * Cookie phiên có cờ `Secure` hay không.
 *
 * Mặc định: có trên production, không trên dev (localhost không có HTTPS). Trình duyệt
 * VỨT cookie `Secure` nhận qua http thường — trừ localhost — nên một builder production
 * mở bằng `http://<ip-nội-bộ>:3002` đăng nhập "thành công" rồi bị đẩy về form trống,
 * không một dòng lỗi (đo 15/10/2026 trên 192.168.1.10).
 *
 * `COOKIE_SECURE=false` là lối ra cho đúng trường hợp đó: môi trường nội bộ chạy http
 * có chủ ý. Đừng đặt nó ở môi trường có tên miền — ở đó HTTPS mới là cách sửa, và
 * cookie phiên đi qua http thì ai trên cùng mạng cũng đọc được.
 */
export function sessionCookieSecure(): boolean {
  const flag = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  return process.env.NODE_ENV === 'production';
}
/** 8 giờ: đủ một ngày làm việc, đủ ngắn để máy bỏ quên không mở mãi. */
export const SESSION_MAX_AGE = 8 * 60 * 60;

/**
 * 30 ngày, và CHỈ khi người dùng tự tick "Ghi nhớ đăng nhập" (23/09/2026).
 *
 * Nó đi ngược chủ ý của `SESSION_MAX_AGE` ngay trên, nên phải nói rõ vì sao được
 * phép: 8 giờ là mặc định đúng cho một máy dùng chung, nhưng builder này chạy trên
 * máy cá nhân của vài người trong công ty, và bắt họ gõ lại mật khẩu mỗi buổi sáng
 * đẩy người ta sang thói quen tệ hơn nhiều — dán mật khẩu ở chỗ tiện tay.
 *
 * Vì sao 30 chứ không phải 90: tài khoản ở đây publish được ra site công khai. Một
 * máy mất cắp mở được builder trong ba tháng là cái giá không tương xứng với việc
 * đỡ phải đăng nhập lại vài lần.
 *
 * Mặc định là TẮT. Người dùng phải chủ động chọn, và lựa chọn đó được ghi vào
 * `AuditLog` để admin thấy phiên dài nào đang tồn tại.
 */
export const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60;

// Hạn của token service KHÔNG cố định ở đây — người cấp chọn 7/30/90 ngày trong
// /builder/claude, và `ServiceToken.expiresAt` là nguồn sự thật. Xem
// service-token.ts.

export type Role = 'viewer' | 'editor' | 'admin';

export interface SessionPayload {
  sub: string;
  email: string;
  role: Role;
  name?: string;
  /**
   * 'service' = token dài hạn cấp cho một máy (hiện tại: MCP server), không phải
   * người đăng nhập qua trình duyệt.
   *
   * Phân biệt hai loại là cần thiết chứ không phải trang trí: token service sống
   * hàng tháng thay vì 8 giờ, nên khi một thay đổi đáng ngờ xuất hiện trong
   * AuditLog thì "ai làm" và "làm từ đâu" là hai câu hỏi khác nhau. Nó cũng là
   * chỗ để sau này chặn riêng service khỏi một số hành động mà không đụng người.
   */
  kind?: 'user' | 'service';
  /**
   * Chỉ có ở token service. Khoá tra bảng `ServiceToken` để biết token đã bị thu
   * hồi chưa — JWT tự nó không mang được thông tin đó, vì nó được ký một lần rồi
   * không ai chạm vào nữa.
   */
  jti?: string;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    // Fail to chứ không tự sinh khoá: khoá tự sinh nghĩa là mỗi lần khởi động
    // lại sẽ vô hiệu mọi phiên, và tệ hơn, mỗi replica ký bằng một khoá khác.
    throw new Error(
      'AUTH_SECRET thiếu hoặc ngắn hơn 32 ký tự. Sinh bằng: openssl rand -base64 48',
    );
  }
  return new TextEncoder().encode(value);
}

export async function signSession(
  payload: SessionPayload,
  maxAgeSeconds: number = SESSION_MAX_AGE,
): Promise<string> {
  const jwt = new SignJWT({
    email: payload.email,
    role: payload.role,
    name: payload.name,
    kind: payload.kind ?? 'user',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`);

  if (payload.jti) jwt.setJti(payload.jti);

  return jwt.sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || typeof payload.email !== 'string') return null;
    return {
      sub: payload.sub,
      email: payload.email,
      role: (payload.role as Role) ?? 'viewer',
      name: typeof payload.name === 'string' ? payload.name : undefined,
      kind: payload.kind === 'service' ? 'service' : 'user',
      jti: typeof payload.jti === 'string' ? payload.jti : undefined,
    };
  } catch {
    // Hết hạn, sai chữ ký, hỏng định dạng — tất cả đều là "không có phiên".
    return null;
  }
}

/** Quyền tối thiểu cho từng hành động. */
export const REQUIRED_ROLE = {
  read: ['viewer', 'editor', 'admin'],
  write: ['editor', 'admin'],
  publish: ['editor', 'admin'],
  admin: ['admin'],
} as const;

export function can(role: Role, action: keyof typeof REQUIRED_ROLE): boolean {
  return (REQUIRED_ROLE[action] as readonly string[]).includes(role);
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/**
 * Role thấp hơn trong hai role.
 *
 * Dùng để role trong JWT không bao giờ vượt role hiện tại trong DB: hạ một admin
 * xuống editor phải có hiệu lực ở request kế tiếp, không phải khi token hết hạn
 * (tới 30 ngày với "Ghi nhớ đăng nhập", 90 ngày với token service).
 *
 * Giá trị lạ (cột `User.role` là String) tính là `viewer`: hỏng thì hỏng về phía
 * ít quyền.
 */
export function lowerRole(a: Role, b: string): Role {
  const other: Role = b in ROLE_RANK ? (b as Role) : 'viewer';
  return ROLE_RANK[other] < ROLE_RANK[a] ? other : a;
}
