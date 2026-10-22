import { describe, expect, it } from 'vitest';

import { diffDocs } from './doc-diff';
import { capList, clip, describeDiff, liveHref, nodeLabel, summarizeView } from './diff-view';
import type { Doc, Node } from '@/lib/doc/types';

/**
 * Hộp "Xem diff" cho NGƯỜI đọc: tên, loại, section, chữ trước → sau.
 *
 * Bản trước in thẳng id node — một trang clone ra "Thêm 231 node" rồi một bức tường
 * `n0000001 · n0000002 …`. Các test dưới khoá lại ba điều làm danh sách đọc được:
 * gom theo section, gộp node con vào cha cũng-mới-thêm, và thứ tự trên trang.
 */

type Spec = { type?: string; name?: string; text?: string; parent?: string | null; children?: string[] };

function mk(specs: Record<string, Spec>, rootId = 'root'): Doc {
  const nodes: Record<string, unknown> = {};
  for (const [id, s] of Object.entries(specs)) {
    nodes[id] = {
      id,
      type: s.type ?? 'Text',
      parentId: s.parent ?? null,
      children: s.children ?? [],
      effects: [],
      style: { base: {} },
      ...(s.name ? { name: s.name } : {}),
      ...(s.text !== undefined ? { content: [{ t: 'text', v: s.text }] } : {}),
    };
  }
  return { schemaVersion: 1, rootId, nodes } as unknown as Doc;
}

const base = {
  root: { type: 'Stack', children: ['hero', 'faq'] },
  hero: { type: 'Section', name: 'Hero', parent: 'root', children: ['h1'] },
  h1: { text: 'Vay nhanh', parent: 'hero' },
  faq: { type: 'Section', name: 'FAQ', parent: 'root', children: ['q1'] },
  q1: { text: 'Hỏi 1', parent: 'faq' },
} satisfies Record<string, Spec>;

describe('nodeLabel', () => {
  it('ưu tiên name', () => {
    expect(nodeLabel({ type: 'Stack', name: 'Thẻ lợi ích' } as Node, 'x')).toBe('Thẻ lợi ích');
  });
  it('không có name: loại + mẩu chữ', () => {
    const d = mk({ a: { text: 'Xin chào' } }, 'a');
    expect(nodeLabel(d.nodes.a, 'a')).toBe('Text “Xin chào”');
  });
  it('không name, không chữ: chỉ loại', () => {
    expect(nodeLabel({ type: 'Stack' } as Node, 'x')).toBe('Stack');
  });
  it('node không tồn tại: rơi về id', () => {
    expect(nodeLabel(undefined, 'n42')).toBe('n42');
  });
});

