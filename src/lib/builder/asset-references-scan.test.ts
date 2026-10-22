import { describe, expect, it } from 'vitest';

import type { Node } from '@/lib/doc/types';
import {
  createScanContext,
  effectPresetAssetIds,
  idsInJson,
  scanAssetReferences,
  type ReferenceSources,
  type ReleaseSource,
} from './asset-references-scan';

/**
 * Phép kiểm trước khi XOÁ HẲN ảnh — mỗi nguồn một ca.
 *
 * Mỗi nguồn ở đây là một chỗ mà `listAssetsWithUsage` (màn quản lý ảnh) không thấy.
 * Thiếu test cho một nguồn là để ngỏ đúng cái lỗ mà cả tính năng thùng rác dựa vào
 * hàm này để bịt: ảnh đang hiện trên site bị coi là "không ai dùng", và nút "Xoá hoàn
 * toàn" xoá nó khỏi S3 — không lấy lại được.
 */

const IMG = 'cimg0000000000000000000001';
const OTHER = 'cimg0000000000000000000002';
const KEY = 'public/builder/bia-bai-1a2b3c4d.png';
const CDN = 'https://cdn.example.com';

const ASSETS = [
  { id: IMG, key: KEY },
  { id: OTHER, key: 'public/builder/khac-9f8e7d6c.png' },
];

const base = (id: string, extra: Record<string, unknown>) => ({
  id,
  parentId: null,
  children: [],
  effects: [],
  style: { base: {} },
  ...extra,
});

const doc = (nodes: Record<string, unknown>) => ({
  schemaVersion: 2,
  rootId: Object.keys(nodes)[0]!,
  nodes,
});

const emptyDoc = () => doc({ root: base('root', { type: 'Section' }) });

const sources = (over: Partial<ReferenceSources> = {}): ReferenceSources => ({
  pages: [],
  draftTranslations: [],
  presets: [],
  effectPresets: [],
  entries: [],
  sites: [],
  users: [],
  tokens: [],
  liveReleases: [],
  oldReleases: [],
  versionDocs: new Map(),
  ...over,
});

const page = (over: Partial<ReferenceSources['pages'][number]> = {}) => ({
  id: 'p1',
  slug: 'blog',
  title: 'Blog',
  archived: false,
  ogImageId: null,
  jsonLd: null,
  draftDoc: emptyDoc(),
  ...over,
});

const entry = (over: Partial<ReferenceSources['entries'][number]> = {}) => ({
  id: 'e1',
  typeKey: 'post',
  typeName: 'Bài viết',
  titleField: 'title',
  slug: 'bai-mot',
  archived: false,
  data: { title: 'Bài một' },
  i18n: {},
  ...over,
});

const release = (over: Partial<ReleaseSource> = {}): ReleaseSource => ({
  id: 'r1',
  label: 'Publish 1',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  entries: [],
  components: new Map(),
  translations: {},
  tokens: {},
  globals: {},
  ...over,
});

const scan = (over: Partial<ReferenceSources>, ids: string[] = [IMG]) =>
  scanAssetReferences(ids, ASSETS, sources(over));

const kinds = (m: ReturnType<typeof scan>, id = IMG) => m.get(id)!.blocking.map((r) => r.kind);

describe('scanAssetReferences — hợp đồng kết quả', () => {
  it('ảnh không ai dùng: có mặt trong Map, cả hai danh sách rỗng', () => {
    const m = scan({ pages: [page()], entries: [entry()] }, [IMG, OTHER]);
    expect(m.get(IMG)).toEqual({ blocking: [], oldReleases: [] });
    expect(m.get(OTHER)).toEqual({ blocking: [], oldReleases: [] });
  });

  it('id không có hàng Asset vẫn có mặt, vẫn quét được theo id', () => {
    const ghost = 'cghost000000000000000000001';
    const m = scan(
      { entries: [entry({ data: { title: 'x', cover: { assetId: ghost } } })] },
      [ghost],
    );
    expect(kinds(m, ghost)).toEqual(['entry']);
  });

  it('id trùng trong đầu vào chỉ cho một khoá', () => {
    const m = scan({}, [IMG, IMG]);
    expect([...m.keys()]).toEqual([IMG]);
  });

  it('cùng một chỗ dùng hai lần chỉ cho một dòng', () => {
    const m = scan({
      pages: [
        page({
          draftDoc: doc({
            a: base('a', { type: 'Image', assetId: IMG }),
            b: base('b', { type: 'Image', assetId: IMG }),
          }),
        }),
      ],
    });
    expect(m.get(IMG)!.blocking).toHaveLength(1);
  });
});

