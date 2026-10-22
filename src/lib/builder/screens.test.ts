import { describe, expect, it } from 'vitest';

import { DEFAULT_SCREENS, breakpointForWidth } from '@/lib/design/breakpoints';
import { defaultHeightFor, nextScreenId, normalizeScreens, readScreens } from './screens';

/**
 * Danh sách khổ màn đến từ `localStorage`, tức từ dữ liệu sống lâu hơn code đọc nó.
 * Mọi test dưới đây kiểm một đường mà rác đi vào và làm canvas TRỐNG mà không có lỗi.
 */

describe('breakpointForWidth', () => {
  it('năm khổ mặc định phủ đúng năm lớp style, một-đối-một', () => {
    // Đây là lý do chọn đúng bộ số 1920/1440/1024/768/320 làm mặc định. Nếu ai đó
    // đổi mặc định mà không kiểm lại điều này, sẽ có lớp style không khung nào chạm
    // tới — tức sửa được nhưng không xem được.
    expect(DEFAULT_SCREENS.map((s) => breakpointForWidth(s.width))).toEqual([
      'xl',
      'lg',
      'md',
      'sm',
      'base',
    ]);
  });

  it('lấy mốc LỚN NHẤT còn ≤ width, đúng như @media min-width', () => {
    expect(breakpointForWidth(1560)).toBe('xl');
    expect(breakpointForWidth(1559)).toBe('lg');
    expect(breakpointForWidth(1200)).toBe('lg');
    expect(breakpointForWidth(1023)).toBe('sm');
    expect(breakpointForWidth(768)).toBe('sm');
    expect(breakpointForWidth(767)).toBe('base');
    expect(breakpointForWidth(0)).toBe('base');
  });

  it('hai khổ khác nhau CÓ THỂ trỏ cùng một lớp', () => {
    // Không phải trùng lặp cần loại: 1920 và 1600 đều là xl, và người dùng vẫn muốn
    // xem cả hai.
    expect(breakpointForWidth(1920)).toBe(breakpointForWidth(1600));
  });
});

describe('normalizeScreens', () => {
  it('bỏ bề rộng 0 / NaN — đây là đường làm canvas trống mà không có lỗi', () => {
    const out = normalizeScreens([
      { id: 'a', width: 0, height: 800 },
      { id: 'b', width: Number.NaN, height: 800 },
      { id: 'c', width: 1440, height: 900 },
    ]);
    expect(out).toEqual([{ id: 'c', width: 1440, height: 900 }]);
  });

  it('bỏ bề rộng ngoài khoảng cho phép', () => {
    const out = normalizeScreens([
      { id: 'a', width: 10, height: 800 },
      { id: 'b', width: 99999, height: 800 },
      { id: 'c', width: 320, height: 568 },
    ]);
    expect(out.map((s) => s.width)).toEqual([320]);
  });

  it('bỏ id TRÙNG — id trùng làm React dựng lại sai iframe', () => {
    const out = normalizeScreens([
      { id: 'x', width: 1440, height: 900 },
      { id: 'x', width: 1024, height: 768 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.width).toBe(1440);
  });

  it('sắp GIẢM DẦN theo bề rộng, không giữ thứ tự nhập', () => {
    const out = normalizeScreens([
      { id: 'a', width: 320, height: 568 },
      { id: 'b', width: 1920, height: 1080 },
      { id: 'c', width: 768, height: 1024 },
    ]);
    expect(out.map((s) => s.width)).toEqual([1920, 768, 320]);
  });

  it('cắt ở 12 khổ', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`, width: 300 + i * 100, height: 800,
    }));
    expect(normalizeScreens(many)).toHaveLength(12);
  });

  it('rỗng, không phải mảng, hoặc bỏ hết → về MẶC ĐỊNH, không bao giờ rỗng', () => {
    // Mảng rỗng nghĩa là canvas không có khung nào để hiện — tức một màn trắng.
    expect(normalizeScreens([])).toEqual([...DEFAULT_SCREENS]);
    expect(normalizeScreens(null)).toEqual([...DEFAULT_SCREENS]);
    expect(normalizeScreens('1920')).toEqual([...DEFAULT_SCREENS]);
    expect(normalizeScreens([{ id: 'a', width: -1, height: -1 }])).toEqual([...DEFAULT_SCREENS]);
  });

  it('làm tròn px lẻ', () => {
    const out = normalizeScreens([{ id: 'a', width: 1439.6, height: 899.2 }]);
    expect(out[0]).toEqual({ id: 'a', width: 1440, height: 899 });
  });
});

describe('readScreens', () => {
  const store = (raw: string | null) => ({ getItem: () => raw });

  it('JSON hỏng → mặc định, không ném', () => {
    expect(readScreens(store('{khong-phai-json'))).toEqual([...DEFAULT_SCREENS]);
  });

  it('không có storage (server, hoặc chế độ riêng tư) → mặc định', () => {
    expect(readScreens(null)).toEqual([...DEFAULT_SCREENS]);
  });

  it('storage NÉM khi đọc → mặc định', () => {
    // Một số trình duyệt ném ngay ở bước đọc thuộc tính khi storage bị policy chặn.
    const throwing = { getItem: () => { throw new Error('bị chặn'); } };
    expect(readScreens(throwing)).toEqual([...DEFAULT_SCREENS]);
  });

  it('đọc được danh sách hợp lệ', () => {
    const saved = JSON.stringify([{ id: 'w800', width: 800, height: 1000 }]);
    expect(readScreens(store(saved))).toEqual([{ id: 'w800', width: 800, height: 1000 }]);
  });
});

describe('nextScreenId', () => {
  it('lấy theo bề rộng, và tránh trùng', () => {
    expect(nextScreenId([], 1280)).toBe('w1280');
    expect(nextScreenId([{ id: 'w1280', width: 1280, height: 900 }], 1280)).toBe('w1280-2');
    expect(
      nextScreenId(
        [
          { id: 'w1280', width: 1280, height: 900 },
          { id: 'w1280-2', width: 1280, height: 900 },
        ],
        1280,
      ),
    ).toBe('w1280-3');
  });
});

describe('defaultHeightFor', () => {
  it('khổ rộng thì ngang, khổ hẹp thì dọc', () => {
    expect(defaultHeightFor(1920)).toBe(1080);
    expect(defaultHeightFor(1440)).toBe(900);
    expect(defaultHeightFor(1024)).toBe(768);
    // 768 là iPad DỌC: cao hơn rộng. Trả 768 ở đây là biến tablet dọc thành vuông.
    expect(defaultHeightFor(768)).toBe(1024);
    expect(defaultHeightFor(320)).toBe(568);
  });
});
