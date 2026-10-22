import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Phiên hiện tại.
 *
 * Client cần biết mình là ai để ẩn/hiện đúng thứ (nút Tài khoản chỉ dành cho
 * admin, nút Publish chỉ dành cho editor trở lên). Không có endpoint này thì
 * thông tin đó phải nhét vào từng trang qua props, và mỗi component client lại
 * phải chờ nó đi xuống qua nhiều tầng.
 *
 * KHÔNG trả bất cứ thứ gì ngoài những gì đã nằm trong JWT — không tra database.
 * Endpoint này được gọi thường xuyên và nó không phải chỗ để lộ thêm dữ liệu.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 });

  return NextResponse.json({
    id: session.sub,
    email: session.email,
    name: session.name ?? null,
    role: session.role,
  });
}
