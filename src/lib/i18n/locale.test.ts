import { describe, expect, it } from 'vitest';

/**
 * Tách ngôn ngữ khỏi đường dẫn.
 *
 * Tính chất chịu lực: KHÔNG bao giờ nuốt một đoạn slug thật thành mã ngôn ngữ.
 * Nhầm một lần là một trang 404 hoặc một trang phục vụ sai ngôn ngữ, và cả hai
 * đều khó lần vì URL trông vẫn đúng.
 */

import { localePath, splitLocale, type LocaleInfo } from './locale';

const vi: LocaleInfo = { code: 'vi', label: 'Tiếng Việt', isDefault: true };
const en: LocaleInfo = { code: 'en', label: 'English', isDefault: false };
const all = [vi, en];

describe('splitLocale', () => {
  it('không có tiền tố thì là ngôn ngữ mặc định', () => {
    expect(splitLocale([], all)).toEqual({ locale: vi, slug: '' });
    expect(splitLocale(['gioi-thieu'], all)).toEqual({ locale: vi, slug: 'gioi-thieu' });
  });

  it('tiền tố khớp thì tách ra', () => {
    expect(splitLocale(['en'], all)).toEqual({ locale: en, slug: '' });
    expect(splitLocale(['en', 'gioi-thieu'], all)).toEqual({ locale: en, slug: 'gioi-thieu' });
  });

  it('đường dẫn nhiều đoạn giữ nguyên phần còn lại', () => {
    expect(splitLocale(['en', 'tin-tuc', 'bai-1'], all))
      .toEqual({ locale: en, slug: 'tin-tuc/bai-1' });
  });

  it('KHÔNG nuốt đoạn slug chỉ vì nó bắt đầu bằng mã ngôn ngữ', () => {
    // `/english-guide` là một trang thật, không phải ngôn ngữ `en`.
    expect(splitLocale(['english-guide'], all))
      .toEqual({ locale: vi, slug: 'english-guide' });
  });

  it('tiền tố của NGÔN NGỮ MẶC ĐỊNH không được nhận', () => {
    // `/vi/gioi-thieu` không phải URL của site này. Nhận nó nghĩa là mỗi trang có
    // hai địa chỉ, và Google sẽ coi đó là nội dung trùng lặp.
    expect(splitLocale(['vi', 'gioi-thieu'], all))
      .toEqual({ locale: vi, slug: 'vi/gioi-thieu' });
  });

  it('mã ngôn ngữ không tồn tại được coi là slug', () => {
    expect(splitLocale(['de', 'x'], all)).toEqual({ locale: vi, slug: 'de/x' });
  });

  it('không có dòng isDefault thì lấy dòng đầu, không ném', () => {
    // Một hàng cấu hình sai không đáng làm mọi request trả 500.
    const broken = [{ code: 'en', label: 'English', isDefault: false }];
    expect(splitLocale(['x'], broken).locale.code).toBe('en');
  });

  it('danh sách rỗng vẫn trả về được gì đó', () => {
    expect(splitLocale(['x'], []).locale.code).toBe('vi');
  });
});

describe('localePath', () => {
  it('ngôn ngữ mặc định không có tiền tố', () => {
    expect(localePath(vi, '')).toBe('/');
    expect(localePath(vi, 'gioi-thieu')).toBe('/gioi-thieu');
  });

  it('ngôn ngữ thêm vào có tiền tố', () => {
    expect(localePath(en, '')).toBe('/en');
    expect(localePath(en, 'gioi-thieu')).toBe('/en/gioi-thieu');
  });

  it('vòng tròn: localePath → splitLocale trả lại đúng cặp ban đầu', () => {
    for (const locale of all) {
      for (const slug of ['', 'gioi-thieu', 'tin-tuc/bai-1']) {
        const path = localePath(locale, slug);
        const segments = path.split('/').filter(Boolean);
        expect(splitLocale(segments, all)).toEqual({ locale, slug });
      }
    }
  });
});
