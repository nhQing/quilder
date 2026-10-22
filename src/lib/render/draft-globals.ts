import 'server-only';

/**
 * `Site.globals` cho các màn NHÁP — canvas của editor và `/preview`.
 *
 * Site thật đọc `Release.globals` (ảnh chụp lúc Publish, xem `render/page.ts`). Màn nháp
 * thì đọc bảng live, cùng hợp đồng với doc: nháp là thứ SẼ lên ở lần Publish tới.
 *
 * Trước 13/10/2026 hai màn này dựng `scope.site = {}`. Hậu quả: mọi form trong bản nháp
 * hiện "chưa có đích gửi" dù endpoint đã đặt ở màn Cài đặt, và binding `site.*` hiện chữ
 * dự phòng — người dùng đặt xong cấu hình rồi không có chỗ nào thấy nó chạy trước khi
 * đưa lên site thật.
 */

import { prisma } from '@/lib/db';

export async function draftSiteGlobals(): Promise<Record<string, unknown>> {
  const site = await prisma.site.findFirst({ select: { globals: true } });
  const globals = site?.globals;
  return globals && typeof globals === 'object' && !Array.isArray(globals)
    ? (globals as Record<string, unknown>)
    : {};
}
