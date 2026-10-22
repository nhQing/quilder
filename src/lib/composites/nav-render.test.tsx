import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NavChart } from './NavChart';
import { parseCompositeParams } from './registry';
import type { NavChartParams } from './registry';
import type { NavPayload } from './nav-series';

/**
 * HTML mà `NavChart` phát ra ở SERVER.
 *
 * Hai tính chất chịu lực, và cả hai là lý do composite này không dùng `<canvas>`
 * hay chart lib: **số thật có trong HTML đầu tiên** (crawler và screen reader đọc
 * được), và **thiếu dữ liệu thì nói ra** thay vì hiện một khung rỗng.
 */

const params = (raw: unknown = {}) => parseCompositeParams('NavChart', raw) as NavChartParams;

const payload = (points: [string, number][]): NavPayload => ({
  points: points.map(([date, nav]) => ({ date, nav })),
  currency: 'VND',
});

const html = (data: NavPayload | null, raw: unknown = {}) =>
  renderToStaticMarkup(createElement(NavChart, { ...params(raw), data }));

const SERIES = payload([
  ['2020-06-01', 10000],
  ['2024-06-01', 15000],
  ['2025-06-01', 18000],
  ['2026-06-01', 20000],
]);

describe('NavChart — số thật ở server', () => {
  it('vẽ polyline, không canvas', () => {
    const out = html(SERIES);
    expect(out).toContain('<polyline');
    expect(out).not.toContain('<canvas');
    expect(out).toContain('stroke="currentColor"');
  });

  it('bảng số có trong HTML — đây là thứ crawler đọc', () => {
    const out = html(SERIES, { defaultRange: 'all' });
    expect(out).toContain('<table');
    for (const date of ['2020-06-01', '2026-06-01']) expect(out, date).toContain(date);
    // Số đã định dạng vi-VN.
    expect(out).toContain('20.000');
  });

  it('SVG là trang trí, aria-hidden — số đã ở bảng', () => {
    expect(html(SERIES)).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('giá trị mới nhất và % thay đổi hiện ra', () => {
    const out = html(SERIES, { defaultRange: 'all' });
    expect(out).toContain('data-part="nav-value"');
    expect(out).toContain('data-part="nav-change"');
    // 10000 → 20000 là +100%
    expect(out).toContain('+100.00%');
  });

  it('dải nút mốc có nhãn nhóm và aria-pressed', () => {
    const out = html(SERIES);
    expect(out).toContain('aria-label="Khoảng thời gian"');
    expect(out).toContain('aria-pressed="true"');
  });

  it('chỉ bày mốc cắt được thật', () => {
    // Chuỗi 6 tháng: ba nút kia cho ra cùng một hình, nên chúng không được bày.
    const short = html(payload([['2026-01-01', 1], ['2026-06-01', 2]]));
    expect(short).toContain('Từ đầu');
    expect(short).not.toContain('1 năm');
  });

  it('defaultRange không có thật thì hạ xuống mốc có thật', () => {
    // Chuỗi 6 tháng + params khai `5y`: state trỏ vào một nút không tồn tại thì
    // không nút nào trông như đang chọn.
    const out = html(payload([['2026-01-01', 1], ['2026-06-01', 2]]), { defaultRange: '5y' });
    expect(out).toContain('aria-pressed="true"');
  });
});

describe('NavChart — thiếu dữ liệu phải NÓI RA', () => {
  it('data null thì nói chưa có nguồn số liệu', () => {
    const out = html(null);
    expect(out).toContain('data-part="nav-empty"');
    expect(out).toContain('endpoint');
    expect(out).not.toContain('<polyline');
  });

  it('points rỗng thì nói chưa có dữ liệu — khác ca chưa cấu hình', () => {
    const out = html(payload([]));
    expect(out).toContain('data-part="nav-empty"');
    expect(out).toContain('Chưa có dữ liệu NAV');
    // Không nói về `endpoint`: khoá đã đặt đúng, chỉ là BE chưa có số.
    expect(out).not.toContain('màn Cài đặt');
  });
});

describe('navChartParams', () => {
  it('mặc định: khoá "nav", mốc 1y', () => {
    expect(params({})).toEqual({ endpointKey: 'nav', defaultRange: '1y' });
  });

  it('endpointKey là slug, không nhận URL', () => {
    expect(params({ endpointKey: 'https://evil.example/nav' }).endpointKey).toBe('nav');
  });

  it('params rác rơi về mặc định, KHÔNG ném', () => {
    expect(() => params({ defaultRange: '7y' })).not.toThrow();
    expect(params({ defaultRange: '7y' }).defaultRange).toBe('1y');
  });
});
