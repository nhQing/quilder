import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from '@/lib/doc/types';
import { parseBundle } from './manifest';
import { sampleBundle, SHA } from './fixtures';
import { checkBundle } from './compat';

const root = { id: 'root', type: 'Section', tag: 'main', parentId: null, children: ['img'], effects: [], style: { base: {} } };
const img = { id: 'img', type: 'Image', parentId: 'root', children: [], effects: [], style: { base: {} }, assetId: 'casset00000000000000000001', alt: 'x', fit: { base: 'cover' } };

function bundleWith(over: Record<string, unknown> = {}) {
  const r = parseBundle(sampleBundle({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    doc: { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { root, img } },
    ...over,
  }));
  if (!r.ok) throw new Error(r.error);
  return r.bundle;
}

const codes = (b: ReturnType<typeof bundleWith>) => checkBundle(b).issues.map((i) => i.code);

describe('checkBundle', () => {
  it('gói lành: không có issue, doc đã migrate', () => {
    const r = checkBundle(bundleWith());
    expect(r.issues).toEqual([]);
    expect(r.doc?.rootId).toBe('root');
  });

  it('schemaVersion cao hơn bản này → G3', () => {
    expect(codes(bundleWith({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }))).toContain('builder-too-old');
  });

  it('effect và composite lạ → G3, kèm tên', () => {
    const odd = { ...img, effects: [{ id: 'e', effect: 'hieu-ung-tuong-lai', params: {} }] };
    const comp = { id: 'c', type: 'Composite', composite: 'TuongLai', parentId: 'root', children: [], effects: [], style: { base: {} }, params: {}, slots: {} };
    const r = checkBundle(bundleWith({ doc: { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { root: { ...root, children: ['img', 'c'] }, img: odd, c: comp } } }));
    const g3 = r.issues.find((i) => i.code === 'builder-too-old');
    expect(g3?.vars?.missing).toContain('hieu-ung-tuong-lai');
    expect(g3?.vars?.missing).toContain('TuongLai');
  });

  it('doc trỏ tới ảnh hoặc component không có trong gói → G4', () => {
    expect(codes(bundleWith({ assets: [] }))).toContain('file-corrupt');
    const inst = { id: 'i', type: 'Instance', componentId: 'cmissing', overrides: {}, parentId: 'root', children: [], effects: [], style: { base: {} } };
    expect(codes(bundleWith({ doc: { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { root: { ...root, children: ['img', 'i'] }, img, i: inst } } }))).toContain('file-corrupt');
  });

  it('file > 10 MB → G2 kèm tên file', () => {
    const b = bundleWith();
    b.assets[0]!.bytes = 11 * 1024 * 1024;
    const g2 = checkBundle(b).issues.find((i) => i.code === 'file-too-large');
    expect(g2?.level).toBe('block');
    expect(g2?.items?.[0]?.label).toContain('hero');
  });

  it('sha trùng nhưng file trong gói khai khác nhau vẫn hợp lệ (một file dùng nhiều chỗ)', () => {
    const b = bundleWith();
    b.assets.push({ ...b.assets[0]!, id: 'casset00000000000000000002', file: `files/${SHA}.png` });
    expect(checkBundle(b).issues.filter((i) => i.level === 'block')).toEqual([]);
  });

  it('component trong gói trỏ tới component vắng mặt → G4', () => {
    const croot = { id: 'croot', type: 'Section', tag: 'section', parentId: null, children: ['ci'], effects: [], style: { base: {} } };
    const ci = { id: 'ci', type: 'Instance', componentId: 'cmissing', overrides: {}, parentId: 'croot', children: [], effects: [], style: { base: {} } };
    const comp = { id: 'ccomp', key: 'k', name: 'K', category: 'c', aiDescription: '', tree: { rootId: 'croot', nodes: { croot, ci } } };
    expect(codes(bundleWith({ components: [comp] }))).toContain('file-corrupt');
  });

  it('node hoặc effect hỏng không làm checkBundle ném lỗi', () => {
    const badNode = { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { root, img, x: null } };
    const badEffect = { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { root, img: { ...img, effects: [null] } } };
    for (const doc of [badNode, badEffect]) {
      const r = checkBundle(bundleWith({ doc }));
      expect(r.doc).toBeNull();
      expect(r.issues.some((i) => i.level === 'block')).toBe(true);
    }
  });

  it('composite trùng tên thuộc tính của Object → coi là lạ', () => {
    const comp = { id: 'c', type: 'Composite', composite: 'toString', parentId: 'root', children: [], effects: [], style: { base: {} }, params: {}, slots: {} };
    const r = checkBundle(bundleWith({ doc: { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { root: { ...root, children: ['img', 'c'] }, img, c: comp } } }));
    expect(r.issues.find((i) => i.code === 'builder-too-old')?.vars?.missing).toContain('toString');
  });
  it('cây hỏng cấu trúc (qua zod nhưng con trùng / mồ côi) → G4 kèm mô tả, không phải G3', () => {
    const dup = { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { root: { ...root, children: ['img', 'img'] }, img } };
    const r = checkBundle(bundleWith({ doc: dup }));
    expect(r.doc).toBeNull();
    const g4 = r.issues.find((i) => i.code === 'file-corrupt');
    expect(g4?.level).toBe('block');
    expect(g4?.detail).toContain('img nhiều lần');
    expect(r.issues.some((i) => i.code === 'builder-too-old')).toBe(false);
  });

  it('cây component hỏng cấu trúc → G4 nêu tên component', () => {
    const croot = { id: 'croot', type: 'Section', tag: 'section', parentId: null, children: [], effects: [], style: { base: {} } };
    const stray = { id: 'stray', type: 'Section', tag: 'section', parentId: null, children: [], effects: [], style: { base: {} } };
    const comp = { id: 'ccomp', key: 'k', name: 'Thẻ K', category: 'c', aiDescription: '', tree: { rootId: 'croot', nodes: { croot, stray } } };
    const g4 = checkBundle(bundleWith({ components: [comp] })).issues.find((i) => i.code === 'file-corrupt');
    expect(g4?.detail).toContain('Thẻ K');
    expect(g4?.detail).toContain('mồ côi');
  });
});
