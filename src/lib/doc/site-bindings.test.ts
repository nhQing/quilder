import { describe, expect, it } from 'vitest';

import { findSiteBindings } from './site-bindings';

const bind = (path: string) => ({ t: 'bind', ref: { source: 'site', path }, fallback: 'x' });

function tree(nodes: Record<string, unknown>) {
  return { rootId: 'root', nodes };
}

describe('findSiteBindings', () => {
  it('tìm trong content của Text', () => {
    const u = findSiteBindings(tree({ n1: { type: 'Text', content: [bind('phone')] } }));
    expect(u.get('phone')).toEqual(['n1']);
  });

  it('tìm trong label của Button — không chỉ content', () => {
    const u = findSiteBindings(tree({ b1: { type: 'Button', label: [bind('hotline')] } }));
    expect(u.get('hotline')).toEqual(['b1']);
  });

  it('tìm được khi lồng trong em/strong/link', () => {
    const u = findSiteBindings(
      tree({
        n1: {
          content: [{ t: 'strong', children: [{ t: 'link', href: '/x', children: [bind('license')] }] }],
        },
      }),
    );
    expect(u.get('license')).toEqual(['n1']);
  });

  it('gỡ tiền tố `site.` — cùng khoá không được đếm thành hai', () => {
    const u = findSiteBindings(
      tree({ a: { content: [bind('site.phone')] }, b: { content: [bind('phone')] } }),
    );
    expect(u.get('phone')?.sort()).toEqual(['a', 'b']);
    expect(u.has('site.phone')).toBe(false);
  });

  it('đường dẫn con tính về khoá gốc', () => {
    const u = findSiteBindings(tree({ n: { content: [bind('store.ios')] } }));
    expect(u.get('store')).toEqual(['n']);
  });

  it('bỏ qua binding nguồn khác', () => {
    const u = findSiteBindings(
      tree({ n: { content: [{ t: 'bind', ref: { source: 'page', path: 'title' }, fallback: '' }] } }),
    );
    expect(u.size).toBe(0);
  });

  it('gộp được nhiều cây vào cùng một Map — trang cộng preset', () => {
    const u = findSiteBindings(tree({ a: { content: [bind('phone')] } }));
    findSiteBindings(tree({ b: { content: [bind('phone')] } }), u);
    expect(u.get('phone')?.sort()).toEqual(['a', 'b']);
  });

  it('không nổ với cây rỗng hay dữ liệu lạ', () => {
    expect(findSiteBindings(null).size).toBe(0);
    expect(findSiteBindings({}).size).toBe(0);
    expect(findSiteBindings(tree({})).size).toBe(0);
  });
});
