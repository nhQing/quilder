import { describe, expect, it } from 'vitest';

/**
 * Số học của carousel.
 *
 * Tính chất chịu lực: một mũi tên sáng phải LUÔN đi được đâu đó. Mũi tên sáng mà
 * bấm không làm gì là loại lỗi không giải thích nổi cho người dùng, và nó xuất
 * hiện ngay khi so sánh mép bằng dấu bằng chính xác — offset cuộn thôi là số
 * nguyên ngay khi layout tính theo phần trăm.
 */

import { arrowState, atEnd, END_EPSILON } from './carousel-model';

describe('arrowState', () => {
  it('ở đầu dải thì chỉ mũi tên tiến sáng', () => {
    expect(arrowState({ scrollLeft: 0, scrollWidth: 1200, clientWidth: 400 })).toEqual({
      prevDisabled: true,
      nextDisabled: false,
    });
  });

  it('ở giữa thì cả hai sáng', () => {
    expect(arrowState({ scrollLeft: 400, scrollWidth: 1200, clientWidth: 400 })).toEqual({
      prevDisabled: false,
      nextDisabled: false,
    });
  });

  it('ở cuối thì chỉ mũi tên lùi sáng', () => {
    expect(arrowState({ scrollLeft: 800, scrollWidth: 1200, clientWidth: 400 })).toEqual({
      prevDisabled: false,
      nextDisabled: true,
    });
  });

  it('không tràn thì KHOÁ CẢ HAI', () => {
    // Section 8 ở khổ 1280 nằm đúng đây: ba thẻ trong khung ba thẻ. Để mũi tên
    // sáng ở trạng thái này là hai cú bấm không làm gì.
    expect(arrowState({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({
      prevDisabled: true,
      nextDisabled: true,
    });
  });

  it('tràn dưới ngưỡng epsilon cũng tính là không tràn', () => {
    // 1.5px tràn là sai số layout, không phải chỗ để cuộn tới.
    expect(arrowState({ scrollLeft: 0, scrollWidth: 401.5, clientWidth: 400 }))
      .toEqual({ prevDisabled: true, nextDisabled: true });
  });

  it('offset lẻ ở cuối vẫn khoá được mũi tên tiến', () => {
    // Thẻ section 8 rộng 410.66px nên `scrollLeft === max` không bao giờ đúng.
    // Không có epsilon thì mũi tên cuối sáng vĩnh viễn.
    expect(arrowState({ scrollLeft: 799.34, scrollWidth: 1200, clientWidth: 400 }).nextDisabled)
      .toBe(true);
  });

  it('chiều phải-sang-trái báo offset âm, vẫn tính đúng', () => {
    // Trình duyệt báo 0 ở đầu rồi đếm âm dần. "Đầu" là nơi chiều đọc bắt đầu.
    expect(arrowState({ scrollLeft: -800, scrollWidth: 1200, clientWidth: 400 })).toEqual({
      prevDisabled: false,
      nextDisabled: true,
    });
    expect(arrowState({ scrollLeft: -400, scrollWidth: 1200, clientWidth: 400 })).toEqual({
      prevDisabled: false,
      nextDisabled: false,
    });
  });
});

describe('atEnd', () => {
  it('true ở cuối và khi không có gì để cuộn', () => {
    expect(atEnd({ scrollLeft: 800, scrollWidth: 1200, clientWidth: 400 })).toBe(true);
    expect(atEnd({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toBe(true);
  });

  it('false ở đầu và ở giữa khi còn chỗ', () => {
    expect(atEnd({ scrollLeft: 0, scrollWidth: 1200, clientWidth: 400 })).toBe(false);
    expect(atEnd({ scrollLeft: 400, scrollWidth: 1200, clientWidth: 400 })).toBe(false);
  });

  it('nhất quán với arrowState.nextDisabled', () => {
    // Hai hàm trả lời hai câu khác nhau nhưng ở cuối dải chúng phải đồng ý —
    // lệch nhau nghĩa là autoplay cuốn về đầu trong khi mũi tên vẫn sáng.
    for (const scrollLeft of [0, 100, 500, 797, 799, 800]) {
      const m = { scrollLeft, scrollWidth: 1200, clientWidth: 400 };
      expect(atEnd(m)).toBe(arrowState(m).nextDisabled);
    }
  });
});

describe('END_EPSILON', () => {
  it('đủ lớn cho sai số layout, đủ nhỏ để không bỏ mất một thẻ', () => {
    expect(END_EPSILON).toBeGreaterThan(1);
    expect(END_EPSILON).toBeLessThan(10);
  });
});
