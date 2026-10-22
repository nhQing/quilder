import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  noindex: vi.fn(() => false),
  robotsTxt: vi.fn((): string | null => null),
}));

vi.mock('@/lib/site-mode', () => ({ isNoindexSite: m.noindex }));
vi.mock('@/lib/site/origin', () => ({ siteOrigin: async () => 'https://vd.vn' }));
vi.mock('@/lib/site/settings', () => ({
  getSiteCrawlSettings: async () => ({ robotsTxt: m.robotsTxt() }),
}));

import { GET } from './route';

beforeEach(() => {
  m.noindex.mockReturnValue(false);
  m.robotsTxt.mockReturnValue(null);
});

describe('GET /robots.txt', () => {
  it('không tự soạn: nội dung tự sinh với gốc của site', async () => {
    const res = await GET();
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const text = await res.text();
    expect(text).toContain('Disallow: /builder');
    expect(text).toContain('Sitemap: https://vd.vn/sitemap.xml');
  });

  it('tự soạn: trả nguyên văn', async () => {
    m.robotsTxt.mockReturnValue('User-agent: GPTBot\nDisallow: /\n');
    expect(await (await GET()).text()).toBe('User-agent: GPTBot\nDisallow: /\n');
  });

  it('SITE_NOINDEX thắng cả nội dung tự soạn', async () => {
    m.noindex.mockReturnValue(true);
    m.robotsTxt.mockReturnValue('User-agent: *\nAllow: /\n');
    const text = await (await GET()).text();
    expect(text).toBe('User-Agent: *\nDisallow: /\n');
    expect(text).not.toContain('Sitemap');
  });
});
