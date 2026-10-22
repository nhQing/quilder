import { NextResponse } from 'next/server';

/**
 * Áp op lên cây node của một component.
 *
 * Đường ghi DUY NHẤT cho cấu trúc component, dùng chung cho builder và cho AI —
 * cùng lý do như `/api/ops` với trang: hai đường tự viết transaction riêng sẽ
 * trôi khỏi nhau, và thứ trôi mất sẽ là kiểm vùng khoá, audit log, hoặc
 * `parentId` của version.
 */

import { requireAuth } from '@/lib/auth/guard';
import { applyOpsToPreset } from '@/lib/doc/apply-to-preset';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  ops?: unknown;
  label?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await applyOpsToPreset({
    presetId: id,
    ops: body.ops,
    actor: 'human',
    session: auth,
    label: body.label,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, issues: result.issues },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    versionId: result.versionId,
    tree: result.tree,
    undo: result.undo,
  });
}
