import { describe, expect, it, vi } from 'vitest';

import type { AssetUse } from './collect';
import {
  exportIssues, isMissingError, missingComponentRefs, readExportFile, tooLargeIssue, unreadableIssues,
} from './export';

describe('exportIssues', () => {
  const uses = new Map([
    ['gone', [{ kind: 'component' as const, componentId: 'c-header', nodeId: 'logo' }]],
    ['big', [{ kind: 'page' as const, nodeId: 'hero' }]],
  ]);

  it('X1 nói ảnh nào và ở đâu, kèm link mở đúng node trong component', () => {
    const out = exportIssues({
      pageId: 'p1', uses, rows: new Map([['big', { name: 'hero.mp4', bytes: 12 * 1024 * 1024 }]]),
      missingComponents: [], nodeLabels: { hero: 'Video hero' }, collection: false,
    });
    const x1 = out.find((i) => i.code === 'asset-row-missing');
    expect(x1?.level).toBe('block');
    expect(x1?.items?.[0]).toEqual({ label: 'Ảnh gone — component c-header › node logo', href: '/builder/components/c-header?node=logo' });
    const w1 = out.find((i) => i.code === 'file-over-import-limit');
    expect(w1?.level).toBe('warn');
    expect(w1?.items?.[0]?.label).toContain('hero.mp4');
    expect(w1?.items?.[0]?.label).toContain('Video hero');
  });

  it('X4 cho instance trỏ component đã xoá; W2 cho trang có collection', () => {
    const out = exportIssues({
      pageId: 'p1', uses: new Map(), rows: new Map(),
      missingComponents: [{ nodeId: 'inst' }], nodeLabels: {}, collection: true,
    });
    expect(out.map((i) => i.code)).toEqual(['component-missing', 'entries-not-included']);
    expect(out[0]!.items?.[0]?.href).toBe('/builder/p1?node=inst');
  });
});

describe('tooLargeIssue', () => {
  const frames = (node: string, n: number) =>
    Array.from({ length: n }, (_, i) => [`${node}-${i}`, [{ kind: 'page', nodeId: node }]] as [string, AssetUse[]]);

  it('X6 không báo khi trong giới hạn', () => {
    expect(tooLargeIssue({ pageId: 'p1', assetCount: 10, manifestBytes: 1000, uses: new Map(frames('a', 10)), nodeLabels: {} })).toBeNull();
  });

  it('X6 chặn khi quá 5000 asset và nêu 3 node nhiều ảnh nhất', () => {
    const uses = new Map([...frames('a', 5), ...frames('b', 4), ...frames('c', 3), ...frames('d', 1)]);
    const out = tooLargeIssue({ pageId: 'p1', assetCount: 5001, manifestBytes: 1000, uses, nodeLabels: { a: 'Dãy khung' } });
    expect(out?.code).toBe('too-large');
    expect(out?.level).toBe('block');
    expect(out?.items).toHaveLength(3);
    expect(out?.items?.[0]?.label).toContain('Dãy khung');
    expect(out?.items?.[0]?.label).toContain('5');
    expect(out?.items?.[0]?.href).toBe('/builder/p1?node=a');
  });

  it('X6 chặn khi manifest quá 5 MB (đếm theo byte UTF-8 do nơi gọi đo)', () => {
    const out = tooLargeIssue({ pageId: 'p1', assetCount: 1, manifestBytes: 5 * 1024 * 1024 + 1, uses: new Map(), nodeLabels: {} });
    expect(out?.code).toBe('too-large');
  });
});

describe('unreadableIssues', () => {
  const file = (id: string, key: string) => ({ entry: '', asset: { id, key, url: `https://s3/${key}` } });
  const uses = new Map<string, AssetUse[]>([['a1', [{ kind: 'page', nodeId: 'hero' }]]]);
  const s3 = (status: number) => Object.assign(new Error('x'), { $metadata: { httpStatusCode: status } });

  it('404/403/NoSuchKey/ENOENT là X2, kèm chỗ dùng và link', () => {
    for (const error of [s3(404), s3(403), Object.assign(new Error('x'), { name: 'NoSuchKey' }), Object.assign(new Error('x'), { code: 'ENOENT' })]) {
      expect(isMissingError(error)).toBe(true);
    }
    const out = unreadableIssues([{ file: file('a1', 'img/hero-1a2b3c4d.png'), error: s3(404) }], uses, 'p1', { hero: 'Hero' });
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('asset-file-missing');
    expect(out[0]!.items?.[0]).toEqual({ label: 'hero.png — trang › Hero', href: '/builder/p1?node=hero' });
  });

  it('lỗi mạng / 500 là X3', () => {
    expect(isMissingError(new Error('connect ECONNREFUSED'))).toBe(false);
    const out = unreadableIssues([{ file: file('a1', 'k.png'), error: new Error('connect ECONNREFUSED') }], uses, 'p1', {});
    expect(out.map((i) => i.code)).toEqual(['storage-unreachable']);
  });

  it('bất biến: mỗi file đọc lỗi đều có mặt trong issue block', () => {
    const failures = [
      { file: file('a1', 'a.png'), error: s3(404) },
      { file: file('a2', 'b.png'), error: s3(404) },
      { file: file('a3', 'c.png'), error: new Error('timeout') },
    ];
    const out = unreadableIssues(failures, uses, 'p1', {});
    expect(out.every((i) => i.level === 'block')).toBe(true);
    expect(out.find((i) => i.code === 'asset-file-missing')?.items).toHaveLength(2);
    expect(out.find((i) => i.code === 'storage-unreachable')).toBeDefined();
  });
});

