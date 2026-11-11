// Dữ liệu test dùng chung cho các test của transfer (không chứa test, không đưa vào bundle).
import { BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION } from './manifest';

export const SHA = 'a'.repeat(64);

/** Hai file font của họ Gilroy trong gói mẫu: weight 300 (sha `b…`) và 400 (sha `c…`). */
export const FONT_SHA_300 = 'b'.repeat(64);
export const FONT_SHA_400 = 'c'.repeat(64);

export function fontAsset(id: string, name: string, sha: string) {
  return {
    id, key: `public/builder/${name}-${sha.slice(0, 8)}.woff2`, name: `${name}.woff2`,
    kind: 'font', mime: 'font/woff2', bytes: 20, width: null, height: null, blurhash: null,
    alt: null, folder: 'fonts/gilroy', sha256: sha, file: `files/${sha}.woff2`,
  };
}

export const GILROY_ASSETS = [
  fontAsset('cfont000000000000000000300', 'gilroy-light', FONT_SHA_300),
  fontAsset('cfont000000000000000000400', 'gilroy-regular', FONT_SHA_400),
];

export function sampleFont(over: Record<string, unknown> = {}) {
  return {
    slug: 'gilroy', cssName: 'Gilroy', fallback: 'system-ui, sans-serif', source: 'upload',
    googleFamily: null, licenseNote: 'Mua bản web 2025',
    faces: [
      { weight: '300', style: 'normal', unicodeRange: '', subset: '', assetRef: 'cfont000000000000000000300' },
      { weight: '400', style: 'normal', unicodeRange: '', subset: '', assetRef: 'cfont000000000000000000400' },
    ],
    ...over,
  };
}

export function sampleBundle(over: Record<string, unknown> = {}) {
  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    exportedAt: '2026-10-14T08:00:00.000Z',
    exportedBy: 'admin@example.com',
    source: { siteName: 'Quilder Demo', origin: 'localhost', pageId: 'csrcpage000000000000000001' },
    schemaVersion: 2,
    page: {
      slug: 'abc', title: 'ABC', description: null, canonical: null, noindex: false,
      jsonLd: null, ogImageId: null, collection: null,
    },
    doc: { schemaVersion: 2, rootId: 'root', nodes: {} },
    translations: [],
    locales: [],
    components: [],
    tokens: [],
    assets: [{
      id: 'casset00000000000000000001', key: 'public/builder/hero-aaaaaaaa.png', name: 'hero.png',
      kind: 'image', mime: 'image/png', bytes: 10, width: 1, height: 1, blurhash: null,
      alt: 'Ảnh', folder: 'trang-chu', sha256: SHA, file: `files/${SHA}.png`,
    }],
    needs: { endpointKeys: [], embedOrigins: [], collectionTypes: [], collection: null },
    ...over,
  };
}
