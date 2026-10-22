/**
 * Phép tính thuần cho `bindAnchors` — tách khỏi scroll.ts để test không phải kéo
 * theo gsap/lenis.
 *
 * Neo trỏ tới một TRƯỜNG NHẬP (ô email ở chân trang) khác neo trỏ tới một section:
 * người dùng sắp gõ vào đó, nên ô phải dừng lại thấy được và rõ ràng dưới thanh
 * nav cố định — offset mặc định (-80, tính cho đầu section) chỉ vừa khít mép dưới
 * nav, ô nhập sẽ dính sát vào nó.
 */

/** Offset mặc định của `scrollTo` cho neo section. */
export const SECTION_OFFSET = -80;

/** Offset tối thiểu khi đích là trường nhập (site cũ dùng đúng -120). */
export const FIELD_OFFSET = -120;

/** Chừa thêm dưới nav để ô nhập không dính mép của nó. */
const HEADER_GAP = 24;

const FOCUSABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

interface FocusableLike {
  tagName: string;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}

/**
 * Đích neo có nhận focus được không: input/textarea/select/button (trừ khi bị
 * vô hiệu hoá hoặc là input ẩn) hoặc phần tử có `tabindex`.
 */
export function isFocusableTarget(el: FocusableLike): boolean {
  if (el.hasAttribute('disabled')) return false;
  if (FOCUSABLE_TAGS.has(el.tagName)) {
    return !(el.tagName === 'INPUT' && el.getAttribute('type') === 'hidden');
  }
  return el.hasAttribute('tabindex');
}

/**
 * Offset (số ÂM, theo quy ước của Lenis) để cuộn tới `target`.
 *
 * Trường nhập: ít nhất `FIELD_OFFSET`, và nếu thanh nav cố định cao hơn thế thì
 * theo chiều cao thật của nó (`headerBottom`, mép dưới của `[data-header]`, 0 khi
 * không có) cộng một khoảng thở — nên ô luôn nằm dưới nav kể cả khi nav cao.
 */
export function anchorOffset(focusable: boolean, headerBottom: number): number {
  if (!focusable) return SECTION_OFFSET;
  return -Math.max(-FIELD_OFFSET, Math.ceil(headerBottom) + HEADER_GAP);
}
