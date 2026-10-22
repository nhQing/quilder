import { describe, expect, it } from 'vitest';

/**
 * Sinh key và tên cho component.
 *
 * Tính chất chịu lực: **không bao giờ trả về một key đã bị dùng.** `key` là thứ
 * `scripts/extract-presets.ts` upsert theo, nên hai component cùng key nghĩa là
 * lần trích xuất sau ghi đè cái này bằng cái kia — mất hẳn một component mà
 * không có lỗi nào báo ra.
 */

import { copyName, slugify, uniqueKey } from './preset-key';

describe('slugify', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(slugify('Tiêu đề + mô tả')).toBe('tieu-de-mo-ta');
    expect(slugify('Nút CTA')).toBe('nut-cta');
    expect(slugify('Đăng ký')).toBe('dang-ky');
  });

  it('gộp ký tự lạ thành một gạch, không để gạch ở hai đầu', () => {
    expect(slugify('  Header — 2024!!  ')).toBe('header-2024');
    expect(slugify('a///b')).toBe('a-b');
  });

  it('chuỗi không còn ký tự nào thì về "component"', () => {
    // Key rỗng sẽ đụng nhau ngay lần thứ hai, và hậu tố số sẽ biến nó thành một
    // dãy vô nghĩa.
    expect(slugify('!!!')).toBe('component');
    expect(slugify('')).toBe('component');
    expect(slugify('   ')).toBe('component');
  });

  it('cắt ở 48 ký tự', () => {
    expect(slugify('a'.repeat(200)).length).toBe(48);
  });
});

describe('uniqueKey', () => {
  it('chưa bị dùng thì giữ nguyên', () => {
    expect(uniqueKey('Header', new Set())).toBe('header');
  });

  it('đụng thì thêm số, BẮT ĐẦU TỪ 2', () => {
    // `-1` gợi ý rằng có một bản `-0`, mà không có.
    expect(uniqueKey('Header', new Set(['header']))).toBe('header-2');
    expect(uniqueKey('Header', new Set(['header', 'header-2']))).toBe('header-3');
  });

  it('nhảy qua khoảng trống, không lấp lỗ', () => {
    // Lấp lỗ nghĩa là key của một component vừa xoá bị tái dùng, và lịch sử audit
    // trỏ vào hai thứ khác nhau dưới cùng một tên.
    expect(uniqueKey('Header', new Set(['header', 'header-3']))).toBe('header-2');
  });

  it('kết quả LUÔN chưa bị dùng, thử 50 lần liên tiếp', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const key = uniqueKey('Nút CTA', taken);
      expect(taken.has(key)).toBe(false);
      taken.add(key);
    }
    expect(taken.size).toBe(50);
  });
});

describe('copyName', () => {
  it('thêm hậu tố bản sao', () => {
    expect(copyName('Header', new Set())).toBe('Header (bản sao)');
  });

  it('KHÔNG lồng hậu tố', () => {
    // "Header (bản sao) (bản sao)" đọc ra vô nghĩa từ lần thứ hai.
    expect(copyName('Header (bản sao)', new Set(['Header (bản sao)'])))
      .toBe('Header (bản sao 2)');
    expect(copyName('Header (bản sao 2)', new Set(['Header (bản sao)', 'Header (bản sao 2)'])))
      .toBe('Header (bản sao 3)');
  });

  it('nhân bản liên tiếp không bao giờ trùng tên', () => {
    const taken = new Set(['Header']);
    let name = 'Header';
    for (let i = 0; i < 10; i += 1) {
      name = copyName(name, taken);
      expect(taken.has(name)).toBe(false);
      taken.add(name);
    }
  });
});
