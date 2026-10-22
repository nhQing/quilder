import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from '@/lib/doc/types';
import { checkBundle } from './compat';
import { buildImportPlan, candidateKeys, uploadsNeeded, type TargetSnapshot } from './import-plan';
import { parseBundle } from './manifest';
import { sampleBundle, SHA } from './fixtures';

const base = { parentId: 'root', children: [], effects: [], style: { base: {} } };
const nodes = {
  root: { ...base, id: 'root', type: 'Section', tag: 'main', parentId: null, children: ['img', 'inst', 'form'] },
  img: { ...base, id: 'img', type: 'Image', assetId: 'casset00000000000000000001', alt: 'x', fit: { base: 'cover' } },
  inst: { ...base, id: 'inst', type: 'Instance', componentId: 'csrcheader', overrides: { gone: { alt: 'y' } } },
  form: { ...base, id: 'form', type: 'Composite', composite: 'Form', params: { endpointKey: 'lien-he' }, slots: {}, name: 'Form liên hệ' },
};
const headerTree = { rootId: 'h', nodes: { h: { ...base, id: 'h', type: 'Section', tag: 'header', parentId: null } } };

function bundle(over: Record<string, unknown> = {}) {
  const r = parseBundle(sampleBundle({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    doc: { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes },
    components: [{ id: 'csrcheader', key: 'header', name: 'Header', category: 'layout', aiDescription: '', tree: headerTree }],
    translations: [
      { locale: 'en', nodeId: 'img', field: 'alt', value: 'Hi', sourceHash: 'h' },
      { locale: 'ja', nodeId: 'img', field: 'alt', value: 'こ', sourceHash: 'h' },
    ],
    needs: { endpointKeys: ['lien-he'], embedOrigins: [], collectionTypes: [], collection: null },
    ...over,
  }));
  if (!r.ok) throw new Error(r.error);
  return r.bundle;
}

function snap(over: Partial<TargetSnapshot> = {}): TargetSnapshot {
  return {
    pages: [
      { id: 'p-abc', slug: 'abc', title: 'ABC', draftVersionId: 'v1', fixture: false, collection: null, hasUnpublishedChanges: true },
      { id: 'p-test', slug: 'trang-chu-test-v2', title: 'Test', draftVersionId: 'v9', fixture: false, collection: null, hasUnpublishedChanges: false },
      { id: 'p-fix', slug: 'gioi-thieu', title: 'Fixture', draftVersionId: 'v3', fixture: true, collection: null, hasUnpublishedChanges: false },
      { id: 'p-tpl', slug: 'blogs/[slug]', title: 'Mẫu', draftVersionId: 'v4', fixture: false, collection: { typeKey: 'news', param: 'entry' }, hasUnpublishedChanges: false },
    ],
    assetsByKey: new Map(),
    presetsByKey: new Map([['header', { id: 'cdstheader', tree: { rootId: 'h', nodes: { h: { ...headerTree.nodes.h, tag: 'nav' } } } as never }]]),
    tokens: new Map(),
    tokenNames: new Set(),
    locales: new Map([['vi', { enabled: true }], ['en', { enabled: false }]]),
    endpointUrls: {},
    embedHosts: [],
    collectionTypes: new Map(),
    folders: ['trang-chu'],
    ...over,
  };
}

const plan = (b = bundle(), s = snap(), t: Parameters<typeof buildImportPlan>[3] = { kind: 'existing', pageId: 'p-test' }) =>
  buildImportPlan(b, checkBundle(b), s, t);
const codes = (p: ReturnType<typeof plan>) => p.issues.map((i) => `${i.level}:${i.code}`);

describe('candidateKeys', () => {
  it('khoá nguồn trước, rồi khoá mà uploadAsset sẽ sinh từ tên + sha', () => {
    expect(candidateKeys({ key: 'img/section2/a.png', name: 'a.png', sha256: SHA })).toEqual([
      'img/section2/a.png', `public/builder/a-${SHA.slice(0, 8)}.png`,
    ]);
  });
});

