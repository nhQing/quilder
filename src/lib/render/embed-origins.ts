import 'server-only';

/**
 * Origin được phép cho khối `CustomCode`.
 *
 * Bọc `unstable_cache` với tag riêng: danh sách này đọc MỘT lần cho mỗi trang có
 * khối CustomCode, và nó gần như không bao giờ đổi. Không cache thì mỗi khối trên
 * mỗi trang là một truy vấn.
 *
 * `enabled: false` thay vì xoá hàng — tắt tạm một CDN đang có sự cố mà không mất
 * ghi chú vì sao nó từng được thêm.
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/db';

export const EMBED_ORIGINS_TAG = 'embed-origins';

/**
 * Chỉ nhận `https://host` không đường dẫn, không dấu `/` cuối.
 *
 * Lọc lại ở đây dù đường ghi đã kiểm, vì chuỗi này đi thẳng vào header CSP: một
 * khoảng trắng lọt vào là chèn được một directive mới, tức vô hiệu hoá cả CSP.
 * Chỗ DUY NHẤT chắc chắn nằm giữa database và chuỗi CSP là chỗ này.
 */
const ORIGIN_RE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Cùng danh sách, nhưng chỉ HOSTNAME — `sanitize-html` cần đúng dạng đó.
 *
 * `allowedEmbedOrigins()` trả `https://host` vì nó sinh chuỗi CSP, nơi scheme là
 * bắt buộc. `allowedIframeHostnames` của `sanitize-html` thì so hostname đã parse,
 * và một phần tử `"https://www.youtube.com"` ở đó KHÔNG khớp gì cả — nó chỉ âm thầm
 * không nhận iframe nào. Hai dạng của một danh sách, nên chỗ chuyển đổi phải có
 * đúng một bản, ở đây, cạnh nguồn.
 *
 * Cắt bằng `URL` chứ không `slice(8)`: `ORIGIN_RE` đã bảo đảm dạng chuỗi, nhưng
 * một hàng mới thêm vào bảng bằng SQL tay thì chưa đi qua regex đó.
 */
export async function allowedEmbedHostnames(): Promise<string[]> {
  const origins = await allowedEmbedOrigins();
  const out: string[] = [];
  for (const o of origins) {
    try {
      out.push(new URL(o).hostname);
    } catch {
      // Hàng hỏng thì BỎ, không ném: một origin gõ sai không được làm cả trang 500.
    }
  }
  return out;
}

export const allowedEmbedOrigins = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await prisma.embedOrigin.findMany({
      where: { enabled: true },
      orderBy: { origin: 'asc' },
      select: { origin: true },
    });
    return rows.map((r) => r.origin).filter((o) => ORIGIN_RE.test(o));
  },
  ['embed-origins'],
  { tags: [EMBED_ORIGINS_TAG] },
);
