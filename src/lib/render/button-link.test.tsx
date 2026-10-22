import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Button `link`: route nội bộ đi qua next/link, còn link ngoài / mailto / hash là <a> thường.
 *
 * HTML tĩnh của next/link và <a> giống hệt nhau, nên phải mock Link để thấy nhánh nào chạy.
 * Đã hỏng một lần mà mọi test khác vẫn xanh: regex nhận link ngoài mất dấu `\` (`?///i…`),
 * phần sau thành chú thích, regex literal luôn truthy → MỌI link thành "ngoài", bấm link nội
 * bộ là reload cả trang (e2e `single-raf` bắt được, unit test không).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a {...rest} href={href} data-next-link="">
      {children}
    </a>
  ),
}));

import type { Doc, Node } from '@/lib/doc/types';
import { NodeRenderer, type RenderContext } from './NodeRenderer';

const base = { children: [] as string[], style: { base: {} }, effects: [] };

const button = (id: string, href: string, target?: string) =>
  ({
    ...base, id, parentId: 'page', type: 'Button', variant: 'primary',
    label: [{ t: 'text', v: id }], action: { kind: 'link', href, ...(target ? { target } : {}) },
  }) as unknown as Node;

const cases: Array<[string, string, string?]> = [
  ['route', '/gioi-thieu'],
  ['routeHash', '/#chapters'],
  ['hash', '#section-3'],
  ['abs', 'https://example.com/x'],
  ['protoRel', '//cdn.example.com/x'],
  ['mail', 'mailto:hi@example.com'],
  ['blank', '/blogs', '_blank'],
];

const doc = {
  schemaVersion: 1,
  rootId: 'page',
  nodes: {
    page: { ...base, id: 'page', parentId: null, type: 'Section', tag: 'main', children: cases.map(([id]) => id) },
    ...Object.fromEntries(cases.map(([id, href, target]) => [id, button(id, href, target)])),
  },
} as unknown as Doc;

const ctx: RenderContext = { doc, scope: { site: {}, page: {} }, assets: {} };
const out = renderToStaticMarkup(<NodeRenderer nodeId="page" ctx={ctx} />);

/** Thẻ <a> của nút `id`. */
const tagOf = (id: string) => out.match(new RegExp(`<a [^>]*data-n="${id}"[^>]*>`))?.[0] ?? '';

describe('Button link', () => {
  it.each(['route', 'routeHash'])('%s: route nội bộ đi qua next/link', (id) => {
    expect(tagOf(id)).toContain('data-next-link');
  });

  it.each(['hash', 'abs', 'protoRel', 'mail', 'blank'])('%s: <a> thường, không next/link', (id) => {
    const tag = tagOf(id);
    expect(tag).not.toBe('');
    expect(tag).not.toContain('data-next-link');
  });

  it('_blank thêm rel an toàn', () => {
    expect(tagOf('blank')).toContain('rel="noopener noreferrer"');
  });
});
