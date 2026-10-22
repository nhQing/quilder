/**
 * Đo độ trễ của vòng sửa: lưu (POST /api/ops) và dựng lại canvas (iframe nạp xong).
 *
 * Lộ trình nâng cấp (D2) đặt điều kiện: chỉ làm "patch tạm lên canvas" khi SỐ ĐO cho
 * thấy cần. Trước 08/10/2026 không có số nào — "builder chậm" là cảm giác, không phải
 * dữ liệu. Giờ mỗi lần lưu ghi một mẫu, đọc được ngay trong console của builder:
 *
 *   __mmTiming.summary()   // { save: { n, p50, p95 }, canvas: { n, p50, p95 } }
 *
 * Giữ 50 mẫu gần nhất mỗi loại, chỉ trong bộ nhớ của tab. Không gửi đi đâu.
 */

const MAX_SAMPLES = 50;

export type TimingKind = 'save' | 'canvas';

interface Stats {
  n: number;
  p50: number | null;
  p95: number | null;
}

interface TimingStore {
  save: number[];
  canvas: number[];
  summary: () => Record<TimingKind, Stats>;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)]!;
}

export function stats(samples: readonly number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

function store(): TimingStore | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __mmTiming?: TimingStore };
  if (!w.__mmTiming) {
    const t: TimingStore = {
      save: [],
      canvas: [],
      summary: () => ({ save: stats(t.save), canvas: stats(t.canvas) }),
    };
    w.__mmTiming = t;
  }
  return w.__mmTiming;
}

export function recordTiming(kind: TimingKind, ms: number): void {
  const t = store();
  if (!t || !Number.isFinite(ms)) return;
  t[kind].push(Math.round(ms));
  if (t[kind].length > MAX_SAMPLES) t[kind].shift();
}
