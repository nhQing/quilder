import 'server-only';

/**
 * Đường đọc `/api/public/v1/views/<khoá>[/<slug>]`.
 *
 * Không có truy vấn nội dung nào ở đây: view chỉ dựng lại query string rồi giao cho
 * `readPublicList` / `readPublicOne` — nên mọi luật của API công khai (chỉ bài đã đăng,
 * ngôn ngữ, danh sách trắng tham số, trần payload) áp NGUYÊN cho view, không phải chép.
 *
 * ## Vì sao KHÔNG cache bản ghi view
 *
 * Khoá cache sẽ là đoạn URL do người ngoài gõ, tức một cửa để phình cache bằng khoá rác
 * — cùng lý do `public-read.ts` không bọc danh sách. Một lượt `findUnique` trên khoá
 * unique là rẻ so với chính truy vấn danh sách đi sau.
 *
 * ## Hai loại lỗi, hai mã
 *
 * Client gửi tham số view không cho phép → 400 `bad_param`: lỗi của client. Query ĐÃ LƯU
 * không còn đọc được (field vừa bị xoá, loại bị xoá) → 500 `view_invalid`: lỗi của cấu
 * hình, và app không làm gì khác được để sửa. Gộp hai cái vào 400 thì người viết app đi
 * tìm lỗi trong code của mình.
 */

import { prisma } from '@/lib/db';
import { mergeViewParams, VIEW_KEY_RE } from './api-view';
import { checkViewQuery } from './api-view-store';
import { readPublicList, readPublicOne, type PublicListPayload, type ReadResult } from './public-read';

export async function readPublicView(
  viewKey: string,
  client: URLSearchParams,
  slug?: string,
): Promise<ReadResult<PublicListPayload | { data: Record<string, unknown> }>> {
  const missing = { ok: false, status: 404, error: `Không có view "${viewKey}"`, code: 'unknown_view' } as const;
  if (!VIEW_KEY_RE.test(viewKey)) return missing;

  const view = await prisma.apiView.findUnique({
    where: { key: viewKey },
    select: { key: true, typeKey: true, query: true, allow: true },
  });
  if (!view) return missing;

  const fit = await checkViewQuery(view.typeKey, view.query);
  if (!fit.ok) {
    return { ok: false, status: 500, error: `View "${viewKey}" cấu hình lỗi: ${fit.error}`, code: 'view_invalid' };
  }

  const merged = mergeViewParams(view.query, client, view.allow);
  if (!merged.ok) return { ok: false, status: 400, error: merged.error, code: 'bad_param' };

  return slug === undefined
    ? readPublicList(view.typeKey, merged.params)
    : readPublicOne(view.typeKey, slug, merged.params);
}
