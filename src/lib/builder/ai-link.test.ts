import { describe, expect, it } from 'vitest';

import type { Doc, Node } from '@/lib/doc/types';
import {
  buildAiLink,
  buildClipboardLine,
  describeTarget,
  findBuilderUrl,
  parseAiLink,
} from './ai-link';

const n = (o: Record<string, unknown>) =>
  ({ style: {}, effects: [], children: [], parentId: null, ...o }) as unknown as Node;

const doc: Doc = {
  schemaVersion: 2,
  rootId: 'root',
  nodes: {
    root: n({ id: 'root', type: 'Stack', children: ['sec'] }),
    sec: n({ id: 'sec', type: 'Section', name: 'Hero', parentId: 'root', children: ['a'] }),
    a: n({ id: 'a', type: 'Stack', name: 'Cột trái', parentId: 'sec', children: ['b'] }),
    b: n({ id: 'b', type: 'Stack', name: 'Nhóm', parentId: 'a', children: ['t', 'inst'] }),
    t: n({
      id: 't',
      type: 'Text',
      parentId: 'b',
      content: [{ t: 'text', v: 'Mở tài khoản ngay' }],
    }),
    inst: n({ id: 'inst', type: 'Instance', name: 'Header', parentId: 'b', componentId: 'c1', overrides: {} }),
  } as Record<string, Node>,
};

const components = new Map([
  ['c1', { nodes: { logo: n({ id: 'logo', type: 'Image', name: 'Logo' }) } as Record<string, Node> }],
]);

describe('buildAiLink', () => {
  it('node của trang', () => {
    expect(buildAiLink({ origin: 'https://a.test', pageId: 'p1', nodeId: 'n1' })).toBe(
      'https://a.test/builder/p1?node=n1',
    );
  });

  it('phần tử trong instance mang cn', () => {
    expect(
      buildAiLink({ origin: 'https://a.test/', pageId: 'p1', nodeId: 'i1', innerLocalId: 'l1' }),
    ).toBe('https://a.test/builder/p1?node=i1&cn=l1');
  });

  it('component: component trước node, bỏ cn, thêm locale', () => {
    expect(
      buildAiLink({
        origin: 'https://a.test',
        pageId: 'p1',
        componentId: 'c1',
        nodeId: 'l1',
        innerLocalId: 'ignored',
        locale: 'en',
      }),
    ).toBe('https://a.test/builder/p1?component=c1&node=l1&locale=en');
  });
});

describe('parseAiLink', () => {
  it('page-node', () => {
    const r = parseAiLink('https://a.test/builder/p1?node=n1');
    expect(r).toEqual({
      ok: true,
      link: { kind: 'page-node', origin: 'https://a.test', pageId: 'p1', node: 'n1', cn: null, component: null, locale: null },
    });
  });

  it('instance-child', () => {
    const r = parseAiLink('https://a.test/builder/p1?node=i1&cn=l1');
    expect(r.ok && r.link.kind).toBe('instance-child');
    expect(r.ok && r.link.cn).toBe('l1');
  });

  it('component-node và locale', () => {
    const r = parseAiLink('https://a.test/builder/p1?component=c1&node=l1&locale=en');
    expect(r.ok && r.link).toMatchObject({ kind: 'component-node', component: 'c1', node: 'l1', locale: 'en', cn: null });
  });

  it('cả dòng chép: lấy URL cuối dòng, kèm lời nhắn xung quanh', () => {
    const line = '[Quilder] Trang chủ › Hero › Nút CTA — https://a.test/builder/p1?node=n1. Đổi chữ thành "Đăng ký".';
    const r = parseAiLink(line);
    expect(r.ok && r.link.node).toBe('n1');
  });

  it('link markdown và link bọc <>', () => {
    expect(findBuilderUrl('xem [đây](https://a.test/builder/p1?node=n1) nhé')).toBe('https://a.test/builder/p1?node=n1');
    expect(findBuilderUrl('<https://a.test/builder/p1?node=n1>')).toBe('https://a.test/builder/p1?node=n1');
  });

  it('ký tự mã hoá %', () => {
    const r = parseAiLink('https://a.test/builder/p%201?node=n%2D1');
    // Id có khoảng trắng bị từ chối; %2D là "-" thì đi qua.
    expect(r.ok).toBe(false);
    const ok = parseAiLink('https://a.test/builder/p1?node=n%2D1');
    expect(ok.ok && ok.link.node).toBe('n-1');
  });

  it('đường dẫn tương đối: origin rỗng', () => {
    const r = parseAiLink('/builder/p1?node=n1');
    expect(r.ok && r.link.origin).toBe('');
  });

  it('lỗi: không có link, thiếu node, không phải trang, id lạ', () => {
    expect(parseAiLink('sửa giúp tôi cái nút').ok).toBe(false);
    const noNode = parseAiLink('https://a.test/builder/p1');
    expect(!noNode.ok && noNode.error).toMatch(/node=/);
    expect(parseAiLink('https://a.test/builder/p1/extra?node=n').ok).toBe(false);
    expect(parseAiLink('https://a.test/builder/p1?node=a%2Fb').ok).toBe(false);
    expect(parseAiLink('https://a.test/builder/%E0%A4%A?node=n').ok).toBe(false);
  });

  it('build rồi parse là khứ hồi', () => {
    const url = buildAiLink({ origin: 'https://a.test', pageId: 'p1', nodeId: 'i1', innerLocalId: 'l1', locale: 'en' });
    const r = parseAiLink(url);
    expect(r.ok && r.link).toMatchObject({ kind: 'instance-child', pageId: 'p1', node: 'i1', cn: 'l1', locale: 'en' });
  });
});

describe('describeTarget + buildClipboardLine', () => {
  it('đường tổ tiên không gồm gốc, cắt còn hai bậc', () => {
    const d = describeTarget(doc, 't')!;
    expect(d.path).toEqual(['…', 'Cột trái', 'Nhóm']);
    expect(d.label).toBe('Mở tài khoản ngay');
  });

  it('node nông: không có dấu …', () => {
    expect(describeTarget(doc, 'a')!.path).toEqual(['Hero']);
  });

  it('phần tử trong instance: nhãn ghép instance › phần tử', () => {
    const d = describeTarget(doc, 'inst', { innerLocalId: 'logo', components })!;
    expect(d.label).toBe('Header › Logo');
    expect(d.innerLabel).toBe('Logo');
  });

  it('node không tồn tại → null', () => {
    expect(describeTarget(doc, 'zzz')).toBeNull();
  });

  it('dòng chép một dòng, có tên trang và URL', () => {
    const d = describeTarget(doc, 'a')!;
    const line = buildClipboardLine({ rootName: 'Trang\nchủ', description: d, url: 'https://a.test/builder/p1?node=a' });
    expect(line).toBe('[Quilder] Trang chủ › Hero › Cột trái — https://a.test/builder/p1?node=a');
    expect(line).not.toContain('\n');
  });

  it('nhãn chứa dấu tách thì được thay để dòng vẫn tách được', () => {
    const d = describeTarget(
      { ...doc, nodes: { ...doc.nodes, a: n({ id: 'a', type: 'Stack', name: 'A › B — C', parentId: 'sec', children: [] }) } },
      'a',
    )!;
    expect(d.label).toBe('A - B - C');
  });
});
