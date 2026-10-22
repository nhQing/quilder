import 'server-only';

/**
 * Giới hạn tần suất, gáo token, trong bộ nhớ tiến trình.
 *
 * ## Vì sao trong bộ nhớ là đủ — và khi nào thì không
 *
 * Cả hệ thống chạy MỘT replica xuyên suốt Phase 1–5; đó là ràng buộc có chủ đích
 * đã ghi trong plan (cùng lý do khiến `revalidateTag` dùng được). Một bộ đếm
 * trong bộ nhớ là nhất quán chừng nào điều đó còn đúng.
 *
 * Ngày chạy nhiều replica, giới hạn này thành "N request mỗi replica" — nới lỏng
 * âm thầm chứ không hỏng ầm ĩ. Nên khi thêm replica, đây là một trong những thứ
 * phải chuyển sang Redis, cùng với cacheHandler.
 *
 * Không dùng thư viện: cần đúng một gáo token, và một dependency cho việc này là
 * thêm bề mặt để đổi lấy 20 dòng.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
  /** Cửa sổ của CHÍNH gáo này — các key dùng cửa sổ khác nhau (tool 1 phút, login 15 phút). */
  windowMs: number;
}

const buckets = new Map<string, Bucket>();

/** Dọn định kỳ để Map không phình theo số key đã từng thấy. */
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    // Gáo đã đầy lại từ lâu thì không mang thông tin gì nữa.
    //
    // Đo theo cửa sổ của từng gáo, không theo cửa sổ của lời gọi đang chạy: trước
    // 08/10/2026, một lời gọi tool (cửa sổ 1 phút) dọn luôn gáo login (15 phút)
    // mới cạn được vài phút — tức trả lại đủ lượt sớm hơn nhiều lần.
    if (now - bucket.updatedAt > bucket.windowMs * 2) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Số lượt còn lại sau lời gọi này. */
  remaining: number;
  /** Giây phải chờ, khi bị chặn. */
  retryAfter: number;
}

/**
 * @param key      Danh tính bị tính phí — dùng `jti` của token, không dùng IP.
 *                 IP sai ở cả hai chiều: nhiều người sau một NAT bị gộp, còn một
 *                 token lộ thì đổi IP là thoát.
 * @param limit    Số lượt trong một cửa sổ.
 * @param windowMs Độ dài cửa sổ.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now, windowMs };
  bucket.windowMs = windowMs;

  // Đổ lại liên tục theo thời gian trôi qua, không phải reset theo mốc cố định:
  // cửa sổ cố định cho phép dồn 2× limit quanh ranh giới hai cửa sổ.
  const refill = ((now - bucket.updatedAt) / windowMs) * limit;
  bucket.tokens = Math.min(limit, bucket.tokens + refill);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const retryAfter = Math.ceil(((1 - bucket.tokens) * windowMs) / limit / 1000);
    return { ok: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { ok: true, remaining: Math.floor(bucket.tokens), retryAfter: 0 };
}

/** Dùng trong test. */
/**
 * Hỏi gáo còn lượt không, KHÔNG tiêu lượt nào.
 *
 * Cho những chỗ chỉ tính phí khi thất bại — đăng nhập sai mật khẩu. Người gõ đúng
 * mật khẩu không được bị khoá vì đã đăng nhập nhiều lần trong ngày.
 */
export function peekRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket) return { ok: true, remaining: limit, retryAfter: 0 };
  const refill = ((Date.now() - bucket.updatedAt) / windowMs) * limit;
  const tokens = Math.min(limit, bucket.tokens + refill);
  if (tokens < 1) {
    const retryAfter = Math.ceil(((1 - tokens) * windowMs) / limit / 1000);
    return { ok: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
  }
  return { ok: true, remaining: Math.floor(tokens), retryAfter: 0 };
}

export function resetRateLimits(): void {
  buckets.clear();
}
