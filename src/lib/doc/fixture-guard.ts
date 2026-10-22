/**
 * Trang đồ gá: quyết định chặn hay không, dưới dạng một hàm thuần.
 *
 * ## Vì sao tách ra khỏi `apply-to-page.ts`
 *
 * `apply-to-page.ts` khai `server-only` và import Prisma, nên một phép kiểm nằm
 * trong đó chỉ test được khi có Prisma client đã generate — thứ không có trong
 * mọi môi trường (xem `ai-css-allowlist.ts`, cùng lý do, cùng hôm nay). Luật
 * "AI không ghi vào đồ gá" là luật đáng có test hơn hầu hết luật khác, vì nó tồn
 * tại CHÍNH VÌ đã bị vi phạm hai lần.
 *
 * Cùng khuôn với `savings-model.ts` (số học thuần, tách khỏi component) và
 * `static-css.ts` (gộp thuần, tách khỏi `style-bundle.ts`).
 *
 * ## Vì sao chặn AI mà không chặn người
 *
 * Người dọn đồ gá là việc bình thường: `pnpm seed:second` dựng lại nó. Người sửa
 * bằng tay trong Inspector cũng là việc bình thường khi đang viết spec. Cái không
 * bình thường là một Agent đọc `list_pages`, thấy một trang tên "Về chúng tôi",
 * `published: true`, và dựng 47 node nội dung lên đó — vì từ phía Agent, trang đó
 * trông y hệt mọi trang khác.
 */

import type { Actor } from './validate-types';

export interface FixtureRejection {
  status: 403;
  error: string;
}

/**
 * `null` = cho qua.
 *
 * Nhận đúng hai field thay vì cả hàng `Page`: hàm này không được có cơ hội đọc
 * thêm thứ gì, và chữ ký hẹp nói rõ nó quyết định dựa trên cái gì.
 */
export function fixtureRejection(
  page: { slug: string; fixture: boolean },
  actor: Actor,
): FixtureRejection | null {
  if (actor !== 'ai' || !page.fixture) return null;

  return {
    status: 403,
    error:
      `/${page.slug} là đồ gá của test e2e, không phải nội dung — AI không được ghi vào đây. ` +
      'Dựng nội dung thật lên một trang khác, hoặc hỏi người dùng trang nào là đúng.',
  };
}
