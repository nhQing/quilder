/**
 * Ops engine.
 *
 * Bất biến quan trọng nhất được canh ở đây: `apply` rồi `invert` phải trả về
 * ĐÚNG doc ban đầu, kể cả với op xoá cả một cây con. Undo sai là cách nhanh nhất
 * để mất niềm tin vào một editor.
 */

import { describe, expect, it } from 'vitest';

import { apply, invert, OpError, subtreeIds, type Op } from './ops';
import { CURRENT_SCHEMA_VERSION } from './types';
import type { Doc, SectionNode, StackNode, TextNode } from './types';

const t = (name: string) => ({ $token: name });

function baseDoc(): Doc {
  const root: SectionNode = {
    id: 'root', type: 'Section', tag: 'main',
    parentId: null, children: ['a', 'b'], effects: [],
    style: { base: {} },
  };
  const a: StackNode = {
    id: 'a', type: 'Stack', direction: { base: 'column' },
    parentId: 'root', children: ['a1'], name: 'Khối A', effects: [],
    style: { base: { spacing: { pt: t('space-l') } } },
  };
  const a1: TextNode = {
    id: 'a1', type: 'Text', tag: 'p',
    parentId: 'a', children: [], effects: [],
    style: { base: {} },
    content: [{ t: 'text', v: 'xin chào' }],
  };
  const b: StackNode = {
    id: 'b', type: 'Stack', direction: { base: 'row' },
    parentId: 'root', children: [], effects: [],
    style: { base: {} },
  };
  return { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes: { root, a, a1, b } };
}

/** apply → invert → phải bằng doc ban đầu. */
function roundTrip(ops: Op[]) {
  const before = baseDoc();
  const after = apply(before, ops);
  const back = apply(after, invert(before, ops));
  return { before, after, back };
}

describe('apply — không mutate đầu vào', () => {
  it('doc gốc giữ nguyên sau khi apply', () => {
    const doc = baseDoc();
    const snapshot = JSON.stringify(doc);
    apply(doc, [{ op: 'setName', nodeId: 'a', name: 'Đổi tên' }]);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });
});

describe('setStyle', () => {
  it('merge sâu, không ghi đè cả nhóm', () => {
    const after = apply(baseDoc(), [
      { op: 'setStyle', nodeId: 'a', target: 'base', patch: { spacing: { pb: t('space-s') } } },
    ]);
    const spacing = after.nodes.a!.style.base.spacing!;
    expect(spacing.pt).toEqual(t('space-l')); // giữ nguyên
    expect(spacing.pb).toEqual(t('space-s')); // thêm mới
  });

  it('null xoá một key — cách inspector gỡ thuộc tính', () => {
    const after = apply(baseDoc(), [
      { op: 'setStyle', nodeId: 'a', target: 'base', patch: { spacing: { pt: null } } as never },
    ]);
    // Gỡ key CUỐI CÙNG của một nhóm thì nhóm biến mất luôn, không để lại `{}`.
    // Trước đây `{ spacing: {} }` ở lại vĩnh viễn — vô hình trên trang, nhưng
    // làm lớp override trông như vẫn còn nội dung, và doc phình dần theo mỗi
    // lần người dùng gỡ một thuộc tính.
    expect(after.nodes.a!.style.base.spacing).toBeUndefined();
  });

  it('lớp override rỗng bị xoá hẳn, không để lại {} vô nghĩa', () => {
    const withMd = apply(baseDoc(), [
      { op: 'setStyle', nodeId: 'a', target: 'md', patch: { spacing: { pt: t('space-s') } } },
    ]);
    expect(withMd.nodes.a!.style.md).toBeDefined();

    const cleared = apply(withMd, [
      { op: 'setStyle', nodeId: 'a', target: 'md', patch: { spacing: null } as never },
    ]);
    expect(cleared.nodes.a!.style.md).toBeUndefined();
  });

  it('round-trip chính xác', () => {
    const { before, back } = roundTrip([
      { op: 'setStyle', nodeId: 'a', target: 'base', patch: { spacing: { pt: t('space-3xl') } } },
      { op: 'setStyle', nodeId: 'a', target: 'lg', patch: { layout: { display: 'grid' } } },
    ]);
    expect(back).toEqual(before);
  });
});

