import { NextResponse } from 'next/server';

/**
 * Áp một batch op lên bản NHÁP của một trang.
 *
 * Không bao giờ chạm tới release đang chạy — sửa trong builder không được ảnh
 * hưởng thứ khách đang xem. Đó là toàn bộ ý nghĩa của draft/publish.
 *
 * Phần việc thật nằm ở `applyOpsToPage`, dùng chung với tool `apply_ops` của
 * MCP/AI. Route này chỉ lo xác thực, đọc body và dịch kết quả thành HTTP.
 */

import { requireAuth } from '@/lib/auth/guard';
import { applyOpsToPage } from '@/lib/doc/apply-to-page';
import type { Actor } from '@/lib/doc/validate';

export const dynamic = 'force-dynamic';

interface Body {
  pageId?: string;
  ops?: unknown;
  label?: string;
  /** Prompt đã sinh ra batch này, nếu do AI. Lưu để truy vết. */
  prompt?: string;
  /**
   * `seq` của bản nháp mà client đã thấy. Lệch thì 409 kèm `currentSeq` — xem
   * `applyOpsToPage`. Builder luôn gửi; vắng thì áp lên bản hiện tại.
   */
  baseSeq?: number;
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

  const { pageId, ops, label, prompt } = body;
  const baseSeq = typeof body.baseSeq === 'number' ? body.baseSeq : undefined;

  /*
   * Actor suy ra từ PHIÊN, không đọc từ body.
   *
   * Trước 08/10/2026 đây là `body.actor ?? 'human'`: một client chỉ cần không gửi
   * trường đó là được tính là người, và qua mặt chặn node khoá cùng
   * `AI_CSS_ALLOWLIST`. Máy (token service) luôn là 'ai'. Middleware đã chặn
   * token service khỏi route này (`service-scope.ts`); dòng này là lớp thứ hai.
   */
  const actor: Actor = auth.kind === 'service' ? 'ai' : 'human';

  if (!pageId || !Array.isArray(ops)) {
    return NextResponse.json({ error: 'Thiếu pageId hoặc ops' }, { status: 400 });
  }

  const result = await applyOpsToPage({
    pageId, ops, actor, session: auth, label, prompt, baseSeq,
    // Builder thay CSS này vào canvas ngay khi lưu xong — xem `ApplyResult.css`.
    withCss: true,
  });

  if (!result.ok) {
    // 422 chứ không phải 400 khi op sai: cú pháp JSON đúng, nội dung sai. Client
    // dùng `issues` để hiện lỗi ngay cạnh op gây ra nó.
    return NextResponse.json(
      {
        error: result.error,
        issues: result.issues,
        ...(result.warnings ? { warnings: result.warnings } : {}),
        // 409: client gửi lại cùng batch với `baseSeq = currentSeq` để áp lên bản mới.
        ...(result.conflict ? { conflict: true, currentSeq: result.currentSeq } : {}),
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    versionId: result.versionId,
    seq: result.seq,
    doc: result.doc,
    undo: result.undo,
    ...(result.css !== undefined ? { css: result.css } : {}),
    // Không chặn, nhưng inspector phải hiện được: "đã lưu" mà CSS bị gỡ một nửa
    // là đúng loại im lặng khiến người dùng đi tìm bug ở chỗ không có bug.
    ...(result.warnings ? { warnings: result.warnings } : {}),
  });
}
