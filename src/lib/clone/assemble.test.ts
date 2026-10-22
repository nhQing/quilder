import { describe, expect, it } from 'vitest';

import { assembleCloneDoc, collectAssetRefs, CloneAssembleError } from './assemble';
import type { RawDoc, RawNode } from './types';

const node = (over: Record<string, unknown>): RawNode =>
  ({ children: [], effects: [], style: { base: {} }, parentId: 'root', ...over }) as unknown as RawNode;

function raw(): RawDoc {
  return {
    rootId: 'root',
    nodes: {
      root: node({ id: 'root', parentId: null, type: 'Stack', direction: { base: 'column' }, children: ['h', 'img', 'vid', 'bg', 'ghost'] }),
      h: node({
        id: 'h', type: 'Text', tag: 'h1', content: [{ t: 'text', v: 'Xin chào' }],
        style: { base: { typography: { weight: 800, transform: 'capitalize', size: { v: 40, u: 'px' } }, layout: { display: 'flex', bogus: 1 } } },
        _vis: 1, _area: 10,
      }),
      img: node({ id: 'img', type: 'Image', assetId: null, alt: '', fit: { base: 'cover' }, _src: 'https://cdn.test/a.png' }),
      vid: node({ id: 'vid', type: 'Video', assetId: null, posterAssetId: null, _src: 'https://cdn.test/v.mp4', _posterSrc: 'https://cdn.test/p.jpg' }),
      bg: node({
        id: 'bg', type: 'Stack', direction: { base: 'row' }, _bgSrc: ['https://cdn.test/bg.jpg'],
        style: { base: { fill: { image: { assetId: '__bg__', fit: 'cover' } } }, md: { fill: { image: { assetId: '__bg__', fit: 'contain' } } } },
      }),
      // Mồ côi: không ai liệt kê nó trong children.
      orphan: node({ id: 'orphan', type: 'Stack', direction: { base: 'row' } }),
      // Id con không tồn tại trong nodes — phải bị lọc.
    },
  } as unknown as RawDoc;
}

const assetsOk = {
  'https://cdn.test/a.png': { assetId: 'A1' },
  'https://cdn.test/v.mp4': { assetId: 'V1' },
  'https://cdn.test/p.jpg': { assetId: 'P1' },
  'https://cdn.test/bg.jpg': { assetId: 'B1' },
};

describe('collectAssetRefs', () => {
  it('gom mọi nguồn một lần, kèm loại', () => {
    const refs = collectAssetRefs(raw());
    expect(refs.map((r) => r.ref).sort()).toEqual(Object.keys(assetsOk).sort());
    expect(refs.find((r) => r.ref.endsWith('v.mp4'))?.kind).toBe('video');
    expect(refs.find((r) => r.ref.endsWith('bg.jpg'))?.kind).toBe('background');
  });

  it('nhận ra SVG nội dòng', () => {
    const d = raw();
    (d.nodes.img as Record<string, unknown>)._src = 'svg:abc';
    expect(collectAssetRefs(d).find((r) => r.ref === 'svg:abc')?.kind).toBe('svg');
  });
});

