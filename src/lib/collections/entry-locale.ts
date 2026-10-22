/**
 * Slug và trạng thái đăng của một entry theo từng ngôn ngữ — phần THUẦN.
 *
 * Không `server-only`, không Prisma, không zod: form admin (client) cần đúng những
 * luật này để hiện "bản tiếng Anh đang là nháp" và để dựng URL xem trước. Một bản
 * thứ hai của luật ở phía client là cách chắc chắn nhất để hai bên nói khác nhau.
 *
 * ## Quy ước locale `undefined` = ngôn ngữ mặc định
 *
 * Cả đường render đã dùng quy ước này từ trước (`resolveTarget(slug, locale.isDefault
 * ? undefined : locale.code)`), nên nó không phải phát minh mới ở đây. Hệ quả quan
 * trọng: ngôn ngữ mặc định KHÔNG có hàng `EntryLocale`, nó đọc thẳng cột của `Entry`.
 * Bắt nó cũng có hàng nghĩa là mọi entry đang tồn tại phải được backfill, và một
 * backfill quên chạy là toàn bộ site biến mất.
 */

/** Đúng những cột của `EntryLocale` mà các luật dưới đây cần. */
export interface EntryLocaleRow {
  locale: string;
  slug: string | null;
  status: string;
  publishedAt: Date | null;
}

/** Trạng thái đăng của bản gốc, đọc từ cột của `Entry`. */
export interface EntryBaseState {
  slug: string;
  status: string;
  publishedAt: Date | null;
}

function rowFor(rows: EntryLocaleRow[], locale: string): EntryLocaleRow | null {
  return rows.find((r) => r.locale === locale) ?? null;
}

/**
 * URL của một bài ở một ngôn ngữ.
 *
 * Rơi về slug gốc khi ngôn ngữ đó chưa đặt slug riêng — đó là trạng thái của mọi
 * bài ngay sau migration, và của mọi bài mới dịch nội dung mà chưa ai nghĩ tới URL.
 * Rơi về slug gốc thì URL tiếng Anh trùng URL tiếng Việt, không phải 404.
 */
export function localeSlug(
  base: EntryBaseState,
  rows: EntryLocaleRow[],
  locale?: string,
): string {
  if (!locale) return base.slug;
  const row = rowFor(rows, locale);
  return row?.slug ?? base.slug;
}

/**
 * Bài này có được hiện ở ngôn ngữ đó chưa.
 *
 * ## Vì sao bản dịch KHÔNG cần bản gốc đã đăng
 *
 * Đây là điểm khác biệt cốt lõi của "publish riêng từng locale", nên nó phải viết
 * ra: bản tiếng Anh đã đăng thì hiện, kể cả khi bản tiếng Việt còn nháp. Bắt bản
 * gốc phải đăng trước nghĩa là không thể tháo bản gốc xuống mà giữ bản dịch, và
 * cũng nghĩa là "publish riêng" chỉ đúng một nửa.
 *
 * `archivedAt` thì NGƯỢC LẠI — nó là của cả hàng `Entry`, nên lưu trữ một bài là
 * lưu trữ mọi ngôn ngữ của nó. Lưu trữ nghĩa là "bài này không còn nữa", và một
 * bản dịch còn sống của một bài không còn nữa là một trang không ai quản.
 */
export function isLocalePublished(
  base: EntryBaseState,
  rows: EntryLocaleRow[],
  locale: string | undefined,
  now: Date,
): boolean {
  const state = locale ? rowFor(rows, locale) : base;
  if (!state) return false;
  if (state.status !== 'published') return false;
  if (!state.publishedAt) return false;
  return state.publishedAt.getTime() <= now.getTime();
}

/**
 * Trạng thái để hiện trong admin: chưa có bản ngôn ngữ này, đang nháp, đã hẹn giờ,
 * hay đã lên sóng.
 *
 * Bốn giá trị chứ không phải hai, vì "đã hẹn giờ" và "đã lên sóng" cùng có
 * `status: 'published'` — phân biệt chúng là một phép so mốc thời gian, và người
 * biên tập cần thấy khác nhau: một bài hẹn 9:00 mai mà hiện là "đã lên sóng" thì
 * không ai biết vì sao mở URL ra vẫn 404.
 */
export type LocalePublishState = 'missing' | 'draft' | 'scheduled' | 'live';

export function localePublishState(
  base: EntryBaseState,
  rows: EntryLocaleRow[],
  locale: string | undefined,
  now: Date,
): LocalePublishState {
  const state = locale ? rowFor(rows, locale) : base;
  if (!state) return 'missing';
  if (state.status !== 'published' || !state.publishedAt) return 'draft';
  return state.publishedAt.getTime() <= now.getTime() ? 'live' : 'scheduled';
}
