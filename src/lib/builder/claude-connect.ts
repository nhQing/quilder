import 'server-only';

import { headers } from 'next/headers';

import { prisma } from '@/lib/db';
import type { Platform, TokenRow } from '@/components/builder/TokenAdmin';

/*
 * Dùng chung cho màn cá nhân (`/builder/claude`) và màn quản trị (`/builder/admin/tokens`).
 */

/** Danh sách token cho `TokenAdmin`. `userId` = chỉ token đứng tên người đó. */
export async function tokenRows(userId?: string): Promise<TokenRow[]> {
  const rows = await prisma.serviceToken.findMany({
    where: userId ? { userId } : {},
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, name: true, expiresAt: true, lastUsedAt: true,
      revokedAt: true, createdAt: true, createdBy: true, canPublishLocale: true,
      user: { select: { email: true, role: true } },
    },
  });

  const now = Date.now();
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    email: t.user.email,
    role: t.user.role,
    createdBy: t.createdBy,
    canPublishLocale: t.canPublishLocale,
    createdAt: t.createdAt.toISOString(),
    expiresAt: t.expiresAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    status: t.revokedAt ? 'revoked' : t.expiresAt.getTime() <= now ? 'expired' : 'active',
  }));
}

/** Gốc URL và hệ điều hành đoán được — cho khối hướng dẫn sau khi cấp token. */
export async function connectContext(): Promise<{ origin: string; platform: Platform }> {
  // Gốc URL thật mà người dùng đang truy cập — cấu hình sinh ra phải trỏ về
  // abc.com khi họ mở từ abc.com, không phải localhost đã hardcode.
  const head = await headers();
  const configured = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  const host = head.get('x-forwarded-host') ?? head.get('host') ?? 'localhost:3001';
  const proto = head.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = configured ?? `${proto}://${host}`;

  /*
   * Đoán hệ điều hành, chỉ để chọn TAB MẶC ĐỊNH của hướng dẫn.
   *
   * Đoán từ user-agent của TRÌNH DUYỆT, mà máy chạy Claude Desktop có thể là máy khác —
   * builder này thường được deploy, nên người mở trang cấp token và người dán cấu hình
   * không bắt buộc cùng một máy. Vì vậy hướng dẫn cho đổi tab bằng tay; đoán chỉ tiết
   * kiệm một cú bấm cho trường hợp phổ biến, không quyết định thay người dùng.
   */
  const ua = head.get('user-agent') ?? '';
  const platform: Platform = /mac os|macintosh/i.test(ua) ? 'mac' : 'windows';

  return { origin, platform };
}
