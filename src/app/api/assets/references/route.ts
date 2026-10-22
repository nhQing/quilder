import { NextResponse } from 'next/server';
import { z } from 'zod';

import { assetReferences } from '@/lib/builder/asset-references';

import { idList, MAX_BATCH, readBody, requireHuman } from '../trash/_http';

export const dynamic = 'force-dynamic';

const schema = z.object({ ids: idList(MAX_BATCH) });

/** Nơi các ảnh đang được dùng (chặn xoá) + release cũ còn tham chiếu. Map thành object. */
export async function POST(request: Request) {
  const auth = await requireHuman('write');
  if (auth instanceof NextResponse) return auth;
  const body = await readBody(request, schema);
  if (body instanceof NextResponse) return body;
  const map = await assetReferences(body.ids);
  return NextResponse.json(Object.fromEntries(map));
}
