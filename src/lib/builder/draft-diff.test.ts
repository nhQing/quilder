import { describe, expect, it } from 'vitest';

import { diffDocs } from './draft-diff';
import type { Doc } from '@/lib/doc/types';

/**
 * So bản nháp với bản đang chạy.
 *
 * Đây là mảnh làm cho "Agent dựng, người soát" chạy được: Agent gọi nó để TỰ KIỂM
 * trước khi báo xong, và người soát đọc cùng con số đó trước khi bấm Publish. Một
 * dữ liệu, hai người dùng.
 *
 * ## Vì sao chỉ so id node và chữ thuần
 *
 * Diff style ở mức thuộc tính là một dự án riêng, và với người soát nó là nhiễu:
 * "n42.style.md.spacing.pt đổi từ 24 sang 32" không trả lời được câu hỏi "trang có
 * gì khác". Thứ trả lời được là: thêm gì, mất gì, chữ nào đổi.
 */

const node = (id: string, text?: string) => ({
  id,
  type: 'Text' as const,
  tag: 'p' as const,
  parentId: null,
  children: [],
  effects: [],
  style: { base: {} },
  ...(text === undefined ? {} : { content: [{ t: 'text' as const, v: text }] }),
});

const doc = (ids: [string, string?][]): Doc =>
  ({
    schemaVersion: 1,
    rootId: ids[0]![0],
    nodes: Object.fromEntries(ids.map(([id, t]) => [id, node(id, t)])),
  }) as unknown as Doc;

describe('diffDocs', () => {
  it('không đổi thì mọi mảng đều rỗng', () => {
    const d = doc([['a', 'xin chao']]);
    expect(diffDocs(d, d)).toEqual({ added: [], removed: [], textChanged: [] });
  });

  it('thêm node', () => {
    const r = diffDocs(doc([['a', 'x']]), doc([['a', 'x'], ['b', 'y']]));
    expect(r.added).toEqual(['b']);
    expect(r.removed).toEqual([]);
  });

  it('xoá node', () => {
    const r = diffDocs(doc([['a', 'x'], ['b', 'y']]), doc([['a', 'x']]));
    expect(r.removed).toEqual(['b']);
    expect(r.added).toEqual([]);
  });

  it('đổi chữ — trả cả trước lẫn sau', () => {
    // Người soát cần thấy CẢ HAI. Chỉ đưa giá trị mới thì họ phải tự nhớ cái cũ,
    // và đó đúng là thứ họ mở công cụ này ra để khỏi phải làm.
    const r = diffDocs(doc([['a', 'cũ']]), doc([['a', 'mới']]));
    expect(r.textChanged).toEqual([{ nodeId: 'a', before: 'cũ', after: 'mới' }]);
  });

  it('node vừa thêm KHÔNG tính là đổi chữ', () => {
    // Không thì một node mới hiện hai lần trong báo cáo, và tổng số nghe to gấp
    // đôi thực tế.
    const r = diffDocs(doc([['a', 'x']]), doc([['a', 'x'], ['b', 'y']]));
    expect(r.textChanged).toEqual([]);
  });

  it('trang CHƯA publish bao giờ: mọi node là added', () => {
    // `live === null` khác hẳn "live rỗng". Trả mảng rỗng ở đây là nói dối rằng
    // không có gì đổi, trong khi cả trang là mới.
    const r = diffDocs(null, doc([['a', 'x'], ['b', 'y']]));
    expect(r.added.sort()).toEqual(['a', 'b']);
    expect(r.removed).toEqual([]);
    expect(r.textChanged).toEqual([]);
  });

  it('id trả về đã sắp xếp — báo cáo phải ổn định giữa hai lần gọi', () => {
    const r = diffDocs(doc([['a', 'x']]), doc([['a', 'x'], ['c', 'z'], ['b', 'y']]));
    expect(r.added).toEqual(['b', 'c']);
  });

  it('bỏ khoảng trắng thừa khi so chữ', () => {
    // Op sinh ra từ hai đường khác nhau có thể để lại khoảng trắng khác nhau quanh
    // cùng một câu. Báo "đã đổi" cho một thay đổi không ai nhìn thấy là làm người
    // soát mất niềm tin vào công cụ.
    const r = diffDocs(doc([['a', ' xin  chao ']]), doc([['a', 'xin chao']]));
    expect(r.textChanged).toEqual([]);
  });
});
