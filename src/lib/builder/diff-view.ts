/**
 * Biến `DocDiff` (danh sách id) thành thứ NGƯỜI đọc được: tên node, loại node, nó
 * nằm ở section nào, và chữ trước → sau. Hàm thuần, không chạm database.
 *
 * ## Vì sao cần lớp này
 *
 * Hộp "Xem diff" bản đầu in thẳng `diff.added.join(' · ')`. Với một trang clone (chưa
 * publish lần nào) đó là "Thêm 231 node" rồi một bức tường `blog-cards · blog-track ·
 * n0000001 · n0000002 …`. Chủ dự án nói đúng câu cần nói: *"không hiểu khác ở đâu,
 * khác thế nào"*. Id là khoá cho máy; người soát cần biết **chỗ nào trên trang**.
 *
 * Ba quyết định, cả ba để danh sách ngắn lại mà không nói dối:
 *
 *  1. **Gom theo section** (tổ tiên gần nhất có `type: 'Section'`, kể cả chính nó).
 *     Người ta nhìn trang theo khối — hero, lợi ích, FAQ — không theo cây node.
 *  2. **Node con của một node cũng-mới-thêm thì không liệt kê riêng**, chỉ đếm vào
 *     `descendants` của cha. Thêm một section 23 node là MỘT thay đổi với người
 *     soát, không phải 23. Tổng số vẫn giữ nguyên ở `counts` — không giấu con số.
 *  3. **Trang chưa publish bao giờ** (`live === null`) không có gì để so: mọi node
 *     đều "thêm". `isNew` để UI thay danh sách bằng một câu tóm tắt.
 *
 * Thứ tự là thứ tự TRÊN TRANG (duyệt cây từ gốc), không phải thứ tự chữ cái của id
 * như `diffDocs` trả — "section thứ 3 từ trên xuống" mới là thứ người ta tìm được.
 */

import type { DocDiff } from './doc-diff';
import { isTemplateSlug } from './slug';
import { plainText } from '@/lib/doc/plain-text';
import type { Doc, Node } from '@/lib/doc/types';

export type ChangeKind = 'added' | 'removed' | 'text';

export interface ChangeItem {
  nodeId: string;
  kind: ChangeKind;
  /** Tên cho người đọc: `name` của node, không có thì loại + một mẩu chữ. */
  label: string;
  type: string;
  /**
   * Mẩu chữ đầu tiên TRONG node (tính cả con cháu), khi nhãn chưa nói nó. Năm dòng
   * cùng tên `mc-faq__item` là năm dòng không phân biệt được; kèm câu hỏi đầu tiên
   * của từng cái thì người soát biết ngay là câu nào.
   */
  hint?: string;
  /** Số node con cháu cũng mới thêm / cũng bị xoá, đã gộp vào dòng này. */
  descendants: number;
  /** Chỉ có ở `kind: 'text'`. */
  before?: string;
  after?: string;
}

export interface ChangeGroup {
  /** `null` = node không nằm trong section nào (con trực tiếp của gốc không phải Section). */
  sectionId: string | null;
  sectionLabel: string;
  items: ChangeItem[];
}

export interface DiffView {
  isNew: boolean;
  counts: { added: number; removed: number; textChanged: number };
  /** Một câu, cho dòng đầu hộp diff. */
  summary: string;
  groups: ChangeGroup[];
}

/** Độ dài tối đa của mẩu chữ trong nhãn. */
const SNIPPET = 48;

export function clip(s: string, max = SNIPPET): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Chữ đại diện của một node — thứ người ta NHÌN THẤY trên trang. */
function snippetOf(n: Node): string {
  switch (n.type) {
    case 'Text':
      return plainText(n.content);
    case 'Button':
      return plainText(n.label);
    case 'Image':
      return n.alt ?? '';
    default:
      return '';
  }
}

/**
 * Nhãn của một node. `name` thắng vì đó là tên người dựng tự đặt, và cũng là tên
 * hiện trong cây lớp — cùng một tên ở hai chỗ thì người soát tìm được nó trong editor.
 */
