import 'server-only';

/**
 * Token dài hạn cho máy (MCP server).
 *
 * ## Vì sao phải tra database mỗi lần dùng
 *
 * JWT không thu hồi được. Đã ký thì hợp lệ tới lúc hết hạn, và cách duy nhất để
 * vô hiệu sớm là đổi `AUTH_SECRET` — thao tác đó đăng xuất mọi người. Với token
 * sống 30 ngày, đứng tên tài khoản publish được lên site công ty tài chính, và
 * nằm plaintext trong file cấu hình Claude Desktop, đó không phải đánh đổi chấp
 * nhận được.
 *
 * Nên mỗi token mang `jti` và mỗi lần dùng đều tra bảng `ServiceToken`. Giá phải
 * trả là một truy vấn cho mỗi request; đổi lại là nút Thu hồi thật sự có tác dụng.
 *
 * Phiên trình duyệt KHÔNG chịu chi phí này: chúng sống 8 giờ và không có `jti`,
 * nên `assertNotRevoked` bỏ qua chúng ngay.
 *
 * ## Bản thân token không được lưu
 *
 * Bảng chỉ giữ `jti`. Lộ database không đồng nghĩa lộ token, và trang quản lý
 * hiện token đúng một lần lúc tạo vì sau đó chính hệ thống cũng không đọc lại được.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { lowerRole, signSession, type Role, type SessionPayload } from './session';

/** Hạn cho phép chọn trong trang quản lý. */
export const TOKEN_LIFETIMES = [
  { days: 7, label: '7 ngày' },
  { days: 30, label: '30 ngày' },
  { days: 90, label: '90 ngày' },
] as const;

export const MAX_TOKEN_DAYS = 90;

export interface MintedToken {
  token: string;
  id: string;
  name: string;
  expiresAt: Date;
  canPublishLocale: boolean;
}

export async function mintServiceToken(args: {
  user: { id: string; email: string; name?: string | null; role: string };
  name: string;
  days: number;
  createdBy: string;
  /**
   * Cho token này quyền ĐĂNG bản dịch. Mặc định KHÔNG.
   *
   * Mặc định phải là không: một cờ mặc định bật thì mọi token cấp trước khi có
   * màn chọn đều mang nó, và không ai biết. Xem `ServiceToken.canPublishLocale`.
   *
   * KHÔNG đi vào JWT. Nếu nó nằm trong token đã ký thì tắt cờ sẽ không có hiệu
   * lực cho tới khi token hết hạn — tức là cờ không thu hồi được, đúng thứ cả
   * bảng `ServiceToken` tồn tại để tránh.
   */
  canPublishLocale?: boolean;
}): Promise<MintedToken> {
  const days = Math.min(Math.max(Math.round(args.days), 1), MAX_TOKEN_DAYS);
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // Ghi row TRƯỚC khi ký. Ngược lại sẽ có một khoảng — dù ngắn — mà token đã tồn
  // tại nhưng chưa thu hồi được, và nếu bước ghi hỏng thì token đó vĩnh viễn
  // không nằm trong danh sách nào cả.
  const row = await prisma.serviceToken.create({
    data: {
      jti,
      name: args.name,
      userId: args.user.id,
      expiresAt,
      createdBy: args.createdBy,
      canPublishLocale: args.canPublishLocale ?? false,
    },
    select: { id: true, name: true, expiresAt: true, canPublishLocale: true },
  });

  const token = await signSession(
    {
      sub: args.user.id,
      email: args.user.email,
      role: args.user.role as Role,
      name: args.user.name ?? undefined,
      kind: 'service',
      jti,
    },
    days * 24 * 60 * 60,
  );

  return {
    token,
    id: row.id,
    name: row.name,
    expiresAt: row.expiresAt,
    canPublishLocale: row.canPublishLocale,
  };
}

/**
 * Lần dùng cuối, ghi có tiết chế.
 *
 * Cập nhật mỗi request là một lượt ghi DB cho mỗi lời gọi tool — và giá trị của
 * field này chỉ là "token còn được dùng không", nên độ chính xác 5 phút là thừa đủ.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type RevocationCheck =
  | { ok: true }
  | { ok: false; reason: 'revoked' | 'unknown' | 'expired' };

/**
 * Token service còn dùng được không.
 *
 * Trả `unknown` khi `jti` không có trong bảng: đó là token ký bằng đúng khoá
 * nhưng row đã bị xoá (ví dụ chủ tài khoản bị xoá, kéo theo cascade). Chữ ký hợp
 * lệ không đủ để kết luận là hợp lệ.
 */