describe('removeNode', () => {
  it('xoá cả cây con, không để lại node mồ côi', () => {
    const after = apply(baseDoc(), [{ op: 'removeNode', nodeId: 'a' }]);
    expect(after.nodes.a).toBeUndefined();
    expect(after.nodes.a1).toBeUndefined();
    expect(after.nodes.root!.children).toEqual(['b']);
  });

  it('undo khôi phục cả cây con, đúng vị trí', () => {
    const { before, back } = roundTrip([{ op: 'removeNode', nodeId: 'a' }]);
    expect(back).toEqual(before);
    expect(back.nodes.root!.children).toEqual(['a', 'b']);
  });

  it('không xoá được node gốc', () => {
    expect(() => apply(baseDoc(), [{ op: 'removeNode', nodeId: 'root' }])).toThrow(OpError);
  });
});

describe('moveNode', () => {
  it('chuyển được và undo về đúng chỗ cũ', () => {
    const { before, after, back } = roundTrip([
      { op: 'moveNode', nodeId: 'a', newParentId: 'b', newIndex: 0 },
    ]);
    expect(after.nodes.b!.children).toEqual(['a']);
    expect(after.nodes.root!.children).toEqual(['b']);
    expect(back).toEqual(before);
  });

  it('chặn chuyển node vào trong cây con của chính nó', () => {
    expect(() =>
      apply(baseDoc(), [{ op: 'moveNode', nodeId: 'a', newParentId: 'a1', newIndex: 0 }]),
    ).toThrow(OpError);
  });
});

describe('effect', () => {
  const attachment = { id: 'fx1', effect: 'tilt', params: { max: 9 } };

  it('gắn, sửa param, gỡ — và mỗi bước undo được', () => {
    const { before, back } = roundTrip([
      { op: 'attachEffect', nodeId: 'a', attachment },
      { op: 'updateEffect', nodeId: 'a', instanceId: 'fx1', params: { max: 3 } },
    ]);
    expect(back).toEqual(before);
  });

  it('chặn trùng instanceId', () => {
    const withFx = apply(baseDoc(), [{ op: 'attachEffect', nodeId: 'a', attachment }]);
    expect(() => apply(withFx, [{ op: 'attachEffect', nodeId: 'a', attachment }])).toThrow(OpError);
  });

  it('detach rồi undo trả lại đúng params', () => {
    const withFx = apply(baseDoc(), [{ op: 'attachEffect', nodeId: 'a', attachment }]);
    const ops: Op[] = [{ op: 'detachEffect', nodeId: 'a', instanceId: 'fx1' }];
    const back = apply(apply(withFx, ops), invert(withFx, ops));
    expect(back.nodes.a!.effects).toEqual([attachment]);
  });
});

describe('setProps — chặn field có bất biến riêng', () => {
  it.each(['id', 'parentId', 'children', 'type', 'style', 'effects'])(
    'không cho setProps đụng "%s"',
    (field) => {
      expect(() =>
        apply(baseDoc(), [{ op: 'setProps', nodeId: 'a', props: { [field]: 'x' } }]),
      ).toThrow(OpError);
    },
  );
});

describe('customCss', () => {
  it('chuỗi rỗng coi như gỡ bỏ', () => {
    const after = apply(baseDoc(), [{ op: 'setCustomCss', nodeId: 'a', css: '   ' }]);
    expect(after.nodes.a!.customCss).toBeUndefined();
  });

  it('round-trip', () => {
    const { before, back } = roundTrip([
      { op: 'setCustomCss', nodeId: 'a', css: 'opacity: .5;' },
    ]);
    expect(back).toEqual(before);
  });
});

describe('chuỗi op nhiều bước', () => {
  it('undo cả loạt trả về đúng trạng thái đầu', () => {
    const ops: Op[] = [
      { op: 'setName', nodeId: 'a', name: 'Mới' },
      { op: 'setStyle', nodeId: 'a', target: 'base', patch: { effects: { opacity: 0.5 } } },
      { op: 'removeNode', nodeId: 'a1' },
      { op: 'moveNode', nodeId: 'b', newParentId: 'a', newIndex: 0 },
      { op: 'setCustomCss', nodeId: 'a', css: 'color: red;' },
    ];
    const { before, back } = roundTrip(ops);
    expect(back).toEqual(before);
  });
});

