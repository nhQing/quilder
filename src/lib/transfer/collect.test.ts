import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, type Doc, type Node } from '@/lib/doc/types';
import { assetUses, componentIdsOf, needsOf, tokenNamesOf, tokenRefsOf, useLink, type TreeShape } from './collect';

const n = (node: Record<string, unknown>) => ({ parentId: 'root', children: [], effects: [], style: { base: {} }, ...node }) as unknown as Node;

const doc: Doc = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  rootId: 'root',
  nodes: {
    root: n({ id: 'root', type: 'Section', tag: 'main', parentId: null, children: ['img', 'inst', 'bg'] }),
    img: n({ id: 'img', type: 'Image', assetId: 'a-img', alt: '' }),
    bg: n({
      id: 'bg', type: 'Stack',
      style: { base: { fill: { image: { assetId: 'a-bg', fit: 'cover' } } }, states: { hover: { fill: { image: { assetId: 'a-hover', fit: 'cover' } } } } },
      effects: [{ id: 'e1', effect: 'image-sequence', params: { frames: ['a-f1', 'a-f2'] } }],
      customCss: '& { color: var(--mau-rieng); }',
    }),
    inst: n({ id: 'inst', type: 'Instance', componentId: 'c-header', overrides: { logo: { assetId: 'a-ov' } } }),
  },
};

const header: TreeShape = {
  rootId: 'h',
  nodes: {
    h: n({ id: 'h', type: 'Section', tag: 'header', parentId: null, children: ['logo', 'spare'], style: { base: { color: { $token: 'mau-header' } } } }),
    logo: n({ id: 'logo', type: 'Image', parentId: 'h', assetId: 'a-logo', alt: '' }),
    spare: n({ id: 'spare', type: 'Image', parentId: 'h', assetId: 'a-spare', alt: '' }),
  },
};
const trees = new Map([['c-header', header]]);

describe('componentIdsOf', () => {
  it('nhặt Instance và blockComponents của khối lặp', () => {
    const nodes = {
      ...doc.nodes,
      rep: n({ id: 'rep', type: 'Instance', componentId: 'c-card', overrides: {}, repeat: { source: { kind: 'field', path: 'body' }, map: {}, blockComponents: { quote: 'c-quote' } } }),
    };
    expect(componentIdsOf(nodes).sort()).toEqual(['c-card', 'c-header', 'c-quote']);
  });
});

describe('assetUses', () => {
  const uses = assetUses({
    doc, trees,
    translations: [{ locale: 'en', nodeId: 'img', field: 'assetId', value: 'a-en' }, { locale: 'en', nodeId: 'img', field: 'alt', value: 'x' }],
    ogImageId: 'a-og',
  });

  it('đủ mọi chỗ: ảnh, nền mọi lớp, khung effect, override, toàn cây component, bản dịch, ảnh chia sẻ', () => {
    expect([...uses.keys()].sort()).toEqual(
      ['a-bg', 'a-en', 'a-f1', 'a-f2', 'a-hover', 'a-img', 'a-logo', 'a-og', 'a-ov', 'a-spare'].sort(),
    );
  });

  it('ghi chỗ dùng để báo lỗi nói được "ở đâu"', () => {
    expect(uses.get('a-spare')).toContainEqual({ kind: 'component', componentId: 'c-header', nodeId: 'spare' });
    expect(uses.get('a-en')).toContainEqual({ kind: 'translation', nodeId: 'img', locale: 'en' });
    expect(uses.get('a-og')).toEqual([{ kind: 'og' }]);
  });

  it('link mở editor tại node, cả node trong component', () => {
    expect(useLink('p1', { kind: 'page', nodeId: 'img' })).toBe('/builder/p1?node=img');
    expect(useLink('p1', { kind: 'component', componentId: 'c-header', nodeId: 'logo' })).toBe('/builder/components/c-header?node=logo');
    expect(useLink('p1', { kind: 'og' })).toBe('/builder/p1');
  });
});

describe('tokenNamesOf', () => {
  it('chỉ lấy token TỰ TẠO: $token trong style và var(--x) trong customCss', () => {
    const custom = new Set(['mau-rieng', 'mau-header', 'khong-dung']);
    expect(tokenNamesOf([doc.nodes, header.nodes], custom).sort()).toEqual(['mau-header', 'mau-rieng']);
  });

  it('var(--x) trong css của khối CustomCode cũng tính (khối đó cũng chạy trong trang)', () => {
    const code = n({ id: 'code', type: 'CustomCode', mode: 'inline', html: '<p>x</p>', css: '.a { color: var(--mau-code); background: var( --khong-tu-tao ) }' });
    expect(tokenNamesOf([{ code }], new Set(['mau-code']))).toEqual(['mau-code']);
  });
});

describe('tokenRefsOf', () => {
  it('mọi tên $token (kể cả token tĩnh), không trùng, đã sắp', () => {
    const style = { base: { color: { $token: 'ink' }, gap: { $token: 'space-l' } }, states: { hover: { color: { $token: 'ink' } } } };
    expect(tokenRefsOf([{ a: n({ id: 'a', type: 'Stack', style }) }, null, 'x'])).toEqual(['ink', 'space-l']);
  });
});

describe('needsOf', () => {
  it('khoá endpoint của Form, origin của CustomCode, loại nội dung, và field mà trang mẫu gắn', () => {
    const d: Doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        form: n({ id: 'form', type: 'Composite', composite: 'Form', params: { endpointKey: 'lien-he' }, slots: {} }),
        code: n({ id: 'code', type: 'CustomCode', mode: 'iframe', js: 'load("https://cdn.example.com/x.js")', html: '<script src="https://cdn.example.com/y.js"></script>' }),
        list: n({ id: 'list', type: 'Instance', componentId: 'c-card', overrides: {}, repeat: { source: { kind: 'query', query: { typeKey: 'news', limit: 3 } }, map: {} } }),
        t: n({ id: 't', type: 'Text', tag: 'h1', content: [{ t: 'bind', ref: { source: 'collection', path: 'title' }, fallback: '' }] }),
        body: n({ id: 'body', type: 'Stack', part: 'entry:body' }),
      },
    };
    const needs = needsOf(d, trees, { typeKey: 'news', param: 'entry' });
    expect(needs.endpointKeys).toEqual(['lien-he']);
    expect(needs.embedOrigins).toEqual(['https://cdn.example.com']);
    // Loại của CHÍNH trang mẫu đi qua `collection` (blocker G8), không lặp lại ở
    // `collectionTypes` (việc cần làm C4) — hai danh sách không được trùng.
    expect(needs.collectionTypes).toEqual([]);
    expect(needs.collection).toEqual({ typeKey: 'news', role: 'entry', fields: ['body', 'title'] });
    // Cùng khối lặp đó trên một trang THƯỜNG thì là C4.
    expect(needsOf(d, trees, null).collectionTypes).toEqual(['news']);
  });

  it('trang thường: collection null', () => {
    expect(needsOf(doc, trees, null).collection).toBeNull();
  });
});
