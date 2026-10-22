import { describe, expect, it } from 'vitest';

import type { FieldDef } from '@/lib/collections/field-def';
import { applyEntryLocale } from '@/lib/collections/i18n';
import { resolveEntrySeo } from '@/lib/collections/seo';
import { jsonForScript } from './json-for-script';
import { applySeoToMeta, ogImageAlt, pickJsonLd } from './entry-meta';

/**
 * Metadata trang chi tiết = dữ liệu ĐÃ phủ ngôn ngữ → `resolveEntrySeo` → `applySeoToMeta`.
 * Đúng ba bước `generateMetadata` làm, chạy ở cả `vi` (không phủ) và `en`.
 */
const FIELDS: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề' },
  { t: 'text', key: 'excerpt', label: 'Sapo', multiline: true },
  { t: 'image', key: 'cover', label: 'Ảnh bìa' },
  { t: 'seo', key: 'seo', label: 'SEO' },
];
const SHAPE = { titleField: 'title', fields: FIELDS };

const PAGE_BASE = { title: 'Chi tiết tin tức', description: undefined, canonical: null, robots: undefined };

function meta(data: Record<string, unknown>, i18n: unknown, locale: 'vi' | 'en', selfPath: string, shape = SHAPE) {
  const localized = locale === 'en' ? applyEntryLocale(data, i18n, 'en', 'seo') : data;
  return applySeoToMeta({ ...PAGE_BASE, canonical: selfPath }, resolveEntrySeo(shape, localized));
}

const ARTICLE = { title: 'Lãi suất tháng 8', excerpt: 'Sapo', cover: { assetId: 'cover1' } };
const I18N_EN = { en: { title: 'August rates', excerpt: 'Lead' } };

describe('applySeoToMeta — bài KHÔNG có SEO', () => {
  it('vi: y hệt hôm nay', () => {
    expect(meta(ARTICLE, null, 'vi', '/blogs/post/lai-suat')).toEqual({
      title: 'Lãi suất tháng 8',
      titleMeta: 'Lãi suất tháng 8',
      description: 'Sapo',
      keywords: undefined,
      canonical: '/blogs/post/lai-suat',
      robots: undefined,
      imageAssetId: 'cover1',
      imageAlt: null,
    });
  });

  it('en: chữ tiếng Anh, canonical của chính nó', () => {
    const m = meta(ARTICLE, I18N_EN, 'en', '/en/blogs/post/august-rates');
    expect(m.title).toBe('August rates');
    expect(m.description).toBe('Lead');
    expect(m.canonical).toBe('/en/blogs/post/august-rates');
    expect(m.robots).toBeUndefined();
  });

  it('loại không có field SEO: như bài không có SEO', () => {
    const shape = { titleField: 'title', fields: FIELDS.filter((f) => f.t !== 'seo') };
    expect(meta(ARTICLE, null, 'vi', '/blogs/post/x', shape).titleMeta).toBe('Lãi suất tháng 8');
  });
});

describe('applySeoToMeta — bài CÓ SEO', () => {
  const WITH_SEO = {
    ...ARTICLE,
    seo: {
      metaTitle: 'Lãi suất 8/2026 | Ưu đãi',
      metaDescription: 'Mô tả SEO',
      keywords: 'lãi suất',
      ogImage: { assetId: 'og1', alt: 'Ảnh chia sẻ' },
      canonicalUrl: '/blogs/post/goc',
      noindex: true,
    },
  };

  it('vi: mọi ô ghi đè đi vào metadata, tiêu đề không nối template', () => {
    expect(meta(WITH_SEO, null, 'vi', '/blogs/post/lai-suat')).toEqual({
      title: 'Lãi suất 8/2026 | Ưu đãi',
      titleMeta: { absolute: 'Lãi suất 8/2026 | Ưu đãi' },
      description: 'Mô tả SEO',
      keywords: 'lãi suất',
      canonical: '/blogs/post/goc',
      robots: { index: false, follow: true },
      imageAssetId: 'og1',
      imageAlt: 'Ảnh chia sẻ',
    });
  });

  it('en, CHỈ có SEO tiếng Việt: tiêu đề tiếng Anh, canonical của chính nó, không noindex, ảnh OG của bản gốc', () => {
    expect(meta(WITH_SEO, I18N_EN, 'en', '/en/blogs/post/august-rates')).toEqual({
      title: 'August rates',
      titleMeta: 'August rates',
      description: 'Lead',
      keywords: undefined,
      canonical: '/en/blogs/post/august-rates',
      robots: undefined,
      imageAssetId: 'og1',
      imageAlt: null,
    });
  });

  it('en có SEO riêng: dùng của tiếng Anh', () => {
    const i18n = { en: { ...I18N_EN.en, seo: { metaTitle: 'Rates 8/2026', noindex: true, canonicalUrl: '/en/x' } } };
    const m = meta(WITH_SEO, i18n, 'en', '/en/blogs/post/august-rates');
    expect(m.titleMeta).toEqual({ absolute: 'Rates 8/2026' });
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.canonical).toBe('/en/x');
  });

  it('trang mẫu noindex vẫn thắng, giữ follow:false như hôm nay', () => {
    const m = applySeoToMeta(
      { ...PAGE_BASE, canonical: '/x', robots: { index: false, follow: false } },
      resolveEntrySeo(SHAPE, WITH_SEO),
    );
    expect(m.robots).toEqual({ index: false, follow: false });
  });
});