describe('subtreeIds', () => {
  it('gồm chính nó và mọi hậu duệ', () => {
    expect(subtreeIds(baseDoc(), 'a').sort()).toEqual(['a', 'a1']);
    expect(subtreeIds(baseDoc(), 'root').sort()).toEqual(['a', 'a1', 'b', 'root']);
  });
});

describe('setStyle — dọn rác khi gỡ override', () => {
  const doc = (): Doc => ({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'r',
    nodes: {
      r: {
        id: 'r', type: 'Stack', direction: { base: 'column' },
        parentId: null, children: [], effects: [],
        style: {
          base: { spacing: { pt: { v: 4, u: 'px' } } },
          md: { spacing: { pt: { v: 8, u: 'px' } }, layout: { gap: { v: 2, u: 'px' } } },
        },
      } as unknown as StackNode,
    },
  });

  it('gỡ thuộc tính cuối của một nhóm thì xoá luôn nhóm', () => {
    // `{ spacing: {} }` không sinh declaration nào nên vô hình trên trang, nhưng
    // nó làm lớp override trông như "có nội dung" mãi mãi.
    const next = apply(doc(), [
      { op: 'setStyle', nodeId: 'r', target: 'md', patch: { spacing: { pt: null } } as never },
    ]);
    expect(next.nodes.r!.style.md).toEqual({ layout: { gap: { v: 2, u: 'px' } } });
    expect(next.nodes.r!.style.md).not.toHaveProperty('spacing');
  });

  it('gỡ hết mọi nhóm thì xoá cả lớp override', () => {
    const next = apply(doc(), [
      { op: 'setStyle', nodeId: 'r', target: 'md', patch: { spacing: { pt: null } } as never },
      { op: 'setStyle', nodeId: 'r', target: 'md', patch: { layout: { gap: null } } as never },
    ]);
    expect(next.nodes.r!.style.md).toBeUndefined();
  });

  it('lớp base KHÔNG bị xoá dù rỗng — mọi lớp khác kế thừa từ nó', () => {
    const next = apply(doc(), [
      { op: 'setStyle', nodeId: 'r', target: 'base', patch: { spacing: { pt: null } } as never },
    ]);
    expect(next.nodes.r!.style.base).toEqual({});
  });

  it('hoàn tác vẫn khôi phục đúng sau khi nhóm bị xoá', () => {
    const before = doc();
    const ops: Op[] = [
      { op: 'setStyle', nodeId: 'r', target: 'md', patch: { spacing: { pt: null } } as never },
    ];
    const after = apply(before, ops);
    const restored = apply(after, invert(before, ops));
    expect(restored.nodes.r!.style.md).toEqual(before.nodes.r!.style.md);
  });
});

