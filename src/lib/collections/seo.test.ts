import { describe, expect, it } from 'vitest';

import type { FieldDef } from './field-def';
import {
  SEO_LIMITS, asSeo, hasSeoText, localizeSeo, normalizeCanonical, resolveEntrySeo, seoKeyOf,
} from './seo';
import { zSeoValue } from './seo-schema';

const HOST = 'vd.test';

function parse(v: unknown, host: string | null = HOST) {
  return zSeoValue(host).safeParse(v);
}

function firstError(v: unknown, host: string | null = HOST) {
  const r = parse(v, host);
  if (r.success) throw new Error('mong đợi lỗi, nhận được ' + JSON.stringify(r.data));
  return { path: r.error.issues[0]!.path.join('.'), message: r.error.issues[0]!.message };
}

describe('zSeoValue — trần độ dài', () => {
  it('nhận đúng trần, chặn ở trần + 1, câu lỗi nói số ký tự đang có', () => {
    expect(parse({ metaTitle: 'a'.repeat(SEO_LIMITS.titleMax) }).success).toBe(true);
    expect(firstError({ metaTitle: 'a'.repeat(121) })).toEqual({
      path: 'metaTitle',
      message: 'Tiêu đề SEO dài quá 120 ký tự (đang có 121)',
    });
    expect(parse({ metaDescription: 'a'.repeat(300) }).success).toBe(true);
    expect(firstError({ metaDescription: 'a'.repeat(301) })).toEqual({
      path: 'metaDescription',
      message: 'Mô tả SEO dài quá 300 ký tự (đang có 301)',
    });
    expect(firstError({ keywords: 'a'.repeat(501) }).path).toBe('keywords');
    expect(firstError({ ogImage: { assetId: 'a1', alt: 'a'.repeat(301) } }).path).toBe('ogImage.alt');
  });

  it('đếm theo code point — một emoji là một ký tự', () => {
    expect(parse({ metaTitle: '😀'.repeat(120) }).success).toBe(true);
  });
});

describe('zSeoValue — chuẩn hoá', () => {
  it('chuỗi trắng, noindex:false, ogImage rỗng bị xoá khoá', () => {
    const r = parse({ metaTitle: '   ', metaDescription: ' Mô tả ', noindex: false, ogImage: { alt: ' ' } });
    expect(r.success && r.data).toEqual({ metaDescription: 'Mô tả' });
  });

  it('ogImage chỉ có alt được GIỮ — lớp phủ tiếng Anh dịch alt của ảnh bản gốc', () => {
    const r = parse({ ogImage: { alt: 'EN alt' } });
    expect(r.success && r.data).toEqual({ ogImage: { alt: 'EN alt' } });
  });

  it('giữ {} cho giá trị rỗng', () => {
    const r = parse({});
    expect(r.success && r.data).toEqual({});
  });

  it('bỏ khoá lạ', () => {
    const r = parse({ metaTitle: 'A', metaRobots: 'noindex' });
    expect(r.success && r.data).toEqual({ metaTitle: 'A' });
  });
});

describe('canonical', () => {
  it('đường dẫn: bỏ #hash, giữ ?query', () => {
    expect(normalizeCanonical('/a?b=1#c', HOST)).toEqual({ ok: true, path: '/a?b=1' });
  });

  it('URL tuyệt đối cùng site (có hoặc không www.) → cắt về đường dẫn', () => {
    expect(normalizeCanonical('https://vd.test/a', HOST)).toEqual({ ok: true, path: '/a' });
    expect(normalizeCanonical('https://www.vd.test/a/b?x=1', HOST)).toEqual({ ok: true, path: '/a/b?x=1' });
    expect(normalizeCanonical('https://vd.test', HOST)).toEqual({ ok: true, path: '/' });
  });

  it('từ chối domain lạ, URL không giao thức, giao thức khác http(s)', () => {
    for (const raw of ['https://evil.com/a', '//evil.com/a', 'javascript:alert(1)', 'mailto:a@b.c', 'a/b']) {
      expect(normalizeCanonical(raw, HOST).ok, raw).toBe(false);
    }
    expect(normalizeCanonical('https://evil.com/a', HOST)).toEqual({
      ok: false,
      error: 'Đường dẫn chuẩn phải thuộc site này (vd.test). Nhập dạng /duong-dan.',
    });
  });

  it('site chưa đặt domain: chỉ nhận đường dẫn', () => {
    expect(normalizeCanonical('https://vd.test/a', null)).toEqual({
      ok: false,
      error: 'Đường dẫn chuẩn phải là đường dẫn trên site, dạng /duong-dan.',
    });
    expect(normalizeCanonical('/a', null)).toEqual({ ok: true, path: '/a' });
  });

  it('validator lưu đường dẫn, không lưu URL tuyệt đối', () => {
    const r = parse({ canonicalUrl: 'https://vd.test/blogs/x' });
    expect(r.success && r.data).toEqual({ canonicalUrl: '/blogs/x' });
    expect(firstError({ canonicalUrl: 'https://evil.com/x' }).path).toBe('canonicalUrl');
  });
});

