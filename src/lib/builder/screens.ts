/**
 * Danh sách khổ màn giả lập của người dùng: kiểm, chuẩn hoá, lưu.
 *
 * ## Vì sao lưu ở `localStorage` chứ không ở database
 *
 * Danh sách khổ là **lựa chọn giao diện**, không phải nội dung site. Nó không đi
 * vào `Doc`, không đi vào `Release`, và không ảnh hưởng một byte nào của thứ được
 * publish — xem `Screen` trong `src/lib/design/breakpoints.ts`. Đưa nó vào DB là
 * thêm một trường phải migrate, phải snapshot, phải nghĩ xem có thuộc release
 * không; đổi lại chẳng được gì ngoài việc đồng bộ giữa hai máy.
 *
 * Cái giá phải chấp nhận và nói rõ: đổi máy hoặc xoá dữ liệu trình duyệt thì danh
 * sách về mặc định.
 *
 * ## Vì sao kiểm gắt thứ đọc ra
 *
 * Cùng lý lẽ như `persisted.ts`: giá trị trong `localStorage` sống lâu hơn code
 * đọc nó. Ở đây rủi ro cụ thể hơn — một bề rộng `0` hoặc `NaN` lọt vào sẽ làm
 * iframe rộng 0px, và triệu chứng là "canvas trống", không có lỗi nào để lần.
 * Nên mọi phần tử không hợp lệ bị BỎ, và nếu bỏ hết thì rơi về mặc định.
 */

import {
  DEFAULT_SCREENS,
  MAX_SCREEN_WIDTH,
  MIN_SCREEN_WIDTH,
  type Screen,
} from '@/lib/design/breakpoints';
import { safeStorage, write } from './persisted';

export const SCREENS_STORAGE_KEY = 'mm.builder.canvas.screens';

/** Tối đa 12 khổ. Không phải giới hạn kỹ thuật — quá số này thì thanh nút vô dụng. */
export const MAX_SCREENS = 12;

/** Chiều cao mặc định khi người dùng thêm một khổ mới, theo bề rộng. */
export function defaultHeightFor(width: number): number {
  // Xấp xỉ tỉ lệ thiết bị thật: khổ rộng thì ngang (16:9→16:10), khổ hẹp thì dọc.
  if (width >= 1600) return 1080;
  if (width >= 1200) return 900;
  if (width >= 900) return 768;
  if (width >= 600) return 1024;
  return 568;
}

function isValid(value: unknown): value is Screen {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    s.id.length > 0 &&
    s.id.length <= 40 &&
    Number.isFinite(s.width) &&
    typeof s.width === 'number' &&
    s.width >= MIN_SCREEN_WIDTH &&
    s.width <= MAX_SCREEN_WIDTH &&
    Number.isFinite(s.height) &&
    typeof s.height === 'number' &&
    s.height >= 200 &&
    s.height <= 4000
  );
}

/**
 * Chuẩn hoá một danh sách bất kỳ thành danh sách dùng được.
 *
 * Bỏ phần tử sai, bỏ id trùng, sắp giảm dần theo bề rộng, cắt ở `MAX_SCREENS`, và
 * trả mặc định nếu không còn gì.
 *
 * Sắp giảm dần chứ không giữ thứ tự người dùng nhập: thanh nút đọc được là thanh
 * đi từ rộng tới hẹp, và người ta dựng desktop trước rồi thu nhỏ dần. Đây cũng là
 * lý do không có tính năng "kéo để đổi thứ tự" — thứ tự là hàm của bề rộng.
 */
export function normalizeScreens(input: unknown): Screen[] {
  if (!Array.isArray(input)) return [...DEFAULT_SCREENS];

  const seen = new Set<string>();
  const out: Screen[] = [];
  for (const item of input) {
    if (!isValid(item)) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, width: Math.round(item.width), height: Math.round(item.height) });
  }

  if (!out.length) return [...DEFAULT_SCREENS];
  out.sort((a, b) => b.width - a.width);
  return out.slice(0, MAX_SCREENS);
}

/** Id mới, không trùng với `existing`. */
export function nextScreenId(existing: readonly Screen[], width: number): string {
  const base = `w${Math.round(width)}`;
  if (!existing.some((s) => s.id === base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!existing.some((s) => s.id === candidate)) return candidate;
  }
}

/**
 * Đọc danh sách đã lưu. KHÔNG BAO GIỜ ném, và không bao giờ trả mảng rỗng.
 *
 * Nhận `Storage | null` để test được ở môi trường `node` — vitest của dự án này
 * không có jsdom. Cùng lý lẽ với `persisted.ts`.
 */
export function readScreens(store: Pick<Storage, 'getItem'> | null = safeStorage()): Screen[] {
  if (!store) return [...DEFAULT_SCREENS];
  let raw: string | null;
  try {
    raw = store.getItem(SCREENS_STORAGE_KEY);
  } catch {
    return [...DEFAULT_SCREENS];
  }
  if (!raw) return [...DEFAULT_SCREENS];
  try {
    return normalizeScreens(JSON.parse(raw));
  } catch {
    // JSON hỏng — người dùng hoặc extension ghi tay vào.
    return [...DEFAULT_SCREENS];
  }
}

export function writeScreens(screens: readonly Screen[]): void {
  write(safeStorage(), SCREENS_STORAGE_KEY, JSON.stringify(screens));
}
