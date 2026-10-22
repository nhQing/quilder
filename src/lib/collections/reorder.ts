import { prisma } from '@/lib/db';

import { revalidateTypes } from './cache';

/**
 * Đổi thứ tự loại nội dung / nhóm field trên màn Kho dữ liệu.
 *
 * ## Nhận CẢ danh sách, không nhận "chuyển cái này lên một bậc"
 *
 * Một lệnh "lên một bậc" phải đọc thứ tự hiện tại rồi tự suy ra hàng xóm — và giữa
 * lúc đọc với lúc ghi, một tab khác có thể đã đổi thứ tự. Kết quả là hai lần bấm
 * cho ra một hoán vị không ai yêu cầu. Client đã có đúng danh sách đang hiện trên
 * màn, nên nó gửi cả danh sách và server chỉ việc đánh số lại: kết quả luôn bằng
 * cái người dùng vừa nhìn thấy.
 *
 * ## `updateMany` chứ không `update`
 *
 * Một khoá không còn tồn tại (tab kia vừa xoá loại đó) thì `update` ném `P2025` và
 * cả lượt sắp xếp hỏng vì một hàng đã biến mất. `updateMany` bỏ qua nó, những hàng
 * còn lại vẫn được đánh số đúng thứ tự tương đối.
 *
 * ## Không ghi audit
 *
 * Thứ tự thẻ trên một màn quản trị là TRÌNH BÀY, không phải nội dung: không có bản
 * nào lên site khác đi vì nó. Ghi audit cho nó là làm loãng đúng cái log mà người
 * ta mở ra để tìm "ai đã đổi bài này".
 */
export type ReorderKind = 'type' | 'group';

export type ReorderResult =
  | { ok: true; count: number }
  | { ok: false; error: string; status: number };

/** Trần cho một lượt: đủ rộng cho mọi kho thật, đủ hẹp để không ai gửi cả một mảng rác. */
const MAX_KEYS = 200;

export async function reorderCollectionCards(
  kind: ReorderKind,
  keys: unknown,
): Promise<ReorderResult> {
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string' || !k.trim())) {
    return { ok: false, error: 'keys phải là mảng chuỗi khoá', status: 400 };
  }
  const list = keys as string[];
  if (list.length === 0) return { ok: false, error: 'keys rỗng', status: 400 };
  if (list.length > MAX_KEYS) {
    return { ok: false, error: `Tối đa ${MAX_KEYS} khoá một lượt`, status: 400 };
  }
  if (new Set(list).size !== list.length) {
    return { ok: false, error: 'keys có khoá trùng', status: 400 };
  }

  // Một giao dịch: nửa chừng mà đứt thì thứ tự sẽ là một pha trộn giữa cũ và mới,
  // và không có gì trên màn nói cho người dùng biết điều đó đã xảy ra.
  await prisma.$transaction(
    list.map((key, i) =>
      kind === 'type'
        ? prisma.collectionType.updateMany({ where: { key }, data: { order: i } })
        : prisma.fieldGroupDef.updateMany({ where: { key }, data: { order: i } }),
    ),
  );

  // Cả hai danh sách đều nằm dưới `TYPES_TAG` (xem `queries.ts` và `public-read.ts`).
  // Bỏ dòng này thì thứ tự mới chỉ hiện sau `revalidate: 3600`.
  revalidateTypes();
  return { ok: true, count: list.length };
}
