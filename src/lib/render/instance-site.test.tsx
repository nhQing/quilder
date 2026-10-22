import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Component làm HEADER / FOOTER của cả site.
 *
 * Mỗi test khoá một chỗ mà instance từng KHÔNG làm được, và hỏng thì im lặng:
 * effect trong component không chạy, `#contact` không tồn tại, link hash đi qua
 * next/link, composite/video biến mất, header sticky không dính theo trang.
 */

import type { Doc, Node } from '@/lib/doc/types';
import { compileDoc } from './css';
import { collectEffects, NodeRenderer, type RenderContext } from './NodeRenderer';
import { instanceAssetIds, isLayoutTransparent } from './instance';

const base = { parentId: null, children: [] as string[], style: { base: {} }, effects: [] };
const n = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as Node;

const fx = (id: string, effect: string, params: Record<string, unknown> = {}) => ({
  id,
  effect,
  params,
  gates: {},
});

/** Header: root Section (có effect + parts), link hash/route, nút anchor, accordion, video, form. */
const tree = (over: Record<string, Node> = {}) => ({
  rootId: 'hdr',
  nodes: {
    hdr: n({
      id: 'hdr', type: 'Section', tag: 'header', part: 'header', htmlId: 'top',
      children: ['pill', 'contact', 'toHash', 'toRoute', 'toAnchor', 'acc', 'vid', 'frm'],
      effects: [fx('e1', 'nav-collapse'), fx('e2', 'image-sequence', { frames: ['a1', 'a2'] })],
      style: {
        base: { position: { kind: 'sticky', top: { v: 0, u: 'px' } } },
        states: { collapsed: { fill: {} } },
      },
    }),
    pill: n({ id: 'pill', type: 'Stack', part: 'pill', parentId: 'hdr' }),
    contact: n({ id: 'contact', type: 'Stack', htmlId: 'contact', parentId: 'hdr' }),
    toHash: n({
      id: 'toHash', type: 'Button', variant: 'primary', parentId: 'hdr',
      label: [{ t: 'text', v: 'Chương' }], action: { kind: 'link', href: '#section-3' },
    }),
    toRoute: n({
      id: 'toRoute', type: 'Button', variant: 'primary', parentId: 'hdr',
      label: [{ t: 'text', v: 'Blog' }], action: { kind: 'link', href: '/blogs' },
    }),
    toAnchor: n({
      id: 'toAnchor', type: 'Button', variant: 'primary', parentId: 'hdr',
      label: [{ t: 'text', v: 'Liên hệ' }], action: { kind: 'anchor', toNodeId: 'contact' },
    }),
    acc: n({
      id: 'acc', type: 'Composite', composite: 'Accordion', params: {}, parentId: 'hdr',
      slots: { 'q-1': ['q1'], 'a-1': ['a1'] },
    }),
    q1: n({ id: 'q1', type: 'Text', tag: 'p', content: [{ t: 'text', v: 'Câu hỏi' }] }),
    a1: n({ id: 'a1', type: 'Text', tag: 'p', content: [{ t: 'text', v: 'Trả lời' }] }),
    vid: n({ id: 'vid', type: 'Video', assetId: 'v1', posterAssetId: 'p1', parentId: 'hdr' }),
    frm: n({
      id: 'frm', type: 'Composite', composite: 'Form', params: {}, parentId: 'hdr',
      slots: { heading: ['fh'] },
    }),
    fh: n({ id: 'fh', type: 'Text', tag: 'h3', content: [{ t: 'text', v: 'Đăng ký' }] }),
    ...over,
  },
});

const doc = (instance: Record<string, unknown> = {}): Doc =>
  ({
    schemaVersion: 1,
    rootId: 'page',
    nodes: {
      page: n({ id: 'page', type: 'Section', tag: 'main', children: ['inst'] }),
      inst: n({
        id: 'inst', type: 'Instance', componentId: 'C1', parentId: 'page', overrides: {},
        ...instance,
      }),
    },
  }) as unknown as Doc;

const components = (t = tree()) => new Map([['C1', t]]);

const ctxOf = (d: Doc, t = tree()): RenderContext => ({
  doc: d,
  scope: { site: {}, page: {} },
  assets: {
    v1: { url: '/v.mp4', mime: 'video/mp4' },
    p1: { url: '/p.jpg', mime: 'image/jpeg' },
  },
  components: components(t),
});

const html = (d: Doc) => renderToStaticMarkup(<NodeRenderer nodeId="page" ctx={ctxOf(d)} />);

const withSecondInstance = (d: Doc): Doc => {
  (d.nodes as Record<string, Node>).inst2 = n({
    id: 'inst2', type: 'Instance', componentId: 'C1', parentId: 'page', overrides: {},
  });
  (d.nodes.page as { children: string[] }).children.push('inst2');
  return d;
};

