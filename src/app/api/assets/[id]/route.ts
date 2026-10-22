import { NextResponse } from 'next/server';

/**
 * Dời một ảnh sang thư mục khác.
 *
 * PATCH chứ không PUT: thư mục là MỘT thuộc tính trong nhiều thuộc tính của asset,
 * và route này cố ý không cho sửa những cái còn lại. `key`, `url`, `width`,
 * `height` là dữ kiện của file — sửa chúng là nói dối về một object bất biến.
 */

import { requireAuth } from '@/lib/auth/guard';
import { moveAsset } from '@/lib/builder/asset-folders';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  let body: { folder?: string | null };
  try {
    body = (await request.json()) as { folder?: string | null };
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  /*
   * `folder` vắng mặt ≠ `folder: null`. Vắng mặt là một yêu cầu không nói gì —
   * từ chối, vì đoán ra "đưa về chưa phân loại" sẽ biến một request thiếu sót
   * thành một thao tác sắp xếp lại kho.
   */
  if (!('folder' in body)) {
    return NextResponse.json(
      { error: 'Thiếu trường "folder". Dùng null để đưa về Chưa phân loại.' },
      { status: 400 },
    );
  }

  const result = await moveAsset({ assetId: id, folder: body.folder ?? null, actorSub: auth.sub });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, moved: result.moved });
}
