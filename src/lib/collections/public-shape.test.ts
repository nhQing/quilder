import { describe, expect, it } from 'vitest';

import type { RichDoc } from '@/lib/doc/types';
import type { FieldDef, GroupTable } from './field-def';
import {
  collectAssetIds, richDocToHtml, richDocToPublic, richTextToHtml, toPublicData,
  type AssetTable, type PublicFigure,
} from './public-shape';

const ASSETS: AssetTable = {
  a1: { url: 'https://cdn/x.webp', width: 1600, height: 900, blurhash: 'LKO2', mime: 'image/webp' },
};

const GROUPS: GroupTable = {
  quote: [{ t: 'text', key: 'text', label: 'Câu trích' }],
};

const FIELDS: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề' },
  { t: 'richtext', key: 'body', label: 'Nội dung' },
  { t: 'image', key: 'cover', label: 'Ảnh' },
  { t: 'blocks', key: 'zone', label: 'Khối', allowed: ['quote'] },
  { t: 'json', key: 'raw', label: 'Thô' },
];

const DATA = {
  title: 'Lãi suất tháng 8',
  body: [{ t: 'text', v: 'Xin chào' }],
  cover: { assetId: 'a1', alt: 'Ảnh bìa' },
  zone: [{ __type: 'quote', text: 'Câu trích' }],
  raw: { anything: true },
};

