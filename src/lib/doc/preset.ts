/**
 * Biến một preset thành chuỗi op chèn.
 *
 * Preset không phải hộp đen: nó là một cây node dựng sẵn, và sau khi chèn thì
 * mọi node bên trong sửa được tự do như node tự tạo. Đây là khác biệt then chốt
 * với mô hình section-template, nơi bạn chỉ đổi được text và ảnh.
 *
 * Vì vậy "chèn preset" không phải một op riêng — nó là N op `insertNode` bình
 * thường, đi qua đúng validator và undo được bằng đúng cơ chế như mọi thao tác
 * khác. Không có đường tắt nào cho preset.
 */

import type { Op } from './ops';
import type { Node, NodeId } from './types';

export interface PresetTree {
  /**
   * Schema mà cây này thuộc về.
   *
   * Tuỳ chọn vì dữ liệu cũ không có nó: 5 preset và 56 `Release.components` được
   * ghi trước khi trường này tồn tại. `migratePresetTree` coi thiếu là v1.
   *
   * Nằm TRONG cây chứ không phải một cột riêng, và đó là điểm chính:
   * `Release.components` chụp lại đúng JSON này, nên ở đó không có cột nào để tra.
   * Cây phải tự mô tả — không thì ảnh chụp là một đống node mà không ai biết nó
   * thuộc schema nào, và ngày `Doc` lên 2 thì không có cách nào biết phải migrate
   * hay không.
   */
  schemaVersion?: number;
  rootId: NodeId;
  nodes: Record<string, Node>;
}

/**
 * Id ngắn, đủ ngẫu nhiên để không đụng trong một doc.
 *
 * Không dùng crypto.randomUUID(): id đi vào selector CSS (`[data-n="..."]`) và
 * xuất hiện trong mọi op, nên ngắn gọn có giá trị thực tế khi đọc diff.
 */
function newId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'n';
  for (let i = 0; i < 9; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Sinh op chèn preset vào `parentId` ở vị trí `index`.
 *
 * Mọi id trong preset được thay bằng id mới, kể cả các tham chiếu chéo
 * (`fallbackChildId` của Canvas, `toNodeId` của Button dạng anchor, `slots` của
 * Composite). Bỏ sót một tham chiếu là tạo ra node trỏ vào hư không, và lỗi đó
 * chỉ lộ ra lúc render.
 */
export function presetToOps(
  tree: PresetTree,
  parentId: NodeId,
  index: number,
  existingIds: Set<string> = new Set(),
): Op[] {
  const idMap = new Map<string, string>();
  for (const oldId of Object.keys(tree.nodes)) {
    let candidate = newId();
    while (existingIds.has(candidate) || idMap.has(candidate)) candidate = newId();
    idMap.set(oldId, candidate);
  }

  const remap = (id: string | null | undefined): string | null =>
    id == null ? null : (idMap.get(id) ?? id);

  /** Duyệt cha trước con, để insertNode luôn tìm thấy cha. */
  const order: string[] = [];
  const walk = (id: string) => {
    const n = tree.nodes[id];
    if (!n) return;
    order.push(id);
    for (const child of n.children) walk(child);
  };
  walk(tree.rootId);

  return order.map((oldId) => {
    const source = tree.nodes[oldId]!;
    const node = structuredClone(source) as Node;

    node.id = idMap.get(oldId)!;
    node.parentId = oldId === tree.rootId ? parentId : remap(source.parentId);
    // children để rỗng: từng op con tự chèn mình vào đúng vị trí, giống cơ chế
    // khôi phục cây con trong `invert`. Để nguyên mảng sẽ làm id con bị lặp.
    (node as { children: string[] }).children = [];

    // Tham chiếu chéo giữa các node trong preset.
    if (node.type === 'Canvas' && node.fallbackChildId) {
      node.fallbackChildId = remap(node.fallbackChildId);
    }
    if (node.type === 'Button' && node.action.kind === 'anchor') {
      node.action = { ...node.action, toNodeId: remap(node.action.toNodeId)! };
    }
    if (node.type === 'Composite') {
      node.slots = Object.fromEntries(
        Object.entries(node.slots).map(([slot, ids]) => [slot, ids.map((i) => remap(i)!)]),
      );
    }
    if (node.a11y?.labelledBy) {
      node.a11y = { ...node.a11y, labelledBy: remap(node.a11y.labelledBy)! };
    }
    // htmlId phải là duy nhất trong trang; chèn preset lần thứ hai sẽ tạo hai
    // element cùng id. Bỏ đi và để tác giả đặt lại nếu cần neo.
    delete node.htmlId;

    const parent = oldId === tree.rootId ? parentId : remap(source.parentId)!;
    const at =
      oldId === tree.rootId
        ? index
        : (tree.nodes[source.parentId!]!.children as string[]).indexOf(oldId);

    const op: Op = { op: 'insertNode', parentId: parent, index: oldId === tree.rootId ? index : at, node };
    return op;
  });
}

/**
 * Op chèn một INSTANCE — còn liên kết với component.
 *
 * Khác `presetToOps` ở điểm bản chất, và đó là cả lựa chọn người dùng phải hiểu:
 *
 *   `presetToOps`       đóng dấu một BẢN SAO. Sửa tự do, nhưng component đổi thì
 *                       trang không đổi theo.
 *   `presetToInstance`  giữ LIÊN KẾT. Component đổi thì mọi trang đổi theo; phần
 *                       riêng của trang là override nội dung.
 *
 * Một op duy nhất, vì con của instance đến từ cây component chứ không nằm trong
 * doc — xem `InstanceNode` trong types.ts.
 */
export function instanceToOps(
  componentId: string,
  parentId: NodeId,
  index: number,
  existingIds: Set<string> = new Set(),
  name?: string,
): Op[] {
  let id = newId();
  while (existingIds.has(id)) id = newId();

  return [
    {
      op: 'insertNode',
      parentId,
      index,
      node: {
        id,
        parentId,
        type: 'Instance',
        componentId,
        overrides: {},
        children: [],
        effects: [],
        // Lớp base rỗng nhưng PHẢI có: validator đòi nó, và style của instance
        // (vị trí, khoảng cách trong trang) vẫn thuộc về trang chứ không thuộc
        // component.
        style: { base: {} },
        ...(name ? { name } : {}),
      },
    },
  ];
}
