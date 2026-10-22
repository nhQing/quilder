import { describe, expect, it } from 'vitest';

import { assetUsesInDoc } from './asset-refs';
import type { Doc, Node } from '@/lib/doc/types';

/**
 * Tìm asset mà một doc đang dùng.
 *
 * Bốn chỗ node có thể trỏ tới asset, và bỏ sót chỗ nào là báo "không ai dùng" cho
 * một ảnh đang hiện trên trang — thứ dẫn thẳng tới việc người dùng gỡ nhầm. Nên mỗi
 * chỗ có một test riêng.
 *
 * `listAssetsWithUsage()` chạm Prisma nên không test được ở đây; phần đáng sai là
 * phép duyệt này, và nó thuần.
 */

const doc = (nodes: Record<string, unknown>): Doc =>
  ({ schemaVersion: 1, rootId: Object.keys(nodes)[0]!, nodes }) as unknown as Doc;

const base = (id: string, extra: Record<string, unknown>) => ({
  id,
  parentId: null,
  children: [],
  effects: [],
  style: { base: {} },
  ...extra,
});

/** Cây component, đúng hình dạng mà `loadComponents()` trả về. */
const trees = (
  byId: Record<string, Record<string, unknown>>,
): ReadonlyMap<string, { nodes: Record<string, Node> }> =>
  new Map(
    Object.entries(byId).map(([id, nodes]) => [id, { nodes: nodes as Record<string, Node> }]),
  );

describe('assetUsesInDoc', () => {
  it('node Image', () => {
    const m = assetUsesInDoc(doc({ a: base('a', { type: 'Image', assetId: 'img1' }) }));
    expect(m.get('img1')).toEqual(['a']);
  });

  it('node Image chưa gắn ảnh thì không tính', () => {
    const m = assetUsesInDoc(doc({ a: base('a', { type: 'Image', assetId: null }) }));
    expect(m.size).toBe(0);
  });

  it('node Video tính CẢ video lẫn poster', () => {
    // Bỏ sót poster là báo sai cho đúng loại ảnh dễ bị quên nhất.
    const m = assetUsesInDoc(
      doc({ a: base('a', { type: 'Video', assetId: 'v1', posterAssetId: 'p1' }) }),
    );
    expect(m.get('v1')).toEqual(['a']);
    expect(m.get('p1')).toEqual(['a']);
  });

  it('ảnh nền trong style', () => {
    const m = assetUsesInDoc(
      doc({
        a: base('a', {
          type: 'Section',
          style: { base: { fill: { image: { assetId: 'bg1' } } } },
        }),
      }),
    );
    expect(m.get('bg1')).toEqual(['a']);
  });

  it('ảnh nền ở layer responsive khác base', () => {
    // Ảnh nền đặt riêng cho khổ hẹp là trường hợp thật, và nó nằm ở layer `sm` chứ
    // không ở `base`. Chỉ duyệt `base` là bỏ sót.
    const m = assetUsesInDoc(
      doc({
        a: base('a', {
          type: 'Section',
          style: { base: {}, sm: { fill: { image: { assetId: 'bg-sm' } } } },
        }),
      }),
    );
    expect(m.get('bg-sm')).toEqual(['a']);
  });

  it('nhiều node cùng dùng một ảnh — gom lại', () => {
    const m = assetUsesInDoc(
      doc({
        a: base('a', { type: 'Image', assetId: 'x' }),
        b: base('b', { type: 'Image', assetId: 'x' }),
      }),
    );
    expect(m.get('x')).toEqual(['a', 'b']);
  });

  it('doc không dùng ảnh nào thì map rỗng', () => {
    expect(assetUsesInDoc(doc({ a: base('a', { type: 'Section' }) })).size).toBe(0);
  });
});

/**
 * Hai lỗ mà tầng renderer đã vá ở `4de3f7d`, còn nguyên ở đây.
 *
 * Cùng hình dạng dữ liệu, cùng hậu quả — nhưng hậu quả ở phía này NẶNG HƠN. Bên
 * renderer, đọc trượt nghĩa là một khối mất nền: nhìn thấy được, sửa được. Bên
 * này, đọc trượt nghĩa là `/builder/assets` in con số "0 nơi dùng" cho một tấm
 * ảnh đang hiện trên trang — rồi có người tin con số đó và bấm xoá. Không khôi
 * phục được.
 */