describe('applySeoToMeta — không có SEO nào (seo null)', () => {
  it('trả nguyên giá trị nền', () => {
    expect(applySeoToMeta({ ...PAGE_BASE, canonical: '/blogs' }, null)).toEqual({
      title: 'Chi tiết tin tức',
      titleMeta: 'Chi tiết tin tức',
      description: undefined,
      keywords: undefined,
      canonical: '/blogs',
      robots: undefined,
      imageAssetId: null,
      imageAlt: null,
    });
  });
});

describe('trang danh mục — chỉ giá trị ghi đè', () => {
  const CAT_FIELDS: FieldDef[] = [
    { t: 'text', key: 'name', label: 'Tên' },
    { t: 'text', key: 'description', label: 'Mô tả' },
    { t: 'seo', key: 'seo', label: 'SEO' },
  ];
  const CAT = { titleField: 'name', fields: CAT_FIELDS };

  it('không có SEO: giữ metadata của trang mẫu, KHÔNG suy ra từ tên/mô tả danh mục', () => {
    const seo = resolveEntrySeo(CAT, { name: 'Tiết kiệm', description: 'Mô tả danh mục' }, { derive: false });
    expect(applySeoToMeta({ ...PAGE_BASE, canonical: '/blogs/tiet-kiem' }, seo)).toEqual(
      applySeoToMeta({ ...PAGE_BASE, canonical: '/blogs/tiet-kiem' }, null),
    );
  });

  it('có SEO: dùng ghi đè', () => {
    const seo = resolveEntrySeo(CAT, { name: 'Tiết kiệm', seo: { metaTitle: 'Tiết kiệm | MaiMoney', noindex: true } }, { derive: false });
    const m = applySeoToMeta({ ...PAGE_BASE, canonical: '/blogs/tiet-kiem' }, seo);
    expect(m.titleMeta).toEqual({ absolute: 'Tiết kiệm | MaiMoney' });
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.description).toBeUndefined();
  });
});

describe('ogImageAlt', () => {
  it('alt của ảnh OG chỉ dùng khi ảnh được chọn đúng là ảnh đó', () => {
    expect(ogImageAlt('og1', { imageAssetId: 'og1', imageAlt: 'Alt' }, 'Tiêu đề')).toBe('Alt');
    expect(ogImageAlt('site-default', { imageAssetId: 'og1', imageAlt: 'Alt' }, 'Tiêu đề')).toBe('Tiêu đề');
    expect(ogImageAlt('og1', { imageAssetId: 'og1', imageAlt: null }, 'Tiêu đề')).toBe('Tiêu đề');
  });
});

describe('pickJsonLd', () => {
  const auto = () => ({ '@type': 'Article' });

  it('bài tự khai → trang mẫu khai → tự sinh', () => {
    expect(pickJsonLd({ entryJsonLd: { '@type': 'FAQPage' }, pageJsonLd: { '@type': 'WebPage' }, auto })).toEqual({ '@type': 'FAQPage' });
    expect(pickJsonLd({ entryJsonLd: null, pageJsonLd: { '@type': 'WebPage' }, auto })).toEqual({ '@type': 'WebPage' });
    expect(pickJsonLd({ entryJsonLd: null, pageJsonLd: null, auto })).toEqual({ '@type': 'Article' });
  });

  it('structuredData chứa </script> không đóng được thẻ khi chèn', () => {
    const ld = pickJsonLd({ entryJsonLd: { name: '</script><script>alert(1)</script>' }, pageJsonLd: null, auto });
    expect(jsonForScript(ld)).not.toContain('</script');
  });
});