describe('scanAssetReferences — entry', () => {
  it('ảnh trong entry data (field image)', () => {
    const m = scan({ entries: [entry({ data: { title: 'Bài một', cover: { assetId: IMG, alt: '' } } })] });
    expect(m.get(IMG)!.blocking).toEqual([
      { kind: 'entry', label: 'Bài viết: Bài một', href: '/builder/content/post/e1' },
    ]);
  });

  it('ảnh chỉ nằm trong entry i18n', () => {
    const m = scan({ entries: [entry({ i18n: { en: { cover: { assetId: IMG } } } })] });
    expect(kinds(m)).toEqual(['entry']);
  });

  /*
   * Ảnh OG của field `seo` lồng hai tầng (`seo.ogImage.assetId`). Thiếu ca này thì một
   * lần tái cấu trúc phép duyệt có thể làm ảnh chia sẻ thành "mồ côi" — và nút "Xoá
   * hoàn toàn" xoá nó khỏi kho trong khi mọi lượt chia sẻ bài vẫn trỏ tới nó.
   */
  it('ảnh OG trong field seo, ở data và ở bản dịch', () => {
    const inData = scan({ entries: [entry({ data: { title: 'x', seo: { ogImage: { assetId: IMG, alt: 'A' } } } })] });
    expect(kinds(inData)).toEqual(['entry']);
    const inI18n = scan({ entries: [entry({ i18n: { en: { seo: { ogImage: { assetId: IMG } } } } })] });
    expect(kinds(inI18n)).toEqual(['entry']);
  });

  it('figure trong richdoc', () => {
    const body = [
      { b: 'p', c: [{ t: 'text', v: 'Mở bài' }] },
      { b: 'figure', assetId: IMG, alt: 'Hình' },
    ];
    const m = scan({ entries: [entry({ data: { title: 'x', body } })] });
    expect(kinds(m)).toEqual(['entry']);
  });

  it('URL trong field html (CKEditor lưu URL, không lưu id)', () => {
    const html = `<p>Mở bài</p><figure class="image"><img src="${CDN}/${KEY}" alt=""></figure>`;
    const m = scan({ entries: [entry({ data: { title: 'x', content: html } })] });
    expect(kinds(m)).toEqual(['entry']);
  });

  it('URL dính dấu chấm cuối câu vẫn khớp', () => {
    const m = scan({ entries: [entry({ data: { title: 'x', note: `Xem ${CDN}/${KEY}.` } })] });
    expect(kinds(m)).toEqual(['entry']);
  });

  it('entry chưa đặt tiêu đề lấy slug làm nhãn; entry lưu trữ vẫn chặn', () => {
    const m = scan({
      entries: [entry({ archived: true, data: { title: '  ', cover: { assetId: IMG } } })],
    });
    expect(m.get(IMG)!.blocking[0]!.label).toBe('Bài viết: bai-mot (đã lưu trữ)');
  });
});

