import { NextResponse } from 'next/server';

/**
 * Việc đang treo: trang nào có bản nháp chưa lên site.
 *
 * Vỏ HTTP mỏng quanh `pendingWork()`. Luật — hai con số và vì sao không gộp chúng —
 * nằm ở đó.
 *
 * ## Vì sao cần một route khi trang chủ builder là server component
 *
 * Banner phải làm mới được SAU khi người dùng publish một trang, mà không tải lại cả
 * trang chủ. `router.refresh()` làm được điều đó nhưng nó nạp lại mọi thứ khác trên
 * màn — component dựng sẵn, nền tảng thiết kế, lịch sử publish — để cập nhật một danh
 * sách vài dòng.
 *
 * Route này cũng là thứ `1h` (lớp AI) sẽ gọi khi nó muốn tự kiểm trước khi báo xong.
 * `draftDiff()` đã được tool MCP dùng; đây là cửa cho phía client.
 */

import { requireAuth } from '@/lib/auth/guard';
import { draftDiffDetail } from '@/lib/builder/draft-diff';
import { pendingWork } from '@/lib/builder/pending-work';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // `read` chứ không `write`: đây là câu hỏi, không phải hành động. Viewer cũng cần
  // biết còn gì chưa publish — họ chỉ không bấm được nút.
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;

  /*
   * `?pageId=` trả CHI TIẾT của một trang, cho hộp "Xem diff".
   *
   * Đi qua `draftDiffDetail()` chứ không mở rộng `pendingWork()`: nó dùng CÙNG phép so
   * với `draftDiff()` (đã có test, đang được tool MCP dùng), rồi gắn thêm tên node,
   * section và địa chỉ bản đang chạy cho người đọc — xem `diff-view.ts`.
   * Danh sách đầy đủ chỉ cần khi có người mở một trang ra xem — kéo nó vào mọi lần
   * tải banner là gửi hàng nghìn id node cho một màn hiện bốn con số.
   */
  const pageId = new URL(request.url).searchParams.get('pageId');
  if (pageId) {
    const detail = await draftDiffDetail(pageId);
    if (!detail) return NextResponse.json({ error: 'Không có trang này' }, { status: 404 });
    return NextResponse.json({ page: detail });
  }

  const pages = await pendingWork();
  return NextResponse.json({
    pages,
    /*
     * Tổng số LẦN SỬA, không phải tổng số chỗ đổi — cùng nguồn với số trên nút Publish.
     * Trang mới (`editCount: null`) không cộng vào đây; nó được đếm riêng, vì "3 lần
     * sửa" và "1 trang mới" là hai câu khác nhau và gộp lại thành "4" thì vô nghĩa.
     */
    edits: pages.reduce((n, p) => n + (p.editCount ?? 0), 0),
    newPages: pages.filter((p) => p.status === 'moi').length,
  });
}
