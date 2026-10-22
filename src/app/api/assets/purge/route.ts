import { after, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  MAX_PURGE_BATCH,
  previewPurge,
  purgeAssets,
  PurgeConfirmError,
  sweepAssetHolds,
} from '@/lib/builder/asset-trash';

import { idList, readBody, requireHuman } from '../trash/_http';

export const dynamic = 'force-dynamic';

/**
 * Xoá hoàn toàn. Chỉ admin, cả chạy thử lẫn xoá thật. `dryRun: true` không ghi gì và
 * trả `batches[]`, mỗi lô một `confirmToken`; `all: true` (chỉ với dryRun) = mọi ảnh
 * đang ở thùng rác.
 *
 * Xoá thật BẮT BUỘC có `confirmToken` của đúng lô đó. Danh sách tính lại lúc xoá khác
 * lúc xem trước (ảnh vừa được dùng, cửa sổ rollback vừa trôi, token hết hạn) thì 409
 * và không xoá gì — xem `purgeAssets`.
 */
const schema = z.union([
  z.object({ dryRun: z.literal(true), all: z.literal(true) }),
  z.object({ dryRun: z.literal(true), ids: idList(MAX_PURGE_BATCH) }),
  z.object({
    dryRun: z.literal(false).optional(),
    ids: idList(MAX_PURGE_BATCH),
    confirmToken: z.string().min(1, 'Thiếu confirmToken — gọi dryRun trước'),
  }),
]);

export async function POST(request: Request) {
  const auth = await requireHuman('admin');
  if (auth instanceof NextResponse) return auth;
  const body = await readBody(request, schema);
  if (body instanceof NextResponse) return body;

  if (body.dryRun) {
    return NextResponse.json(await previewPurge('all' in body ? { all: true } : { ids: body.ids }));
  }

  try {
    const result = await purgeAssets(body.ids, auth.actor, body.confirmToken);
    // Sau phản hồi: dọn các object đã tới hạn. Lỗi ở đây không được thành lỗi của lần
    // xoá vừa xong — `sweepAssetHolds` tự ghi lỗi S3 và để hàng giữ cho lượt sau.
    after(() => sweepAssetHolds({ actor: auth.actor }).catch(() => undefined));
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PurgeConfirmError) {
      return NextResponse.json({ error: e.message, reason: e.reason }, { status: 409 });
    }
    throw e;
  }
}