describe('structuredData', () => {
  it('nhận object và mảng object, từ chối chuỗi và số', () => {
    expect(parse({ structuredData: { '@type': 'FAQPage' } }).success).toBe(true);
    expect(parse({ structuredData: [{ '@type': 'A' }, { '@type': 'B' }] }).success).toBe(true);
    expect(parse({ structuredData: '{"@type":"A"}' }).success).toBe(false);
    expect(parse({ structuredData: 3 }).success).toBe(false);
    expect(parse({ structuredData: [1, 2] }).success).toBe(false);
  });

  it('JSON-LD rỗng ({} hoặc [{}]) coi như không khai — không được đè JSON-LD của mẫu và Article tự sinh', () => {
    expect(parse({ structuredData: {} }).success && parse({ structuredData: {} }).data).toEqual({});
    const arr = parse({ structuredData: [{}] });
    expect(arr.success && arr.data).toEqual({});
    expect(asSeo({ structuredData: {} })).toEqual({});
    expect(asSeo({ structuredData: [{}, {}] })).toEqual({});
  });

  it('chặn khi quá 20.000 ký tự JSON', () => {
    const big = { x: 'a'.repeat(SEO_LIMITS.structuredMax) };
    expect(firstError({ structuredData: big }).path).toBe('structuredData');
  });
});

describe('localizeSeo', () => {
  const base = {
    metaTitle: 'Tiêu đề VI',
    metaDescription: 'Mô tả VI',
    keywords: 'vi',
    ogImage: { assetId: 'img1', alt: 'Ảnh VI' },
    canonicalUrl: '/khac',
    noindex: true,
    structuredData: { '@type': 'Article' },
  };

  it('không có lớp phủ: chỉ ảnh OG (không alt) kế thừa bản gốc', () => {
    expect(localizeSeo(base, undefined)).toEqual({ ogImage: { assetId: 'img1' } });
  });

  it('lớp phủ có giá trị thì dùng của lớp phủ', () => {
    const out = localizeSeo(base, { metaTitle: 'EN title', noindex: true, ogImage: { alt: 'EN alt' } });
    expect(out).toEqual({ metaTitle: 'EN title', noindex: true, ogImage: { assetId: 'img1', alt: 'EN alt' } });
  });

  it('lớp phủ chọn ảnh riêng thì thắng', () => {
    expect(localizeSeo(base, { ogImage: { assetId: 'img2' } })).toEqual({ ogImage: { assetId: 'img2' } });
  });

  it('bản gốc rác: không ném', () => {
    expect(localizeSeo('rác', null)).toEqual({});
  });
});

describe('hasSeoText', () => {
  it('chỉ đếm ô chữ', () => {
    expect(hasSeoText({ noindex: true, ogImage: { assetId: 'a' } })).toBe(false);
    expect(hasSeoText({ metaTitle: '  ' })).toBe(false);
    expect(hasSeoText({ keywords: 'x' })).toBe(true);
    expect(hasSeoText({ ogImage: { assetId: 'a', alt: 'x' } })).toBe(true);
    expect(hasSeoText(undefined)).toBe(false);
  });
});

