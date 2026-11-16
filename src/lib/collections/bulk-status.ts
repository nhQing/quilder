/**
 * Hành động nào của thanh thao tác hàng loạt (màn bảng entry) có nghĩa với những
 * dòng đang chọn, và gửi cho đúng dòng nào.
 *
 * "Chuyển về nháp" khi cả 12 dòng đã là nháp là một nút không làm gì — nhưng bấm
 * nó vẫn bắn 12 request, đẩy `updatedAt` và revalidate tag 12 lần, và nó làm người
 * dùng tự hỏi cột trạng thái có đang nói đúng không. Nên mỗi hành động chỉ hiện khi
 * có ít nhất một dòng nó đổi được, và chỉ gửi cho những dòng đó.
 *
 * Tách khỏi EntryTable.tsx (client component) để test được không cần DOM.
 */

export type BulkRow = { id: string; status: string };
export type BulkTargets = { publish: string[]; draft: string[]; archive: string[] };

export function bulkTargets(rows: readonly BulkRow[], picked: Iterable<string>): BulkTargets {
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));
  const out: BulkTargets = { publish: [], draft: [], archive: [] };
  for (const id of picked) {
    // Không thấy dòng (đã chọn rồi mới chuyển trang): không biết trạng thái thì để
    // server quyết — đặt lại đúng trạng thái đang có là vô hại.
    const status = statusOf.get(id);
    // Bài hẹn giờ cũng là `published`: "Đăng" lại nó không có nghĩa, "Chuyển về
    // nháp" thì có (huỷ lịch).
    if (status !== 'published') out.publish.push(id);
    if (status !== 'draft') out.draft.push(id);
    out.archive.push(id);
  }
  return out;
}
