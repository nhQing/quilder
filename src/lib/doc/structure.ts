/**
 * Bất biến cấu trúc của một cây node (tầng 4 của `validate.ts`) — THUẦN.
 *
 * Tách khỏi `validate.ts` (file đó `server-only` và kéo prisma) để nhập trang dùng được
 * đúng bộ luật mà đường ghi op dùng: một gói .zip sửa tay có thể qua zod mà vẫn hỏng cây
 * (node mồ côi, con trùng, vòng lặp) — renderer sẽ vẽ sai hoặc treo, không báo lỗi.
 */

export interface StructuralIssue {
  code: 'no-root' | 'orphan' | 'bad-parent' | 'not-in-parent' | 'bad-child' | 'duplicate-child' | 'cycle';
  message: string;
}

type TreeLike = {
  rootId: string;
  nodes: Record<string, { parentId?: string | null; children: readonly string[] }>;
};

export function structuralIssues(tree: TreeLike): StructuralIssue[] {
  const out: StructuralIssue[] = [];
  const { nodes, rootId } = tree;
  if (!nodes[rootId]) {
    out.push({ code: 'no-root', message: 'rootId không trỏ tới node nào.' });
  }

  for (const [id, n] of Object.entries(nodes)) {
    if (id !== rootId) {
      if (!n.parentId) {
        out.push({ code: 'orphan', message: `Node mồ côi: ${id}` });
      } else if (!nodes[n.parentId]) {
        out.push({ code: 'bad-parent', message: `${id} trỏ tới cha không tồn tại` });
      } else if (!nodes[n.parentId]!.children.includes(id)) {
        out.push({ code: 'not-in-parent', message: `${id} không nằm trong children của cha` });
      }
    }
    // Trùng id trong children: một node xuất hiện nhiều lần dưới cùng một cha.
    // Renderer sẽ render nó nhiều lần với CÙNG data-n, nên click-to-select và
    // mọi phép đo đều nhắm nhầm. Bug này lộ ra khi một script seed chạy hai lần
    // và append cùng một id — không tầng nào khác bắt được.
    const seenChildren = new Set<string>();
    for (const child of n.children) {
      if (!nodes[child]) {
        out.push({ code: 'bad-child', message: `${id} trỏ tới con không tồn tại: ${child}` });
      }
      if (seenChildren.has(child)) {
        out.push({ code: 'duplicate-child', message: `${id} chứa ${child} nhiều lần trong children` });
      }
      seenChildren.add(child);
    }
  }

  // Cycle: đi ngược lên gốc từ mọi node.
  for (const id of Object.keys(nodes)) {
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur) {
      if (seen.has(cur)) {
        out.push({ code: 'cycle', message: `Cycle chứa node ${id}` });
        break;
      }
      seen.add(cur);
      cur = nodes[cur]?.parentId ?? null;
    }
  }
  return out;
}
