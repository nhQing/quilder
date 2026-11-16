import { describe, expect, it } from 'vitest';

import {
  filterValueFromHref,
  hrefWithFilter,
  itemVisible,
  normalizeFilterValue,
  resolveActive,
} from './filter-model';

describe('normalizeFilterValue', () => {
  it('bỏ dấu, đ → d, chữ thường, khoảng trắng thành -', () => {
    expect(normalizeFilterValue('Hà Nội')).toBe('ha-noi');
    expect(normalizeFilterValue('Ha-Noi')).toBe('ha-noi');
    expect(normalizeFilterValue('  Hồ Chí Minh ')).toBe('ho-chi-minh');
    expect(normalizeFilterValue('Đà Nẵng')).toBe('da-nang');
  });
  it('rỗng / null → chuỗi rỗng', () => {
    expect(normalizeFilterValue(null)).toBe('');
    expect(normalizeFilterValue('')).toBe('');
  });
});

describe('filterValueFromHref', () => {
  const base = 'https://maimoney.com/events';
  it('đọc tham số trong query của link', () => {
    expect(filterValueFromHref('/events?place=Ha-Noi', 'place', base)).toBe('ha-noi');
  });
  it('link không có tham số = bỏ lọc', () => {
    expect(filterValueFromHref('/events', 'place', base)).toBe('');
    expect(filterValueFromHref(null, 'place', base)).toBe('');
  });
});

describe('resolveActive', () => {
  it('giữ giá trị trên URL khi có lựa chọn trùng', () => {
    expect(resolveActive('ha-noi', ['', 'ha-noi', 'ho-chi-minh'])).toBe('ha-noi');
  });
  it('giá trị lạ → bỏ lọc thay vì lưới rỗng', () => {
    expect(resolveActive('da-nang', ['', 'ha-noi'])).toBe('');
  });
});

describe('itemVisible', () => {
  it('không lọc thì hiện tất cả', () => expect(itemVisible('', 'ha-noi')).toBe(true));
  it('lọc thì chỉ hiện mục trùng', () => {
    expect(itemVisible('ha-noi', 'ha-noi')).toBe(true);
    expect(itemVisible('ha-noi', 'ho-chi-minh')).toBe(false);
  });
  it('mục không mang giá trị luôn hiện', () => expect(itemVisible('ha-noi', '')).toBe(true));
});

describe('hrefWithFilter', () => {
  it('đặt và gỡ tham số, giữ tham số khác', () => {
    expect(hrefWithFilter('https://x.vn/events?locale=en', 'place', 'ha-noi')).toBe(
      '/events?locale=en&place=ha-noi',
    );
    expect(hrefWithFilter('https://x.vn/events?place=ha-noi', 'place', '')).toBe('/events');
  });
});
