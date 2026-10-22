import { NextResponse } from 'next/server';
import { z } from 'zod';

import { MAX_PURGE_BATCH, retryPurgeS3 } from '@/lib/builder/asset-trash';

import { idList, readBody, requireHuman } from '../../trash/_http';

export const dynamic = 'force-dynamic';

const schema = z.object({ keys: idList(MAX_PURGE_BATCH) });

/** Thử xoá lại object S3 mà lần xoá hoàn toàn trước để sót. Chỉ admin. */
export async function POST(request: Request) {
  const auth = await requireHuman('admin');
  if (auth instanceof NextResponse) return auth;
  const body = await readBody(request, schema);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await retryPurgeS3(body.keys, auth.actor));
}
