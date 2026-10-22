import { NextResponse } from 'next/server';

/**
 * Cấp và liệt kê token service (MCP).
 *
 * Ai cũng quản lý được token của CHÍNH MÌNH; admin quản lý được mọi token. Luật nằm ở
 * `lib/auth/token-scope.ts`.
 *
 * Token hiện ra ĐÚNG MỘT LẦN, lúc tạo. Bảng chỉ lưu `jti`, không lưu token —
 * nên hệ thống cũng không đọc lại được. Đây là chủ đích: rò rỉ database không
 * đồng nghĩa rò rỉ quyền ghi vào site.
 */

import { requireAuth } from '@/lib/auth/guard';
import {
  MAX_TOKEN_DAYS,
  mintServiceToken,
} from '@/lib/auth/service-token';
import { isMachine, mayMintFor, tokenOwnerWhere } from '@/lib/auth/token-scope';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const machine = () =>
  NextResponse.json(
    { error: 'Token service không quản lý được token — mở builder bằng trình duyệt.' },
    { status: 403 },
  );

/** `?scope=mine` — chỉ token đứng tên mình, kể cả khi là admin. */
const wantsMine = (request: Request) => new URL(request.url).searchParams.get('scope') === 'mine';

export async function GET(request: Request) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  if (isMachine(auth)) return machine();

  const tokens = await prisma.serviceToken.findMany({
    where: tokenOwnerWhere(auth, wantsMine(request)),
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, name: true, expiresAt: true, lastUsedAt: true,
      revokedAt: true, createdAt: true, createdBy: true, canPublishLocale: true,
      user: { select: { email: true, role: true } },
    },
  });

  const now = Date.now();
  return NextResponse.json({
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.user.email,
      role: t.user.role,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      status: t.revokedAt
        ? 'revoked'
        : t.expiresAt.getTime() <= now
          ? 'expired'
          : 'active',
    })),
  });
}

interface Body {
  name?: string;
  days?: number;
  /** Tài khoản mà token đứng tên. Mặc định là chính người đang tạo. */
  userId?: string;
  /** Cho token quyền ĐĂNG bản dịch. Xem `ServiceToken.canPublishLocale`. */
  canPublishLocale?: boolean;
}

export async function POST(request: Request) {
  // `read` chứ không `write`: viewer phải nhận câu giải thích ở dưới ("vai trò viewer
  // không sửa được nội dung"), không phải một 403 chung chung.
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  if (isMachine(auth)) return machine();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) {
    // Tên là bắt buộc, không phải trang trí: một danh sách token không tên thì
    // lúc cần thu hồi sẽ không biết cái nào là của máy nào — và người ta sẽ thu
    // hồi hết, hoặc tệ hơn, không thu hồi gì.
    return NextResponse.json(
      { error: 'Đặt tên cho token, ví dụ "Máy ở nhà" — để sau này biết cái nào mà thu hồi.' },
      { status: 400 },
    );
  }
  if (name.length > 60) {
    return NextResponse.json({ error: 'Tên tối đa 60 ký tự' }, { status: 400 });
  }

  const days = Number(body.days ?? 30);
  if (!Number.isFinite(days) || days < 1 || days > MAX_TOKEN_DAYS) {
    return NextResponse.json(
      { error: `Hạn phải từ 1 tới ${MAX_TOKEN_DAYS} ngày` },
      { status: 400 },
    );
  }

  if (!mayMintFor(auth, body.userId)) {
    return NextResponse.json({ error: 'Chỉ admin mới cấp được token đứng tên người khác.' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: body.userId ?? auth.sub },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) return NextResponse.json({ error: 'Không tìm thấy tài khoản' }, { status: 404 });

  if (user.role === 'viewer') {
    // Token viewer đọc được nhưng apply_ops trả 403 — hỏng một cách khó hiểu ở
    // tận trong Claude Desktop. Chặn ngay đây và nói rõ lý do.
    return NextResponse.json(
      { error: `${user.email} có vai trò "viewer" nên không sửa được nội dung. Nhờ admin nâng lên "editor" trước.` },
      { status: 400 },
    );
  }

  /*
   * Cờ đăng bản dịch: mặc định KHÔNG, và chỉ bật khi thân request nói rõ `true`.
   *
   * `=== true` chứ không `Boolean(...)`: thân request là JSON do client gửi, và
   * chuỗi "false" là truthy. Đây là cửa quyền, nên nó phải đóng với mọi thứ không
   * phải đúng boolean `true`.
   */
  const canPublishLocale = body.canPublishLocale === true;

  const minted = await mintServiceToken({
    user,
    name,
    days,
    createdBy: auth.email,
    canPublishLocale,
  });

  await prisma.auditLog.create({
    data: {
      userId: auth.sub,
      action: 'token.create',
      targetType: 'ServiceToken',
      targetId: minted.id,
      // Cờ vào audit: "vì sao con bot kia đăng được bài" phải có chỗ trả lời.
      meta: { name, days, forUser: user.email, canPublishLocale },
    },
  });

  return NextResponse.json({
    ok: true,
    // Lần duy nhất token đi ra khỏi server.
    token: minted.token,
    id: minted.id,
    name: minted.name,
    email: user.email,
    expiresAt: minted.expiresAt.toISOString(),
  });
}