describe('scanAssetReferences — trang', () => {
  it('ảnh trong bản nháp trang', () => {
    const m = scan({
      pages: [page({ draftDoc: doc({ a: base('a', { type: 'Image', assetId: IMG }) }) })],
    });
    expect(m.get(IMG)!.blocking).toEqual([
      { kind: 'page', label: 'Blog — /blog', href: '/builder/p1' },
    ]);
  });

  it('trang đã lưu trữ vẫn chặn, trỏ về danh sách lưu trữ', () => {
    const m = scan({
      pages: [
        page({
          archived: true,
          draftDoc: doc({ a: base('a', { type: 'Image', assetId: IMG }) }),
        }),
      ],
    });
    expect(m.get(IMG)!.blocking).toEqual([
      { kind: 'archived-page', label: 'Blog — /blog (đã lưu trữ)', href: '/builder' },
    ]);
  });

  it('og trang', () => {
    const m = scan({ pages: [page({ ogImageId: IMG })] });
    expect(kinds(m)).toEqual(['page-og']);
  });

  it('ảnh chỉ nằm trong component mà trang cắm', () => {
    const presets = [
      {
        id: 'card',
        name: 'Thẻ',
        tree: { rootId: 'c', nodes: { c: base('c', { type: 'Image', assetId: IMG }) } },
      },
    ];
    const m = scan({
      presets,
      pages: [
        page({
          draftDoc: doc({
            root: base('root', { type: 'Section', children: ['i1'] }),
            i1: base('i1', { type: 'Instance', componentId: 'card', overrides: {} }),
          }),
        }),
      ],
    });
    expect(kinds(m).sort()).toEqual(['component', 'page']);
  });

  it('url() trong customCss của node', () => {
    const m = scan({
      pages: [
        page({
          draftDoc: doc({
            a: base('a', { type: 'Section', customCss: `& { background: url("${CDN}/${KEY}"); }` }),
          }),
        }),
      ],
    });
    expect(kinds(m)).toEqual(['page']);
  });

  it('doc hỏng không migrate được vẫn được quét mù, không bị bỏ qua', () => {
    const m = scan({
      pages: [page({ draftDoc: { schemaVersion: 99, nodes: { a: { assetId: IMG } } } })],
    });
    expect(kinds(m)).toEqual(['page']);
  });

  it('JSON-LD mang URL ảnh', () => {
    const m = scan({ pages: [page({ jsonLd: { '@type': 'Article', image: `${CDN}/${KEY}` } })] });
    expect(kinds(m)).toEqual(['page']);
  });

  it('ảnh theo ngôn ngữ trong bảng Translation', () => {
    const m = scan({
      pages: [page()],
      draftTranslations: [{ pageId: 'p1', locale: 'en', value: IMG }],
    });
    expect(m.get(IMG)!.blocking).toEqual([
      { kind: 'page', label: 'Blog — /blog (bản dịch en)', href: '/builder/p1' },
    ]);
  });
});

describe('scanAssetReferences — component và effect preset', () => {
  it('preset không có instance nào vẫn chặn', () => {
    const m = scan({
      presets: [
        {
          id: 'hero',
          name: 'Hero',
          tree: {
            rootId: 'h',
            nodes: { h: base('h', { type: 'Section', style: { base: { fill: { image: { assetId: IMG } } } } }) },
          },
        },
      ],
    });
    expect(m.get(IMG)!.blocking).toEqual([
      { kind: 'component', label: 'Component “Hero”', href: '/builder/components/hero' },
    ]);
  });

  it('khung image-sequence trong effect preset', () => {
    const m = scan({
      effectPresets: [
        {
          id: 'ep1',
          name: 'Clip mở đầu',
          effectKey: 'image-sequence',
          params: { frames: [OTHER], framesNarrow: [IMG] },
        },
      ],
    }, [IMG, OTHER]);
    expect(kinds(m)).toEqual(['effect-preset']);
    expect(kinds(m, OTHER)).toEqual(['effect-preset']);
    expect(m.get(IMG)!.blocking[0]!.href).toBeUndefined();
  });

  it('effectPresetAssetIds chỉ đọc tham số khai trong EFFECT_ASSET_PARAMS', () => {
    expect(effectPresetAssetIds('image-sequence', { frames: ['a', '', 3], pinPart: 'b' })).toEqual(['a']);
    expect(effectPresetAssetIds('tilt', { frames: ['a'] })).toEqual([]);
  });
});

describe('scanAssetReferences — cấu hình site, người dùng, token', () => {
  const site = { faviconAssetId: null, ogImageId: null, globals: {} };

  it('favicon', () => {
    const m = scan({ sites: [{ ...site, faviconAssetId: IMG }] });
    expect(m.get(IMG)!.blocking).toEqual([
      { kind: 'favicon', label: 'Favicon của site', href: '/builder/settings' },
    ]);
  });

  it('og site', () => {
    const m = scan({ sites: [{ ...site, ogImageId: IMG }] });
    expect(kinds(m)).toEqual(['site-og']);
  });

  it('Site.globals mang URL ảnh', () => {
    const m = scan({ sites: [{ ...site, globals: { logoUrl: `${CDN}/${KEY}` } }] });
    expect(kinds(m)).toEqual(['site-globals']);
  });

  it('avatar', () => {
    const m = scan({ users: [{ email: 'a@x.vn', name: 'An', avatarAssetId: IMG }] });
    expect(m.get(IMG)!.blocking).toEqual([
      { kind: 'avatar', label: 'Ảnh đại diện của An', href: '/builder/admin' },
    ]);
  });

  it('token có url()', () => {
    const m = scan({ tokens: [{ name: 'hero-bg', value: `url(${CDN}/${KEY})` }] });
    expect(m.get(IMG)!.blocking).toEqual([
      { kind: 'token', label: 'Token --hero-bg', href: '/builder/settings' },
    ]);
  });
});

