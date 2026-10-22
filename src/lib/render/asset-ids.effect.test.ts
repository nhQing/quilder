/**
 * Lô khung của `image-sequence` phải được NẠP, không chỉ được khai.
 *
 * Cùng hợp đồng ba mắt xích như `asset-ids.style.test.ts`, chỉ khác chỗ trú của
 * assetId: ở đây chúng nằm trong `params` của một effect chứ không trong một
 * node nào. Đứt mắt xích "tầng trang đi hỏi DB cho đúng những asset ấy" thì
 * effect vẫn gắn, manifest vẫn phát, mà `collectEffects` không resolve được id
 * nào thành URL — lô rỗng, schema từ chối, clip không chạy. Im lặng, như mọi ca
 * trong file anh em.
 *
 * Phép duyệt thật nằm ở `effectAssetIds` (`@/lib/builder/asset-refs`) và có bộ
 * kiểm riêng ở đó. Test này canh đúng MỘT thứ mà bộ kia không thấy: tầng trang
 * có gọi nó hay không.
 */

import { describe, expect, it } from 'vitest';

import type { Doc, Node } from '@/lib/doc/types';
import { collectAssetIds } from './page';

const doc = (nodes: Record<string, unknown>): Doc =>
  ({ schemaVersion: 1, rootId: Object.keys(nodes)[0]!, nodes }) as unknown as Doc;

const section = (effects: unknown[]): Node =>
  ({
    id: 's',
    type: 'Section',
    parentId: null,
    children: [],
    style: { base: {} },
    effects,
  }) as unknown as Node;

describe('collectAssetIds — lô khung nằm trong params effect', () => {
  it('nạp CẢ hai lô, rộng lẫn hẹp', () => {
    const ids = collectAssetIds(
      doc({
        s: section([
          {
            id: 'fx1',
            effect: 'image-sequence',
            params: { frames: ['w1', 'w2', 'w3'], framesNarrow: ['n1', 'n2'] },
          },
        ]),
      }),
    );
    expect(new Set(ids)).toEqual(new Set(['w1', 'w2', 'w3', 'n1', 'n2']));
  });

  it('`folder` là metadata, không phải asset', () => {
    const ids = collectAssetIds(
      doc({
        s: section([
          {
            id: 'fx1',
            effect: 'image-sequence',
            params: { frames: ['w1', 'w2'], folder: 'trang-chu/clip-hero' },
          },
        ]),
      }),
    );
    expect(ids.sort()).toEqual(['w1', 'w2']);
  });

  it('section không có effect nào thì không nạp gì', () => {
    expect(collectAssetIds(doc({ s: section([]) }))).toEqual([]);
  });
});
