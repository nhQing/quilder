import { createHash } from 'node:crypto';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from '@/lib/doc/types';
import { blankSnapshot, dryRunOne } from './dryrun';
import { sampleBundle } from './fixtures';

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
const SHA = createHash('sha256').update(PNG).digest('hex');
const ASSET_ID = 'casset00000000000000000001';

const base = { children: [], effects: [], style: { base: {} } };
/** Header có một dòng hotline bind vào `Site.globals.hotline`; `label` đổi để tạo "hai bản Header". */
function header(label: string) {
  return {
    id: 'cheader', key: 'header', name: 'Header', category: 'layout', aiDescription: '',
    tree: {
      rootId: 'h',
      nodes: {
        h: { ...base, id: 'h', type: 'Section', tag: 'header', parentId: null, children: ['t'] },
        t: {
          ...base, id: 't', type: 'Text', tag: 'p', parentId: 'h',
          content: [{ t: 'text', v: label }, { t: 'bind', ref: { source: 'site', path: 'hotline' }, fallback: '1900 0000' }],
        },
      },
    },
  };
}

function zipOf(slug: string, headerLabel: string): Uint8Array {
  const bundle = sampleBundle({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    page: { slug, title: slug || 'Trang chủ', description: null, canonical: null, noindex: false, jsonLd: null, ogImageId: null, collection: null },
    doc: {
      schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root',
      nodes: {
        root: { ...base, id: 'root', type: 'Section', tag: 'main', parentId: null, children: ['hd', 'img'] },
        hd: { ...base, id: 'hd', type: 'Instance', componentId: 'cheader', overrides: {}, parentId: 'root' },
        img: { ...base, id: 'img', type: 'Image', parentId: 'root', assetId: ASSET_ID, alt: 'x', fit: { base: 'cover' } },
      },
    },
    components: [header(headerLabel)],
    assets: [{
      id: ASSET_ID, key: `public/builder/hero-${SHA.slice(0, 8)}.png`, name: 'hero.png', kind: 'image', mime: 'image/png',
      bytes: PNG.length, width: 1, height: 1, blurhash: null, alt: 'Ảnh', folder: null, sha256: SHA, file: `files/${SHA}.png`,
    }],
  });
  return zipSync({ 'manifest.json': strToU8(JSON.stringify(bundle)), [`files/${SHA}.png`]: PNG });
}

const blank = () => blankSnapshot({ globals: {}, locales: null, collections: [], embed: [] }, new Set());

describe('dryRunOne — site trắng', () => {
  it('trang chủ đè lên trang chủ mặc định; ảnh và Header được TẠO', async () => {
    const snap = blank();
    const r = await dryRunOne('home.zip', zipOf('', 'v1'), snap, {});
    expect(r.issues.filter((i) => i.level === 'block')).toEqual([]);
    expect(r.target).toBe('trang có sẵn');
    expect(r.counts).toMatchObject({ upload: 1, reuse: 0, createComponents: 1 });
  });

  it('trang thứ hai dùng chung ảnh và Header: DÙNG LẠI, không tải lại', async () => {
    const snap = blank();
    await dryRunOne('home.zip', zipOf('', 'v1'), snap, {});
    const r = await dryRunOne('a.zip', zipOf('gioi-thieu', 'v1'), snap, {});
    expect(r.target).toBe('trang mới');
    expect(r.counts).toMatchObject({ upload: 0, reuse: 1, createComponents: 0 });
    expect(r.issues.map((i) => i.code)).not.toContain('component-differs');
  });

  it('hai gói mang hai bản Header khác nhau → gói sau báo component-differs', async () => {
    const snap = blank();
    await dryRunOne('home.zip', zipOf('', 'v1'), snap, {});
    const r = await dryRunOne('a.zip', zipOf('gioi-thieu', 'v2'), snap, {});
    expect(r.issues.map((i) => i.code)).toContain('component-differs');
  });

  it('binding site:"hotline" mà globals chưa có → báo thiếu, kèm chỗ dùng trong component', async () => {
    const r = await dryRunOne('home.zip', zipOf('', 'v1'), blank(), {});
    expect(r.missingSiteKeys).toEqual([{ key: 'hotline', where: [expect.stringContaining('component "Header"')] }]);
  });

  it('globals đã có hotline → không báo; chuỗi rỗng vẫn coi là thiếu', async () => {
    expect((await dryRunOne('h.zip', zipOf('', 'v1'), blank(), { hotline: '1900 6868' })).missingSiteKeys).toEqual([]);
    expect((await dryRunOne('h.zip', zipOf('', 'v1'), blank(), { hotline: '  ' })).missingSiteKeys).toHaveLength(1);
  });

  it('zip hỏng → một issue chặn, không ném', async () => {
    const r = await dryRunOne('x.zip', new Uint8Array([1, 2, 3]), blank(), {});
    expect(r.issues[0]).toMatchObject({ code: 'file-corrupt', level: 'block' });
  });
});
