/**
 * Override MỒ CÔI: trỏ tới một `localId` không còn trong cây component.
 *
 * ## Vì sao chúng tồn tại được
 *
 * Override bind theo `localId` — id của node BÊN TRONG cây component. Xoá node đó
 * khỏi component thì override trên các trang vẫn còn, chỉ là không còn đích.
 *
 * Renderer bỏ qua chúng khi vẽ, và đó là quyết định đúng: ném ở đó sẽ làm trắng cả
 * trang vì một chuỗi không ai đọc tới. Nhưng hệ quả là **không ai biết chúng tồn
 * tại**. Chúng nằm trong doc, đi vào `Release.components`, và tích lại theo từng
 * lần ai đó dọn cây component.
 *
 * Figma ship hẳn một lệnh cho việc này (`Fix instance overrides`) — xem
 * docs/BENCHMARK.md §1.1.
 *
 * ## Vì sao ta hơn Figma ở chỗ này
 *
 * Override của Figma bind theo TÊN LAYER, nên đổi tên là sinh mồ côi. Của ta bind
 * theo `localId`, nên `setName` không thể phá — mồ côi chỉ sinh ra khi node bị XOÁ
 * thật. Đó là một lớp rủi ro ta không có.
 *
 * Hàm thuần: không `server-only`, không prisma. Cùng khuôn `asset-refs.ts`.
 */

import type { Doc, Node } from '@/lib/doc/types';

export interface OrphanOverride {
  /** Node `Instance` trong trang. */
  nodeId: string;
  /** Id bên trong cây component mà override trỏ tới — nay không còn. */
  localId: string;
  componentId: string;
}

/** Cây component tối thiểu mà hàm này cần: chỉ tập id node. */
export type ComponentNodeIds = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Mọi override trỏ vào hư không trong một doc.
 *
 * `components` thiếu một `componentId` thì instance đó bị BỎ QUA, không tính là mồ
 * côi: component vắng mặt là chuyện khác hẳn (nó có thể chỉ chưa được nạp), và gộp
 * hai chuyện đó lại sẽ báo cả một cây override lành mạnh là rác.
 */
export function findOrphanOverrides(doc: Doc, components: ComponentNodeIds): OrphanOverride[] {
  const out: OrphanOverride[] = [];

  for (const node of Object.values(doc.nodes) as Node[]) {
    if (node.type !== 'Instance') continue;

    const known = components.get(node.componentId);
    if (!known) continue;

    for (const localId of Object.keys(node.overrides ?? {})) {
      if (known.has(localId)) continue;
      out.push({ nodeId: node.id, localId, componentId: node.componentId });
    }
  }

  return out;
}

/**
 * Op gỡ một danh sách override.
 *
 * Dùng `setOverride` với `patch: null` — đúng op mà `InstancePanel` dùng để gỡ từng
 * field, và đúng op mà AI dùng. Không thêm op mới cho "gỡ hàng loạt": nó là N lần
 * của cùng một thao tác, nên nó phải undo được bằng đúng cơ chế đó.
 *
 * Trần 80 op là trần của validator (`validate.ts`). Chỗ gọi phải chia lô nếu vượt —
 * hàm này không tự chia, vì chia ở đây sẽ ẩn mất việc có nhiều batch, tức nhiều
 * version trong lịch sử.
 */
export function clearOverrideOps(
  targets: readonly { nodeId: string; localId: string }[],
): { op: 'setOverride'; nodeId: string; localId: string; patch: null }[] {
  return targets.map((t) => ({
    op: 'setOverride' as const,
    nodeId: t.nodeId,
    localId: t.localId,
    patch: null,
  }));
}
