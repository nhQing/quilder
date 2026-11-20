/**
 * "Màn Cấu trúc / Nhóm field còn thay đổi chưa lưu không" — và khi nào một cú bấm rời màn
 * phải hỏi trước. Thuần, để test được không cần DOM (vitest chạy `environment: 'node'`).
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Khoá so sánh của một trạng thái cấu trúc. Sắp khoá object trước khi chuỗi hoá: sửa một ô rồi
 * sửa lại như cũ có thể để lại object khác THỨ TỰ khoá (`{...f, ...patch}`), và hai object đó
 * phải được coi là một — không thì màn hỏi "bỏ thay đổi?" khi chẳng còn gì để bỏ.
 */
export function schemaKey(s: { fields: readonly unknown[]; titleField: string }): string {
  return JSON.stringify([s.fields, s.titleField], (_k, v: unknown) =>
    isObj(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

/**
 * Cú bấm vào link rời màn có cần hỏi trước không. Chỉ hỏi khi còn thay đổi chưa lưu VÀ cú bấm
 * thật sự rời màn này: Ctrl/Cmd/Shift/Alt + bấm hay chuột giữa mở tab/cửa sổ mới, màn đang sửa
 * vẫn còn nguyên — chặn chúng chỉ làm phiền.
 */
export function leaveNeedsConfirm(
  dirty: boolean,
  e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
): boolean {
  if (!dirty) return false;
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
