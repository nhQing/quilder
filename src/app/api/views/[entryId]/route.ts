import { NextResponse } from 'next/server';

/**
 * "Bài này vừa được xem một lượt."
 *
 * ## Vì sao KHÔNG nằm trong `/api/public/v1`
 *
 * Namespace ấy là GET-only theo hợp đồng — `corsHeaders` phát
 * `access-control-allow-methods: 'GET, OPTIONS'` cho cả bốn route. Thêm một POST
 * vào đó là đổi hợp đồng của cả namespace để phục vụ một route, và là mở một bề
 * mặt GHI cho người lạ ở đúng chỗ đã cố ý chỉ có đọc.
 *
 * Route này thì ngược lại: nó chỉ phục vụ CHÍNH site của mình. Trang chi tiết do
 * app này render, nên lời gọi là same-origin và không cần CORS. Không có
 * `OPTIONS`, không có `access-control-allow-origin` — một trang của bên thứ ba
 * gọi tới đây sẽ bị trình duyệt chặn, và đó là ý muốn.
 *
 * ## Vì sao không đòi đăng nhập, và cái giá của nó
 *
 * Người đọc site không có phiên. Cổng mở ở `middleware.ts` (`isPublicWrite`) —
 * trước 08/10/2026 docblock này đã nói "không đòi đăng nhập" nhưng middleware vẫn
 * trả 401, nên con số chỉ đếm lượt xem của nhân viên.
 *
 * Chống bơm số ở mức đủ cho một con số dùng để SẮP XẾP, không dùng để đối soát:
 * mỗi IP được tính một lượt cho mỗi bài trong 30 phút, và bot tự khai danh tính
 * không được tính. Người cố tình đổi IP vẫn bơm được — chống điều đó cần chống bot
 * theo phiên, và không đáng cho mục đích này.
 *
 * Vượt trần vẫn trả 204: người gọi không cần biết lượt của mình có được tính hay
 * không, và trả mã khác là dạy cho kẻ bơm số biết lúc nào nên đổi IP.
 *
 * Không kiểm bài có tồn tại hay đã đăng chưa: kiểm nghĩa là một lượt ĐỌC DB cho
 * mỗi lượt xem, tức đúng chi phí mà `entry-views.ts` tồn tại để tránh. Bài không
 * có thật thì lượt `update` lúc flush rơi, và nó rơi trong im lặng ở đó.
 */

import { clientIp } from '@/lib/client-ip';
import { recordView } from '@/lib/collections/entry-views';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** Hình dạng cuid/cuid2 — đủ để chặn rác, không phải để xác thực. */
const ID = /^[a-z0-9]{20,32}$/;

/** Một IP, một bài, một lượt trong khoảng này. */
const VIEW_WINDOW_MS = 30 * 60_000;

/** Crawler, link preview và trình duyệt không đầu tự khai trong User-Agent. */
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const { entryId } = await params;

  if (!ID.test(entryId)) {
    return NextResponse.json({ error: 'entryId không hợp lệ' }, { status: 400 });
  }

  const agent = request.headers.get('user-agent') ?? '';
  const counted =
    !BOT_UA.test(agent) &&
    rateLimit(`view:${clientIp(request.headers)}:${entryId}`, 1, VIEW_WINDOW_MS).ok;

  if (counted) recordView(entryId);

  /*
   * 204 chứ không phải 200 kèm một JSON: người gọi không có gì để đọc, và trả về
   * số lượt hiện tại sẽ là một lời hứa sai — nó còn đang nằm trong bộ đệm.
   */
  return new NextResponse(null, { status: 204 });
}
