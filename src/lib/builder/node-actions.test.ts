import { describe, expect, it } from 'vitest';

/**
 * Thao tác cấu trúc.
 *
 * Mỗi hàm ở đây sinh ra op sẽ đi thẳng qua validator 4 tầng, nên test chạy luôn
 * `apply` để chứng minh chúng thật sự hợp lệ — chứ không chỉ "trông đúng hình
 * dạng". Một node mặc định thiếu field sẽ bị từ chối ở server và người dùng chỉ
 * thấy "op không hợp lệ".
 */

import { apply } from '@/lib/doc/ops';
import type { Doc, SectionNode, StackNode, TextNode } from '@/lib/doc/types';
import {
  afterRemove, blankNode, duplicateDeep, freshId, insertNear, reorder,
} from './node-actions';

function doc(): Doc {
  const root: SectionNode = {
    id: 'root', type: 'Section', tag: 'main',
    parentId: null, children: ['a', 'b'], effects: [], style: { base: {} },
  };
  const a: StackNode = {
    id: 'a', type: 'Stack', direction: { base: 'column' },
    parentId: 'root', children: ['a1'], name: 'Khối A', effects: [], style: { base: {} },
  };
  const a1: TextNode = {
    id: 'a1', type: 'Text', tag: 'p',
    parentId: 'a', children: [], effects: [], style: { base: {} },
    content: [{ t: 'text', v: 'xin chào' }],
  };
  const b: StackNode = {
    id: 'b', type: 'Stack', direction: { base: 'row' },
    parentId: 'root', children: [], effects: [], style: { base: {} },
  };
  return { schemaVersion: 1, rootId: 'root', nodes: { root, a, a1, b } };
}

const ok = <T,>(r: T | { error: string }): T => {
  if (r && typeof r === 'object' && 'error' in r) throw new Error((r as { error: string }).error);
  return r as T;
};

describe('freshId', () => {
  it('không trùng id đang có', () => {
    const d = doc();
    for (let i = 0; i < 50; i++) expect(d.nodes[freshId(d)]).toBeUndefined();
  });
});

describe('blankNode', () => {
  it.each(['Section', 'Stack', 'Grid', 'Text', 'Button', 'Image'] as const)(
    '%s mặc định apply được, không bị engine từ chối',
    (type) => {
      const d = doc();
      const node = blankNode(type, 'x1', 'root');
      const next = apply(d, [{ op: 'insertNode', parentId: 'root', index: 0, node }]);
      expect(next.nodes.x1!.type).toBe(type);
      expect(next.nodes.root!.children[0]).toBe('x1');
    },
  );

  it('Image mặc định là decorative — alt rỗng mà không khai sẽ bị validator chặn', () => {
    const node = blankNode('Image', 'x1', 'root');
    expect(node.type === 'Image' && node.decorative).toBe(true);
  });

  it('node lá luôn có children rỗng', () => {
    for (const type of ['Text', 'Button', 'Image'] as const) {
      expect(blankNode(type, 'x', 'root').children).toEqual([]);
    }
  });
});

describe('insertNear', () => {
  it('chọn node chứa được thì chèn VÀO TRONG, ở cuối', () => {
    const d = doc();
    const { ops } = ok(insertNear(d, 'a', 'Text'));
    const next = apply(d, ops);
    expect(next.nodes.a!.children).toHaveLength(2);
    expect(next.nodes.a!.children[1]).not.toBe('a1');
  });

  it('chọn node LÁ thì chèn làm anh em ngay sau nó', () => {
    // Đang chọn một đoạn văn và bấm "thêm văn bản" thì người ta muốn một đoạn
    // nữa bên cạnh, không phải một thông báo lỗi.
    const d = doc();
    const { ops, newId } = ok(insertNear(d, 'a1', 'Text'));
    const next = apply(d, ops);
    expect(next.nodes.a!.children).toEqual(['a1', newId]);
  });

  it('không chọn gì thì chèn vào gốc', () => {
    const d = doc();
    const { ops, newId } = ok(insertNear(d, null, 'Stack'));
    const next = apply(d, ops);
    expect(next.nodes[newId]!.parentId).toBe('root');
  });
});

describe('reorder', () => {
  it('đổi chỗ với anh em liền kề', () => {
    const d = doc();
    const next = apply(d, ok(reorder(d, 'b', -1)).ops);
    expect(next.nodes.root!.children).toEqual(['b', 'a']);
  });

  it('ở đầu hoặc cuối thì báo lỗi thay vì tạo op vô nghĩa', () => {
    const d = doc();
    expect(reorder(d, 'a', -1)).toHaveProperty('error');
    expect(reorder(d, 'b', 1)).toHaveProperty('error');
  });

  it('node gốc không đổi thứ tự được', () => {
    expect(reorder(doc(), 'root', 1)).toHaveProperty('error');
  });
});

describe('duplicateDeep', () => {
  it('nhân cả cây con, id mới hoàn toàn', () => {
    const d = doc();
    const { ops, newId } = ok(duplicateDeep(d, 'a'));
    const next = apply(d, ops);

    // Bản sao nằm ngay sau bản gốc.
    expect(next.nodes.root!.children).toEqual(['a', newId, 'b']);
    // Cây con đi theo, và KHÔNG dùng lại id cũ.
    expect(next.nodes[newId]!.children).toHaveLength(1);
    expect(next.nodes[newId]!.children[0]).not.toBe('a1');
    // Bản gốc còn nguyên.
    expect(next.nodes.a!.children).toEqual(['a1']);
  });

  it('không thêm id con hai lần', () => {
    // Cái bẫy đã gặp ở `invert`: giữ nguyên mảng children của node được sao chép
    // thì mỗi id con bị splice vào hai lần — một lần theo mảng, một lần theo op
    // của chính nó.
    const d = doc();
    const { ops, newId } = ok(duplicateDeep(d, 'a'));
    const next = apply(d, ops);
    const kids = next.nodes[newId]!.children;
    expect(new Set(kids).size).toBe(kids.length);
  });

  it('đánh dấu bản sao trong tên để phân biệt được', () => {
    const d = doc();
    const { ops, newId } = ok(duplicateDeep(d, 'a'));
    expect(apply(d, ops).nodes[newId]!.name).toBe('Khối A (bản sao)');
  });

  it('không nhân bản được node gốc', () => {
    expect(duplicateDeep(doc(), 'root')).toHaveProperty('error');
  });

  it('cây quá lớn thì báo rõ, không để validator từ chối bằng lỗi lạ', () => {
    const d = doc();
    for (let i = 0; i < 90; i++) {
      d.nodes[`k${i}`] = {
        id: `k${i}`, type: 'Text', tag: 'p', parentId: 'b',
        children: [], effects: [], style: { base: {} },
        content: [{ t: 'text', v: 'x' }],
      } as TextNode;
      (d.nodes.b!.children as string[]).push(`k${i}`);
    }
    const result = duplicateDeep(d, 'b');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/80/);
  });
});

describe('afterRemove', () => {
  it('chọn anh em trước, nếu không thì anh em sau, nếu không thì cha', () => {
    const d = doc();
    expect(afterRemove(d, 'b')).toBe('a');
    expect(afterRemove(d, 'a')).toBe('b');
    expect(afterRemove(d, 'a1')).toBe('a');
  });

  it('node gốc trả null', () => {
    expect(afterRemove(doc(), 'root')).toBeNull();
  });
});