describe('asSeo', () => {
  it('bỏ khoá sai kiểu, không ném', () => {
    expect(asSeo({ metaTitle: 3, noindex: 'yes', keywords: 'a', ogImage: 'x' })).toEqual({ keywords: 'a' });
    expect(asSeo(null)).toEqual({});
  });
});

describe('resolveEntrySeo', () => {
  const FIELDS: FieldDef[] = [
    { t: 'text', key: 'title', label: 'Tiêu đề' },
    { t: 'text', key: 'excerpt', label: 'Sapo', multiline: true },
    { t: 'image', key: 'cover', label: 'Ảnh bìa' },
    { t: 'seo', key: 'seo', label: 'SEO' },
  ];
  const SHAPE = { titleField: 'title', fields: FIELDS };
  const DATA = { title: 'Lãi suất tháng 8', excerpt: 'Sapo bài', cover: { assetId: 'cover1' } };

  const DERIVED = {
    title: 'Lãi suất tháng 8',
    titleIsOverride: false,
    description: 'Sapo bài',
    articleTitle: 'Lãi suất tháng 8',
    articleDescription: 'Sapo bài',
    imageAssetId: 'cover1',
    imageAlt: null,
    keywords: null,
    noindex: false,
    canonical: null,
    jsonLd: null,
  };

  it('trống toàn bộ ra đúng luật suy ra cũ', () => {
    expect(resolveEntrySeo(SHAPE, { ...DATA, seo: {} })).toEqual(DERIVED);
    expect(resolveEntrySeo(SHAPE, { ...DATA, seo: { metaTitle: '   ', metaDescription: '' } })).toEqual(DERIVED);
  });

  it('loại không có field SEO: y hệt luật cũ, kể cả khi data còn khoá seo cũ', () => {
    const shape = { titleField: 'title', fields: FIELDS.filter((f) => f.t !== 'seo') };
    expect(resolveEntrySeo(shape, { ...DATA, seo: { metaTitle: 'X' } })).toEqual(DERIVED);
  });

  it('ghi đè thắng; articleTitle vẫn là tên bài', () => {
    const r = resolveEntrySeo(SHAPE, {
      ...DATA,
      seo: {
        metaTitle: 'Lãi suất 8/2026 | Ưu đãi',
        metaDescription: 'Mô tả SEO',
        keywords: 'lãi suất, tiết kiệm',
        ogImage: { assetId: 'og1', alt: 'Ảnh chia sẻ' },
        canonicalUrl: '/blogs/goc',
        noindex: true,
        structuredData: { '@type': 'FAQPage' },
      },
    });
    expect(r).toEqual({
      title: 'Lãi suất 8/2026 | Ưu đãi',
      titleIsOverride: true,
      description: 'Mô tả SEO',
      articleTitle: 'Lãi suất tháng 8',
      articleDescription: 'Sapo bài',
      imageAssetId: 'og1',
      imageAlt: 'Ảnh chia sẻ',
      keywords: 'lãi suất, tiết kiệm',
      noindex: true,
      canonical: '/blogs/goc',
      jsonLd: { '@type': 'FAQPage' },
    });
  });

  it('canonical hỏng trong JSONB (sửa tay bằng SQL) bị bỏ, quay về luật mặc định', () => {
    expect(resolveEntrySeo(SHAPE, { ...DATA, seo: { canonicalUrl: '//evil.com/x' } }).canonical).toBeNull();
    expect(resolveEntrySeo(SHAPE, { ...DATA, seo: { canonicalUrl: 'https://evil.com/x' } }).canonical).toBeNull();
  });

  it('không có gì để suy ra: null, không bao giờ chuỗi rỗng', () => {
    const r = resolveEntrySeo({ titleField: 'title', fields: FIELDS }, { title: '  ' });
    expect(r.title).toBeNull();
    expect(r.description).toBeNull();
  });
});

describe('seoKeyOf', () => {
  it('tìm theo KIỂU, không theo khoá', () => {
    expect(seoKeyOf([{ t: 'text', key: 'seo', label: 'A' }, { t: 'seo', key: 'toi_uu', label: 'SEO' }])).toBe('toi_uu');
    expect(seoKeyOf([{ t: 'text', key: 'seo', label: 'A' }])).toBeNull();
  });
});