describe('assetUsesInDoc — hai lỗ của phép duyệt', () => {
  it('ảnh nền khai trong `style.states`', () => {
    // `states` là lớp LỒNG một cấp (tên state → style), nên `Object.values(style)`
    // đọc trúng cái hộp chứa các state chứ không đọc từng state. Header thật dùng
    // đúng cấu trúc này (`is-collapsed`, `is-inverted`).
    const m = assetUsesInDoc(
      doc({
        a: base('a', {
          type: 'Section',
          style: {
            base: {},
            states: { 'is-collapsed': { fill: { image: { assetId: 'bg-state' } } } },
          },
        }),
      }),
    );
    expect(m.get('bg-state')).toEqual(['a']);
  });

  it('ảnh nằm trong CÂY COMPONENT của một Instance', () => {
    // Ảnh chỉ được dùng bên trong component thì không node nào của doc mang id
    // của nó. Không nhìn vào cây component là nó "không ai dùng" trên mọi trang.
    const m = assetUsesInDoc(
      doc({ i1: base('i1', { type: 'Instance', componentId: 'cmp1', overrides: {} }) }),
      trees({ cmp1: { n1: base('n1', { type: 'Image', assetId: 'img-trong-cmp' }) } }),
    );
    expect(m.get('img-trong-cmp')).toEqual(['i1']);
  });

  it('ảnh NỀN của một node trong cây component, kể cả ở `states`', () => {
    const m = assetUsesInDoc(
      doc({ i1: base('i1', { type: 'Instance', componentId: 'cmp1', overrides: {} }) }),
      trees({
        cmp1: {
          n1: base('n1', {
            type: 'Section',
            style: { base: {}, states: { hovered: { fill: { image: { assetId: 'bg-cmp' } } } } },
          }),
        },
      }),
    );
    expect(m.get('bg-cmp')).toEqual(['i1']);
  });

  it('ảnh do OVERRIDE của instance chỉ định — kể cả khi chưa nạp cây component', () => {
    // Override nằm ngay trong doc, nên nó đọc được mà không cần cây. Bỏ qua nó là
    // báo "không ai dùng" cho đúng tấm ảnh mà người dùng vừa tự tay chọn.
    const m = assetUsesInDoc(
      doc({
        i1: base('i1', {
          type: 'Instance',
          componentId: 'cmp1',
          overrides: { n1: { assetId: 'img-override' }, n2: { posterAssetId: 'poster-override' } },
        }),
      }),
    );
    expect(m.get('img-override')).toEqual(['i1']);
    expect(m.get('poster-override')).toEqual(['i1']);
  });

  it('override THAY ảnh của component: đếm cả hai, không đếm trùng', () => {
    const m = assetUsesInDoc(
      doc({
        i1: base('i1', {
          type: 'Instance',
          componentId: 'cmp1',
          overrides: { n1: { assetId: 'img-moi' } },
        }),
      }),
      trees({ cmp1: { n1: base('n1', { type: 'Image', assetId: 'img-cu' }) } }),
    );
    // Ảnh mới đang hiện.
    expect(m.get('img-moi')).toEqual(['i1']);
    // Ảnh cũ vẫn là ảnh của COMPONENT — instance khác đang dùng nó, và xoá nó là
    // hỏng những trang kia. "Không ai dùng" ở đây vẫn là câu trả lời sai.
    expect(m.get('img-cu')).toEqual(['i1']);
  });

  it('một node không bao giờ được đếm hai lần cho cùng một ảnh', () => {
    const m = assetUsesInDoc(
      doc({
        a: base('a', {
          type: 'Image',
          assetId: 'x',
          style: { base: { fill: { image: { assetId: 'x' } } } },
        }),
      }),
    );
    // Trùng lặp ở đây đi thẳng vào `useCount` của trang quản lý ảnh: "2 nơi dùng"
    // cho một node duy nhất là một con số kiểm kê sai.
    expect(m.get('x')).toEqual(['a']);
  });
});

/**
 * Hồi quy: con số mà `/builder/assets` in ra.
 *
 * `listAssetsWithUsage()` tính "chưa dùng" bằng `usage.keys()` — đúng tập khoá mà
 * `assetUsesInDoc` trả về. Nên test này đo chính con số đó, không đo một hàm phụ.
 */
