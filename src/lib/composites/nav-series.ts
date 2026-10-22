/**
 * Chuỗi NAV — hợp đồng dữ liệu, lọc theo mốc, và hình học của đường vẽ.
 *
 * Hàm thuần: không DOM, không fetch, không React. Cùng lý do như
 * `savings-model.ts` — đây là chỗ dễ sai nhất của cả composite (một mốc lọc lệch
 * một ngày, một trục y chia cho 0), và nó phải test được mà không dựng gì.
 *
 * ## Hợp đồng với backend, và vì sao nó HẸP
 *
 * BE trả về **toàn bộ** chuỗi một lần; đổi mốc 1y/3y/5y/all là phép lọc ở client.
 * Hai hệ quả, cả hai đều muốn:
 *
 *  - **Một lần fetch cho cả bốn mốc.** Bấm đổi mốc không gọi mạng, nên nó tức thì
 *    và không có trạng thái loading nào phải thiết kế.
 *  - **SSR ra số thật.** Tầng trang fetch trước khi render (xem `nav-fetch.ts`),
 *    nên HTML đầu tiên đã có đường vẽ và bảng số của mốc mặc định.
 *
 * Schema là `.strict()` ở từng điểm: một field lạ nghĩa là hợp đồng đã đổi, và
 * biết ngay còn hơn vẽ một đường im lặng thiếu dữ liệu.
 */

import { z } from 'zod';

/** Mốc thời gian mà biểu đồ bày ra. `all` là toàn bộ chuỗi BE trả về. */
export const NAV_RANGES = ['1y', '3y', '5y', 'all'] as const;
export type NavRange = (typeof NAV_RANGES)[number];

export const NAV_RANGE_LABEL: Record<NavRange, string> = {
  '1y': '1 năm',
  '3y': '3 năm',
  '5y': '5 năm',
  all: 'Từ đầu',
};

/** Số năm mà mỗi mốc lùi lại. `all` không lùi. */
const RANGE_YEARS: Record<Exclude<NavRange, 'all'>, number> = { '1y': 1, '3y': 3, '5y': 5 };

/**
 * Một điểm NAV.
 *
 * `date` là chuỗi `YYYY-MM-DD`, KHÔNG phải `Date`: JSON không có kiểu ngày, và
 * `new Date('2026-09-07')` với `new Date('2026-9-7')` cho hai kết quả khác nhau ở
 * các múi giờ khác nhau. Giữ nguyên chuỗi ISO thì so sánh là so chuỗi — đúng theo
 * thứ tự thời gian, và không có múi giờ nào tham gia.
 */
export const zNavPoint = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date phải là YYYY-MM-DD'),
    nav: z.number().finite().nonnegative(),
  })
  .strict();

export type NavPoint = z.infer<typeof zNavPoint>;

/**
 * Payload mà endpoint NAV phải trả về.
 *
 * `points` có thể rỗng — một quỹ mới chưa có lịch sử là trạng thái thật, không
 * phải lỗi. Composite render khung kèm một dòng nói chưa có dữ liệu.
 */
export const zNavPayload = z
  .object({
    points: z.array(zNavPoint).max(10000),
    /** Đơn vị hiện cạnh số. Mặc định VND vì đây là quỹ trong nước. */
    currency: z.string().min(1).max(8).default('VND'),
  })
  .strict();

export type NavPayload = z.infer<typeof zNavPayload>;

/**
 * Sắp theo ngày tăng dần và bỏ ngày trùng.
 *
 * BE không hứa thứ tự, và một chuỗi không sắp sẽ vẽ ra đường zigzag đi ngược —
 * trông như dữ liệu hỏng chứ không như một lỗi sắp xếp. Ngày trùng thì giữ điểm
 * SAU: với dữ liệu tài chính, bản ghi sau là bản đã điều chỉnh.
 */