describe('clip', () => {
  it('cắt chữ dài bằng một dấu …', () => {
    expect(clip('a'.repeat(100), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(clip('  ngắn  ')).toBe('ngắn');
  });
});

describe('describeDiff', () => {
  it('đổi chữ: gom vào section, có trước → sau', () => {
    const live = mk(base);
    const draft = mk({ ...base, h1: { text: 'Vay siêu nhanh', parent: 'hero' } });
    const v = describeDiff(live, draft, diffDocs(live, draft));
    expect(v.isNew).toBe(false);
    expect(v.groups).toHaveLength(1);
    expect(v.groups[0]!.sectionLabel).toBe('Hero');
    expect(v.groups[0]!.items[0]).toMatchObject({
      nodeId: 'h1', kind: 'text', before: 'Vay nhanh', after: 'Vay siêu nhanh',
    });
  });

  it('thêm cả một section: MỘT dòng, con cháu đếm vào descendants', () => {
    const live = mk(base);
    const draft = mk({
      ...base,
      root: { type: 'Stack', children: ['hero', 'new', 'faq'] },
      new: { type: 'Section', name: 'Lợi ích', parent: 'root', children: ['c1', 'c2'] },
      c1: { text: 'Một', parent: 'new' },
      c2: { type: 'Stack', parent: 'new', children: ['c3'] },
      c3: { text: 'Ba', parent: 'c2' },
    });
    const v = describeDiff(live, draft, diffDocs(live, draft));
    expect(v.counts.added).toBe(4); // tổng số KHÔNG bị giấu
    expect(v.groups).toHaveLength(1);
    expect(v.groups[0]!.sectionLabel).toBe('Lợi ích');
    expect(v.groups[0]!.items).toEqual([
      expect.objectContaining({ nodeId: 'new', kind: 'added', descendants: 3 }),
    ]);
  });

  it('xoá node: lấy tên và section từ bản đang chạy', () => {
    const live = mk({
      ...base,
      faq: { type: 'Section', name: 'FAQ', parent: 'root', children: ['q1', 'q2'] },
      q2: { text: 'Hỏi 2', parent: 'faq' },
    });
    const draft = mk(base);
    const v = describeDiff(live, draft, diffDocs(live, draft));
    expect(v.groups[0]!.sectionLabel).toBe('FAQ');
    expect(v.groups[0]!.items[0]).toMatchObject({ nodeId: 'q2', kind: 'removed', label: 'Text “Hỏi 2”' });
  });

  it('node trùng tên: kèm chữ đầu tiên bên trong để phân biệt', () => {
    const live = mk({
      ...base,
      faq: { type: 'Section', name: 'FAQ', parent: 'root', children: ['i1', 'i2'] },
      i1: { type: 'Stack', name: 'faq__item', parent: 'faq', children: ['t1'] },
      t1: { text: 'Vay bao lâu thì duyệt?', parent: 'i1' },
      i2: { type: 'Stack', name: 'faq__item', parent: 'faq', children: ['t2'] },
      t2: { text: 'Lãi suất bao nhiêu?', parent: 'i2' },
    });
    const draft = mk(base);
    const v = describeDiff(live, draft, diffDocs(live, draft));
    expect(v.groups[0]!.items.map((i) => i.hint)).toEqual(['Vay bao lâu thì duyệt?', 'Lãi suất bao nhiêu?']);
    // Node chữ con bị xoá cùng cha thì gộp vào dòng của cha.
    expect(v.groups[0]!.items.every((i) => i.descendants === 1)).toBe(true);
  });

  it('nhóm theo thứ tự TRÊN TRANG, không theo chữ cái của id', () => {
    const live = mk(base);
    const draft = mk({
      ...base,
      h1: { text: 'đổi', parent: 'hero' },
      q1: { text: 'đổi', parent: 'faq' },
    });
    const v = describeDiff(live, draft, diffDocs(live, draft));
    expect(v.groups.map((g) => g.sectionLabel)).toEqual(['Hero', 'FAQ']);
  });

  it('node ngoài mọi section vào nhóm "Ngoài section"', () => {
    const live = mk({ root: { type: 'Stack', children: [] } });
    const draft = mk({ root: { type: 'Stack', children: ['t'] }, t: { text: 'x', parent: 'root' } });
    const v = describeDiff(live, draft, diffDocs(live, draft));
    expect(v.groups[0]!.sectionId).toBeNull();
    expect(v.groups[0]!.sectionLabel).toBe('Ngoài section');
  });

  it('trang chưa publish: isNew + câu tóm tắt đếm node', () => {
    const draft = mk(base);
    const v = describeDiff(null, draft, diffDocs(null, draft));
    expect(v.isNew).toBe(true);
    expect(v.summary).toBe('Trang mới, chưa publish — 5 node');
    // Gộp dừng ở biên section: mỗi section một dòng, và khung bọc gốc (không tự
    // mang gì lên trang) không thành dòng "Stack" vô nghĩa.
    expect(v.groups.map((g) => g.sectionLabel)).toEqual(['Hero', 'FAQ']);
    expect(v.groups.flatMap((g) => g.items)).toEqual([
      expect.objectContaining({ nodeId: 'hero', descendants: 1 }),
      expect.objectContaining({ nodeId: 'faq', descendants: 1 }),
    ]);
  });
});

describe('summarizeView', () => {
  it('ghép các phần có mặt, viết hoa chữ đầu', () => {
    expect(summarizeView(false, { added: 2, removed: 0, textChanged: 1 })).toBe(
      'Thêm 2 node · đổi chữ ở 1 chỗ',
    );
  });
  it('không đổi gì', () => {
    expect(summarizeView(false, { added: 0, removed: 0, textChanged: 0 })).toBe(
      'Không thấy node hay chữ nào đổi',
    );
  });
});

describe('capList', () => {
  it('cắt và đếm phần còn lại', () => {
    expect(capList([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(capList([1, 2], 3)).toEqual({ shown: [1, 2], more: 0 });
  });
});

describe('liveHref', () => {
  it('trang đang chạy → đường dẫn site', () => {
    expect(liveHref('', 'da-sua')).toBe('/');
    expect(liveHref('tin-tuc', 'khong-doi')).toBe('/tin-tuc');
  });
  it('trang mới hoặc trang mẫu → không có gì để xem', () => {
    expect(liveHref('bang-gia', 'moi')).toBeNull();
    expect(liveHref('blogs/[category]', 'da-sua')).toBeNull();
  });
});
