/**
 * Tiến độ và thời gian còn lại của xuất trang — THUẦN, chạy ở trình duyệt.
 *
 * ## Vì sao tính theo byte CỘNG phí mỗi file
 *
 * Đếm theo file thì một video 9 MB và một icon 2 KB nặng như nhau: thanh đứng im ở 98% suốt
 * phút cuối. Đếm thuần theo byte thì một trang 400 khung hình nhỏ (mỗi lượt đọc tốn một vòng
 * mạng tới kho) chạy chậm hơn hẳn con số MB gợi ý. Mỗi file được tính thêm `FILE_OVERHEAD`
 * byte "ảo" cho vòng mạng đó — đủ để cả hai kiểu trang cho thanh chạy đều.
 *
 * ## Vì sao ETA chỉ hiện sau một lúc
 *
 * Vài file đầu cho tốc độ rất nhiễu (kết nối kho đang mở, cache lạnh). Hiện một con số nhảy từ
 * "còn 3 giây" sang "còn 4 phút" tệ hơn là chưa hiện gì, nên đợi `ETA_MIN_MS` và `ETA_MIN_FRACTION`.
 */

export const FILE_OVERHEAD = 64 * 1024;
export const ETA_MIN_MS = 1500;
export const ETA_MIN_FRACTION = 0.05;

export interface WorkCount {
  files: number;
  bytes: number;
}

/** Phần đã xong, 0..1. Không có việc gì thì coi như xong. */
export function fractionDone(done: WorkCount, total: WorkCount): number {
  const all = total.bytes + total.files * FILE_OVERHEAD;
  if (all <= 0) return 1;
  const got = Math.min(done.bytes, total.bytes) + Math.min(done.files, total.files) * FILE_OVERHEAD;
  return Math.max(0, Math.min(1, got / all));
}

/** Phần trăm để HIỂN THỊ: chưa xong thật thì không bao giờ ghi 100%. */
export function percentLabel(fraction: number, finished = false): number {
  if (finished) return 100;
  return Math.min(99, Math.floor(fraction * 100));
}

/** Mili-giây còn lại, hoặc null khi chưa đủ dữ liệu để ước tính tử tế. */
export function etaMs(fraction: number, elapsedMs: number): number | null {
  if (fraction >= 1) return 0;
  if (elapsedMs < ETA_MIN_MS || fraction < ETA_MIN_FRACTION) return null;
  return (elapsedMs * (1 - fraction)) / fraction;
}

/** "còn khoảng 40 giây" / "còn khoảng 3 phút" / "sắp xong". */
export function formatEta(ms: number | null): string {
  if (ms === null) return 'đang ước tính thời gian…';
  const s = Math.ceil(ms / 1000);
  if (s <= 3) return 'sắp xong';
  if (s < 60) return `còn khoảng ${Math.ceil(s / 5) * 5} giây`;
  const m = Math.round(s / 60);
  if (m < 60) return `còn khoảng ${m} phút`;
  const h = Math.floor(m / 60);
  return `còn khoảng ${h} giờ ${m % 60} phút`;
}

/** Một dòng trong stream NDJSON của `export/check`. */
export type CheckEvent =
  | { type: 'progress'; done: WorkCount; total: WorkCount }
  | { type: 'result'; status: number; body: unknown };

/** Tách buffer NDJSON thành các dòng đầy đủ; phần dở dang trả lại để ghép với chunk sau. */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts.filter((l) => l.trim().length > 0), rest };
}
