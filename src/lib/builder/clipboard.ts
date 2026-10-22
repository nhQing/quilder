/**
 * Chép chữ vào bộ nhớ tạm — chạy được cả khi builder mở bằng http thường.
 *
 * `navigator.clipboard` chỉ có ở "trang an toàn" (https, hoặc localhost). Builder nội bộ
 * mở bằng `http://192.168.1.10:3002` thì nó KHÔNG tồn tại, và mọi nút copy rơi vào nhánh
 * lỗi — đo được ngày 19/10/2026: "Copy link cho AI" chỉ hiện "Không copy tự động được".
 *
 * Nên: dùng Clipboard API khi có, không thì đường cũ — textarea ẩn + `execCommand('copy')`.
 * Đường cũ bị đánh dấu lỗi thời nhưng mọi trình duyệt vẫn chạy, kể cả ở http, miễn là
 * được gọi trong lúc người dùng vừa bấm/gõ (nó chạy ĐỒNG BỘ ở đây, trước mọi `await`).
 *
 * Ném lỗi khi cả hai đường đều không chép được — chỗ gọi giữ nguyên nhánh "chép tay".
 */
export async function copyText(text: string): Promise<void> {
  if (typeof window !== 'undefined' && window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Bị từ chối quyền (Safari riêng tư, iframe không có quyền) — thử đường cũ.
    }
  }
  if (!legacyCopy(text)) throw new Error('Trình duyệt không cho chép vào bộ nhớ tạm');
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // Trong khung nhìn (`fixed` ở góc) để trình duyệt không cuộn trang tới nó; trong suốt
  // và không nhận chuột để người dùng không thấy gì.
  Object.assign(area.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }

  area.remove();
  // Trả lại đúng chỗ người dùng đang đứng: vùng chọn cũ và ô đang focus.
  if (selection && range) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
  active?.focus?.({ preventScroll: true });
  return ok;
}
