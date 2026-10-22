import { NextResponse } from 'next/server';

/**
 * Tạo tài khoản. Chỉ admin.
 *
 * Không có đăng ký tự do và không có mời qua email: đây là công cụ nội bộ với
 * vài người dùng, và mỗi tài khoản đều publish được lên site của một công ty tài
 * chính. Admin tạo tài khoản, đưa mật khẩu tận tay.
 */

import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';
import { hashPassword } from '@/lib/auth/password';
import type { Role } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROLES: Role[] = ['viewer', 'editor', 'admin'];
export const MIN_PASSWORD = 10;

interface Body {
  email?: string;
  name?: string;
  password?: string;
  role?: Role;
}

export async function POST(request: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const role = body.role ?? 'editor';

  if (!email.includes('@')) {
    return NextResponse.json({ error: 'Email không hợp lệ' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Mật khẩu phải từ ${MIN_PASSWORD} ký tự` },
      { status: 400 },
    );
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: `Vai trò không hợp lệ: ${role}` }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: 'Email này đã có tài khoản' }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: body.name?.trim() || null,
      role,
      passwordHash: await hashPassword(password),
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: auth.sub, action: 'user.create', targetType: 'User',
      targetId: user.id, meta: { email: user.email, role: user.role },
    },
  });

  return NextResponse.json({ ok: true, user });
}