/**
 * Thu hồi TẤT CẢ token còn hiệu lực — của mọi người (admin), hoặc của chính mình
 * (người không phải admin, hay admin gửi `?scope=mine`).
 *
 * ## Vì sao là một endpoint, không phải N lần gọi `DELETE /api/tokens/:id`
 *
 * Ba lý do, và cả ba đều là hệ quả thật:
 *
 *  1. **Một ý định thì phải là một dòng audit.** "Thu hồi tất cả" là một quyết định,
 *     thường là quyết định lúc đang xử lý sự cố. N dòng `token.revoke` rời rạc bắt
 *     người đọc log sau này tự suy ra rằng chúng thuộc cùng một hành động — và nếu
 *     có một token được cấp xen vào giữa thì suy ra sai.
 *  2. **Thất bại một phần là trạng thái tệ nhất có thể.** Vòng lặp ở client mà đứt
 *     giữa đường để lại một nửa còn sống, và giao diện đã báo "đang thu hồi". Ở đây
 *     một transaction làm tất cả hoặc không làm gì.
 *  3. **Không có cuộc đua với chính nó.** Vòng lặp client đọc danh sách rồi gọi lần
 *     lượt; token cấp trong lúc đó không nằm trong danh sách và sống sót im lặng.
 *
 * KHÔNG chạm token đã thu hồi hoặc đã hết hạn: `revokedAt` là dấu thời gian của
 * hành động, ghi lại nó lần hai sẽ xoá mất thời điểm thật.
 */
export async function DELETE(request: Request) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  if (isMachine(auth)) return machine();

  const now = new Date();
  const owner = tokenOwnerWhere(auth, wantsMine(request));

  // Chỉ token CÒN HIỆU LỰC. Token hết hạn đã vô hiệu; "thu hồi" nó không thêm an
  // toàn nào mà lại làm lịch sử nói sai về việc gì đã xảy ra.
  const live = await prisma.serviceToken.findMany({
    where: { ...owner, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, name: true, user: { select: { email: true } } },
  });

  if (!live.length) return NextResponse.json({ ok: true, revoked: 0 });

  await prisma.$transaction([
    prisma.serviceToken.updateMany({
      where: { id: { in: live.map((t) => t.id) } },
      data: { revokedAt: now },
    }),
    prisma.auditLog.create({
      data: {
        userId: auth.sub,
        action: 'token.revokeAll',
        targetType: 'ServiceToken',
        // Không có một target duy nhất, nên `targetId` mang số lượng — còn danh sách
        // đầy đủ nằm trong `meta` để sau này truy được từng cái.
        targetId: `${live.length} token`,
        meta: {
          scope: owner.userId ? 'mine' : 'all',
          count: live.length,
          tokens: live.map((t) => ({ id: t.id, name: t.name, forUser: t.user.email })),
        },
      },
    }),
  ]);

  return NextResponse.json({ ok: true, revoked: live.length });
}
