import { describe, expect, it } from 'vitest';

import { defaultRobotsTxt, lintRobotsTxt, MAX_ROBOTS_BYTES } from './robots';

/** Output thật của `MetadataRoute.Robots` trước 20/10/2026, chép từ `/robots.txt` trên dev. */
const NEXT_OUTPUT =
  'User-Agent: *\nAllow: /\nDisallow: /builder\nDisallow: /builder/\nDisallow: /preview/\nDisallow: /api/\n\nSitemap: http://localhost:3005/sitemap.xml\n';

describe('defaultRobotsTxt', () => {
  it('đúng từng byte với thứ Next từng sinh', () => {
    expect(defaultRobotsTxt('http://localhost:3005')).toBe(NEXT_OUTPUT);
  });

  it('nội dung mặc định không có lỗi hay cảnh báo', () => {
    expect(lintRobotsTxt(defaultRobotsTxt('https://vd.vn'), 'https://vd.vn')).toEqual({ errors: [], warnings: [] });
  });
});

describe('lintRobotsTxt', () => {
  const O = 'https://vd.vn';

  it('dòng sai dạng là lỗi, comment và dòng trống thì không', () => {
    const r = lintRobotsTxt('# ghi chú\n\nUser-agent: *\nchặn hết đi\nSitemap: https://vd.vn/sitemap.xml', O);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('Dòng 4');
  });

  it('quá trần là lỗi', () => {
    expect(lintRobotsTxt('# ' + 'x'.repeat(MAX_ROBOTS_BYTES), O).errors).toHaveLength(1);
  });

  it('Disallow: / cho * là cảnh báo chặn cả site', () => {
    const r = lintRobotsTxt('User-agent: *\nDisallow: /\nSitemap: https://vd.vn/sitemap.xml', O);
    expect(r.warnings.join()).toContain('cả site');
  });

  it('Disallow: / cho MỘT bot cụ thể thì không cảnh báo chặn cả site', () => {
    const r = lintRobotsTxt(
      'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://vd.vn/sitemap.xml',
      O,
    );
    expect(r.warnings).toEqual([]);
  });

  it('thiếu Sitemap và Sitemap khác host là cảnh báo', () => {
    expect(lintRobotsTxt('User-agent: *\nAllow: /', O).warnings.join()).toContain('Sitemap');
    expect(lintRobotsTxt('User-agent: *\nAllow: /\nSitemap: https://khac.vn/s.xml', O).warnings.join()).toContain(
      'khac.vn',
    );
  });
});
