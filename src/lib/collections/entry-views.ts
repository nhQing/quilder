import 'server-only';

/**
 * Đếm lượt xem bài — gom lại rồi ghi một lượt, không ghi từng lượt.
 *
 * ## Vì sao không `UPDATE … SET viewCount = viewCount + 1` mỗi lượt xem
 *
 * Vì đó là MỘT lượt ghi DB cho MỖI lượt xem trang, và nó chỉ lộ ra khi có traffic
 * thật. Tệ hơn con số lượt ghi: mọi lượt xem cùng một bài đụng CÙNG một hàng, nên
 * Postgres xếp hàng chúng sau một row lock. Một bài đang lên trang chủ là chỗ
 * nghẽn, và bài càng được đọc thì nó càng chậm — đúng chiều ngược với mong muốn.
 *
 * Nên: cộng dồn trong bộ nhớ, và cứ `FLUSH_MS` mới ghi một lượt cho mỗi bài. Đúng
 * lý lẽ mà `ServiceToken.lastUsedAt` đã dùng (xem `service-token.ts`), chỉ khác ở
 * chỗ đây là phép CỘNG nên bỏ lỡ không được, phải gom chứ không được bỏ.
 *
 * ## Ba giới hạn, nói thẳng ra
 *
 * 1. **Mất một cửa sổ khi tiến trình chết.** Tối đa `FLUSH_MS` lượt xem của mỗi
 *    bài. Với một con số dùng để SẮP XẾP thì đó là sai số không đổi thứ hạng; với
 *    một con số để đối soát quảng cáo thì không chấp nhận được — và nó không phải
 *    con số đó.
 * 2. **Nhiều instance thì mỗi instance gom riêng.** Không sao: `increment` của
 *    Postgres là phép cộng nguyên tử, nên hai instance cùng ghi ra tổng đúng.
 *    Chỉ là số lượt ghi nhân lên theo số instance.
 * 3. **Một lần tải trang = một lượt.** Không chống bot, không khử trùng lặp theo
 *    người xem. Chống bot đúng nghĩa cần lưu trạng thái theo phiên, và nó thuộc
 *    một mốc khác. Điều DUY NHẤT ở đây làm nó đỡ tệ: lượt đếm đến từ một lời gọi
 *    của trình duyệt sau khi trang đã dựng, nên bot không chạy JS không được đếm.
 */

import { prisma } from '@/lib/db';

/**
 * Gom bao lâu trước khi ghi.
 *
 * 10 giây: đủ để một bài đang hot gộp hàng trăm lượt thành một `UPDATE`, và đủ
 * ngắn để bảng admin không hiện một con số cũ đến mức người biên tập tưởng hỏng.
 */
const FLUSH_MS = 10_000;

/**
 * Trần số bài đang chờ ghi. Chạm trần thì ghi ngay, không đợi hết giờ.
 *
 * Có trần vì `pending` là bộ nhớ tiến trình: một đợt crawl chạm 50.000 bài trong
 * một cửa sổ sẽ dựng một Map 50.000 khoá. Trần biến nó thành nhiều lượt ghi thay
 * vì một lượt phình bộ nhớ.
 */
const MAX_PENDING = 500;

/** entryId → số lượt chưa ghi. */
const pending = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;

/**
 * Đẩy phần đang gom xuống DB.
 *
 * Lấy `pending` ra NGAY ở dòng đầu rồi mới `await`: giữa lúc chờ vẫn có lượt xem
 * mới tới, và chúng phải rơi vào cửa sổ SAU chứ không bị `clear()` xoá mất.
 *
 * Một `update` cho mỗi bài, gói trong một transaction. Không gộp được thành một
 * câu vì mỗi bài cộng một số khác nhau; `$executeRaw` với `VALUES` làm được, đổi
 * lại mất kiểu của Prisma cho một vòng lặp vài chục phần tử.
 */
async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.size === 0) return;

  const batch = [...pending.entries()];
  pending.clear();

  try {
    await prisma.$transaction(
      batch.map(([id, n]) =>
        prisma.entry.update({ where: { id }, data: { viewCount: { increment: n } } }),
      ),
    );
  } catch {
    /*
     * Nuốt lỗi, và KHÔNG trả `batch` về `pending`.
     *
     * Ca hay gặp nhất là một bài vừa bị xoá giữa cửa sổ — `update` ném
     * `RecordNotFound`, và transaction rơi cả lô. Trả về `pending` thì lô ấy hỏng
     * mãi mãi, và mọi lượt xem sau đó chết theo nó. Mất một cửa sổ đếm là giá rẻ
     * hơn hẳn một hàng đợi tự đầu độc.
     */
  }
}

/**
 * Ghi nhận một lượt xem. KHÔNG `await` — nó không phải điều kiện của response nào.
 *
 * Cùng lý lẽ với `checkServiceToken`: đây là số liệu quan sát, và bắt người đọc
 * chờ nó ghi xong là trả độ trễ cho một thứ không ai đọc ngay.
 */
export function recordView(entryId: string): void {
  pending.set(entryId, (pending.get(entryId) ?? 0) + 1);

  if (pending.size >= MAX_PENDING) {
    void flush();
    return;
  }
  if (!timer) {
    timer = setTimeout(() => void flush(), FLUSH_MS);
    // `unref` để một tiến trình script không bị giữ sống chỉ vì còn một hẹn giờ đếm
    // lượt xem đang chờ.
    timer.unref?.();
  }
}

/** Ghi ngay phần đang gom. Cho test, và cho chỗ nào cần con số đúng tức thì. */
export const flushViews = flush;
