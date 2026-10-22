import { NextResponse } from 'next/server';
import { z } from 'zod';

import { trashAssets } from '@/lib/builder/asset-trash';

import { idList, MAX_BATCH, readBody, requireHuman } from './_http';

export const dynamic = 'force-dynamic';

const schema = z.object({ ids: idList(MAX_BATCH) });

/** Đưa ảnh vào thùng rác. Ảnh đang dùng được trả về trong `skipped`, không làm hỏng lô. */
export async function POST(request: Request) {
  const auth = await requireHuman('write');
  if (auth instanceof NextResponse) return auth;
  const body = await readBody(request, schema);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await trashAssets(body.ids, auth.actor));
}
