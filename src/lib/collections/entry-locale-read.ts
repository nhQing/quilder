import 'server-only';

/**
 * Trạng thái ngôn ngữ của MỘT entry, cho những chỗ cần biết về MỌI ngôn ngữ cùng lúc.
 *
 * ## Vì sao không nằm trong `queries.ts`
 *
 * Mọi hàm ở đó trả `EntryRow`, và `EntryRow.slug` là slug HIỆU LỰC của đúng một
 * ngôn ngữ — hình dạng đó đúng cho việc render một trang. hreflang thì cần thứ
 * ngược lại: URL của bài này ở TẤT CẢ các ngôn ngữ, cùng một lúc. Nhồi nó vào
 * `EntryRow` nghĩa là mọi lượt đọc danh sách mang theo một bảng ngôn ngữ mà 99%
 * chỗ gọi không dùng.
 *
 * Một truy vấn theo khoá chính, chỉ gọi ở `generateMetadata` của trang chi tiết.
 */

import { prisma } from '@/lib/db';
import type { EntryBaseState, EntryLocaleRow } from './entry-locale';

export interface EntryLocaleState {
  base: EntryBaseState;
  rows: EntryLocaleRow[];
}

export async function entryLocaleState(entryId: string): Promise<EntryLocaleState | null> {
  const e = await prisma.entry.findUnique({
    where: { id: entryId },
    select: {
      slug: true,
      status: true,
      publishedAt: true,
      locales: { select: { locale: true, slug: true, status: true, publishedAt: true } },
    },
  });
  if (!e) return null;
  return {
    base: { slug: e.slug, status: e.status, publishedAt: e.publishedAt },
    rows: e.locales,
  };
}
