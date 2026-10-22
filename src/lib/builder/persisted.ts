/**
 * Đọc/ghi lựa chọn giao diện vào `localStorage`, có KIỂM giá trị đọc ra.
 *
 * ## Vì sao phải kiểm chứ không tin những gì đã lưu
 *
 * Giá trị trong `localStorage` sống lâu hơn code đọc nó. Ba đường nó thành rác:
 *
 *   - đổi tên một mục (`'pages'` → `'routes'`) thì bản cũ vẫn nằm đó
 *   - mục còn tên nhưng KHÔNG còn hợp lệ trong ngữ cảnh này — pane trái ở chế độ
 *     sửa component chỉ có mục Lớp, mà người dùng có thể đã lưu `'pages'`
 *   - người dùng, hoặc một extension, ghi tay vào đó
 *
 * Tin giá trị đã lưu thì accordion mở ra một mục không tồn tại: pane trống, không
 * lỗi, không cách nào đoán ra vì sao. Nên `readEnum` nhận tập hợp lệ và trả
 * `null` khi không khớp — bên gọi rơi về mặc định của chính nó.
 *
 * ## Vì sao nhận `Storage | null` thay vì gọi thẳng `localStorage`
 *
 * Trên server không có `localStorage`, và ở chế độ riêng tư của một số trình
 * duyệt thì chỉ ĐỌC thuộc tính đó cũng ném lỗi. Truyền vào làm hàm thuần và test
 * được ở môi trường `node` — vitest của dự án này không có jsdom.
 */

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** `localStorage` nếu có, `null` nếu không — không bao giờ ném. */
export function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Chế độ riêng tư / storage bị chặn bởi policy.
    return null;
  }
}

/** Giá trị đã lưu, chỉ khi nó còn nằm trong `allowed`. */
export function readEnum<T extends string>(
  store: Reader | null,
  key: string,
  allowed: readonly T[],
): T | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** Cờ boolean đã lưu. Chỉ `'1'`/`'0'` là hợp lệ — mọi thứ khác là rác. */
export function readFlag(store: Reader | null, key: string): boolean | null {
  const v = readEnum(store, key, ['1', '0'] as const);
  return v === null ? null : v === '1';
}

/** Ghi, im lặng bỏ qua khi storage đầy hoặc bị chặn. */
export function write(store: Writer | null, key: string, value: string): void {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // Quota vượt hoặc storage bị chặn — một lựa chọn giao diện không lưu được
    // thì không đáng làm gãy cả pane.
  }
}

/** Khoá dùng chung, gom một chỗ để khỏi lệch chính tả giữa các file. */
export const STORAGE_KEYS = {
  leftSection: 'mm.builder.left.section',
  leftCollapsed: 'mm.builder.left.collapsed',
  /** Canvas "Toàn trang": khung cao bằng nội dung. Xem `freeze-viewport.ts`. */
  canvasFullPage: 'mm.builder.canvas.fullPage',
  /** Bề rộng Inspector (px) sau khi kéo tay. Vắng = mặc định `--shell-right`. Xem `pane-width.ts`. */
  rightWidth: 'mm.builder.right.width',
} as const;

/**
 * Số nguyên trong khoảng `[min, max]`, hoặc `null` (vắng, rác, ngoài khoảng).
 *
 * Ngoài khoảng là `null` chứ không kẹp: một giá trị lạ trong storage (sửa tay, bản cũ có
 * khoảng khác) thì về mặc định là an toàn hơn đoán xem người ta muốn gì.
 */
export function readInt(store: Reader | null, key: string, min: number, max: number): number | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

export function remove(store: Pick<Storage, 'removeItem'> | null, key: string): void {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // Như `write`.
  }
}