export function nodeLabel(n: Node | undefined, id: string): string {
  if (!n) return id;
  const name = n.name?.trim();
  if (name) return name;
  const text = clip(snippetOf(n));
  return text ? `${n.type} “${text}”` : n.type;
}

/** Chữ đầu tiên nhìn thấy trong cây con của node — duyệt sâu, dừng ở chữ đầu tiên. */
function firstText(doc: Doc, id: string): string {
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const n = doc.nodes[cur];
    if (!n) continue;
    const t = snippetOf(n);
    if (t) return t;
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
  }
  return '';
}

/** Gợi ý kèm nhãn — chỉ khi nó nói thêm được điều nhãn chưa nói. */
function hintOf(doc: Doc, id: string, label: string): string | undefined {
  const t = clip(firstText(doc, id));
  return t && !label.includes(t) ? t : undefined;
}

/** Section gần nhất, tính cả chính nó. */
function sectionOf(doc: Doc, id: string): string | null {
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n: Node | undefined = doc.nodes[cur];
    if (!n) return null;
    if (n.type === 'Section') return cur;
    cur = n.parentId;
  }
  return null;
}

/** Id theo thứ tự trên trang: duyệt sâu từ gốc, con theo `children`. */
function pageOrder(doc: Doc): Map<string, number> {
  const order = new Map<string, number>();
  const stack = [doc.rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (order.has(id)) continue;
    const n = doc.nodes[id];
    if (!n) continue;
    order.set(id, order.size);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
  }
  // Node mồ côi (không với tới từ gốc) vẫn phải có chỗ — xếp cuối, không vứt đi.
  for (const id of Object.keys(doc.nodes).sort()) if (!order.has(id)) order.set(id, order.size);
  return order;
}

/**
 * Bỏ node có cha cũng nằm trong tập, và đếm chúng vào tổ tiên cao nhất còn lại.
 * Trả về `Map<id giữ lại, số con cháu đã gộp>`.
 *
 * Gộp DỪNG ở biên section: một section mới nằm trong một khung bọc cũng mới vẫn là
 * một dòng riêng dưới tên của nó. Không dừng thì trang chưa publish gộp cả về node
 * gốc — một dòng "Stack" không nói được trang có những khối nào.
 *
 * Khung bọc mà MỌI con đều đã thành dòng riêng ở section khác thì bị bỏ hẳn: nó
 * không tự mang gì lên trang, và "Stack (0 node con)" chỉ là nhiễu.
 */
function collapse(doc: Doc, ids: string[]): Map<string, number> {
  const set = new Set(ids);
  const top = new Map<string, number>();
  const topOf = (id: string): string => {
    let cur = id;
    const sec = sectionOf(doc, id);
    const seen = new Set<string>();
    for (;;) {
      seen.add(cur);
      if (doc.nodes[cur]?.type === 'Section') return cur;
      const p = doc.nodes[cur]?.parentId;
      if (!p || !set.has(p) || seen.has(p) || sectionOf(doc, p) !== sec) return cur;
      cur = p;
    }
  };
  for (const id of ids) {
    const t = topOf(id);
    top.set(t, (top.get(t) ?? 0) + (t === id ? 0 : 1));
  }
  for (const [id, n] of top) {
    const kids = doc.nodes[id]?.children ?? [];
    if (n === 0 && kids.length > 0 && kids.every((k) => set.has(k))) top.delete(id);
  }
  return top;
}

export function summarizeView(isNew: boolean, c: DiffView['counts']): string {
  if (isNew) return `Trang mới, chưa publish — ${c.added} node`;
  const bits: string[] = [];
  if (c.added) bits.push(`thêm ${c.added} node`);
  if (c.removed) bits.push(`xoá ${c.removed} node`);
  if (c.textChanged) bits.push(`đổi chữ ở ${c.textChanged} chỗ`);
  if (!bits.length) return 'Không thấy node hay chữ nào đổi';
  const s = bits.join(' · ');
  return s[0]!.toUpperCase() + s.slice(1);
}

