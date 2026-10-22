import { NextResponse } from 'next/server';

/**
 * Dời NHIỀU ảnh sang một thư mục trong một lần.
 *
 * ## Vì sao có route này thay vì để client gọi `PATCH /api/assets/[id]` N lần
 *
 * Kéo 12 ảnh vào một thư mục là MỘT hành động của người dùng. Mười hai request
 * riêng biến nó thành mười hai hành động có thể thành công một phần: mạng rớt ở
 * request thứ bảy để lại kho ở trạng thái không ai chọn, và không có cách nào lùi
 * lại. Ở đây cả lô nằm trong một transaction, và nhật ký ghi đúng một dòng.
 *
 * `PATCH /api/assets/[id]` vẫn giữ nguyên — nó là đường tối giản cho MCP và cho
 * thao tác trên một ảnh lẻ, và giờ chỉ là lớp mỏng gọi cùng hàm.
 *
 * Lưu ý định tuyến: đoạn tĩnh `move` thắng đoạn động `[id]`, nên một asset có id
 * đúng bằng `move` sẽ không gọi được qua route lẻ. `id` là cuid nên chuyện đó không
 * xảy ra được — nhưng nếu có ngày đổi sang id tự đặt thì đây là chỗ vỡ.
 */

import { requireAuth } from '@/lib/auth/guard';
import { moveAssets } from '@/lib/builder/asset-folders';

export const dynamic = 'force-dynamic';

/** Trần một lô. Cao hơn số ảnh ai đó chọn được bằng tay, thấp hơn mức làm nghẽn DB. */
const MAX_BATCH = 200;

export async function PATCH(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: { ids?: unknown; folder?: string | null };
  try {
    body = (await request.json()) as { ids?: unknown; folder?: string | null };
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.some((i) => typeof i !== 'string')) {
    return NextResponse.json({ error: '"ids" phải là mảng chuỗi' }, { status: 400 });
  }
  if (body.ids.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Tối đa ${MAX_BATCH} ảnh một lần, nhận ${body.ids.length}` },
      { status: 400 },
    );
  }

  /*
   * `folder` vắng mặt ≠ `folder: null` — giống `PATCH /api/assets/[id]`. Vắng mặt là
   * một yêu cầu không nói gì; đoán ra "đưa về chưa phân loại" sẽ biến một request
   * thiếu sót thành một thao tác sắp xếp lại kho.
   */
  if (!('folder' in body)) {
    return NextResponse.json(
      { error: 'Thiếu trường "folder". Dùng null để đưa về Chưa phân loại.' },
      { status: 400 },
    );
  }

  const result = await moveAssets({
    assetIds: body.ids as string[],
    folder: body.folder ?? null,
    actorSub: auth.sub,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, moved: result.moved });
}
