/**
 * Luật xoá hẳn một tài khoản (19/11/2026). Thuần — route `DELETE /api/users/[id]` và bảng
 * admin dùng chung một phép quyết định.
 *
 * Đường xoá cứng từng bị bỏ hẳn (xem `User.lockedAt`): xoá làm byline mồ côi và làm token MCP
 * biến mất không dấu vết. Nó quay lại có ĐIỀU KIỆN, giữ nguyên cả hai lý do ấy:
 *
 *  - **Chỉ tài khoản đã khoá đủ {@link DELETE_AFTER_DAYS} ngày.** Khoá là bước đảo ngược được;
 *    một tháng là đủ để nhận ra khoá nhầm trước khi bước không đảo ngược tới. Token đã bị thu
 *    hồi lúc khoá, nên xoá không cắt quyền của ai thêm nữa.
 *  - **Không còn đứng tên bài viết nào** (tác giả hoặc người sửa gần nhất). Tên tác giả hiện
 *    trên site thật, và khoá ngoại `Restrict` ở `Entry` cũng sẽ chặn ở tầng DB.
 *  - Không tự xoá mình.
 *
 * Lịch sử không mất: `AuditLog.userId` là chuỗi, không khoá ngoại; route ghi thêm một dòng
 * `user.delete` kèm email.
 */

export const DELETE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DeleteEligibility =
  | { ok: true }
  | { ok: false; reason: string; availableAt?: Date };

const fmt = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export function deleteEligibility(args: {
  lockedAt: Date | null;
  /** Số bài viết tài khoản này đứng tên (tạo hoặc sửa gần nhất). */
  entryCount: number;
  isSelf: boolean;
  now?: Date;
}): DeleteEligibility {
  const now = args.now ?? new Date();
  if (args.isSelf) return { ok: false, reason: 'Không tự xoá tài khoản của mình.' };
  if (!args.lockedAt) return { ok: false, reason: 'Tài khoản chưa bị khoá. Khoá trước, đủ 30 ngày mới xoá được.' };
  const availableAt = new Date(args.lockedAt.getTime() + DELETE_AFTER_DAYS * DAY_MS);
  if (now < availableAt) {
    return {
      ok: false,
      reason: `Khoá chưa đủ ${DELETE_AFTER_DAYS} ngày — xoá được từ ${fmt(availableAt)}.`,
      availableAt,
    };
  }
  if (args.entryCount > 0) {
    return {
      ok: false,
      reason: `Còn đứng tên ${args.entryCount} bài viết (tác giả hoặc người sửa) — xoá thì tên tác giả trên site bị mất. Chuyển các bài đó cho người khác trước.`,
    };
  }
  return { ok: true };
}
