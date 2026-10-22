import { describe, expect, it } from 'vitest';

/**
 * Lọc cây node.
 *
 * Tính chất chịu lực: kết quả PHẢI giữ cả tổ tiên. Trang chủ có 149 node và 27
 * node không có tên nên hiện trùng nhau — một danh sách phẳng bốn dòng "Text"
 * không giúp gì, còn "hero → hero_inner → Text" thì có.
 */

import { filterTree, fold, indentFor } from './tree-filter';
import type { Doc, Node } from '@/lib/doc/types';

function doc(): Doc {
  const n = (id: string, parentId: string | null, children: string[], name?: string): Node =>
    ({
      id, parentId, children, name,
      type: 'Stack', direction: { base: 'column' },
      effects: [], style: { base: {} },
    }) as unknown as Node;

  return {
    schemaVersion: 1,
    rootId: 'root',
    nodes: {
      root: n('root', null, ['hero', 'footer'], 'Trang'),
      hero: n('hero', 'root', ['inner'], 'hero'),
      inner: n('inner', 'hero', ['title', 'lede'], 'hero_inner'),
      title: n('title', 'inner', [], 'Tiêu đề'),
      lede: n('lede', 'inner', [], 'Lede'),
      footer: n('footer', 'root', ['legal'], 'footer'),
      legal: n('legal', 'footer', [], 'Điều khoản'),
    },
  };
}

const label = (d: Doc) => (id: string) => d.nodes[id]?.name ?? '';

describe('fold', () => {
  it('bỏ dấu và thường hoá', () => {
    expect(fold('Tiêu đề')).toBe('tieu de');
    expect(fold('Điều khoản')).toBe('dieu khoan');
    expect(fold('ĐẦU TƯ')).toBe('dau tu');
  });
});

describe('filterTree', () => {
  it('query rỗng trả null — bên gọi đi đường render cũ', () => {
    // Quan trọng: không có ô tìm nào thì hành vi phải y hệt trước đây, nên e2e
    // bám vào cây đầy đủ không bị phá.
    const d = doc();
    expect(filterTree(d, '', label(d))).toBeNull();
    expect(filterTree(d, '   ', label(d))).toBeNull();
  });

  it('giữ cả tổ tiên của node khớp', () => {
    const d = doc();
    const r = filterTree(d, 'Tiêu đề', label(d))!;
    expect([...r.matched]).toEqual(['title']);
    // root → hero → inner → title
    expect([...r.visible].sort()).toEqual(['hero', 'inner', 'root', 'title']);
  });

  it('KHÔNG kéo theo con của node khớp', () => {
    // Khớp "hero" thì không đổ cả cây con ra — người dùng tìm một thứ, không
    // phải một nhánh.
    const d = doc();
    const r = filterTree(d, 'hero', label(d))!;
    expect(r.matched.has('hero')).toBe(true);
    expect(r.matched.has('inner')).toBe(true); // 'hero_inner' cũng chứa 'hero'
    expect(r.visible.has('title')).toBe(false);
  });

  it('tìm được khi gõ không dấu', () => {
    const d = doc();
    expect([...filterTree(d, 'tieu de', label(d))!.matched]).toEqual(['title']);
    expect([...filterTree(d, 'dieu khoan', label(d))!.matched]).toEqual(['legal']);
  });

  it('không phân biệt hoa thường', () => {
    const d = doc();
    expect(filterTree(d, 'FOOTER', label(d))!.matched.has('footer')).toBe(true);
  });

  it('không khớp gì thì matched rỗng', () => {
    const d = doc();
    const r = filterTree(d, 'khong-co-gi', label(d))!;
    expect(r.matched.size).toBe(0);
    expect(r.visible.size).toBe(0);
  });

  it('nhiều kết quả ở nhánh khác nhau đều giữ đường về gốc', () => {
    const d = doc();
    const r = filterTree(d, 'e', label(d))!;
    for (const id of r.matched) {
      let cursor: string | null = id;
      while (cursor) {
        expect(r.visible.has(cursor), `thiếu tổ tiên ${cursor} của ${id}`).toBe(true);
        cursor = d.nodes[cursor]?.parentId ?? null;
      }
    }
  });

  it('doc có cycle không làm treo', () => {
    // Validator cấm cycle, nhưng một hàm duyệt cây không nên treo cả builder khi
    // dữ liệu sai.
    const d = doc();
    d.nodes.root!.parentId = 'legal';
    expect(() => filterTree(d, 'Tiêu đề', label(d))).not.toThrow();
  });
});

describe('indentFor', () => {
  it('12px mỗi cấp tới cấp 6', () => {
    expect(indentFor(0)).toBe(8);
    expect(indentFor(3)).toBe(44);
    expect(indentFor(6)).toBe(80);
  });

  it('sau cấp 6 chỉ thêm 4px', () => {
    // Ở độ sâu 7, cách cũ (`depth × 12 + 8`) chiếm 92px trong pane 240px — gần
    // 40% bề rộng chỉ để thụt lề.
    expect(indentFor(7)).toBe(84);
    expect(indentFor(10)).toBe(96);
  });

  it('tăng đều trong khoảng độ sâu THẬT (cây sâu nhất 7 cấp)', () => {
    for (let d = 1; d <= 10; d++) {
      expect(indentFor(d)).toBeGreaterThan(indentFor(d - 1));
    }
  });

  it('có trần cứng, không bao giờ ăn quá 40% pane 240px', () => {
    // Quá trần thì thêm thụt lề không nói thêm gì — không ai đếm được bằng mắt
    // 'cấp 14 hay cấp 15' — mà vẫn ăn hết chỗ của tên node.
    expect(indentFor(20)).toBe(96);
    expect(indentFor(100)).toBe(96);
  });
});