describe('buildImportPlan', () => {
  it('trang đích gợi ý = trang trùng đường dẫn nguồn; trang fixture và trang mẫu không nằm trong danh sách', () => {
    const p = plan();
    expect(p.suggestedPageId).toBe('p-abc');
    expect(p.choices.map((c) => c.id)).toEqual(['p-abc', 'p-test']);
  });

  it('nhập vào trang đã chọn: đích ghi draftVersionId để chống ghi đè', () => {
    expect(plan().target).toEqual({ pageId: 'p-test', draftVersionId: 'v9', hasUnpublishedChanges: false });
  });

  it('ảnh: đã có theo khoá → dùng lại; trong thùng rác → lấy ra; chưa có → tải lên', () => {
    const s = snap({ assetsByKey: new Map([['public/builder/hero-aaaaaaaa.png', { id: 'dst1', key: 'public/builder/hero-aaaaaaaa.png', trashed: true, alt: null, bytes: 10 }]]) });
    expect(plan(bundle(), s).assets[0]).toMatchObject({ status: 'restore', targetId: 'dst1' });
    expect(plan().assets[0]).toMatchObject({ status: 'upload', targetId: null, targetKey: `public/builder/hero-${SHA.slice(0, 8)}.png` });
  });

  it('component trùng khoá: dùng bản ở đích, báo khác bản trong gói và đếm chỉnh riêng mồ côi', () => {
    const c = plan().components[0]!;
    expect(c).toMatchObject({ action: 'use-target', targetId: 'cdstheader', differs: true, orphanOverrides: 1 });
    expect(codes(plan())).toContain('todo:component-differs');
  });

  it('ngôn ngữ: en đang tắt vẫn nhập (C2 tắt), ja chưa có thì bỏ và đếm', () => {
    const p = plan();
    expect(p.locales).toEqual([{ code: 'en', status: 'disabled', count: 1 }, { code: 'ja', status: 'missing', count: 1 }]);
    expect(codes(p)).toEqual(expect.arrayContaining(['todo:locale-disabled', 'todo:locale-missing']));
  });

  it('form chưa có URL → C1 kèm tên form; luôn có C6 publish', () => {
    const p = plan();
    const c1 = p.issues.find((i) => i.code === 'endpoint-missing');
    expect(c1?.vars).toEqual({ key: 'lien-he', form: 'Form liên hệ' });
    expect(codes(p)).toContain('todo:publish');
  });

  it('trang đích fixture → G6; trang đích khác dạng → G9', () => {
    expect(codes(plan(bundle(), snap(), { kind: 'existing', pageId: 'p-fix' }))).toContain('block:target-fixture');
    expect(codes(plan(bundle(), snap(), { kind: 'existing', pageId: 'p-tpl' }))).toContain('block:target-shape-mismatch');
  });

  it('gói trang mẫu: loại nội dung chưa có → G8; có loại nhưng thiếu field → C7; danh sách chỉ hiện mẫu cùng loại', () => {
    const tpl = bundle({
      page: { slug: 'blogs/[slug]', title: 'Mẫu', description: null, canonical: null, noindex: false, jsonLd: null, ogImageId: null, collection: { typeKey: 'news', param: 'entry' } },
      needs: { endpointKeys: [], embedOrigins: [], collectionTypes: [], collection: { typeKey: 'news', role: 'entry', fields: ['cover', 'title'] } },
    });
    expect(codes(plan(tpl, snap(), { kind: 'existing', pageId: 'p-tpl' }))).toContain('block:collection-type-missing');
    const withType = snap({ collectionTypes: new Map([['news', { fields: ['title'] }]]) });
    const p = plan(tpl, withType, { kind: 'existing', pageId: 'p-tpl' });
    expect(codes(p)).toContain('todo:collection-field-missing');
    expect(p.choices.map((c) => c.id)).toEqual(['p-tpl']);
  });

  it('chưa chọn trang đích: không có target, không có blocker giả', () => {
    const p = plan(bundle(), snap(), null);
    expect(p.target).toBeNull();
    expect(p.issues.filter((i) => i.level === 'block')).toEqual([]);
  });
  it('origin nhúng hỏng không làm ném lỗi: coi là chưa được phép (C3 kèm chuỗi gốc)', () => {
    const b = bundle({ needs: { endpointKeys: [], embedOrigins: ['khong phai url', 'https://ok.example'], collectionTypes: [], collection: null } });
    const p = plan(b, snap({ embedHosts: ['ok.example'] }));
    const c3 = p.issues.filter((i) => i.code === 'embed-origin-missing');
    expect(c3.map((i) => i.vars?.origin)).toEqual(['khong phai url']);
  });

  it('cùng một file ở nhiều dòng ảnh: mỗi dòng có dòng kế hoạch riêng, trạng thái nhất quán', () => {
    const b = bundle();
    b.assets.push({ ...b.assets[0]!, id: 'casset00000000000000000002' });
    const rows = plan(b).assets;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ sourceId: 'casset00000000000000000002', status: rows[0]!.status, targetKey: rows[0]!.targetKey });
  });
  it('khoá nguồn khác khoá suy ra (ảnh cũ/khoá tay): trùng khoá mà khác cỡ → không dùng lại, tải lên theo khoá suy ra', () => {
    const b = bundle();
    b.assets[0] = { ...b.assets[0]!, key: 'img/cu/hero.png' };
    const legacy = (bytes: number) => snap({ assetsByKey: new Map([['img/cu/hero.png', { id: 'dst-cu', key: 'img/cu/hero.png', trashed: false, alt: null, bytes }]]) });
    expect(plan(b, legacy(10)).assets[0]).toMatchObject({ status: 'reuse', targetId: 'dst-cu' });
    expect(plan(b, legacy(999)).assets[0]).toMatchObject({ status: 'upload', targetId: null, targetKey: `public/builder/hero-${SHA.slice(0, 8)}.png` });
  });

  it('token tĩnh mà đích không có → G3 kèm tên; token tự tạo trong gói thì không tính', () => {
    const style = { base: { spacing: { pt: { $token: 'space-l' }, pb: { $token: 'mau-tuong-lai' } }, fill: { color: { $token: 'mau-rieng' } } } };
    const b = bundle({
      doc: { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { ...nodes, img: { ...nodes.img, style } } },
      tokens: [{ name: 'mau-rieng', value: '#112233', category: 'color', group: null, aiDescription: null }],
    });
    const g3 = plan(b, snap({ tokenNames: new Set(['space-l']) })).issues.find((i) => i.code === 'builder-too-old');
    expect(g3?.level).toBe('block');
    expect(g3?.vars?.missing).toBe('token "--mau-tuong-lai"');
    expect(codes(plan(b, snap({ tokenNames: new Set(['space-l', 'mau-tuong-lai']) })))).not.toContain('block:builder-too-old');
  });

  it('token tự tạo sẽ tạo mà tên hoặc màu sai luật → G4 nêu tên, trước khi ghi', () => {
    const bad = bundle({ tokens: [
      { name: 'Mau Hong', value: '#fff', category: 'color', group: null, aiDescription: null },
      { name: 'mau-sai', value: 'red; } body { x', category: 'color', group: null, aiDescription: null },
      { name: 'mau-dung', value: '#abcdef', category: 'color', group: null, aiDescription: null },
    ] });
    const g4 = plan(bad).issues.filter((i) => i.code === 'file-corrupt');
    expect(g4).toHaveLength(1);
    expect(g4[0]!.level).toBe('block');
    expect(g4[0]!.items?.map((i) => i.label)).toEqual([expect.stringContaining('Mau Hong'), expect.stringContaining('mau-sai')]);
    // Đã có ở đích thì không ghi gì, không chặn.
    expect(codes(plan(bad, snap({ tokens: new Map([['Mau Hong', '#fff'], ['mau-sai', '#000']]) })))).not.toContain('block:file-corrupt');
  });
});

describe('uploadsNeeded', () => {
  it('cùng byte nhưng khác tên → hai khoá đích → hai lần tải; cùng khoá đích → một lần', () => {
    const b = bundle();
    b.assets.push({ ...b.assets[0]!, id: 'casset00000000000000000002', name: 'banner.png' });
    b.assets.push({ ...b.assets[0]!, id: 'casset00000000000000000003' });
    const ups = uploadsNeeded(plan(b).assets);
    expect(ups.map((a) => a.targetKey).sort()).toEqual([`public/builder/banner-${SHA.slice(0, 8)}.png`, `public/builder/hero-${SHA.slice(0, 8)}.png`]);
  });

  it('dòng đã có ở đích không tải', () => {
    const s = snap({ assetsByKey: new Map([['public/builder/hero-aaaaaaaa.png', { id: 'd', key: 'public/builder/hero-aaaaaaaa.png', trashed: false, alt: null, bytes: 10 }]]) });
    expect(uploadsNeeded(plan(bundle(), s).assets)).toEqual([]);
  });
});
