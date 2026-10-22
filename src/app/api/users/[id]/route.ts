import { NextResponse } from 'next/server';

/**
 * Đổi vai trò, đặt lại mật khẩu, khoá tài khoản. Chỉ admin.
 *
 * Ba rào chắn, tất cả đều là những cách tự khoá mình ra ngoài:
 *  - không tự khoá chính mình
 *  - không hạ vai trò của chính mình
 *  - không để hệ thống còn 0 admin
 *
 * Rào thứ ba quan trọng nhất: mất admin cuối cùng nghĩa là không ai tạo lại
 * được tài khoản, và đường duy nhất còn lại là chạy script trực tiếp trên server.
 *
 * KHÔNG còn `DELETE`. Xoá một tài khoản làm byline của bài họ viết mồ côi và thu
 * hồi mọi token MCP của họ không dấu vết — xem `User.lockedAt`. Đường thay thế là
 * `POST` với `{ locked: true }` ở cuối file.
 */

import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';
import { hashPassword } from '@/lib/auth/password';
import type { Role } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROLES: Role[] = ['viewer', 'editor', 'admin'];
const MIN_PASSWORD = 10;

async function adminCount(exceptId?: string): Promise<number> {
  return prisma.user.count({
    where: { role: 'admin', ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    role?: Role;
    password?: string;
    name?: string | null;
    avatarAssetId?: string | null;
  };

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true },
  });
  if (!target) return NextResponse.json({ error: 'Không tìm thấy tài khoản' }, { status: 404 });

  const data: {
    role?: string;
    passwordHash?: string;
    name?: string | null;
    avatarAssetId?: string | null;
  } = {};

  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) {
      return NextResponse.json({ error: `Vai trò không hợp lệ: ${body.role}` }, { status: 400 });
    }
    if (target.id === auth.sub && body.role !== 'admin') {
      return NextResponse.json(
        { error: 'Không tự hạ vai trò của chính mình' },
        { status: 400 },
      );
    }
    if (target.role === 'admin' && body.role !== 'admin' && (await adminCount(target.id)) === 0) {
      return NextResponse.json(
        { error: 'Đây là admin cuối cùng. Tạo admin khác trước khi hạ vai trò.' },
        { status: 400 },
      );
    }
    data.role = body.role;
  }

  if (body.password !== undefined) {
    if (body.password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `Mật khẩu phải từ ${MIN_PASSWORD} ký tự` },
        { status: 400 },
      );
    }
    data.passwordHash = await hashPassword(body.password);
  }

  if (body.name !== undefined) data.name = body.name?.trim() || null;

  /*
   * Ảnh đại diện — cùng đường với tên, vì cả hai là thứ hiện ra BYLINE trên site
   * thật, không phải thiết lập cá nhân.
   *
   * Không kiểm asset có tồn tại: `avatarAssetId` cố ý là chuỗi, không khoá ngoại
   * (xem `User.avatarAssetId`), nên kiểm ở đây là dựng một nửa ràng buộc — chặt ở
   * đường ghi, lỏng ở mọi chỗ khác. Asset biến mất thì byline không có ảnh.
   */
  if (body.avatarAssetId !== undefined) {
    data.avatarAssetId = body.avatarAssetId?.trim() || null;
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: 'Không có gì để đổi' }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, avatarAssetId: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: auth.sub, action: 'user.update', targetType: 'User', targetId: id,
      // KHÔNG ghi mật khẩu vào audit, kể cả dạng băm. Chỉ ghi rằng nó đã đổi.
      meta: { fields: Object.keys(data), role: data.role ?? undefined },
    },
  });

  return NextResponse.json({ ok: true, user });
}

/**
 * KHOÁ hoặc mở khoá một tài khoản. Thay cho `DELETE`, vốn xoá vật lý.
 *
 * ## Vì sao không còn đường xoá cứng
 *
 * Xem docblock của `User.lockedAt`: xoá làm byline mồ côi và làm mọi token MCP
 * của người đó biến mất im lặng qua `onDelete: Cascade`. Khoá ngoại `Restrict` từ
 * `Entry.createdBy` giờ cưỡng chế điều đó ở tầng DB — route này không còn là chỗ
 * duy nhất phải nhớ.
 *
 * ## Vì sao `POST /lock` chứ không một field trong `PATCH`
 *
 * `PATCH` đổi vai trò, mật khẩu, tên — ba thao tác sửa hồ sơ, gộp một dòng audit
 * `user.update` liệt kê các field. Khoá thì khác hạng: nó cắt quyền vào hệ thống
 * và thu hồi token, và nó phải để lại một dòng audit đọc được một mình —
 * `user.lock` chứ không phải `user.update { fields: ['locked'] }`.
 *
 * ## Thu hồi token TƯỜNG MINH, không để cascade
 *
 * Đặt `revokedAt` thay vì xoá hàng: `ServiceToken` giữ `lastUsedAt`, và xoá hàng
 * là mất luôn lịch sử dùng token của đúng tài khoản mà ta đang khoá vì nghi ngờ
 * điều gì đó. Mở khoá KHÔNG hoàn nguyên chúng — thu hồi là một chiều, và cấp
 * token mới là một thao tác có ý thức.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { locked?: unknown };
  if (typeof body.locked !== 'boolean') {
    return NextResponse.json({ error: 'Thiếu trường locked (boolean)' }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, lockedAt: true },
  });
  if (!target) return NextResponse.json({ error: 'Không tìm thấy tài khoản' }, { status: 404 });

  // Hai luật cũ giữ nguyên — chúng là hai cách tự khoá mình ra ngoài, và khoá
  // cũng khoá được ra ngoài y như xoá.
  if (body.locked) {
    if (id === auth.sub) {
      return NextResponse.json({ error: 'Không tự khoá tài khoản của mình' }, { status: 400 });
    }
    if (target.role === 'admin' && (await adminCount(target.id)) === 0) {
      return NextResponse.json(
        { error: 'Đây là admin cuối cùng. Tạo admin khác trước khi khoá.' },
        { status: 400 },
      );
    }
  }

  const already = target.lockedAt !== null;
  if (already === body.locked) {
    return NextResponse.json({ ok: true, lockedAt: target.lockedAt });
  }

  const lockedAt = body.locked ? new Date() : null;

  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { lockedAt, lockedBy: body.locked ? auth.email : null },
    });

    const n = body.locked
      ? (
          await tx.serviceToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: lockedAt },
          })
        ).count
      : 0;

    await tx.auditLog.create({
      data: {
        userId: auth.sub,
        action: body.locked ? 'user.lock' : 'user.unlock',
        targetType: 'User',
        targetId: id,
        // Số token thu hồi vào audit: nếu không, "vì sao con bot kia ngừng chạy"
        // là một câu hỏi không có chỗ nào trả lời được.
        meta: { email: target.email, role: target.role, revokedTokens: n },
      },
    });

    return n;
  });

  return NextResponse.json({ ok: true, lockedAt, revokedTokens: revoked });
}
