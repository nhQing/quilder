/**
 * Thứ tự của bảng bài trong Kho dữ liệu — lựa chọn của TỪNG TÀI KHOẢN.
 *
 * ## Vì sao mặc định là ngày tạo
 *
 * Site sắp danh sách tin theo `createdAt` (ngày tạo — với bài nhập từ Strapi chính là
 * ngày tạo gốc, nên thứ tự khớp id Strapi). Bảng admin từng sắp theo `updatedAt`, nên
 * cùng một loại bài mà admin và site hiện hai thứ tự khác nhau, và mỗi lần sửa một bài
 * thì bài đó nhảy lên đầu bảng — người xem tưởng dữ liệu "lung tung".
 *
 * `updatedAt` vẫn chọn được: "bài nào vừa sửa" là một câu hỏi có thật.
 *
 * ## Vì sao lưu theo tài khoản, không ở cookie như lựa chọn cột
 *
 * Người dùng yêu cầu thế: một biên tập viên đổi máy vẫn giữ cách xem của mình. Lưu ở
 * `User.prefs` (JSON) thay vì một cột riêng, để tuỳ chọn sau không cần migration.
 *
 * ## `id` là khoá phụ
 *
 * Bài nhập hàng loạt có thể trùng mốc thời gian tới mili giây. Không có khoá phụ thì
 * Postgres trả các hàng trùng theo thứ tự tuỳ lượt, và hai lần tải trang ra hai thứ tự.
 *
 * File này không import giá trị nào từ server: component client dùng chung nhãn.
 */

export const ENTRY_SORTS = ['created', 'updated'] as const;
export type EntrySort = (typeof ENTRY_SORTS)[number];

export const DEFAULT_ENTRY_SORT: EntrySort = 'created';

export const ENTRY_SORT_LABEL: Record<EntrySort, string> = {
  created: 'Ngày tạo (mới nhất trước)',
  updated: 'Ngày cập nhật (mới nhất trước)',
};

export function isEntrySort(v: unknown): v is EntrySort {
  return typeof v === 'string' && (ENTRY_SORTS as readonly string[]).includes(v);
}

function asObject(prefs: unknown): Record<string, unknown> {
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? (prefs as Record<string, unknown>) : {};
}

/** Lựa chọn đã lưu trong `User.prefs`. Trống, hỏng hay giá trị lạ → mặc định. */
export function entrySortFromPrefs(prefs: unknown): EntrySort {
  const v = asObject(prefs).entrySort;
  return isEntrySort(v) ? v : DEFAULT_ENTRY_SORT;
}

/** `User.prefs` mới: ghi đúng khoá `entrySort`, giữ nguyên mọi khoá khác. */
export function withEntrySort(prefs: unknown, sort: EntrySort): Record<string, unknown> {
  return { ...asObject(prefs), entrySort: sort };
}

/** `orderBy` của Prisma cho một lựa chọn. */
export function entrySortOrderBy(sort: EntrySort): ({ createdAt: 'desc' } | { updatedAt: 'desc' } | { id: 'desc' })[] {
  return sort === 'updated'
    ? [{ updatedAt: 'desc' }, { id: 'desc' }]
    : [{ createdAt: 'desc' }, { id: 'desc' }];
}