describe('effect trong component → manifest', () => {
  it('node của component vào manifest với scopeId = id Instance của doc', () => {
    const m = collectEffects(doc(), undefined, components());
    const inner = m.filter((e) => e.scopeId);
    expect(inner.map((e) => [e.nodeId, e.effect, e.scopeId])).toEqual([
      ['hdr', 'nav-collapse', 'inst'],
      ['hdr', 'image-sequence', 'inst'],
    ]);
    // id effect phải duy nhất toàn trang dù component cắm nhiều lần.
    expect(inner[0]!.instanceId).toBe('inst:e1');
  });

  it('không có `components` thì effect trong component không vào manifest', () => {
    expect(collectEffects(doc()).filter((e) => e.scopeId)).toEqual([]);
  });

  it('instance LẶP từ chối effect', () => {
    const d = doc({ repeat: { source: { kind: 'field', field: 'x' }, map: {} } });
    expect(collectEffects(d, undefined, components()).filter((e) => e.scopeId)).toEqual([]);
  });

  it('hai instance cùng component → hai bộ, mỗi bộ scope riêng', () => {
    const scopes = collectEffects(withSecondInstance(doc()), undefined, components()).map(
      (e) => e.scopeId,
    );
    expect(scopes.filter((s) => s === 'inst')).toHaveLength(2);
    expect(scopes.filter((s) => s === 'inst2')).toHaveLength(2);
  });

  it('lô khung image-sequence của node trong component đổi thành URL', () => {
    const assets = { a1: { url: '/1.jpg' }, a2: { url: '/2.jpg' } };
    const seq = collectEffects(doc(), assets, components()).find(
      (e) => e.effect === 'image-sequence',
    );
    expect(seq?.params.frames).toEqual(['/1.jpg', '/2.jpg']);
  });

  it('asset của effect trong component được tính vào tập cần nạp / chống xoá', () => {
    expect(instanceAssetIds(tree(), {})).toEqual(expect.arrayContaining(['a1', 'a2']));
  });
});

describe('data-part và htmlId trong instance', () => {
  it('phát data-part và htmlId cho instance không lặp', () => {
    const out = html(doc());
    expect(out).toContain('data-part="header"');
    expect(out).toContain('data-part="pill"');
    expect(out).toContain('id="contact"');
    expect(out).toContain('id="top"');
  });

  it('KHÔNG phát htmlId cho instance lặp', () => {
    const d = doc({ repeat: { source: { kind: 'field', field: 'x' }, map: {} } });
    const ctx = {
      ...ctxOf(d),
      repeatItems: new Map([['inst', [{ key: 'k1', data: {} }, { key: 'k2', data: {} }]]]),
    };
    const out = renderToStaticMarkup(
      <NodeRenderer nodeId="page" ctx={ctx as unknown as RenderContext} />,
    );
    expect(out).not.toContain('id="contact"');
    expect(out).toContain('data-cn="contact"');
  });
});

describe('link trong component', () => {
  const out = html(doc());

  it('hash thuần là <a href="#…"> (bindAnchors cuộn mượt)', () => {
    expect(out).toMatch(/<a [^>]*href="#section-3"/);
  });

  it('route nội bộ vẫn là link', () => {
    expect(out).toMatch(/<a [^>]*href="\/blogs"/);
  });

  it('anchor tới node local có htmlId → <a href="#contact">', () => {
    expect(out).toMatch(/<a [^>]*href="#contact"[^>]*data-anchor/);
  });
});

describe('Composite / Video trong instance', () => {
  const out = html(doc());

  it('Accordion dựng từ slot của component', () => {
    expect(out).toContain('data-composite="Accordion"');
    expect(out).toContain('<details');
    expect(out).toContain('Câu hỏi');
    expect(out).toContain('Trả lời');
  });

  it('Form dựng heading từ slot', () => {
    expect(out).toContain('data-composite="Form"');
    expect(out).toContain('Đăng ký');
  });

  it('Video dùng asset + poster', () => {
    expect(out).toMatch(/<video[^>]*src="\/v\.mp4"/);
    expect(out).toContain('poster="/p.jpg"');
  });

  it('override assetId của Video được tôn trọng', () => {
    const d = doc({ overrides: { vid: { assetId: 'v2' } } });
    const ctx = ctxOf(d);
    ctx.assets.v2 = { url: '/v2.mp4', mime: 'video/mp4' };
    expect(renderToStaticMarkup(<NodeRenderer nodeId="page" ctx={ctx} />)).toContain(
      'src="/v2.mp4"',
    );
  });

  it('hai instance: nhóm Accordion không chung name', () => {
    const o = html(withSecondInstance(doc()));
    const names = [...o.matchAll(/<details[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('wrapper trong suốt cho header sticky', () => {
  it('root sticky + instance không style → display:contents', () => {
    expect(html(doc())).toMatch(/data-n="inst"[^>]*style="display:contents"/);
  });

  it('instance có style riêng thì giữ wrapper thật', () => {
    const d = doc({ style: { base: { spacing: { padding: { pt: { v: 8, u: 'px' } } } } } });
    expect(isLayoutTransparent(d.nodes.inst!, tree())).toBe(false);
    expect(html(d)).not.toContain('display:contents');
  });

  it('root không sticky/fixed thì giữ wrapper (footer thường)', () => {
    const t = tree({ hdr: { ...tree().nodes.hdr!, style: { base: {} } } as Node });
    expect(isLayoutTransparent(doc().nodes.inst!, t)).toBe(false);
  });
});

describe('CSS state cho node trong component', () => {
  it('states do effect ghi → selector [data-collapsed="true"] scope theo component', () => {
    // `fill` rỗng không phát khai báo nào, nên cho state một màu thật.
    const t = tree({
      hdr: {
        ...tree().nodes.hdr!,
        style: {
          base: { position: { kind: 'sticky' } },
          states: { collapsed: { effects: { opacity: 0.5 } } },
        },
      } as Node,
    });
    const { css } = compileDoc(doc(), components(t));
    expect(css).toContain('[data-c="C1"] [data-cn="hdr"][data-collapsed="true"]');
  });
});