export async function checkServiceToken(jti: string): Promise<RevocationCheck> {
  const row = await prisma.serviceToken.findUnique({
    where: { jti },
    select: { id: true, revokedAt: true, expiresAt: true, lastUsedAt: true },
  });

  if (!row) return { ok: false, reason: 'unknown' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  // Hạn đã nằm trong JWT, nhưng kiểm lại ở đây để hạn trong DB là nguồn sự thật —
  // nhờ vậy rút ngắn hạn của một token đã cấp là việc làm được.
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  const stale =
    !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS;
  if (stale) {
    // Không await: đây là số liệu quan sát, không phải điều kiện xác thực. Chặn
    // request để chờ nó ghi xong là trả giá độ trễ cho một thứ không ai đọc ngay.
    void prisma.serviceToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  return { ok: true };
}

/**
 * Phiên này có được ĐĂNG bản dịch không.
 *
 * ## Vì sao ở đây, cạnh `checkServiceToken`
 *
 * Nó đọc đúng bảng ấy, ở đúng nhịp ấy: mỗi lời gọi, không phải đọc từ JWT. Đó là
 * cả điểm của cờ — thu hồi có hiệu lực NGAY. Đặt phép kiểm ở tầng tool thì nó
 * cách nguồn sự thật một tầng, và tầng đó sẽ là chỗ ai đó cache lại.
 *
 * ## Phiên trình duyệt luôn là KHÔNG
 *
 * Không có `jti` thì không có hàng token, nên không có cờ. Nghĩa là AI trong
 * builder không đăng được bản dịch, kể cả khi người đang ngồi đó là admin. Chủ ý:
 * cờ gắn với một MÁY được cấp quyền, không với việc ai đang ngồi trước màn hình.
 * Người muốn đăng thì bấm nút Đăng — đó là một thao tác có người chịu trách nhiệm,
 * và nó đã có sẵn.
 */
export async function canPublishLocale(session: SessionPayload): Promise<boolean> {
  if (session.kind !== 'service' || !session.jti) return false;
  const row = await prisma.serviceToken.findUnique({
    where: { jti: session.jti },
    select: { canPublishLocale: true, revokedAt: true },
  });
  // `revokedAt` kiểm lại ở đây dù `isSessionLive` đã kiểm: hai lượt đọc ở hai thời
  // điểm, và giữa chúng một admin có thể vừa bấm Thu hồi. Với một thao tác GHI lên
  // site thật thì lượt đọc sát nhất là lượt đáng tin.
  return Boolean(row && !row.revokedAt && row.canPublishLocale);
}

/**
 * Tài khoản đã bị khoá chưa.
 *
 * ## Vì sao phải tra DB cho CẢ phiên trình duyệt
 *
 * Trước đây hàm dưới cho phiên trình duyệt đi thẳng qua: không có `jti` thì
 * không có gì để thu hồi. Từ khi có `User.lockedAt` thì có — và nếu không tra,
 * một tài khoản vừa bị khoá vẫn dùng được cho tới khi JWT của họ hết hạn. Với
 * một phiên sống nhiều ngày, "đã khoá" trở thành "sẽ khoá, vào một hôm nào đó".
 *
 * Đó chính xác là lập luận mà docblock của `ServiceToken` đã dùng để chấp nhận
 * một truy vấn cho mỗi request: một thao tác thu hồi không có hiệu lực ngay thì
 * không phải một thao tác thu hồi.
 *
 * Giá: một lượt đọc theo khoá chính cho mỗi request đã xác thực. Cùng hạng với
 * lượt tra `ServiceToken` ngay trên, và hai lượt ấy KHÔNG cộng dồn cho phiên
 * trình duyệt — nó chỉ chạy lượt này.
 *
 * Cùng lượt đọc đó lấy luôn `role` (08/10/2026): đổi role cũng là một thao tác
 * thu hồi, và nó cũng phải có hiệu lực ngay. Không tốn thêm truy vấn nào.
 */
async function loadUserState(
  userId: string,
): Promise<{ locked: boolean; role: string | null }> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { lockedAt: true, role: true },
  });
  // Không có hàng = tài khoản không còn tồn tại. Chặn: chữ ký hợp lệ không đủ để
  // kết luận là hợp lệ — cùng lý lẽ với `reason: 'unknown'` ở `checkServiceToken`.
  if (!row) return { locked: true, role: null };
  return { locked: row.lockedAt !== null, role: row.role };
}

/**
 * Role mà phiên này thật sự được dùng, hoặc `null` nếu phiên không còn hiệu lực.
 * Dùng chung cho mọi đường vào.
 *
 * Hai câu hỏi, và phải hỏi CẢ HAI cho token service: token này còn sống không,
 * và chủ của nó còn dùng được không. Một token chưa thu hồi của một tài khoản đã
 * khoá vẫn là một đường vào.
 *
 * Role trả về là role THẤP HƠN giữa JWT và DB. Không lấy thẳng role trong DB: token
 * service được cấp với role của người cấp lúc đó, và nâng quyền người đó về sau
 * không được âm thầm nâng quyền mọi token họ từng cấp.
 */
export async function liveSessionRole(session: SessionPayload): Promise<Role | null> {
  const user = await loadUserState(session.sub);
  if (user.locked || user.role === null) return null;
  if (session.kind === 'service' && session.jti) {
    if (!(await checkServiceToken(session.jti)).ok) return null;
  }
  return lowerRole(session.role, user.role);
}
