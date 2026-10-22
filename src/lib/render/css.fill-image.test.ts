/**
 * `fill.image` — ảnh nền đặt bằng asset phải RA ĐƯỢC MÀN HÌNH.
 *
 * Vì sao có file riêng: compiler phát `background-image: var(--asset-<id>)` ngay
 * từ commit đầu, và mọi test đều xanh — nhưng KHÔNG AI định nghĩa custom property
 * đó. Một `var()` không có giá trị là "invalid at computed-value time", tức
 * `background-image` rơi về `none`. Kết quả: validator trả ok, CSS có mặt trong
 * stylesheet, và trang không có ảnh nền nào.
 *
 * Đây đúng dạng lỗi đắt nhất — không công cụ nào bắt được — và nó đã đẩy người
 * dựng trang thử đầu tiên sang gõ cứng URL CDN trong `customCss`, tức mất luôn ưu
 * điểm của asset: đổi ảnh phải sửa từng nơi, và inspector không sửa được bằng tay.
 *
 * Hợp đồng hai nửa, nên test cũng hai nửa:
 *   - `css.ts` phát `var(--asset-<id>)` (và tên đó do MỘT hàm sinh ra)
 *   - `NodeRenderer` định nghĩa `--asset-<id>: url("…")` trên chính node đó
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Doc, Node, StackNode } from '@/lib/doc/types';
import { CssCompileError, assetUrlValue, assetVarName, declarations } from './css';
import { NodeRenderer, type AssetInfo, type RenderContext } from './NodeRenderer';

const decl = (s: Parameters<typeof declarations>[0]) => Object.fromEntries(declarations(s));

function docWith(style: Record<string, unknown>): Doc {
  const node = {
    id: 'n0000001',
    type: 'Stack',
    direction: { base: 'column' },
    parentId: null,
    children: [],
    effects: [],
    style,
  } as unknown as StackNode;
  return { schemaVersion: 1, rootId: 'n0000001', nodes: { n0000001: node } };
}

const ASSET: AssetInfo = {
  url: 'https://cdn.example.com/a/hero-bg.jpg',
  width: 1920,
  height: 1080,
  mime: 'image/jpeg',
};

function html(doc: Doc, assets: Record<string, AssetInfo>): string {
  const ctx = {
    doc,
    scope: {} as RenderContext['scope'],
    assets,
  } as RenderContext;
  return renderToStaticMarkup(createElement(NodeRenderer, { nodeId: doc.rootId, ctx }));
}

describe('fill.image — ba khoá ra ba property', () => {
  it('assetId / fit / position → background-image / -size / -position', () => {
    const d = decl({
      fill: { image: { assetId: 'ast001', fit: 'cover', position: 'top center' } },
    });
    expect(d['background-image']).toBe('var(--asset-ast001)');
    expect(d['background-size']).toBe('cover');
    expect(d['background-position']).toBe('top center');
  });

  it('không khai position thì canh giữa', () => {
    expect(decl({ fill: { image: { assetId: 'ast001', fit: 'contain' } } })['background-position'])
      .toBe('center');
  });

  it('đứng cạnh fill.color được — nền màu là lớp lót khi ảnh chưa tải', () => {
    const d = decl({
      fill: { color: { hex: '#0d1321' }, image: { assetId: 'ast001', fit: 'cover' } },
    });
    expect(d['background-color']).toBe('#0d1321');
    expect(d['background-image']).toBe('var(--asset-ast001)');
  });
});

describe('nửa còn lại của hợp đồng — renderer định nghĩa biến', () => {
  it('node có fill.image thì element mang --asset-<id>: url(...)', () => {
    const out = html(docWith({ base: { fill: { image: { assetId: 'ast001', fit: 'cover' } } } }), {
      ast001: ASSET,
    });
    expect(out).toContain('--asset-ast001');
    expect(out).toContain('https://cdn.example.com/a/hero-bg.jpg');
  });

  it('ảnh nền chỉ đặt ở lớp md cũng phải có biến — biến không theo breakpoint', () => {
    const out = html(
      docWith({ base: {}, md: { fill: { image: { assetId: 'ast002', fit: 'cover' } } } }),
      { ast002: { ...ASSET, url: 'https://cdn.example.com/a/md.jpg' } },
    );
    expect(out).toContain('--asset-ast002');
    expect(out).toContain('https://cdn.example.com/a/md.jpg');
  });

  it('node Image tự truyền `style` vẫn giữ được biến — gộp, không đè', () => {
    // Nhánh `fill` của Image (asset thiếu số đo) là chỗ DUY NHẤT có `style=` thứ hai
    // trên cùng element. Quên gộp ở đó thì ảnh nền của riêng những node ấy biến mất,
    // và đó lại là một lỗi im lặng nữa.
    const img = {
      id: 'n0000002',
      type: 'Image',
      assetId: 'ast003',
      alt: 'nền',
      ratio: { base: '16/9' },
      parentId: null,
      children: [],
      effects: [],
      style: { base: { fill: { image: { assetId: 'ast003', fit: 'cover' } } } },
    } as unknown as Node;
    const doc: Doc = { schemaVersion: 1, rootId: 'n0000002', nodes: { n0000002: img } };
    const out = html(doc, { ast003: { url: 'https://cdn.example.com/a/no-dim.png' } });
    expect(out).toContain('--asset-ast003');
    expect(out).toContain('aspect-ratio:16/9');
  });

  it('asset đã bị xoá: không bịa biến, và không làm sập trang', () => {
    const out = html(docWith({ base: { fill: { image: { assetId: 'ast404', fit: 'cover' } } } }), {});
    expect(out).not.toContain('--asset-ast404');
  });
});

describe('không có đường nào cho một string tự do lọt ra', () => {
  it('assetId lạ ký tự bị chặn — nó đi thẳng vào TÊN property', () => {
    expect(() => assetVarName('x); background: url(javascript:alert(1)); --y:(')).toThrow(
      CssCompileError,
    );
    expect(() =>
      declarations({ fill: { image: { assetId: 'a;b', fit: 'cover' } } } as never),
    ).toThrow(CssCompileError);
  });

  it('URL asset phải là http(s) hoặc đường dẫn gốc', () => {
    expect(() => assetUrlValue('javascript:alert(1)')).toThrow(CssCompileError);
    expect(() => assetUrlValue('data:text/html,<script>')).toThrow(CssCompileError);
    expect(assetUrlValue('/uploads/x.png')).toBe('url("/uploads/x.png")');
  });

  it('URL hợp lệ mà mang ký tự đóng được url() thì ĐƯỢC MÃ HOÁ, không bị vứt', () => {
    expect(assetUrlValue('https://cdn.example/a b").jpg')).toBe(
      'url("https://cdn.example/a%20b%22%29.jpg")',
    );
  });

  // Dấu gạch ngược là ký tự THOÁT bên trong url("…"): bỏ sót nó thì `\"` đóng được
  // chuỗi dù dấu nháy đã được mã hoá.
  it('dấu gạch ngược cũng phải mã hoá', () => {
    expect(assetUrlValue('https://cdn.example/a\\b.jpg')).toBe(
      'url("https://cdn.example/a%5Cb.jpg")',
    );
  });
});