function withHint(doc: Doc, item: ChangeItem): ChangeItem {
  const hint = hintOf(doc, item.nodeId, item.label);
  return hint ? { ...item, hint } : item;
}

export function describeDiff(live: Doc | null, draft: Doc, diff: DocDiff): DiffView {
  const counts = {
    added: diff.added.length,
    removed: diff.removed.length,
    textChanged: diff.textChanged.length,
  };
  const isNew = live === null;

  const draftOrder = pageOrder(draft);
  const liveOrder = live ? pageOrder(live) : new Map<string, number>();

  interface Placed { item: ChangeItem; section: string | null; secDoc: Doc; rank: number }
  const placed: Placed[] = [];

  for (const [id, descendants] of collapse(draft, diff.added)) {
    const n = draft.nodes[id];
    placed.push({
      item: withHint(draft, { nodeId: id, kind: 'added', label: nodeLabel(n, id), type: n?.type ?? '?', descendants }),
      section: sectionOf(draft, id),
      secDoc: draft,
      rank: draftOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
    });
  }
  for (const t of diff.textChanged) {
    const n = draft.nodes[t.nodeId];
    placed.push({
      item: {
        nodeId: t.nodeId, kind: 'text', label: nodeLabel(n, t.nodeId), type: n?.type ?? '?',
        descendants: 0, before: t.before, after: t.after,
      },
      section: sectionOf(draft, t.nodeId),
      secDoc: draft,
      rank: draftOrder.get(t.nodeId) ?? Number.MAX_SAFE_INTEGER,
    });
  }
  if (live) {
    for (const [id, descendants] of collapse(live, diff.removed)) {
      const n = live.nodes[id];
      // Node bị xoá không có vị trí trong bản nháp. Mượn vị trí của section chứa nó
      // nếu section đó còn sống, để nó đứng cạnh các thay đổi khác cùng khối.
      const sec = sectionOf(live, id);
      const anchor = sec && draftOrder.has(sec) ? draftOrder.get(sec)! + 0.5 : undefined;
      placed.push({
        item: withHint(live, { nodeId: id, kind: 'removed', label: nodeLabel(n, id), type: n?.type ?? '?', descendants }),
        section: sec,
        secDoc: live,
        rank: anchor ?? draftOrder.size + (liveOrder.get(id) ?? 0),
      });
    }
  }

  placed.sort((a, b) => a.rank - b.rank);

  const groups: ChangeGroup[] = [];
  const byKey = new Map<string, ChangeGroup>();
  for (const p of placed) {
    const key = p.section ?? '∅';
    let g = byKey.get(key);
    if (!g) {
      // Section còn trong bản nháp thì lấy tên ở bản nháp (tên mới nhất).
      const secNode = p.section ? (draft.nodes[p.section] ?? p.secDoc.nodes[p.section]) : undefined;
      g = {
        sectionId: p.section,
        sectionLabel: p.section ? nodeLabel(secNode, p.section) : 'Ngoài section',
        items: [],
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(p.item);
  }

  return { isNew, counts, summary: summarizeView(isNew, counts), groups };
}

/** Cắt danh sách dài: `shown` để hiện, `more` để in "và N node khác". */
export function capList<T>(items: T[], max: number): { shown: T[]; more: number } {
  if (items.length <= max) return { shown: items, more: 0 };
  return { shown: items.slice(0, max), more: items.length - max };
}

/**
 * Địa chỉ site thật của trang, hoặc `null` khi không có gì để xem ở đó.
 *
 * `null` ở hai ca: trang chưa lên site (`moi`), và trang MẪU (`blogs/[category]`) —
 * mẫu không tự phục vụ như một URL (xem `resolveTarget` của route site), nên mở
 * `/blogs/[category]` là 404 chứ không phải bản đang chạy.
 */
export function liveHref(slug: string, status: string): string | null {
  if (status === 'moi') return null;
  if (isTemplateSlug(slug)) return null;
  return `/${slug}`;
}
