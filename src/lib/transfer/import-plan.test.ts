import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from '@/lib/doc/types';
import { checkBundle } from './compat';
import { buildImportPlan, candidateKeys, uploadsNeeded, type TargetSnapshot } from './import-plan';
import { renderGuide } from './guides';
import { parseBundle } from './manifest';
import { FONT_SHA_300, FONT_SHA_400, GILROY_ASSETS, sampleBundle, sampleFont, SHA } from './fixtures';

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
    fontFamilies: [],
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

describe('buildImportPlan - họ font (spec §13.2)', () => {
  const style = { base: { typography: { family: { $token: 'font-gilroy' } } } };
  const fontBundle = (over: Record<string, unknown> = {}) => bundle({
    doc: { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { ...nodes, img: { ...nodes.img, style } } },
    assets: [...sampleBundle().assets, ...GILROY_ASSETS],
    fonts: [sampleFont()],
    ...over,
  });
  const destFace = (weight: string, key: string) => ({ weight, style: 'normal', unicodeRange: '', key });
  const fontPlan = (s: Partial<TargetSnapshot> = {}, b = fontBundle()) => plan(b, snap(s));

  it('đích trống: tạo họ; file font tải lên; token font-gilroy không bị coi là token builder chưa có (G3)', () => {
    const p = fontPlan();
    expect(p.fonts).toEqual([{ slug: 'gilroy', cssName: 'Gilroy', action: 'create', targetId: null }]);
    expect(p.issues.filter((i) => i.level === 'block')).toEqual([]);
    expect(p.assets.filter((a) => a.sha256 === FONT_SHA_300 || a.sha256 === FONT_SHA_400).map((a) => a.status)).toEqual(['upload', 'upload']);
  });

  it('đích có họ cùng slug thiếu weight 300: dùng bản ở đích, việc cần làm nói "thiếu weight 300", không tải file font', () => {
    const p = fontPlan({
      fontFamilies: [{ id: 'fdst', slug: 'gilroy', cssName: 'Gilroy Web', faces: [destFace('400', `public/builder/gilroy-regular-${FONT_SHA_400.slice(0, 8)}.woff2`)] }],
    });
    expect(p.fonts).toEqual([{ slug: 'gilroy', cssName: 'Gilroy', action: 'use-target', targetId: 'fdst' }]);
    const todo = p.issues.filter((i) => i.code === 'font-differs');
    expect(todo).toHaveLength(1);
    expect(todo[0]!.level).toBe('todo');
    const g = renderGuide(todo[0]!);
    expect(g.why).toContain('Gilroy Web ở đây thiếu weight 300');
    expect(g.why).not.toContain('400');
    expect(todo[0]!.items?.[0]?.href).toBe('/builder/settings/fonts');
    expect(p.issues.filter((i) => i.level === 'block')).toEqual([]);
    // Họ ở đích được giữ → file font của gói không cần lên kho.
    expect(p.assets.map((a) => a.sha256)).toEqual([SHA]);
  });

  it('đích có họ cùng slug, cùng tập file: dùng lại, không có việc cần làm', () => {
    const p = fontPlan({
      fontFamilies: [{ id: 'fdst', slug: 'gilroy', cssName: 'Gilroy', faces: [
        destFace('300', `public/builder/x-${FONT_SHA_300.slice(0, 8)}.woff2`),
        destFace('400', `public/builder/y-${FONT_SHA_400.slice(0, 8)}.woff2`),
      ] }],
    });
    expect(p.fonts[0]!.action).toBe('use-target');
    expect(codes(p)).not.toContain('todo:font-differs');
  });

  it('cùng weight mà file khác → việc cần làm nói file khác', () => {
    const p = fontPlan({
      fontFamilies: [{ id: 'fdst', slug: 'gilroy', cssName: 'Gilroy', faces: [
        destFace('300', `public/builder/x-${FONT_SHA_300.slice(0, 8)}.woff2`),
        destFace('400', 'public/builder/y-12345678.woff2'),
      ] }],
    });
    const why = renderGuide(p.issues.find((i) => i.code === 'font-differs')!).why;
    expect(why).toContain('weight 400');
    expect(why).not.toContain('thiếu');
  });

  it('đích có họ cssName "Gilroy" (khác hoa thường) mà khác slug → blocker', () => {
    const p = fontPlan({ fontFamilies: [{ id: 'fcu', slug: 'gilroy-cu', cssName: 'GILROY', faces: [] }] });
    const g = p.issues.find((i) => i.code === 'font-name-taken');
    expect(g?.level).toBe('block');
    expect(renderGuide(g!).why).toContain('GILROY');
  });

  it('tên trùng họ có sẵn (Inter) hoặc token font-<slug> đã có mà không thuộc họ nào → blocker', () => {
    const inter = fontBundle({ fonts: [sampleFont({ slug: 'inter', cssName: 'Inter' })] });
    expect(codes(plan(inter, snap()))).toContain('block:font-name-taken');
    expect(codes(fontPlan({ tokens: new Map([['font-gilroy', '"gilroy", serif']]) }))).toContain('block:font-name-taken');
  });

  it('họ sẽ tạo mà fallback có ký tự thoát CSS, hoặc face trùng nhau → G4', () => {
    const evil = fontBundle({ fonts: [sampleFont({ fallback: 'serif; } body { x' })] });
    expect(codes(plan(evil, snap()))).toContain('block:file-corrupt');
    const f = sampleFont();
    const dup = fontBundle({ fonts: [{ ...f, faces: [f.faces[0], f.faces[0]] }] });
    expect(codes(plan(dup, snap()))).toContain('block:file-corrupt');
  });

  it('face trỏ file không có trong assets[] → gói không kín (G4)', () => {
    const holey = fontBundle({ assets: sampleBundle().assets });
    expect(codes(plan(holey, snap()))).toContain('block:file-corrupt');
  });

  it('gói cũ không có fonts: kế hoạch không có họ font nào', () => {
    expect(plan().fonts).toEqual([]);
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
