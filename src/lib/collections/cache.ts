import 'server-only';

/**
 * Tag cache của collection — CHỖ DUY NHẤT gọi `revalidateTag` cho nội dung.
 *
 * ## Vì sao một file riêng
 *
 * `Entry` là nguồn LIVE, nên "đổi DB xong mà quên revalidate" nghĩa là site phục
 * vụ bản cũ tới 3600s trong khi admin đã hiện bản mới — đúng cái bẫy mà docblock
 * của `/api/publish` đã cảnh báo, nhưng lần này không có nút Publish nào để người
 * dùng bấm lại. Gom một chỗ để mọi đường ghi đều đi qua nó.
 */

import { revalidateTag } from 'next/cache';

export function collectionTag(typeKey: string): string {
  return `collection:${typeKey}`;
}

export function entryTag(typeKey: string, slug: string): string {
  return `entry:${typeKey}:${slug}`;
}

/** Tag cho danh sách loại nội dung và cấu trúc của chúng. */
export const TYPES_TAG = 'collection-types';

/**
 * Gọi sau MỌI lần ghi. Truyền `slug` khi biết, để trang chi tiết cũ hết hiệu lực
 * cùng lúc với trang danh sách — bỏ nó thì trang chi tiết còn phục vụ bản cũ và
 * không ai hiểu vì sao.
 *
 * Nó vô hiệu hoá LUÔN `TYPES_TAG` — xem lý do ở trong thân hàm.
 */
export function revalidateCollection(
  typeKey: string,
  /**
   * Một slug, hay MỌI slug mà bài đó đang được phục vụ dưới.
   *
   * Mảng chứ không phải một chuỗi, vì từ khi có `EntryLocale` thì một bài có nhiều
   * URL: slug gốc, cộng slug riêng của từng ngôn ngữ. `getEntryBySlug` cache theo
   * URL ĐƯỢC YÊU CẦU, nên bỏ sót một slug nghĩa là sửa bài xong mà đúng bản tiếng
   * Anh còn phục vụ nội dung cũ — và đó là bản khó phát hiện nhất, vì người sửa
   * gần như luôn kiểm bản gốc.
   *
   * `null`/`undefined` trong mảng được bỏ qua: slug của một ngôn ngữ chưa đặt riêng
   * là `null`, và ép chỗ gọi phải lọc trước là mời chỗ gọi lọc sai.
   */
  slug?: string | readonly (string | null | undefined)[],
): void {
  revalidateTag(collectionTag(typeKey));
  for (const s of typeof slug === 'string' ? [slug] : (slug ?? [])) {
    if (s) revalidateTag(entryTag(typeKey, s));
  }
  // `getCollectionTypes` cache cả `entryCount`, nên thêm một entry là đổi cả con số
  // mà màn danh sách loại nội dung hiển thị. Bỏ dòng này thì màn đó hiện số sai tới
  // 3600s sau khi đăng một bài — và không có gì gợi ý vì sao.
  revalidateTag(TYPES_TAG);
}

/** Danh sách loại nội dung và cấu trúc của chúng đã đổi. */
export function revalidateTypes(): void {
  revalidateTag(TYPES_TAG);
}
