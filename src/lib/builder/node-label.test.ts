import { describe, expect, it } from 'vitest';

import { ancestorPath, labelOf } from './node-label';
import { CURRENT_SCHEMA_VERSION, type Doc, type Node } from '@/lib/doc/types';

const base = { effects: [], style: { base: {} }, children: [] as string[] };

function doc(nodes: Record<string, unknown>): Doc {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root', nodes } as unknown as Doc;
}

describe('labelOf', () => {
  it('tên tác giả đặt thắng mọi thứ khác', () => {
    const n = { ...base, id: 'a', type: 'Text', parentId: null, name: 'Tiêu đề', content: [{ t: 'text', v: 'Xin chào' }] };
    expect(labelOf(n as unknown as Node)).toBe('Tiêu đề');
  });

  it('không có tên thì lấy đoạn text đầu, cắt ở 28 ký tự', () => {
    const long = 'a'.repeat(50);
    const n = { ...base, id: 'a', type: 'Text', parentId: null, content: [{ t: 'text', v: long }] };
    expect(labelOf(n as unknown as Node)).toBe('a'.repeat(28));
  });

  it('text rỗng hoặc chỉ khoảng trắng thì rơi về type', () => {
    const n = { ...base, id: 'a', type: 'Text', parentId: null, content: [{ t: 'text', v: '   ' }] };
    expect(labelOf(n as unknown as Node)).toBe('Text');
  });

  it('Composite lấy tên composite', () => {
    const n = { ...base, id: 'a', type: 'Composite', parentId: null, composite: 'Carousel' };
    expect(labelOf(n as unknown as Node)).toBe('Carousel');
  });

  it('node không có gì để gọi tên thì lấy type', () => {
    const n = { ...base, id: 'a', type: 'Image', parentId: null };
    expect(labelOf(n as unknown as Node)).toBe('Image');
  });
});

describe('ancestorPath', () => {
  const d = doc({
    root: { ...base, id: 'root', type: 'Section', parentId: null, children: ['sec'] },
    sec: { ...base, id: 'sec', type: 'Stack', parentId: 'root', children: ['txt'] },
    txt: { ...base, id: 'txt', type: 'Text', parentId: 'sec', content: [] },
  });

  it('trả từ GỐC xuống, gồm cả chính nó', () => {
    expect(ancestorPath(d, 'txt').map((n) => n.id)).toEqual(['root', 'sec', 'txt']);
  });

  it('node gốc thì đường dẫn chỉ có chính nó', () => {
    expect(ancestorPath(d, 'root').map((n) => n.id)).toEqual(['root']);
  });

  it('node không tồn tại thì rỗng, không ném', () => {
    expect(ancestorPath(d, 'khong-co')).toEqual([]);
  });

  it('doc có cycle thì DỪNG, không treo', () => {
    /*
     * Doc hợp lệ không có cycle. Nhưng hàm này chạy trên mỗi lần render của panel, và
     * một vòng lặp vô hạn ở đây làm treo cả tab — không phải ném một lỗi đọc được.
     */
    const bad = doc({
      a: { ...base, id: 'a', type: 'Stack', parentId: 'b' },
      b: { ...base, id: 'b', type: 'Stack', parentId: 'a' },
    });
    const path = ancestorPath(bad, 'a').map((n) => n.id);
    expect(path).toHaveLength(2);
    expect(path).toContain('a');
    expect(path).toContain('b');
  });
});
