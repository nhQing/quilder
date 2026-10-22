import { NextResponse } from 'next/server';

/**
 * Bộ đồ nghề clone cho `mcp/server.mjs`: token, khổ đo, mã extractor, mã so sánh.
 *
 * Xem `src/lib/clone/kit.ts` cho lý do nó đi qua API chứ không nằm sẵn trong server.mjs.
 *
 * Quyền `read`: kit chỉ là CÁCH ĐO cộng tên/giá trị token (thứ mà `get_design_system` và trang
 * công khai vốn đã lộ). Việc GHI trang clone đi qua tool `create_clone_draft` với quyền `write`.
 */

import { requireAuth } from '@/lib/auth/guard';
import { buildCloneKit } from '@/lib/clone/kit';
import { CLONE_KIT_VERSION, CLONE_MIN_CLIENT } from '@/lib/clone/types';
import { MAX_ASSET_BYTES } from '@/lib/builder/upload-asset';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;

  /*
   * Bản `server.mjs` trước khi có clone không biết kit là gì và không có khả năng chạy nó — trả
   * 426 với câu bảo tải lại, như route `/api/ai/tool`, thay vì để nó nhận một JSON không hiểu nổi.
   */
  const client = Number(request.headers.get('x-mm-client') ?? '1');
  if (!Number.isFinite(client) || client < CLONE_MIN_CLIENT) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Bản mcp/server.mjs trên máy này chưa hỗ trợ clone. Tải bản mới ở /builder/claude ' +
          'rồi khởi động lại Claude.',
        kitVersion: CLONE_KIT_VERSION,
      },
      { status: 426 },
    );
  }

  const tokens = await prisma.token.findMany({
    where: { deprecated: false },
    select: { name: true, value: true, category: true },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json(buildCloneKit(tokens, MAX_ASSET_BYTES), {
    headers: { 'cache-control': 'no-store' },
  });
}
