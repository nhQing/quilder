/**
 * Ai được đụng token service nào — luật dùng chung cho mọi route `/api/tokens`.
 *
 * Trước 16/10/2026 chỉ admin cấp được token, nên editor muốn dùng Claude Desktop phải nhờ
 * admin cấp hộ và gửi token qua chat. Giờ mỗi người tự cấp token cho CHÍNH MÌNH ở màn
 * "Kết nối Claude": token mang đúng role của người đứng tên (và bị hạ theo nếu role bị hạ,
 * xem `liveSessionRole`), nên tự cấp không nâng quyền của ai.
 *
 * Phạm vi:
 *  - Người không phải admin: chỉ thấy, cấp, thu hồi token đứng tên mình.
 *  - Admin: thấy và thu hồi được mọi token (màn Tài khoản › Kết nối Claude), và có thể
 *    thu hẹp về token của riêng mình (`mine`) ở màn cá nhân — để "Thu hồi tất cả" ở đó
 *    không cắt luôn máy của người khác.
 *  - Token service (chính Claude) KHÔNG quản lý token: một token tự cấp được token mới là
 *    một token không bao giờ hết hạn. Middleware đã chặn (`service-scope.ts`); các route
 *    kiểm lại bằng `isMachine`.
 *
 * File này không import gì để test được mà không cần database.
 */

interface Who {
  sub: string;
  role: string;
  kind?: 'user' | 'service';
}

export function isMachine(who: Who): boolean {
  return who.kind === 'service';
}

/** Điều kiện `where` cho danh sách / thu hồi cả loạt. `{}` = mọi token. */
export function tokenOwnerWhere(who: Who, mine: boolean): { userId?: string } {
  return who.role === 'admin' && !mine ? {} : { userId: who.sub };
}

/** Được thu hồi / xoá token đứng tên `ownerId` không. */
export function mayTouchToken(who: Who, ownerId: string): boolean {
  return who.role === 'admin' || ownerId === who.sub;
}

/** Được cấp token đứng tên `userId` (bỏ trống = chính mình) không. */
export function mayMintFor(who: Who, userId: string | undefined): boolean {
  return !userId || userId === who.sub || who.role === 'admin';
}
