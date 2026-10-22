import { NextResponse } from 'next/server';

/**
 * Thu hồi một token service — của chính mình, hoặc của bất kỳ ai nếu là admin.
 *
 * Thu hồi là ĐÁNH DẤU chứ không xoá row. Xoá đi thì `checkServiceToken` trả
 * 'unknown' — vẫn chặn được, nhưng lịch sử mất: không còn biết token nào đã từng
 * tồn tại, cấp cho ai, dùng lần cuối lúc nào. Đúng lúc cần điều tra thì đó là
 * thứ duy nhất cần.
 *
 * Có hiệu lực NGAY: mỗi lời gọi API đều tra bảng này.
 */

import { requireAuth } from '@/lib/auth/guard';
import { isMachine, mayTouchToken } from '@/lib/auth/token-scope';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  if (isMachine(auth)) {
    return NextResponse.json(
      { error: 'Token service không quản lý được token — mở builder bằng trình duyệt.' },
      { status: 403 },
    );
  }

  const { id } = await params;

  const token = await prisma.serviceToken.findUnique({
    where: { id },
    select: {
      id: true, name: true, revokedAt: true, expiresAt: true, userId: true,
      user: { select: { email: true } },
    },
  });
  // Token của người khác trả 404 y như token không tồn tại: người không phải admin không
  // dò được id nào là token thật.
  if (!token || !mayTouchToken(auth, token.userId)) {
    return NextResponse.json({ error: 'Không tìm thấy token' }, { status: 404 });
  }

  /*
   * `?purge=1` — XOÁ HẲN hàng, không phải đánh dấu.
   *
   * Docblock trên đầu file nói vì sao thu hồi là đánh dấu chứ không xoá: lịch sử.
   * Nhưng lịch sử ấy có hạn dùng. Một bảng token của một hệ thống chạy hai năm là vài
   * chục dòng đã chết, và khi cần thu hồi gấp thì chúng làm dòng còn sống khó tìm —
   * tức chính lúc lịch sử được cho là hữu ích, nó lại cản.
   *
   * Nên: xoá được, nhưng CHỈ token đã vô hiệu (đã thu hồi hoặc đã hết hạn). Token còn
   * sống mà xoá thì `checkServiceToken` trả 'unknown' — vẫn chặn được, nhưng không ai
   * còn biết cái vừa biến mất là của máy nào. Thu hồi trước, xoá sau.
   *
   * Dòng `token.revoke` trong AuditLog KHÔNG đi theo, nên vẫn truy được rằng token
   * này từng tồn tại và đã bị thu hồi lúc nào.
   */
  if (new URL(request.url).searchParams.get('purge') === '1') {
    const dead = token.revokedAt !== null || token.expiresAt.getTime() <= Date.now();
    if (!dead) {
      return NextResponse.json(
        { error: `Token "${token.name}" còn hiệu lực. Thu hồi nó trước, rồi mới xoá được.` },
        { status: 409 },
      );
    }

    await prisma.$transaction([
      prisma.auditLog.create({
        data: {
          userId: auth.sub,
          action: 'token.delete',
          targetType: 'ServiceToken',
          targetId: id,
          meta: {
            name: token.name,
            forUser: token.user.email,
            revokedAt: token.revokedAt?.toISOString() ?? null,
            expiresAt: token.expiresAt.toISOString(),
          },
        },
      }),
      prisma.serviceToken.delete({ where: { id } }),
    ]);

    return NextResponse.json({ ok: true, purged: true, name: token.name });
  }

  if (token.revokedAt) {
    return NextResponse.json({ ok: true, alreadyRevoked: true, name: token.name });
  }

  await prisma.$transaction([
    prisma.serviceToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        userId: auth.sub,
        action: 'token.revoke',
        targetType: 'ServiceToken',
        targetId: id,
        meta: { name: token.name, forUser: token.user.email },
      },
    }),
  ]);

  return NextResponse.json({ ok: true, name: token.name });
}