export function normalizePoints(points: NavPoint[]): NavPoint[] {
  const byDate = new Map<string, NavPoint>();
  for (const p of points) byDate.set(p.date, p);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Lọc theo mốc, tính từ điểm CUỐI CÙNG trong chuỗi.
 *
 * Không tính từ hôm nay: nếu BE ngừng cập nhật ba tháng thì mốc "1 năm" tính từ
 * hôm nay sẽ cắt mất ba tháng đầu và biểu đồ lặng lẽ ngắn đi. Tính từ điểm cuối
 * thì "1 năm" luôn là 12 tháng dữ liệu gần nhất mà ta THẬT SỰ có.
 *
 * Trừ năm trên chuỗi ISO chứ không qua `Date`: `2024-02-29` lùi 1 năm thành
 * `2023-02-29` — một ngày không tồn tại, nhưng dùng làm mốc SO SÁNH CHUỖI thì nó
 * đúng (mọi ngày thật của tháng 2/2023 đều nhỏ hơn nó, mọi ngày từ 1/3 trở đi đều
 * lớn hơn). Đi qua `Date` thì nó nhảy sang `2023-03-01` và mất một ngày.
 */
export function pointsInRange(points: NavPoint[], range: NavRange): NavPoint[] {
  if (range === 'all' || points.length === 0) return points;

  const last = points[points.length - 1]!.date;
  const year = Number(last.slice(0, 4)) - RANGE_YEARS[range];
  const from = `${String(year).padStart(4, '0')}${last.slice(4)}`;

  return points.filter((p) => p.date >= from);
}

export interface NavGeometry {
  /** `points` của `<polyline>`, hệ toạ độ 0…100 trên cả hai trục. */
  polyline: string;
  min: number;
  max: number;
  first: NavPoint | null;
  last: NavPoint | null;
  /** Thay đổi từ điểm đầu đến điểm cuối, phần trăm. `null` khi không tính được. */
  changePct: number | null;
}

/**
 * Chuỗi → hình học của đường vẽ, trong hệ toạ độ 0…100.
 *
 * ## Vì sao SVG chứ không cột như `SavingsSimulator`
 *
 * Simulator vẽ 30 cột bằng node + CSS, và lý do là nó *có* 30 cột. NAV là một
 * ĐƯỜNG qua hàng trăm điểm; biểu diễn nó bằng div là hàng trăm element cho một
 * hình. `<polyline>` là markup, không phải thư viện: nó SSR được, crawler đọc
 * được, và `stroke="currentColor"` ăn token màu — ba tính chất đã khiến
 * `SavingsSimulator` từ chối `<canvas>`.
 *
 * Số thật vẫn đi kèm dưới dạng bảng, cùng lý do đó.
 *
 * ## Vì sao viewBox 0…100 chứ không px
 *
 * `preserveAspectRatio="none"` + viewBox cố định nghĩa là SVG giãn theo ô chứa mà
 * không cần biết bề rộng thật — tức không cần đo DOM, tức tính được ở server.
 *
 * Chuỗi phẳng (`min === max`) vẽ ở GIỮA, không ở đáy: chia cho 0 cho ra `NaN` và
 * `<polyline points="NaN,NaN">` là một đường biến mất không lỗi.
 */
export function navGeometry(points: NavPoint[]): NavGeometry {
  if (points.length === 0) {
    return { polyline: '', min: 0, max: 0, first: null, last: null, changePct: null };
  }

  const values = points.map((p) => p.nav);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const polyline = points
    .map((p, i) => {
      // Một điểm duy nhất: đặt ở mép trái. `(len - 1)` là 0 nên phép chia phải
      // được chặn trước.
      const x = points.length === 1 ? 0 : (i / (points.length - 1)) * 100;
      // `100 - …` vì trục y của SVG hướng xuống, còn NAV cao là ở trên.
      const y = span === 0 ? 50 : 100 - ((p.nav - min) / span) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const changePct = first.nav === 0 ? null : ((last.nav - first.nav) / first.nav) * 100;

  return { polyline, min, max, first, last, changePct };
}

/** Mốc nào có đủ dữ liệu để bày ra. */
export function availableRanges(points: NavPoint[]): NavRange[] {
  if (points.length === 0) return ['all'];
  /*
   * Một mốc chỉ được bày khi nó CẮT bớt thật.
   *
   * Bày cả bốn nút khi chuỗi chỉ dài 6 tháng nghĩa là ba nút cho ra cùng một
   * hình, và người dùng bấm rồi tưởng biểu đồ hỏng. `all` luôn có mặt.
   */
  const out = NAV_RANGES.filter(
    (r) => r === 'all' || pointsInRange(points, r).length < points.length,
  );
  // Mốc hẹp nhất còn cắt được vẫn phải giữ, cộng `all`. Nếu không cắt được gì thì
  // chỉ còn `all` — đúng: chuỗi ngắn thì một hình là đủ.
  return out.length ? out : ['all'];
}
