/**
 * Phần số học của carousel — không DOM, không import.
 *
 * Tách ra vì đây là phần duy nhất đáng test, và test được mà không cần jsdom.
 * Cùng lối chia như `savings-model` / `savings-calculator` ở site cũ.
 *
 * Port từ ../new-website/js/effects/carousel-model.js.
 */

/**
 * Gần mép bao nhiêu thì tính là đã tới mép.
 *
 * Offset cuộn thôi là số nguyên ngay khi layout tính theo phần trăm — card của
 * section 8 rộng 410.66px — nên `scrollLeft === max` không bao giờ đúng, và so
 * sánh chính xác sẽ để mũi tên cuối sáng vĩnh viễn.
 */
export const END_EPSILON = 2;

export interface ScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export interface ArrowState {
  prevDisabled: boolean;
  nextDisabled: boolean;
}

/**
 * Mũi tên nào còn chỗ để đi.
 *
 * `scrollLeft` chuẩn hoá bằng `Math.abs` cho chiều phải-sang-trái, nơi trình
 * duyệt báo 0 ở đầu rồi đếm âm dần khi dải tiến. Dải là một danh sách, nên
 * "đầu" là nơi chiều đọc bắt đầu — không phải luôn là bên trái.
 */
export function arrowState({ scrollLeft, scrollWidth, clientWidth }: ScrollMetrics): ArrowState {
  const max = scrollWidth - clientWidth;
  const x = Math.abs(scrollLeft);

  // Không tràn thì hai mép là cùng một chỗ. Section 8 ở khổ 1280 nằm đúng đây:
  // ba card trong khung ba card. Tràn dưới một pixel cũng rơi vào nhánh này, và
  // đó là điểm chính — một mũi tên sáng mà không đi đâu được là một cú bấm không
  // làm gì và không giải thích được.
  if (max <= END_EPSILON) return { prevDisabled: true, nextDisabled: true };

  return {
    prevDisabled: x <= END_EPSILON,
    nextDisabled: x >= max - END_EPSILON,
  };
}

/** Đã ở cuối dải chưa — autoplay dùng để quyết định cuốn về đầu. */
export function atEnd({ scrollLeft, scrollWidth, clientWidth }: ScrollMetrics): boolean {
  const max = scrollWidth - clientWidth;
  if (max <= END_EPSILON) return true;
  return Math.abs(scrollLeft) >= max - END_EPSILON;
}
