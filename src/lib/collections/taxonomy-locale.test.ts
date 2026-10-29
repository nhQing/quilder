import { describe, expect, it } from 'vitest';

import { setTaxonomyName, taxonomyName } from './taxonomy-locale';

describe('taxonomyName — tên danh mục theo ngôn ngữ đang phục vụ', () => {
  const t = { name: 'Đầu tư', i18n: { en: { name: 'Investing' } } };

  it('ngôn ngữ mặc định (locale undefined) đọc cột name', () => {
    expect(taxonomyName(t, undefined)).toBe('Đầu tư');
  });

  it('ngôn ngữ có bản dịch đọc bản dịch', () => {
    expect(taxonomyName(t, 'en')).toBe('Investing');
  });

  it('chưa dịch thì rơi về tên gốc — một tab danh mục trống chữ trông như lỗi', () => {
    expect(taxonomyName(t, 'ja')).toBe('Đầu tư');
    expect(taxonomyName({ name: 'Đầu tư', i18n: {} }, 'en')).toBe('Đầu tư');
  });

  it('i18n hỏng (không phải object, tên rỗng) cũng rơi về tên gốc', () => {
    expect(taxonomyName({ name: 'Đầu tư', i18n: null }, 'en')).toBe('Đầu tư');
    expect(taxonomyName({ name: 'Đầu tư', i18n: 'en' }, 'en')).toBe('Đầu tư');
    expect(taxonomyName({ name: 'Đầu tư', i18n: { en: { name: '  ' } } }, 'en')).toBe('Đầu tư');
    expect(taxonomyName({ name: 'Đầu tư', i18n: { en: 'Investing' } }, 'en')).toBe('Đầu tư');
  });

  it('hàng không chọn cột i18n (undefined) vẫn đọc được', () => {
    expect(taxonomyName({ name: 'Đầu tư' }, 'en')).toBe('Đầu tư');
  });
});

describe('setTaxonomyName — ghi một bản dịch vào i18n', () => {
  it('thêm bản dịch, giữ bản của ngôn ngữ khác', () => {
    expect(setTaxonomyName({ ja: { name: '投資' } }, 'en', 'Investing')).toEqual({
      ja: { name: '投資' },
      en: { name: 'Investing' },
    });
  });

  it('cắt khoảng trắng hai đầu', () => {
    expect(setTaxonomyName({}, 'en', '  Investing ')).toEqual({ en: { name: 'Investing' } });
  });

  it('null hoặc chuỗi rỗng là GỠ bản dịch — tab quay về tên gốc', () => {
    expect(setTaxonomyName({ en: { name: 'Investing' }, ja: { name: '投資' } }, 'en', null)).toEqual({
      ja: { name: '投資' },
    });
    expect(setTaxonomyName({ en: { name: 'Investing' } }, 'en', '   ')).toEqual({});
  });

  it('i18n cũ hỏng thì bắt đầu lại từ rỗng', () => {
    expect(setTaxonomyName('rác', 'en', 'Investing')).toEqual({ en: { name: 'Investing' } });
  });

  it('không sửa object đầu vào', () => {
    const before = { en: { name: 'Investing' } };
    setTaxonomyName(before, 'en', 'Funds');
    expect(before).toEqual({ en: { name: 'Investing' } });
  });
});
