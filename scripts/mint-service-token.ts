/**
 * Cấp một token dài hạn cho MCP server.
 *
 * Chạy:
 *   pnpm mcp:token [email]
 *
 * Token là CÙNG loại JWT với phiên đăng nhập trình duyệt, chỉ khác `kind:
 * 'service'` và hạn 30 ngày. Nhờ vậy nó đi qua đúng middleware, đúng requireAuth,
 * đúng bảng phân quyền — không có đường tắt nào được mở thêm cho máy.
 *
 * Token buộc phải gắn với một User có thật. Không dùng một danh tính tổng hợp
 * kiểu "mcp@system" vì mọi thay đổi đều ghi vào AuditLog theo userId: nếu id đó
 * không trỏ tới ai thì lịch sử sửa đổi mất luôn chủ thể, đúng lúc cần truy vết.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { signSession, type Role } from '../src/lib/auth/session';

const prisma = new PrismaClient();

/**
 * Ghi row rồi mới ký — cùng thứ tự với `mintServiceToken` trong app.
 *
 * Script này KHÔNG import `src/lib/auth/service-token.ts` được vì file đó có
 * `server-only`. Nên nó lặp lại logic, và cái lặp lại đó có thể trôi. Test
 * `service-token.test.ts` canh cho hai bên cùng sinh ra token có `jti` tra được.
 */
async function main() {
  const email = (process.argv[2] ?? process.env.BUILDER_EMAIL ?? '').toLowerCase();
  const days = Number(process.argv[3] ?? 30);
  if (!email) {
    console.error('Dùng: pnpm mcp:token <email>   (hoặc đặt BUILDER_EMAIL trong .env)');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) {
    console.error(`Không có tài khoản ${email}. Tạo bằng: pnpm user:create ${email} <mật-khẩu>`);
    process.exit(1);
  }
  if (user.role === 'viewer') {
    // Token viewer sẽ đọc được nhưng apply_ops trả 403 — hỏng một cách khó hiểu
    // ở tận trong Claude Desktop. Chặn sớm ở đây và nói rõ lý do.
    console.error(`Tài khoản ${email} có vai trò "viewer" nên không sửa được nội dung.`);
    process.exit(1);
  }

  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await prisma.serviceToken.create({
    data: {
      jti,
      name: `CLI · ${new Date().toISOString().slice(0, 10)}`,
      userId: user.id,
      expiresAt,
      createdBy: `cli:${user.email}`,
    },
  });

  const token = await signSession(
    {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      name: user.name ?? undefined,
      kind: 'service',
      jti,
    },
    days * 24 * 60 * 60,
  );

  console.log(token);
  console.error(''); // stderr để `pnpm mcp:token > file` chỉ lấy đúng token
  console.error(`tài khoản : ${user.email} (${user.role})`);
  console.error(`hết hạn   : ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')}`);
  console.error('');
  console.error('Thu hồi được ở /builder/admin/tokens.');
  console.error('Hướng dẫn cắm vào Claude Desktop: mcp/README.md');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