describe('scanAssetReferences — release', () => {
  const docWithImg = () => doc({ a: base('a', { type: 'Image', assetId: IMG }) });

  it('release đang chạy chặn, kể cả khi ảnh đã rời bản nháp', () => {
    const m = scan({
      pages: [page({ draftDoc: emptyDoc() })],
      liveReleases: [release({ entries: [{ slug: 'blog', versionId: 'v-old' }] })],
      versionDocs: new Map([['v-old', docWithImg()]]),
    });
    expect(m.get(IMG)!.blocking).toEqual([
      { kind: 'live-release', label: 'Site đang chạy — /blog', href: '/builder/releases' },
    ]);
    expect(m.get(IMG)!.oldReleases).toEqual([]);
  });

  it('release đang chạy đọc cây component của CHÍNH nó, không đọc bảng Preset', () => {
    // Component đã bị xoá khỏi thư viện, nhưng ảnh chụp của release vẫn vẽ nó.
    const components = new Map([
      ['gone', { rootId: 'g', nodes: { g: base('g', { type: 'Image', assetId: IMG }) as unknown as Node } }],
    ]);
    const m = scan({
      liveReleases: [release({ components, entries: [{ slug: '', versionId: 'v1' }] })],
      versionDocs: new Map([
        ['v1', doc({ i: base('i', { type: 'Instance', componentId: 'gone', overrides: {} }) })],
      ]),
    });
    expect(m.get(IMG)!.blocking.map((r) => r.label)).toEqual(['Site đang chạy — /']);
  });

  it('ảnh chụp bản dịch, token, globals của release đang chạy', () => {
    const m = scan({
      liveReleases: [
        release({
          translations: { 'en:hero:assetId': IMG },
          tokens: { 'hero-bg': `url(${CDN}/${KEY})` },
          globals: { logo: `${CDN}/${KEY}` },
        }),
      ],
    });
    expect(m.get(IMG)!.blocking.map((r) => r.label)).toEqual([
      'Site đang chạy — bản dịch en',
      'Site đang chạy — token',
      'Site đang chạy — thông tin chung',
    ]);
  });

  it('release cũ chỉ cảnh báo, không chặn', () => {
    const m = scan({
      oldReleases: [
        release({
          id: 'r0',
          label: 'Publish cũ',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          entries: [{ slug: 'blog', versionId: 'v0' }],
        }),
      ],
      versionDocs: new Map([['v0', docWithImg()]]),
    });
    expect(m.get(IMG)!.blocking).toEqual([]);
    expect(m.get(IMG)!.oldReleases).toEqual([
      { id: 'r0', label: 'Publish cũ', createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
  });

  it('release cũ có ảnh ở nhiều trang chỉ cho một dòng cảnh báo', () => {
    const m = scan({
      oldReleases: [
        release({
          id: 'r0',
          entries: [
            { slug: 'a', versionId: 'v0' },
            { slug: 'b', versionId: 'v0' },
          ],
          tokens: { bg: `url(${CDN}/${KEY})` },
        }),
      ],
      versionDocs: new Map([['v0', docWithImg()]]),
    });
    expect(m.get(IMG)!.oldReleases).toHaveLength(1);
  });
});

describe('idsInJson — quét theo key', () => {
  it('không khớp nhầm khi key là hậu tố của một tên file khác', () => {
    const ctx = createScanContext([IMG], [{ id: IMG, key: 'logo.png' }]);
    expect([...idsInJson('/img/footer-logo.png', ctx)]).toEqual([]);
    expect([...idsInJson('/img/logo.png?v=2', ctx)]).toEqual([IMG]);
  });

  it('key mang ký tự lạ vẫn quét được', () => {
    const ctx = createScanContext([IMG], [{ id: IMG, key: 'ảnh cũ/hero 1.png' }]);
    expect([...idsInJson({ css: 'url("/ảnh cũ/hero 1.png")' }, ctx)]).toEqual([IMG]);
  });

  it('chỉ trả id trong lô đang kiểm', () => {
    const ctx = createScanContext([IMG], ASSETS);
    expect([...idsInJson([OTHER, `${CDN}/public/builder/khac-9f8e7d6c.png`, IMG], ctx)]).toEqual([IMG]);
  });
});
