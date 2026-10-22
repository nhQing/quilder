/**
 * Phép kiểm DOM dùng chung cho phím tắt toàn cục.
 *
 * Builder gắn khá nhiều listener lên `window`: Ctrl+Z (EditorShell), Delete và
 * Ctrl+D (NodeActions), Space để kéo canvas, Ctrl+0 để vừa khung. Mỗi listener
 * đó phải tự hỏi "người dùng có đang gõ chữ không?" — và ba chỗ đã tự trả lời
 * theo ba cách khác nhau, sai khác nhau:
 *
 *  - `NodeActions` kiểm `INPUT|TEXTAREA|SELECT` + `isContentEditable` — đúng
 *  - `Canvas` chỉ kiểm `INPUT|TEXTAREA`, nên Space bị nuốt khi focus đang ở một
 *    `<button>`, và không nút nào trong builder bấm được bằng bàn phím
 *  - `EditorShell` không kiểm gì, nên Ctrl+Z trong ô CSS hoàn tác một
 *    `PageVersion` trên server thay vì hoàn tác chữ vừa gõ
 *
 * Một định nghĩa ở đây để lần thứ tư không sinh ra cách sai thứ tư.
 */

/** Người dùng đang gõ vào một ô nhập — phím tắt toàn cục phải nhường. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/**
 * Phím tắt sẽ CƯỚP hành vi mặc định của một phần tử tương tác.
 *
 * Khác `isTypingTarget`: Space là phím kích hoạt chuẩn của `<button>` và
 * `<a role="button">` — chặn nó nghĩa là bàn phím không dùng được nữa. Nhưng
 * Space trên một `<div>` trống thì chỉ cuộn trang, và cướp nó là hợp lệ.
 */
export function isActivatableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (isTypingTarget(el)) return true;
  return Boolean(el.closest('button, a[href], summary, [role="button"], [tabindex]'));
}
