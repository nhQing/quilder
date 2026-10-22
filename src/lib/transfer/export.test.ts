import { describe, expect, it } from 'vitest';

import type { AssetUse } from './collect';
import {
  exportIssues, isMissingError, missingComponentRefs, readExportFile, tooLargeIssue, unreadableIssues,
} from './export';

describe('exportIssues', () => {
  const uses = new Map([
    ['gone', [{ kind: 'component' as const, componentId: 'c-header', nodeId: 'logo' }]],
    ['big', [{ kind: 'page' as const, nodeId: 'hero' }]],
  ]);

  it('X1 nói ảnh nào và ở đâu, kèm link mở đúng node trong component', () => {
    const out = exportIssues({
      pageId: 'p1', uses, rows: new Map([['big', { name: 'hero.mp4', bytes: 12 * 1024 * 1024 }]]),
      missingComponents: [], nodeLabels: { hero: 'Video hero' }, collection: false,
    });
    const x1 = out.find((i) => i.code === 'asset-row-missing');
    expect(x1?.level).toBe('block');
    expect(x1?.items?.[0]).toEqual({ label: 'Ảnh gone — component c-header › node logo', href: '/builder/components/c-header?node=logo' });
    const w1 = out.find((i) => i.code === 'file-over-import-limit');
    expect(w1?.level).toBe('warn');
    expect(w1?.items?.[0]?.label).toContain('hero.mp4');
    expect(w1?.items?.[0]?.label).toContain('Video hero');
  });

  it('X4 cho instance trỏ component đã xoá; W2 cho trang có collection', () => {
    const out = exportIssues({
      pageId: 'p1', uses: new Map(), rows: new Map(),
      missingComponents: [{ nodeId: 'inst' }], nodeLabels: {}, collection: true,
    });
    expect(out.map((i) => i.code)).toEqual(['component-missing', 'entries-not-included']);
    expect(out[0]!.items?.[0]?.href).toBe('/builder/p1?node=inst');
  });
});

describe('tooLargeIssue', () => {
  const frames = (node: string, n: number) =>
    Array.from({ length: n }, (_, i) => [`${node}-${i}`, [{ kind: 'page', nodeId: node }]] as [string, AssetUse[]]);

  it('X6 không báo khi trong giới hạn', () => {
    expect(tooLargeIssue({ pageId: 'p1', assetCount: 10, manifestBytes: 1000, uses: new Map(frames('a', 10)), nodeLabels: {} })).toBeNull();
  });

  it('X6 chặn khi quá 5000 asset và nêu 3 node nhiều ảnh nhất', () => {
    const uses = new Map([...frames('a', 5), ...frames('b', 4), ...frames('c', 3), ...frames('d', 1)]);
    const out = tooLargeIssue({ pageId: 'p1', assetCount: 5001, manifestBytes: 1000, uses, nodeLabels: { a: 'Dãy khung' } });
    expect(out?.code).toBe('too-large');
    expect(out?.level).toBe('block');
    expect(out?.items).toHaveLength(3);
    expect(out?.items?.[0]?.label).toContain('Dãy khung');
    expect(out?.items?.[0]?.label).toContain('5');
    expect(out?.items?.[0]?.href).toBe('/builder/p1?node=a');
  });

  it('X6 chặn khi manifest quá 5 MB (đếm theo byte UTF-8 do nơi gọi đo)', () => {
    const out = tooLargeIssue({ pageId: 'p1', assetCount: 1, manifestBytes: 5 * 1024 * 1024 + 1, uses: new Map(), nodeLabels: {} });
    expect(out?.code).toBe('too-large');
  });
});

describe('unreadableIssues', () => {
  const file = (id: string, key: string) => ({ entry: '', asset: { id, key, url: `https://s3/${key}` } });
  const uses = new Map<string, AssetUse[]>([['a1', [{ kind: 'page', nodeId: 'hero' }]]]);
  const s3 = (status: number) => Object.assign(new Error('x'), { $metadata: { httpStatusCode: status } });

  it('404/403/NoSuchKey/ENOENT là X2, kèm chỗ dùng và link', () => {
    for (const error of [s3(404), s3(403), Object.assign(new Error('x'), { name: 'NoSuchKey' }), Object.assign(new Error('x'), { code: 'ENOENT' })]) {
      expect(isMissingError(error)).toBe(true);
    }
    const out = unreadableIssues([{ file: file('a1', 'img/hero-1a2b3c4d.png'), error: s3(404) }], uses, 'p1', { hero: 'Hero' });
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('asset-file-missing');
    expect(out[0]!.items?.[0]).toEqual({ label: 'hero.png — trang › Hero', href: '/builder/p1?node=hero' });
  });

  it('lỗi mạng / 500 là X3', () => {
    expect(isMissingError(new Error('connect ECONNREFUSED'))).toBe(false);
    const out = unreadableIssues([{ file: file('a1', 'k.png'), error: new Error('connect ECONNREFUSED') }], uses, 'p1', {});
    expect(out.map((i) => i.code)).toEqual(['storage-unreachable']);
  });

  it('bất biến: mỗi file đọc lỗi đều có mặt trong issue block', () => {
    const failures = [
      { file: file('a1', 'a.png'), error: s3(404) },
      { file: file('a2', 'b.png'), error: s3(404) },
      { file: file('a3', 'c.png'), error: new Error('timeout') },
    ];
    const out = unreadableIssues(failures, uses, 'p1', {});
    expect(out.every((i) => i.level === 'block')).toBe(true);
    expect(out.find((i) => i.code === 'asset-file-missing')?.items).toHaveLength(2);
    expect(out.find((i) => i.code === 'storage-unreachable')).toBeDefined();
  });
});

describe('missingComponentRefs', () => {
  it('bắt cả component trong repeat.blockComponents', () => {
    const nodes = {
      i1: { id: 'i1', type: 'Instance', componentId: 'ok', repeat: { blockComponents: { quote: 'gone', text: 'ok' } } },
      i2: { id: 'i2', type: 'Instance', componentId: 'gone2' },
      i3: { id: 'i3', type: 'Instance', componentId: 'ok' },
    } as never;
    expect(missingComponentRefs(nodes, new Set(['ok']))).toEqual([{ nodeId: 'i1' }, { nodeId: 'i2' }]);
  });
});

describe('readExportFile', () => {
  it('không đọc ra ngoài public/ — coi như file mất (X2)', async () => {
    const err = await readExportFile({ entry: '', asset: { key: 'k', url: '/../package.json' } }).catch((e) => e);
    expect(isMissingError(err)).toBe(true);
  });
});
