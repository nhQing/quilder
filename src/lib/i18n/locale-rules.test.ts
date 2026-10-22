import { describe, expect, it } from 'vitest';

import { checkLocaleCode, checkLocaleLabel, nativeLocaleName, slugsBlockingLocale } from './locale-rules';

describe('checkLocaleCode', () => {
  it('nhận mã hai–ba chữ và biến thể', () => {
    for (const c of ['ja', 'fil', 'zh-hant', 'pt-br']) expect(checkLocaleCode(c, ['vi', 'en']), c).toBeNull();
  });

  it('từ chối chữ hoa, dấu, khoảng trắng, mã quá dài', () => {
    for (const c of ['JA', 'j', 'japan', 'ja_JP', 'ja ', 'tiếng', 'ja-']) {
      expect(checkLocaleCode(c, []), c).toMatch(/Mã ngôn ngữ/);
    }
  });

  it('từ chối mã trùng đường dẫn hệ thống và mã đã có', () => {
    expect(checkLocaleCode('api', [])).toMatch(/đường dẫn hệ thống/);
    expect(checkLocaleCode('en', ['vi', 'en'])).toMatch(/đã có/);
  });
});

describe('checkLocaleLabel', () => {
  it('cần tên, không quá dài', () => {
    expect(checkLocaleLabel('日本語')).toBeNull();
    expect(checkLocaleLabel('  ')).toMatch(/Cần tên/);
    expect(checkLocaleLabel('x'.repeat(41))).toMatch(/tối đa/);
  });
});

describe('nativeLocaleName', () => {
  it('tên gốc của ngôn ngữ, viết hoa chữ đầu', () => {
    expect(nativeLocaleName('ja')).toBe('日本語');
    expect(nativeLocaleName('es')).toBe('Español');
    expect(nativeLocaleName('ms')).toBe('Melayu');
  });

  it('mã sai hoặc không ai biết: null', () => {
    expect(nativeLocaleName('JA')).toBeNull();
    expect(nativeLocaleName('qqq')).toBeNull();
  });
});

describe('slugsBlockingLocale', () => {
  it('chỉ trang có ĐOẠN ĐẦU trùng mã mới chặn', () => {
    expect(slugsBlockingLocale('ja', ['ja', 'ja/gioi-thieu', 'ja-guide', 'tin-tuc/ja', ''])).toEqual([
      'ja',
      'ja/gioi-thieu',
    ]);
  });
});
