import { NextResponse } from 'next/server';
import { z } from 'zod';

import { restoreAssets } from '@/lib/builder/asset-trash';

import { idList, MAX_BATCH, readBody, requireHuman } from '../trash/_http';

export const dynamic = 'force-dynamic';

const schema = z.object({ ids: idList(MAX_BATCH) });

/** Khôi phục ảnh từ thùng rác về thư mục cũ. */
export async function POST(request: Request) {
  const auth = await requireHuman('write');
  if (auth instanceof NextResponse) return auth;
  const body = await readBody(request, schema);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await restoreAssets(body.ids, auth.actor));
}