describe('setStyle — giá trị có kiểu phải THAY, không được trộn', () => {
  const node = (style: Record<string, unknown>): Doc => ({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'r',
    nodes: {
      r: {
        id: 'r', type: 'Stack', direction: { base: 'column' },
        parentId: null, children: [], effects: [], style,
      } as unknown as StackNode,
    },
  });

  const set = (doc: Doc, patch: unknown) =>
    apply(doc, [{ op: 'setStyle', nodeId: 'r', target: 'base', patch } as never]);

  it('token → số: thay hẳn, không để lại $token', () => {
    // Bug thật: `{$token:'space-l'}` trộn với `{v:16,u:'px'}` ra
    // `{$token:'space-l', v:16, u:'px'}`, và `len()` đọc nhánh $token trước nên
    // trang vẫn render var(--space-l). Người dùng gõ 16px mà không thấy gì đổi.
    const next = set(node({ base: { layout: { gap: { $token: 'space-l' } } } }), {
      layout: { gap: { v: 16, u: 'px' } },
    });
    expect(next.nodes.r!.style.base.layout!.gap).toEqual({ v: 16, u: 'px' });
  });

  it('số → token: thay hẳn, không để lại v/u', () => {
    const next = set(node({ base: { spacing: { pt: { v: 8, u: 'px' } } } }), {
      spacing: { pt: { $token: 'space-l' } },
    });
    expect(next.nodes.r!.style.base.spacing!.pt).toEqual({ $token: 'space-l' });
  });

  it('màu: hex ↔ token cũng thay hẳn', () => {
    const a = set(node({ base: { fill: { color: { $token: 'color-accent' } } } }), {
      fill: { color: { hex: '#0d1321' } },
    });
    expect(a.nodes.r!.style.base.fill!.color).toEqual({ hex: '#0d1321' });

    const b = set(node({ base: { fill: { color: { hex: '#fff' } } } }), {
      fill: { color: { $token: 'color-accent' } },
    });
    expect(b.nodes.r!.style.base.fill!.color).toEqual({ $token: 'color-accent' });
  });

  it('clamp → số: công thức cũ biến mất hoàn toàn', () => {
    const next = set(
      node({
        base: {
          typography: {
            size: { clamp: [{ v: 1, u: 'rem' }, { v: 5, u: 'cqw' }, { v: 3, u: 'rem' }] },
          },
        },
      }),
      { typography: { size: { v: 24, u: 'px' } } },
    );
    expect(next.nodes.r!.style.base.typography!.size).toEqual({ v: 24, u: 'px' });
  });

  it('NHÓM thuộc tính vẫn trộn — không được mất key khác', () => {
    // Đây là nửa còn lại của hợp đồng: sửa `pt` không được xoá `pb`.
    const next = set(
      node({ base: { spacing: { pt: { v: 4, u: 'px' }, pb: { v: 9, u: 'px' } } } }),
      { spacing: { pt: { v: 20, u: 'px' } } },
    );
    expect(next.nodes.r!.style.base.spacing).toEqual({
      pt: { v: 20, u: 'px' },
      pb: { v: 9, u: 'px' },
    });
  });

  it('round-trip vẫn chính xác sau khi thay giá trị', () => {
    const before = node({ base: { layout: { gap: { $token: 'space-l' } } } });
    const ops: Op[] = [
      { op: 'setStyle', nodeId: 'r', target: 'base', patch: { layout: { gap: { v: 16, u: 'px' } } } },
    ];
    expect(apply(apply(before, ops), invert(before, ops))).toEqual(before);
  });
});

describe('setStyle — null KHÔNG bao giờ được lưu vào doc', () => {
  const node = (style: Record<string, unknown>): Doc => ({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'r',
    nodes: {
      r: {
        id: 'r', type: 'Stack', direction: { base: 'column' },
        parentId: null, children: [], effects: [], style,
      } as unknown as StackNode,
    },
  });

  const set = (doc: Doc, target: string, patch: unknown) =>
    apply(doc, [{ op: 'setStyle', nodeId: 'r', target, patch } as never]);

  it('gỡ override ở lớp CHƯA có nhóm đó không lưu null', () => {
    // Đây là crash thật đã gặp: nhánh "nhóm chưa tồn tại" gán thẳng patch, nên
    // doc lưu `spacing.pt = null`, rồi `len(null)` ném lỗi giữa lúc render
    // server component và sập cả trang builder.
    const next = set(node({ base: { spacing: { pt: { v: 4, u: 'px' } } } }), 'md', {
      spacing: { pt: null },
    });
    expect(next.nodes.r!.style.md).toBeUndefined();
  });

  it('gỡ một key trong nhóm chưa tồn tại, còn key khác thì vẫn tạo nhóm', () => {
    const next = set(node({ base: {} }), 'md', {
      spacing: { pt: null, pb: { v: 8, u: 'px' } },
    });
    expect(next.nodes.r!.style.md).toEqual({ spacing: { pb: { v: 8, u: 'px' } } });
  });

  it('không có null nào sót lại trong style, ở bất kỳ độ sâu nào', () => {
    const next = set(node({ base: {} }), 'lg', {
      size: { maxWidth: null, minHeight: null },
      layout: { gap: null },
    });
    // Chỉ soi `style`: `parentId: null` là hợp lệ và không liên quan.
    expect(JSON.stringify(next.nodes.r!.style)).not.toContain('null');
  });

  it('null ở mức NHÓM cũng xoá được khi nhóm chưa tồn tại', () => {
    const next = set(node({ base: {} }), 'md', { spacing: null });
    expect(next.nodes.r!.style.md).toBeUndefined();
  });
});