describe('assembleCloneDoc', () => {
  it('nối asset, gỡ giàn giáo, ép style về schema và bỏ node mồ côi', () => {
    // `ghost` trong children nhưng không có trong nodes.
    const d = raw();
    const out = assembleCloneDoc(d, { assets: assetsOk, notes: {} });
    const n = out.doc.nodes as unknown as Record<string, Record<string, unknown> & { style: Record<string, Record<string, Record<string, unknown>>> }>;

    expect(n.img?.assetId).toBe('A1');
    expect(n.vid?.assetId).toBe('V1');
    expect(n.vid?.posterAssetId).toBe('P1');
    expect(n.bg?.style.base?.fill).toEqual({ image: { assetId: 'B1', fit: 'cover' } });
    expect(n.bg?.style.md?.fill).toEqual({ image: { assetId: 'B1', fit: 'contain' } });

    // Giàn giáo `_…` biến mất hoàn toàn.
    expect(JSON.stringify(out.doc)).not.toMatch(/"_[a-zA-Z]+"/);
    // Node mồ côi và id con không tồn tại bị gỡ.
    expect(n.orphan).toBeUndefined();
    expect(n.root?.children).toEqual(['h', 'img', 'vid', 'bg']);
    expect(n.h?.parentId).toBe('root');

    // 800 → 700 (ghi vào báo cáo), `capitalize` và khoá lạ bị gỡ (cũng ghi vào báo cáo).
    expect(n.h?.style.base?.typography).toEqual({ weight: 700, size: { v: 40, u: 'px' } });
    expect(n.h?.style.base?.layout).toEqual({ display: 'flex' });
    const codes = out.report.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['weight-snapped', 'style-dropped', 'limits']));

    // Ảnh không alt mà không đánh dấu trang trí được sửa thành trang trí (luật missing-alt).
    expect(n.img?.decorative).toBe(true);
  });

  it('asset hỏng: node để trống và BÁO LỖI, không nuốt', () => {
    const out = assembleCloneDoc(raw(), {
      assets: { ...assetsOk, 'https://cdn.test/v.mp4': { error: 'vượt 10 MB (48 MB)', code: 'too-large' } },
      notes: {},
    });
    const n = out.doc.nodes as unknown as Record<string, Record<string, unknown>>;
    expect(n.vid?.assetId).toBeNull();
    expect(out.stats.videosWired).toBe(0);
    const failed = out.report.find((r) => r.code === 'assets-failed');
    expect(failed?.severity).toBe('error');
    expect(failed?.message).toContain('vượt 10 MB');
    // Lỗi đứng đầu báo cáo.
    expect(out.report[0]?.code).toBe('assets-failed');
  });

  it('nền ảnh không tải được thì gỡ fill.image thay vì để assetId giữ chỗ', () => {
    const out = assembleCloneDoc(raw(), { assets: { ...assetsOk, 'https://cdn.test/bg.jpg': { error: 'HTTP 404', code: 'fetch' } }, notes: {} });
    const n = out.doc.nodes as unknown as Record<string, { style: Record<string, Record<string, unknown>> }>;
    expect(n.bg?.style.base?.fill).toBeUndefined();
  });

  it('ghi chú của extractor thành báo cáo có mức độ, lỗi trước cảnh báo trước thông tin', () => {
    const out = assembleCloneDoc(raw(), {
      assets: assetsOk,
      notes: {
        canvas: { count: 2, samples: ['hero__gl'] },
        'internal-link': { count: 3, samples: ['/a'] },
        'behaviour-carousel': { count: 1, samples: ['swiper'] },
        'ma-la': { count: 1, samples: [] },
      },
    });
    const order = out.report.map((r) => r.severity);
    expect(order).toEqual([...order].sort((a, b) => ({ error: 0, warn: 1, info: 2 })[a] - ({ error: 0, warn: 1, info: 2 })[b]));
    expect(out.report.find((r) => r.code === 'canvas')?.message).toContain('KHÔNG clone được');
    expect(out.report.find((r) => r.code === 'ma-la')?.message).toContain('ma-la');
  });

  it('gỡ lỗi cấp node (htmlId sai) thay vì làm hỏng cả clone', () => {
    const d = raw();
    (d.nodes.h as Record<string, unknown>).htmlId = 'KHÔNG HỢP LỆ';
    const out = assembleCloneDoc(d, { assets: assetsOk, notes: {} });
    expect((out.doc.nodes.h as { htmlId?: string }).htmlId).toBeUndefined();
    expect(out.report.find((r) => r.code === 'style-dropped')?.message).toContain('node.htmlId');
  });

  it('lỗi không sửa được thì ném CloneAssembleError nói rõ, không ghi dữ liệu hỏng', () => {
    const d = raw();
    (d.nodes.h as Record<string, unknown>).tag = 'marquee';
    expect(() => assembleCloneDoc(d, { assets: assetsOk, notes: {} })).toThrow(CloneAssembleError);
  });

  it('nhận diện khung header/footer để tách thành component', () => {
    const d = raw();
    d.nodes.root!.children = ['hd', 'ft'];
    d.nodes.hd = node({ id: 'hd', type: 'Section', tag: 'header', parentId: 'root' });
    d.nodes.ft = node({ id: 'ft', type: 'Section', tag: 'footer', parentId: 'root' });
    const out = assembleCloneDoc(d, { assets: {}, notes: {} });
    expect(out.landmarks).toEqual({ header: 'hd', footer: 'ft' });
  });
});
