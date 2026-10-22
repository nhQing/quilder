/**
 * Ảnh nền phải được NẠP, không chỉ được compile.
 *
 * Hợp đồng `fill.image` có ba mắt xích: compiler phát `var(--asset-<id>)`, renderer
 * định nghĩa biến đó từ `ctx.assets`, và trước cả hai, tầng trang phải biết mà đi
 * hỏi DB cho đúng những asset ấy. Đứt mắt xích thứ ba thì hai mắt xích kia vẫn
 * "đúng" mà trang vẫn không có ảnh — vẫn là im lặng.
 *
 * Hai chỗ đứt tìm ra ngày 14/09/2026:
 *   - `style.states.<tên>` là lớp LỒNG một cấp, nên vòng lặp `Object.values(style)`
 *     đọc trúng object chứa các state chứ không đọc từng state. Ảnh nền của state
 *     do effect bật không bao giờ được nạp.
 *   - `instanceAssetIds` chỉ nhìn `Image`/`Video`, không nhìn style — nên ảnh nền
 *     của một node BÊN TRONG component không bao giờ được nạp. Đây là ca đắt nhất:
 *     builder khuyến khích dựng mọi thứ bằng component.
 */

import { describe, expect, it } from 'vitest';

import type { Node } from '@/lib/doc/types';
import { instanceAssetIds, styleAssetIds } from './instance';

const nodeWith = (style: Record<string, unknown>): Node =>
  ({
    id: 'c-root',
    type: 'Stack',
    direction: { base: 'column' },
    parentId: null,
    children: [],
    effects: [],
    style,
  }) as unknown as Node;

describe('styleAssetIds — mọi lớp, kể cả lớp lồng', () => {
  it('base, breakpoint, hover đều tính', () => {
    const ids = styleAssetIds(
      nodeWith({
        base: { fill: { image: { assetId: 'a1', fit: 'cover' } } },
        md: { fill: { image: { assetId: 'a2', fit: 'cover' } } },
        hover: { fill: { image: { assetId: 'a3', fit: 'cover' } } },
      }),
    );
    expect(new Set(ids)).toEqual(new Set(['a1', 'a2', 'a3']));
  });

  it('state do effect bật cũng tính — `states` là lớp LỒNG', () => {
    const ids = styleAssetIds(
      nodeWith({ base: {}, states: { 'is-inverted': { fill: { image: { assetId: 'a4', fit: 'cover' } } } } }),
    );
    expect(ids).toEqual(['a4']);
  });

  it('không có ảnh nền thì không trả gì', () => {
    expect(styleAssetIds(nodeWith({ base: { fill: { color: { hex: '#fff' } } } }))).toEqual([]);
  });
});

describe('instanceAssetIds — node bên trong component', () => {
  it('ảnh nền của node trong component cũng phải được nạp', () => {
    const tree = { nodes: { 'c-root': nodeWith({ base: { fill: { image: { assetId: 'a9', fit: 'cover' } } } }) } };
    expect(instanceAssetIds(tree, {})).toContain('a9');
  });
});