/**
 * `setStyle` vào `style.states` — state do effect điều khiển.
 *
 * Trước 07/09/2026 `target` là enum đóng 8 giá trị, nên `style.states` chỉ ghi
 * được qua `insertNode` (node mang sẵn cả cây style). Schema đã nhận, compiler đã
 * phát `[data-n][data-<state>="true"]`, và hai effect đang ghi state ra DOM —
 * thiếu đúng một đường ghi.
 *
 * Undo là chỗ dễ sai nhất: lớp cố định nằm thẳng trên `style`, còn state nằm lồng
 * trong `style.states`. Hai bản của luật đó là hai bản sẽ trôi, và bản trôi nghĩa
 * là hoàn tác ghi vào chỗ khác chỗ đã ghi.
 */
describe('setStyle — state của effect', () => {
  const patch = { typography: { color: { hex: '#ffffff' } } } as never;

  it('ghi vào style.states, không tạo khoá lạ trên style', () => {
    const after = apply(baseDoc(), [
      { op: 'setStyle', nodeId: 'a', target: { state: 'inverted' }, patch },
    ]);
    const style = after.nodes.a!.style as unknown as Record<string, unknown>;
    expect(style.states).toEqual({ inverted: { typography: { color: { hex: '#ffffff' } } } });
    expect(style.inverted).toBeUndefined();
  });

  it('trộn sâu vào state đang có, không thay cả nhóm', () => {
    const after = apply(baseDoc(), [
      { op: 'setStyle', nodeId: 'a', target: { state: 'inverted' }, patch },
      {
        op: 'setStyle', nodeId: 'a', target: { state: 'inverted' },
        patch: { typography: { weight: 600 } } as never,
      },
    ]);
    const states = (after.nodes.a!.style as unknown as { states: Record<string, unknown> }).states;
    expect(states.inverted).toEqual({
      typography: { color: { hex: '#ffffff' }, weight: 600 },
    });
  });

  it('gỡ thuộc tính cuối thì xoá luôn state, và xoá luôn bản đồ states', () => {
    const withState = apply(baseDoc(), [
      { op: 'setStyle', nodeId: 'a', target: { state: 'inverted' }, patch },
    ]);
    const after = apply(withState, [
      {
        op: 'setStyle', nodeId: 'a', target: { state: 'inverted' },
        patch: { typography: { color: null } } as never,
      },
    ]);
    const style = after.nodes.a!.style as unknown as Record<string, unknown>;
    // `{ states: {} }` không sinh CSS nào nhưng làm diff và `ownLayer` nói dối.
    expect(style.states).toBeUndefined();
  });

  it('state của node này không chạm state của node khác', () => {
    const after = apply(baseDoc(), [
      { op: 'setStyle', nodeId: 'a', target: { state: 'inverted' }, patch },
    ]);
    expect(
      (after.nodes.b!.style as unknown as { states?: unknown }).states,
    ).toBeUndefined();
  });

  it('undo trả về đúng doc ban đầu', () => {
    const { before, back } = roundTrip([
      { op: 'setStyle', nodeId: 'a', target: { state: 'collapsed' }, patch },
    ]);
    expect(back).toEqual(before);
  });

  it('undo của lần ghi THỨ HAI chỉ gỡ phần vừa thêm', () => {
    const first = apply(baseDoc(), [
      { op: 'setStyle', nodeId: 'a', target: { state: 'collapsed' }, patch },
    ]);
    const second: Op[] = [
      {
        op: 'setStyle', nodeId: 'a', target: { state: 'collapsed' },
        patch: { typography: { weight: 700 } } as never,
      },
    ];
    const back = apply(apply(first, second), invert(first, second));
    expect(back).toEqual(first);
  });
});
