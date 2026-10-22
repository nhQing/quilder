import { NextResponse } from 'next/server';

/**
 * "Đây có phải server của stack e2e không?"
 *
 * `e2e/auth.setup.ts` gọi route này TRƯỚC mọi thao tác. Ngoài stack e2e (biến
 * `MM_E2E=1`, do `scripts/e2e-stack.mjs` đặt) nó trả 404, và setup dừng cả suite với
 * một câu nói rõ lý do. Đó là thứ biến "đừng chạy e2e vào DB dev" từ một dòng cảnh
 * báo trong HANDOFF thành một phép kiểm không lách nhầm được.
 *
 * Công khai (middleware `PUBLIC_API`) vì phải trả lời được trước khi đăng nhập —
 * đăng nhập đã là một lần ghi (AuditLog). Không lộ gì: ở production nó chỉ là 404.
 */

export const dynamic = 'force-dynamic';

export function GET() {
  if (process.env.MM_E2E !== '1') {
    return NextResponse.json({ error: 'Không có' }, { status: 404 });
  }
  return NextResponse.json({ e2e: true });
}
