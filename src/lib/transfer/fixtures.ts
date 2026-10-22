// Dữ liệu test dùng chung cho các test của transfer (không chứa test, không đưa vào bundle).
import { BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION } from './manifest';

export const SHA = 'a'.repeat(64);

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
