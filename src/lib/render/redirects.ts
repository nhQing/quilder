import 'server-only';

/**
 * Tra địa chỉ cũ → địa chỉ mới cho route site.
 *
 * ## Vì sao tra ở đây mà không phải trong `middleware.ts`
 *
 * Middleware chạy TRƯỚC mọi thứ, nên nó sẽ chuyển hướng cả những slug vẫn đang
 * được release hiện tại phục vụ. Đúng cái phải tránh: đổi slug ở bản nháp không
 * được chạm site thật. Đặt phép tra sau `getPublishedPage()` làm điều đó tự đúng —
 * còn trong ảnh chụp release thì trang cũ thắng, hết thì redirect mới lên tiếng.
 *
 * ## Vì sao nạp CẢ bảng thay vì truy vấn theo slug
 *
 * Nó chỉ chạy trên đường 404, và một site marketing có hàng chục redirect chứ
 * không hàng vạn. Nạp cả bảng cho phép `followRedirect` đi hết chuỗi mà không cần
 * n lượt truy vấn, và cho trang 404 hiện được danh sách "bạn đang tìm trang nào".
 * Nếu bảng lớn tới mức đây thành vấn đề thì phép sửa là thêm truy vấn theo `from`,
 * không phải bỏ cache.
 */

import { unstable_cache } from 'next/cache';

import { followRedirect, type RedirectRow } from '@/lib/builder/redirect-plan';
import { prisma } from '@/lib/db';

export const REDIRECTS_TAG = 'redirects';

const loadRedirects = unstable_cache(
  async (): Promise<RedirectRow[]> => {
    const site = await prisma.site.findFirst({ select: { id: true } });
    if (!site) return [];
    return prisma.redirect.findMany({
      where: { siteId: site.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, from: true, to: true },
    });
  },
  ['redirects'],
  { tags: [REDIRECTS_TAG] },
);

/** Slug đích, hoặc `null` nếu không có redirect nào (404 thật). */
export async function resolveRedirect(slug: string): Promise<string | null> {
  return followRedirect(slug, await loadRedirects());
}

/**
 * Danh sách "địa chỉ cũ → địa chỉ mới" để trang 404 gợi ý.
 *
 * Trang 404 chung không biết người ta gõ gì — Next không truyền URL vào
 * `not-found.tsx`. Nên thay vì im lặng, nó bày ra những địa chỉ đã đổi gần đây:
 * người vào từ một link cũ nhìn thấy đúng dòng của mình.
 */
export async function recentRedirects(limit = 12): Promise<RedirectRow[]> {
  return (await loadRedirects()).slice(0, limit);
}
