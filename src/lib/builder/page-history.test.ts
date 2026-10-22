import { describe, expect, it } from 'vitest';

import { diffDocs } from './doc-diff';
import { CURRENT_SCHEMA_VERSION, type Doc } from '@/lib/doc/types';

/**
 * `listPageVersions` và `revertPageToVersion` chạm Prisma, nên chúng thuộc nhóm
 * chỉ chạy được khi client đã generate. Cái test được ở đây là **hợp đồng mà
 * lịch sử dựa vào**: `diffDocs` so được hai `Doc` BẤT KỲ, không chỉ live-vs-draft.
 *
 * Nếu một ngày ai đó siết `diffDocs` để chỉ nhận live-vs-draft, lịch sử mất cột
 * "đổi gì" mà không có gì đỏ — trừ test này.
 */

function doc(ids: string[]): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: Object.fromEntries(
      ['root', ...ids].map((id) => [
        id,
        { id, type: 'Section', parentId: id === 'root' ? null : 'root', children: [], effects: [], style: { base: {} } },
      ]),
    ),
  } as unknown as Doc;
}

describe('diffDocs — hợp đồng cho lịch sử trang', () => {
  it('so được hai version bất kỳ, không riêng live-vs-draft', () => {
    const d = diffDocs(doc(['a', 'b']), doc(['b', 'c']));
    expect(d.added).toEqual(['c']);
    expect(d.removed).toEqual(['a']);
  });

  it('hai bản giống nhau ra rỗng — KHÁC với không so được', () => {
    // Lịch sử phân biệt hai trạng thái này: rỗng nghĩa là "so rồi, không đổi
    // node"; `null` (bản đầu, không có cha) nghĩa là "không so được".
    const d = diffDocs(doc(['a']), doc(['a']));
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('nhận null ở vế trái — bản đầu tiên của một trang', () => {
    const d = diffDocs(null, doc(['a']));
    expect(d.added).toContain('a');
    expect(d.removed).toEqual([]);
  });
});
