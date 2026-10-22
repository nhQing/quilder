import { NextResponse } from 'next/server';

/**
 * Bản dịch — ghi vào BẢN NHÁP.
 *
 * ## Vì sao không đi qua /api/ops
 *
 * Op tác động lên `doc`, và bản dịch cố ý KHÔNG nằm trong doc — xem ghi chú model
 * `Translation`. Nhồi chúng vào doc là quay về phương án fork mà lớp phủ được
 * tạo ra để tránh.
 *
 * Cái mất là undo và `PageVersion`. Đổi lại một chuỗi dịch là thao tác một ô,
 * hoàn nguyên bằng cách gõ lại chuỗi cũ — không giống việc chèn một cây node.
 * Vẫn có `AuditLog` để truy ai sửa gì.
 *
 * ## Vì sao ghi ở đây không lên sóng ngay
 *
 * Render của site đọc ảnh chụp bản dịch trong `Release.translations`, không đọc
 * bảng này. Bảng này là nháp. Đó là điều làm hợp đồng nháp/publish còn đúng cho
 * cả chữ tiếng Anh.
 */

import { requireAuth } from '@/lib/auth/guard';
import { setTranslation } from '@/lib/builder/set-translation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  pageId?: string;
  locale?: string;
  nodeId?: string;
  field?: string;
  /** RichText cho content/label, string cho alt/a11yLabel. `null` = xoá bản dịch. */
  value?: unknown;
}

export async function POST(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await setTranslation({
    pageId: body.pageId,
    locale: body.locale,
    nodeId: body.nodeId,
    field: body.field,
    value: body.value,
    actorEmail: auth.email,
    actorSub: auth.sub,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
