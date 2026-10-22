import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { checkBundle } from '@/lib/transfer/compat';
import { buildImportPlan } from '@/lib/transfer/import-plan';
import { loadTargetSnapshot, parseImportTarget, readBundleBody } from '@/lib/transfer/target';

export const dynamic = 'force-dynamic';

/** Xem trước một lần nhập — CHƯA ghi gì. */
export async function POST(req: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const read = await readBundleBody(req);
  if (!read.ok) return read.response;
  const target = parseImportTarget(read.body.target);

  const plan = buildImportPlan(read.bundle, checkBundle(read.bundle), await loadTargetSnapshot(read.bundle), target);
  return NextResponse.json({ plan });
}