describe('toPublicData', () => {
  it('assetId KHÔNG bao giờ ra ngoài — thay bằng url và blurhash', () => {
    // Mobile không nên phải biết bảng Asset tồn tại, và blurhash là thứ làm
    // placeholder mượt mà không cần thêm một lượt gọi.
    const out = toPublicData(DATA, FIELDS, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] });
    expect(out.cover).toEqual({
      url: 'https://cdn/x.webp', width: 1600, height: 900,
      blurhash: 'LKO2', mime: 'image/webp', alt: 'Ảnh bìa',
    });
    expect(JSON.stringify(out)).not.toContain('assetId');
  });

  it('asset không còn trong bảng thì field thành null, không phải nửa vời', () => {
    const out = toPublicData({ cover: { assetId: 'mat-roi' } }, FIELDS, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] });
    expect(out.cover).toBeNull();
  });

  it('format json giữ cây RichText', () => {
    const out = toPublicData(DATA, FIELDS, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] });
    expect(out.body).toEqual([{ t: 'text', v: 'Xin chào' }]);
  });

  it('format html trả chuỗi HTML', () => {
    const out = toPublicData(DATA, FIELDS, GROUPS, { assets: ASSETS, format: 'html', iframeHosts: [] });
    expect(out.body).toBe('Xin chào');
  });

  it('khối trong Dynamic Zone cũng được xử lý — ảnh bên trong khối cũng thành url', () => {
    const groups: GroupTable = { figure: [{ t: 'image', key: 'image', label: 'Ảnh' }] };
    const fields: FieldDef[] = [{ t: 'blocks', key: 'zone', label: 'Khối', allowed: ['figure'] }];
    const out = toPublicData(
      { zone: [{ __type: 'figure', image: { assetId: 'a1', alt: 'x' } }] },
      fields, groups, { assets: ASSETS, format: 'json', iframeHosts: [] },
    );
    const zone = out.zone as Record<string, unknown>[];
    expect((zone[0]!.image as { url?: string }).url).toBe('https://cdn/x.webp');
    expect(zone[0]!.__type).toBe('figure');
  });

  it('field json đi ra nguyên trạng — nó là lối thoát, không được biến đổi', () => {
    const out = toPublicData(DATA, FIELDS, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] });
    expect(out.raw).toEqual({ anything: true });
  });

  it('field không có trong schema bị BỎ — dữ liệu của field đã xoá không rò ra API', () => {
    // Xoá một field chỉ ẩn nó (spec §10). Nếu API vẫn trả, thì "đã xoá" là một lời
    // nói dối và mobile vẫn thấy nó.
    const out = toPublicData({ ...DATA, fieldDaXoa: 'còn sót' }, FIELDS, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] });
    expect('fieldDaXoa' in out).toBe(false);
  });

  it('field khai trong schema mà entry chưa có thì vẫn CÓ khoá, không vắng mặt', () => {
    // Client sinh model từ /types và mong mọi khoá có mặt; một khoá lúc có lúc
    // không làm mọi bộ decode có kiểu chặt (Swift, Kotlin) phải khai optional hết.
    const out = toPublicData({}, FIELDS, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] });
    expect(Object.keys(out).sort()).toEqual(['body', 'cover', 'raw', 'title', 'zone']);
    expect(out.title).toBeNull();
  });

  it('giá trị rỗng theo KIỂU field: mảng là [], không phải null', () => {
    // Đo ngày 28/08/2026 trên API thật: `ctas`, `zone`, `related` cùng trả `null`
    // trong khi tài liệu §3 hứa `[]`. `null` cho một field mảng đẩy phép kiểm sang
    // MỌI client, và bản quên `?? []` vỡ đúng lúc biên tập viên chưa điền field.
    const fields: FieldDef[] = [
      { t: 'richtext', key: 'sapo', label: 'Sapo' },
      { t: 'image', key: 'gallery', label: 'Bộ ảnh', multiple: true },
      { t: 'image', key: 'cover', label: 'Ảnh bìa' },
      { t: 'blocks', key: 'zone', label: 'Khối', allowed: ['quote'] },
      { t: 'group', key: 'ctas', label: 'CTA', groupKey: 'quote', repeatable: true },
      { t: 'group', key: 'seo', label: 'SEO', groupKey: 'quote' },
      { t: 'relation', key: 'related', label: 'Liên quan', typeKey: 'news', cardinality: 'many' },
      { t: 'relation', key: 'author', label: 'Tác giả', typeKey: 'team', cardinality: 'one' },
      { t: 'text', key: 'title', label: 'Tiêu đề' },
    ];
    const out = toPublicData({}, fields, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] });
    expect(out.sapo).toEqual([]);
    expect(out.gallery).toEqual([]);
    expect(out.zone).toEqual([]);
    expect(out.ctas).toEqual([]);
    expect(out.related).toEqual([]);
    // Field hình dạng OBJECT hoặc scalar vẫn là `null` — `[]` ở đó là một lời nói dối.
    expect(out.cover).toBeNull();
    expect(out.seo).toBeNull();
    expect(out.author).toBeNull();
    expect(out.title).toBeNull();
  });

  it('richtext rỗng ở format=html là chuỗi rỗng, không phải null', () => {
    const fields: FieldDef[] = [{ t: 'richtext', key: 'sapo', label: 'Sapo' }];
    const out = toPublicData({}, fields, GROUPS, { assets: ASSETS, format: 'html', iframeHosts: [] });
    expect(out.sapo).toBe('');
  });

  it('giá trị SAI HÌNH DẠNG ra cùng giá trị rỗng với giá trị vắng mặt', () => {
    // JSONB ghi trước khi validator tồn tại có thể mang bất cứ gì. Hai đường đó phải
    // ra một kết quả, nếu không client lại có hai ca phải xử lý.
    const fields: FieldDef[] = [
      { t: 'richtext', key: 'sapo', label: 'Sapo' },
      { t: 'relation', key: 'related', label: 'Liên quan', typeKey: 'news', cardinality: 'many' },
    ];
    const out = toPublicData({ sapo: 'chuỗi thô', related: 'mot-id' }, fields, GROUPS, {
      assets: ASSETS, format: 'json', iframeHosts: [],
    });
    expect(out.sapo).toEqual([]);
    expect(out.related).toEqual([]);
  });

  it('field taxonomy KHÔNG có khoá trong data — cuid danh mục không ra ngoài', () => {
    // Đo ngày 28/08/2026: `"cats":["cmt1gnf2u0004qfas2bm9af9s"]` đi ra ngoài từ những
    // hàng ghi TRƯỚC khi `entry-data.ts` loại `taxonomy` khỏi `data`. Cùng loại rò với
    // `assetId`: một id nội bộ mà client sẽ lưu rồi phụ thuộc vào.
    const fields: FieldDef[] = [
      { t: 'text', key: 'title', label: 'Tiêu đề' },
      { t: 'taxonomy', key: 'cats', label: 'Danh mục', multiple: true },
    ];
    const out = toPublicData({ title: 'Bài', cats: ['cmt1gnf2u0004qfas2bm9af9s'] }, fields, GROUPS, {
      assets: ASSETS, format: 'json', iframeHosts: [],
    });
    expect('cats' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('cmt1gnf2u');
  });

  it('relation một-một trả chuỗi id, nhiều trả mảng chuỗi — hình dạng do KIỂU quyết', () => {
    const fields: FieldDef[] = [
      { t: 'relation', key: 'author', label: 'Tác giả', typeKey: 'team', cardinality: 'one' },
      { t: 'relation', key: 'related', label: 'Liên quan', typeKey: 'news', cardinality: 'many' },
    ];
    const out = toPublicData({ author: 'id1', related: ['id2', 3, null, 'id4'] }, fields, GROUPS, {
      assets: ASSETS, format: 'json', iframeHosts: [],
    });
    expect(out.author).toBe('id1');
    expect(out.related).toEqual(['id2', 'id4']);
  });

  it('ảnh nhiều: asset đã xoá bị loại khỏi mảng, không để lại lỗ null', () => {
    const fields: FieldDef[] = [{ t: 'image', key: 'gallery', label: 'Bộ ảnh', multiple: true }];
    const out = toPublicData(
      { gallery: [{ assetId: 'a1' }, { assetId: 'mat-roi' }] },
      fields, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] },
    );
    expect(out.gallery).toHaveLength(1);
  });
});

