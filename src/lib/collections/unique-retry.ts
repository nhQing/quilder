/**
 * Nhận diện lỗi "đụng ràng buộc unique" của Prisma, theo tên cột.
 *
 * ## Vì sao kiểm cả `meta.target`, không chỉ mã lỗi
 *
 * `P2002` chỉ nói "có một ràng buộc unique bị vi phạm", không nói ràng buộc nào.
 * Một bảng có hai ràng buộc unique thì chỉ kiểm mã sẽ nhầm cái này thành cái kia —
 * ta thử lại một cách vô nghĩa, rồi trả về một thông báo NÓI SAI CHUYỆN, và người
 * sửa đi tìm ở chỗ không có gì.
 *
 * Thuần, không `server-only`: nó chỉ đọc hình dạng của một object lỗi.
 */
export function isUniqueCollision(e: unknown, field: string): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { code?: unknown; meta?: { target?: unknown } };
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const names = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return names.some((n) => n.toLowerCase().includes(field.toLowerCase()));
}
