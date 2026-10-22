import { NextResponse } from 'next/server';

/**
 * Lùi bản nháp của một trang về một bản cũ.
 *
 * KHÔNG chạm site thật. `Release` mới là nguồn của site đang chạy, và nó chỉ đổi
 * khi có người bấm Publish — route này chỉ dời con trỏ `Page.draftVersionId`.
 *
 * Việc thật nằm ở `revertPageToVersion`, tách ra vì nó cần test được không qua
 * HTTP, và vì cùng lý do `applyOpsToPage` tách khỏi route `/api/ops`: hai đường
 * vào (builder và MCP về sau) không được có hai transaction khác nhau.
 */

import { requireAuth } from '@/lib/auth/guard';
import { revertPageToVersion } from '@/lib/builder/page-history';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  let body: { versionId?: string; expectDraftId?: string };
  try {
    body = (await request.json()) as { versionId?: string; expectDraftId?: string };
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  if (!body.versionId) {
    return NextResponse.json({ error: 'Thiếu versionId' }, { status: 400 });
  }

  const result = await revertPageToVersion({
    pageId: id,
    versionId: body.versionId,
    session: auth,
    // Builder gửi bản nháp đang hiện trong hộp lịch sử; đã đổi thì 409, không lùi mù.
    expectDraftId: typeof body.expectDraftId === 'string' ? body.expectDraftId : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    versionId: result.versionId,
    note: 'Đã lùi BẢN NHÁP. Site thật chưa đổi — cần bấm Publish.',
  });
}
