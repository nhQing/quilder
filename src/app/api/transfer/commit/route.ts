import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { commitImport } from '@/lib/transfer/commit';
import { parseImportTarget, readBundleBody } from '@/lib/transfer/target';

export const dynamic = 'force-dynamic';

/** Ghi một lần nhập vào BẢN NHÁP của trang đích. Không publish. */
export async function POST(req: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const read = await readBundleBody(req);
  if (!read.ok) return read.response;
  const target = parseImportTarget(read.body.target);
  if (!target) return NextResponse.json({ error: 'Chưa chọn trang đích' }, { status: 400 });

  const r = await commitImport({
    bundle: read.bundle,
    target,
    expectDraftVersionId: typeof read.body.expectDraftVersionId === 'string' ? read.body.expectDraftVersionId : null,
    takeMeta: read.body.takeMeta === true,
    session: auth,
  });
  if (!r.ok) return NextResponse.json({ error: r.error, issues: r.issues ?? [] }, { status: r.status });
  return NextResponse.json({
    pageId: r.pageId, importId: r.importId, issues: r.issues,
    editorUrl: `/builder/${r.pageId}`, previewUrl: `/preview/${r.pageId}`,
  });
}
