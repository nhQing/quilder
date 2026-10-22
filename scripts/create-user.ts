/**
 * Tạo hoặc đổi mật khẩu một tài khoản builder.
 *
 * Chạy:
 *   pnpm exec tsx scripts/create-user.ts <email> <mật-khẩu> [role]
 *
 * role: viewer | editor | admin (mặc định admin cho tài khoản đầu tiên)
 */

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

async function main() {
  const [email, password, role = 'admin'] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Dùng: pnpm exec tsx scripts/create-user.ts <email> <mật-khẩu> [role]');
    process.exit(1);
  }
  if (password.length < 10) {
    // Đây là tài khoản publish được lên site của một công ty tài chính.
    console.error('Mật khẩu phải từ 10 ký tự trở lên.');
    process.exit(1);
  }
  if (!['viewer', 'editor', 'admin'].includes(role)) {
    console.error(`role không hợp lệ: ${role}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), passwordHash, role },
    update: { passwordHash, role },
    select: { id: true, email: true, role: true },
  });

  console.log(`${user.email}  role=${user.role}  id=${user.id}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