describe('asset-usage không còn báo "không ai dùng" cho ảnh đang hiện', () => {
  /** Đúng phép tính của `listAssetsWithUsage`: id nào KHÔNG nằm trong tập đang dùng. */
  const unusedAmong = (all: string[], m: Map<string, string[]>) =>
    all.filter((id) => !m.has(id));

  it('ba tấm ảnh đang hiện trên trang, không tấm nào bị kê là chưa dùng', () => {
    const m = assetUsesInDoc(
      doc({
        root: base('root', {
          type: 'Section',
          children: ['i1'],
          style: { base: {}, states: { 'is-inverted': { fill: { image: { assetId: 'bg-header' } } } } },
        }),
        i1: base('i1', {
          type: 'Instance',
          componentId: 'card',
          overrides: { slot: { assetId: 'anh-rieng-cua-trang' } },
        }),
      }),
      trees({ card: { logo: base('logo', { type: 'Image', assetId: 'logo-cua-component' }) } }),
    );

    expect(
      unusedAmong(['bg-header', 'anh-rieng-cua-trang', 'logo-cua-component', 'that-su-khong-ai-dung'], m),
    ).toEqual(['that-su-khong-ai-dung']);
  });
});

/**
 * Lô khung của `image-sequence` — chỗ thứ SÁU, và chỗ đắt nhất nếu bỏ sót.
 *
 * Một section clip giữ tới 400 assetId trong `params` của effect chứ không trong
 * một node nào cả. Bỏ qua nhánh này thì cả lô hiện "0 nơi dùng" ở
 * `/builder/assets` — không phải một tấm ảnh bị báo sai, mà là một lời mời xoá
 * hàng loạt, và xoá xong thì clip trên site thật thành một khung đứng im.
 */
describe('assetUsesInDoc — lô khung trong params effect', () => {
  const clip = (params: Record<string, unknown>) =>
    base('s', {
      type: 'Section',
      effects: [{ id: 'fx1', effect: 'image-sequence', params }],
    });

  it('đếm CẢ hai lô, rộng lẫn hẹp', () => {
    // Quên `framesNarrow` là báo sai cho đúng lô phục vụ máy yếu — nhóm mà cả
    // thiết kế này sinh ra để chăm.
    const m = assetUsesInDoc(
      doc({ s: clip({ frames: ['w1', 'w2'], framesNarrow: ['n1', 'n2'] }) }),
    );
    expect(m.get('w1')).toEqual(['s']);
    expect(m.get('w2')).toEqual(['s']);
    expect(m.get('n1')).toEqual(['s']);
    expect(m.get('n2')).toEqual(['s']);
  });

  it('đếm cả lô siêu rộng', () => {
    // Lô thứ ba thêm 25/09/2026. Bảng tham số cũng là thứ NodeRenderer đổi id → URL,
    // nên một lô thiếu ở đây vừa bị báo "chưa ai dùng" vừa đi xuống dạng id trần.
    const m = assetUsesInDoc(doc({ s: clip({ frames: ['w1', 'w2'], framesSuper: ['s1', 's2'] }) }));
    expect(m.get('s1')).toEqual(['s']);
    expect(m.get('s2')).toEqual(['s']);
  });

  it('không quét mù: `folder` và tên vai KHÔNG bị tính là asset', () => {
    // Quét mù mọi chuỗi trong params sẽ vớt cả những thứ này, và trang quản lý
    // ảnh không bao giờ dọn được gì nữa.
    const m = assetUsesInDoc(
      doc({ s: clip({ frames: ['w1', 'w2'], folder: 'trang-chu/clip-hero', pinPart: 'pin' }) }),
    );
    expect([...m.keys()].sort()).toEqual(['w1', 'w2']);
  });

  it('effect khác có params hình dạng tương tự thì không tính', () => {
    const m = assetUsesInDoc(
      doc({
        s: base('s', {
          type: 'Section',
          effects: [{ id: 'fx1', effect: 'rail-pin', params: { frames: ['khong-phai-anh'] } }],
        }),
      }),
    );
    expect(m.size).toBe(0);
  });
});