describe('missingComponentRefs', () => {
  it('bắt cả component trong repeat.blockComponents', () => {
    const nodes = {
      i1: { id: 'i1', type: 'Instance', componentId: 'ok', repeat: { blockComponents: { quote: 'gone', text: 'ok' } } },
      i2: { id: 'i2', type: 'Instance', componentId: 'gone2' },
      i3: { id: 'i3', type: 'Instance', componentId: 'ok' },
    } as never;
    expect(missingComponentRefs(nodes, new Set(['ok']))).toEqual([{ nodeId: 'i1' }, { nodeId: 'i2' }]);
  });
});

describe('buildExport - họ font (spec §13.1)', () => {
  const base = { children: [], effects: [] };
  const doc = {
    schemaVersion: 2, rootId: 'root',
    nodes: {
      root: { ...base, id: 'root', type: 'Section', tag: 'main', parentId: null, children: ['h'], style: { base: {} } },
      h: {
        ...base, id: 'h', type: 'Text', tag: 'h1', parentId: 'root', content: [{ t: 'text', v: 'Chào' }],
        style: { base: { typography: { family: { $token: 'font-gilroy' }, color: { $token: 'mau-rieng' } } } },
      },
    },
  };
  const assets = [
    { id: 'cfont300', key: 'public/builder/gilroy-light-bbbbbbbb.woff2', url: 'https://s3/public/builder/gilroy-light-bbbbbbbb.woff2', kind: 'font', mime: 'font/woff2', bytes: 3, width: null, height: null, blurhash: null, alt: null, folder: 'fonts/gilroy' },
    { id: 'cfont400', key: 'public/builder/gilroy-regular-cccccccc.woff2', url: 'https://s3/public/builder/gilroy-regular-cccccccc.woff2', kind: 'font', mime: 'font/woff2', bytes: 3, width: null, height: null, blurhash: null, alt: null, folder: 'fonts/gilroy' },
  ];

  async function run() {
    vi.resetModules();
    const fontQuery = vi.fn(async () => [{
      slug: 'gilroy', cssName: 'Gilroy', fallback: 'system-ui, sans-serif', source: 'upload', googleFamily: null, licenseNote: 'Mua bản web',
      faces: [
        { weight: '400', style: 'normal', unicodeRange: '', subset: '', assetId: 'cfont400' },
        { weight: '300', style: 'normal', unicodeRange: '', subset: '', assetId: 'cfont300' },
      ],
    }]);
    vi.doMock('@/lib/db', () => ({
      prisma: {
        page: {
          findUnique: async () => ({
            id: 'p1', slug: 'abc', title: 'ABC', description: null, canonical: null, noindex: false, jsonLd: null,
            ogImageId: null, collection: null, draftVersion: { doc }, site: { name: 'Demo' },
          }),
        },
        preset: { findMany: async () => [] },
        translation: { findMany: async () => [] },
        asset: { findMany: async (q: { where: { id: { in: string[] } } }) => assets.filter((a) => q.where.id.in.includes(a.id)) },
        token: {
          findMany: async () => [
            { name: 'font-gilroy', value: '"Gilroy", system-ui, sans-serif', category: 'font', group: null, aiDescription: null },
            { name: 'mau-rieng', value: '#112233', category: 'color', group: null, aiDescription: null },
          ],
        },
        locale: { findMany: async () => [] },
        fontFamily: { findMany: fontQuery },
      },
    }));
    vi.doMock('@/lib/assets/s3', () => ({ getObject: async () => new Uint8Array([1, 2, 3]) }));
    vi.doMock('@/lib/site/origin', () => ({ configuredSiteOrigin: async () => null }));
    const { buildExport } = await import('./export');
    const r = await buildExport('p1', 'a@b.c');
    return { r, fontQuery };
  }

  it('trang dùng font-gilroy → fonts có một họ, assetRef trỏ vào assets[], token của họ không nằm trong tokens[]', async () => {
    const { r, fontQuery } = await run();
    if (!r.ok) throw new Error(r.error);
    expect(r.issues).toEqual([]);
    expect(fontQuery).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: { in: ['gilroy'] } } }));
    expect(r.bundle.fonts).toEqual([{
      slug: 'gilroy', cssName: 'Gilroy', fallback: 'system-ui, sans-serif', source: 'upload', googleFamily: null, licenseNote: 'Mua bản web',
      faces: [
        { weight: '300', style: 'normal', unicodeRange: '', subset: '', assetRef: 'cfont300' },
        { weight: '400', style: 'normal', unicodeRange: '', subset: '', assetRef: 'cfont400' },
      ],
    }]);
    const ids = new Set(r.bundle.assets.map((a) => a.id));
    for (const f of r.bundle.fonts[0]!.faces) expect(ids.has(f.assetRef)).toBe(true);
    // File font đi cùng đường với ảnh: files/<sha256>.<đuôi>.
    expect(r.files.map((f) => f.entry)).toEqual([expect.stringMatching(/^files\/[0-9a-f]{64}\.woff2$/)]);
    expect(r.bundle.tokens.map((t) => t.name)).toEqual(['mau-rieng']);
  });
});

describe('readExportFile', () => {
  it('không đọc ra ngoài public/ — coi như file mất (X2)', async () => {
    const err = await readExportFile({ entry: '', asset: { key: 'k', url: '/../package.json' } }).catch((e) => e);
    expect(isMissingError(err)).toBe(true);
  });
});
