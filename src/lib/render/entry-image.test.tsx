import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Ô ảnh của trang chi tiết: Image `part="entry:cover"` hiện ảnh bìa của bài đang mở.
 *
 * Binding `collection` chỉ thay được CHỮ (xem `bindNote` của schema), nên trước đây ảnh
 * bìa của `/blogs/post/[slug]` không có đường nào đi vào template — mọi bài sẽ cùng một
 * ảnh mẫu.
 */

import type { Doc, Node } from '@/lib/doc/types';
import { NodeRenderer, type EntryBody, type RenderContext } from './NodeRenderer';

const base = { children: [] as string[], style: { base: {} }, effects: [] };

const doc = {
  schemaVersion: 1,
  rootId: 'page',
  nodes: {
    page: { ...base, id: 'page', parentId: null, type: 'Section', tag: 'main', children: ['cover'] },
    cover: {
      ...base, id: 'cover', parentId: 'page', type: 'Image',
      assetId: 'mau', alt: 'Ảnh mẫu', part: 'entry:cover',
    } as unknown as Node,
  },
} as unknown as Doc;

const assets = {
  mau: { url: '/mau.jpg', mime: 'image/jpeg', width: 800, height: 600 },
  bia: { url: '/bia.jpg', mime: 'image/jpeg', width: 1200, height: 860 },
};

const html = (entryBody?: Map<string, EntryBody>) => {
  const ctx: RenderContext = { doc, scope: { site: {}, page: {} }, assets, entryBody };
  return renderToStaticMarkup(<NodeRenderer nodeId="page" ctx={ctx} />);
};

describe('Image part="entry:<field>"', () => {
  it('có ảnh của bài thì hiện ảnh đó, kèm alt của bài', () => {
    const out = html(new Map([['cover', { kind: 'image', assetId: 'bia', alt: 'Bìa bài' }]]));
    expect(out).toContain('bia.jpg');
    expect(out).not.toContain('mau.jpg');
    expect(out).toContain('alt="Bìa bài"');
  });

  it('không có dữ liệu bài (builder, trang thường) thì giữ ảnh mẫu', () => {
    const out = html();
    expect(out).toContain('mau.jpg');
    expect(out).toContain('alt="Ảnh mẫu"');
  });

  it('không gắn data-mm-article — đó là kiểu chữ của thân bài, không phải của ảnh', () => {
    const out = html(new Map([['cover', { kind: 'image', assetId: 'bia', alt: 'Bìa bài' }]]));
    expect(out).not.toContain('data-mm-article');
  });
});
