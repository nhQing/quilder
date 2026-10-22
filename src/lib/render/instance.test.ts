import { describe, expect, it } from 'vitest';

/**
 * Phủ override nội dung lên node của component.
 *
 * Ba tính chất chịu lực:
 *
 *  1. **KHÔNG sửa cây component.** Cây đó dùng chung cho mọi instance trên trang;
 *     ghi vào nó thì override của instance này rò rỉ sang instance kia, và lỗi
 *     chỉ lộ ra khi có từ hai instance trở lên.
 *  2. **Chỉ nội dung.** Style và cấu trúc luôn theo component — đó là cả điểm.
 *  3. **Dữ liệu rác bị bỏ qua**, không làm trang trắng.
 */

import type { Node } from '@/lib/doc/types';
import { applyOverride, instanceAssetIds } from './instance';

const base = { parentId: null, children: [] as string[], style: { base: {} }, effects: [] };

const text = () =>
  ({ ...base, id: 't', type: 'Text', tag: 'p', content: [{ t: 'text', v: 'Gốc' }] }) as unknown as Node;
const button = () =>
  ({
    ...base, id: 'b', type: 'Button', variant: 'primary',
    label: [{ t: 'text', v: 'Bấm' }], action: { kind: 'link', href: '/goc' },
  }) as unknown as Node;
const image = () =>
  ({ ...base, id: 'i', type: 'Image', alt: 'Ảnh gốc', assetId: 'a1', fit: { base: 'cover' } }) as unknown as Node;

const contentOf = (n: Node) => (n as { content: { v: string }[] }).content[0]!.v;

describe('applyOverride — thay đúng thứ được phép', () => {
  it('thay chữ của Text', () => {
    const out = applyOverride(text(), { content: [{ t: 'text', v: 'Đã đổi' }] });
    expect(contentOf(out)).toBe('Đã đổi');
  });

  it('thay nhãn và href của Button', () => {
    const out = applyOverride(button(), {
      label: [{ t: 'text', v: 'Mới' }],
      href: '/moi',
    }) as { label: { v: string }[]; action: { href: string } };
    expect(out.label[0]!.v).toBe('Mới');
    expect(out.action.href).toBe('/moi');
  });

  it('thay alt và ảnh của Image', () => {
    const out = applyOverride(image(), { alt: 'Ảnh mới', assetId: 'a2' }) as {
      alt: string; assetId: string | null;
    };
    expect(out.alt).toBe('Ảnh mới');
    expect(out.assetId).toBe('a2');
  });

  it('assetId null nghĩa là DÙNG ẢNH CỦA COMPONENT, không phải bỏ qua', () => {
    // Khác hẳn với "không có khoá này": null là một lựa chọn có chủ đích.
    const out = applyOverride(image(), { assetId: null }) as { assetId: string | null };
    expect(out.assetId).toBeNull();
  });

  it('thay nhãn a11y, giữ các trường a11y khác', () => {
    const node = { ...text(), a11y: { role: 'note', label: 'cũ' } } as Node;
    const out = applyOverride(node, { a11yLabel: 'mới' });
    expect(out.a11y).toEqual({ role: 'note', label: 'mới' });
  });
});

describe('KHÔNG sửa cây component', () => {
  it('node gốc không đổi', () => {
    const node = text();
    applyOverride(node, { content: [{ t: 'text', v: 'Đã đổi' }] });
    expect(contentOf(node)).toBe('Gốc');
  });

  it('object a11y lồng cũng không đổi', () => {
    // Chỗ dễ quên nhất: bản sao nông vẫn chia sẻ chính object a11y đó.
    const node = { ...text(), a11y: { role: 'note', label: 'cũ' } } as Node;
    applyOverride(node, { a11yLabel: 'mới' });
    expect(node.a11y?.label).toBe('cũ');
  });

  it('action của Button cũng không đổi', () => {
    const node = button();
    applyOverride(node, { href: '/moi' });
    expect((node as { action: { href: string } }).action.href).toBe('/goc');
  });

  it('không có override thì trả về ĐÚNG object cũ', () => {
    // Giữ nguyên reference là điều kiện để React bỏ qua nhánh không đổi.
    const node = text();
    expect(applyOverride(node, undefined)).toBe(node);
    expect(applyOverride(node, {})).toBe(node);
  });

  it('hai instance của cùng component không giẫm lên nhau', () => {
    const node = text();
    const a = applyOverride(node, { content: [{ t: 'text', v: 'A' }] });
    const b = applyOverride(node, { content: [{ t: 'text', v: 'B' }] });
    expect(contentOf(a)).toBe('A');
    expect(contentOf(b)).toBe('B');
    expect(contentOf(node)).toBe('Gốc');
  });
});

describe('chỉ nội dung, không style và không cấu trúc', () => {
  it('override không mang được style', () => {
    // Schema `.strict()` đã chặn ở tầng ghi; đây là lớp thứ hai lúc render.
    const out = applyOverride(text(), { style: { base: { fill: {} } } } as never);
    expect(out.style).toEqual({ base: {} });
  });

  it('override không mang được children', () => {
    const out = applyOverride(text(), { children: ['x'] } as never);
    expect(out.children).toEqual([]);
  });
});

describe('dữ liệu rác bị bỏ qua', () => {
  it('sai kiểu: chuỗi cho content, mảng cho alt', () => {
    expect(contentOf(applyOverride(text(), { content: 'chuỗi trần' } as never))).toBe('Gốc');
    expect((applyOverride(image(), { alt: [] } as never) as { alt: string }).alt).toBe('Ảnh gốc');
  });

  it('href KHÔNG áp lên action không phải link', () => {
    // Ghi đè lên `anchor` sẽ tạo một action lai không hợp lệ với schema.
    const node = { ...button(), action: { kind: 'anchor', toNodeId: 'x' } } as unknown as Node;
    const out = applyOverride(node, { href: '/moi' }) as { action: Record<string, unknown> };
    expect(out.action).toEqual({ kind: 'anchor', toNodeId: 'x' });
  });

  it('override cho trường không thuộc node type thì bị bỏ', () => {
    const out = applyOverride(text(), { alt: 'x', href: '/y' });
    expect(out).toEqual(text());
  });

  it('assetId rỗng bị bỏ — nó không phải "dùng ảnh component"', () => {
    const out = applyOverride(image(), { assetId: '' } as never) as { assetId: string | null };
    expect(out.assetId).toBe('a1');
  });
});

describe('instanceAssetIds', () => {
  const tree = { nodes: { i: image(), t: text() } };

  it('gom ảnh của component khi không có override', () => {
    expect(instanceAssetIds(tree, {})).toEqual(['a1']);
  });

  it('gom ảnh ĐÃ ghi đè, không phải ảnh gốc', () => {
    // Không tính theo bản đã phủ thì ảnh override không được nạp và Image trả về
    // null — ảnh biến mất mà không có lỗi nào.
    expect(instanceAssetIds(tree, { i: { assetId: 'a2' } })).toEqual(['a2']);
  });

  it('assetId null thì không có ảnh nào để nạp', () => {
    expect(instanceAssetIds(tree, { i: { assetId: null } })).toEqual([]);
  });
});