describe('richdoc', () => {
  const DOC: RichDoc = [
    { b: 'h2', children: [{ t: 'text', v: 'Tiêu đề' }] },
    { b: 'p', children: [{ t: 'text', v: 'Đoạn <b>' }] },
    { b: 'ul', items: [{ children: [{ t: 'text', v: 'Một' }] }, { children: [{ t: 'text', v: 'Hai' }] }] },
    { b: 'figure', assetId: 'a1', alt: 'Biểu đồ', caption: [{ t: 'text', v: 'Nguồn: NHNN' }] },
    { b: 'hr' },
  ];
  const FIELDS_DOC: FieldDef[] = [{ t: 'richdoc', key: 'noi_dung', label: 'Thân bài' }];

  it('khối figure KHÔNG mang assetId ra ngoài, kể cả ở format json', () => {
    // Đây là cửa rò dễ quên nhất: `assetId` nằm sâu trong một cây chữ, không ở
    // tầng field, nên phép kiểm "field ảnh có ra url không" không chạm tới nó.
    const out = toPublicData({ noi_dung: DOC }, FIELDS_DOC, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] });
    expect(JSON.stringify(out)).not.toContain('assetId');
    const blocks = out.noi_dung as PublicFigure[];
    expect(blocks[3]!.image).toEqual({
      url: 'https://cdn/x.webp', width: 1600, height: 900,
      blurhash: 'LKO2', mime: 'image/webp', alt: 'Biểu đồ',
    });
  });

  it('figure mất asset thì image là null nhưng khối vẫn còn', () => {
    const doc: RichDoc = [{ b: 'figure', assetId: 'mat-roi', alt: 'x' }];
    const blocks = richDocToPublic(doc, ASSETS) as PublicFigure[];
    expect(blocks[0]!.image).toBeNull();
    expect(blocks[0]!.alt).toBe('x');
  });

  it('richdoc format html giữ TẦNG KHỐI — không phẳng thành một dòng', () => {
    // Dùng richTextToHtml cho một richdoc là mất hết đoạn, tiêu đề và danh sách,
    // im lặng. Test này là chỗ chặn việc chọn nhầm hàm.
    const html = richDocToHtml(DOC, ASSETS);
    expect(html).toContain('<h2>Tiêu đề</h2>');
    expect(html).toContain('<p>Đoạn &lt;b&gt;</p>');
    expect(html).toContain('<ul><li>Một</li><li>Hai</li></ul>');
    expect(html).toContain('<figcaption>Nguồn: NHNN</figcaption>');
    expect(html).toContain('<hr>');
  });

  it('figure trong html: src và alt đều escape', () => {
    const assets: AssetTable = {
      a2: { url: 'https://cdn/a.webp?x=1&y=2', width: null, height: null, blurhash: null, mime: 'image/webp' },
    };
    const html = richDocToHtml([{ b: 'figure', assetId: 'a2', alt: '"x"' }], assets);
    expect(html).toBe('<figure><img src="https://cdn/a.webp?x=1&amp;y=2" alt="&quot;x&quot;"></figure>');
  });

  it('figure mất asset trong html: bỏ img, giữ figcaption', () => {
    const html = richDocToHtml(
      [{ b: 'figure', assetId: 'mat-roi', alt: 'x', caption: [{ t: 'text', v: 'Chú thích' }] }],
      ASSETS,
    );
    expect(html).toBe('<figure><figcaption>Chú thích</figcaption></figure>');
  });
});

