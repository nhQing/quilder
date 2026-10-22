/**
 * `postcss-safe-parser` không ship type.
 *
 * Khai tối thiểu đúng cách ta dùng nó: một `Parser` truyền vào `process()`.
 * Không khai rộng hơn — một `declare module` trống rỗng sẽ biến mọi thứ nhập từ
 * đây thành `any` và mất luôn phép kiểm.
 */
declare module 'postcss-safe-parser' {
  import type { Parser } from 'postcss';

  const safeParser: Parser;
  export default safeParser;
}
