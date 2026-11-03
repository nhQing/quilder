import { NextResponse } from 'next/server';

/**
 * Form trong component: trang nào giữ chữ theo chỉ số ô của nó (bản dịch, ghi đè)?
 *
 * Khối Form của sidebar hỏi trước khi cho kéo/bỏ ô — xem `formFieldLocks`. Chỉ đọc.
 * `?node=<id local của form>`.
 */

import { requireAuth } from '@/lib/auth/guard';
import { formFieldLocks } from '@/lib/builder/form-locks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const node = new URL(request.url).searchParams.get('node');
  if (!node || !/^[\w-]{1,64}$/.test(node)) {
    return NextResponse.json({ error: 'Cần ?node=<id node form>' }, { status: 400 });
  }
  return NextResponse.json(await formFieldLocks(id, node));
}