describe('richTextToHtml', () => {
  it('escape ký tự HTML trong chữ', () => {
    // Chữ do người nhập gõ. Không escape nghĩa là API trả về một đường XSS cho mọi
    // client dùng `?format=html`.
    expect(richTextToHtml([{ t: 'text', v: '<script>alert(1)</script>' }]))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('dựng strong, em, br', () => {
    expect(richTextToHtml([
      { t: 'strong', children: [{ t: 'text', v: 'Đậm' }] },
      { t: 'br' },
      { t: 'em', children: [{ t: 'text', v: 'Nghiêng' }] },
    ])).toBe('<strong>Đậm</strong><br><em>Nghiêng</em>');
  });

  it('link giữ href và escape nó', () => {
    expect(richTextToHtml([{ t: 'link', href: '/a?b=1&c=2', children: [{ t: 'text', v: 'Xem' }] }]))
      .toBe('<a href="/a?b=1&amp;c=2">Xem</a>');
  });

  it('chặn href javascript: dù zod đã chặn ở đường ghi', () => {
    // Hai lớp có chủ đích: dữ liệu cũ có thể đã lưu trước khi zod chặn.
    expect(richTextToHtml([{ t: 'link', href: 'javascript:alert(1)', children: [{ t: 'text', v: 'x' }] }]))
      .toBe('<a href="#">x</a>');
  });

  it('chặn cả data: và vbscript:, kể cả khi có khoảng trắng đầu', () => {
    expect(richTextToHtml([{ t: 'link', href: '  data:text/html,<b>', children: [] }]))
      .toBe('<a href="#"></a>');
  });

  it('split và counter phẳng thành chữ — chúng là hiệu ứng, không phải nội dung', () => {
    expect(richTextToHtml([{ t: 'split', mode: 'words', children: [{ t: 'text', v: 'Tách chữ' }] }]))
      .toBe('Tách chữ');
    expect(richTextToHtml([{ t: 'counter', to: 300, suffix: '+' }])).toBe('300+');
  });

  it('bind phẳng thành fallback — API không có ngữ cảnh binding', () => {
    expect(richTextToHtml([{ t: 'bind', ref: { source: 'site', path: 'phone' }, fallback: '1900' }])).toBe('1900');
  });
});

describe('collectAssetIds', () => {
  it('tìm cả assetId nằm sâu trong một cây richdoc', () => {
    // Nếu phép quét này đi theo schema thay vì quét mù, ảnh trong thân bài sẽ
    // không có mặt trong bảng asset và biến mất khỏi API mà không có lỗi nào.
    const ids = collectAssetIds({
      cover: { assetId: 'a1' },
      noi_dung: [{ b: 'p', children: [] }, { b: 'figure', assetId: 'a9', alt: '' }],
    });
    expect([...ids].sort()).toEqual(['a1', 'a9']);
  });
});

describe('field seo', () => {
  const F: FieldDef[] = [{ t: 'seo', key: 'seo', label: 'SEO' }];
  const shape = (seo: unknown) =>
    toPublicData(seo === undefined ? {} : { seo }, F, GROUPS, { assets: ASSETS, format: 'json', iframeHosts: [] }).seo;

  it('giá trị ghi đè, ảnh OG đã phân giải URL — không lộ assetId', () => {
    expect(
      shape({
        metaTitle: 'T', metaDescription: 'D', keywords: 'k',
        ogImage: { assetId: 'a1', alt: 'Ảnh' },
        canonicalUrl: '/blogs/x', noindex: true, structuredData: { '@type': 'Article' },
      }),
    ).toEqual({
      metaTitle: 'T',
      metaDescription: 'D',
      keywords: 'k',
      ogImage: { ...ASSETS.a1, alt: 'Ảnh' },
      canonicalUrl: '/blogs/x',
      noindex: true,
      structuredData: { '@type': 'Article' },
    });
  });

  it('có một ô → mọi khoá có mặt, null/false — client không phải hỏi khoá có hay không', () => {
    expect(shape({ keywords: 'k' })).toEqual({
      metaTitle: null, metaDescription: null, keywords: 'k', ogImage: null,
      canonicalUrl: null, noindex: false, structuredData: null,
    });
  });

  it('{} (mọi bài tạo từ form) → null, đúng như "chưa đặt ô nào" — một trạng thái, một hình dạng', () => {
    expect(shape({})).toBeNull();
    expect(shape({ metaTitle: '  ' })).toBeNull();
  });

  it('ảnh OG đã bị xoá → ogImage null', () => {
    expect((shape({ ogImage: { assetId: 'mat-roi' } }) as { ogImage: unknown }).ogImage).toBeNull();
  });

  it('field vắng mặt → null', () => {
    expect(shape(undefined)).toBeNull();
  });

  it('collectAssetIds thấy ảnh OG — nạp cùng lượt với ảnh khác', () => {
    expect([...collectAssetIds({ seo: { ogImage: { assetId: 'og9' } } })]).toEqual(['og9']);
  });
});
