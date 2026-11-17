import { describe, expect, it } from 'vitest';

import { dateLocaleOf, localizeHref, switchLocaleHref, switchLocaleOf, type LinkLocale } from './locale-href';

const en: LinkLocale = { code: 'en', isDefault: false, codes: ['vi', 'en'], defaultCode: 'vi' };
const vi: LinkLocale = { code: 'vi', isDefault: true, codes: ['vi', 'en'], defaultCode: 'vi' };

describe('localizeHref', () => {
  it('gắn tiền tố cho link nội bộ ở ngôn ngữ không mặc định', () => {
    expect(localizeHref('/blogs', en)).toBe('/en/blogs');
    expect(localizeHref('/blogs/post/lai-suat', en)).toBe('/en/blogs/post/lai-suat');
    expect(localizeHref('/', en)).toBe('/en');
    expect(localizeHref('/#chapters', en)).toBe('/en#chapters');
    expect(localizeHref('/events?place=ha-noi', en)).toBe('/en/events?place=ha-noi');
  });

  it('ngôn ngữ mặc định giữ nguyên', () => {
    expect(localizeHref('/blogs', vi)).toBe('/blogs');
    expect(localizeHref('/blogs', undefined)).toBe('/blogs');
  });

  it('không đụng link ngoài, hash, link đã có tiền tố, route hệ thống và file', () => {
    for (const href of [
      'https://maimoney.com/x', '//cdn.x/y', 'mailto:a@b.c', 'tel:123', '#top',
      '/en/blogs', '/en', '/vi/blogs', '/_next/image?x', '/api/forms/dang-ky-su-kien',
      '/files/bao-cao.pdf',
    ]) {
      expect(localizeHref(href, en)).toBe(href);
    }
  });

  it('không nhầm slug bắt đầu bằng mã ngôn ngữ', () => {
    expect(localizeHref('/english-class', en)).toBe('/en/english-class');
  });
});

describe('nút đổi ngôn ngữ', () => {
  it('nhận vai locale-<mã> đang bật', () => {
    expect(switchLocaleOf('locale-vi', en)).toBe('vi');
    expect(switchLocaleOf('nav-dark locale-en', en)).toBe('en');
    expect(switchLocaleOf('locale-fr', en)).toBeNull();
    expect(switchLocaleOf(undefined, en)).toBeNull();
  });

  it('trỏ tới bản của trang đang xem, rơi về trang chủ ngôn ngữ đó', () => {
    const here = { ...en, alternates: { vi: '/blogs', en: '/en/blogs' } };
    expect(switchLocaleHref('vi', here)).toBe('/blogs');
    expect(switchLocaleHref('en', here)).toBe('/en/blogs');
    expect(switchLocaleHref('vi', en)).toBe('/');
    expect(switchLocaleHref('en', en)).toBe('/en');
  });
});

it('định dạng ngày theo ngôn ngữ, mặc định vi-VN', () => {
  expect(dateLocaleOf(undefined)).toBe('vi-VN');
  expect(dateLocaleOf(vi)).toBe('vi-VN');
  expect(dateLocaleOf(en)).toBe('en');
});
