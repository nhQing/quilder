/**
 * Tách một instance thành node thường.
 *
 * ## Vì sao KHÔNG có op `detachInstance`
 *
 * Detach là chèn cây component vào chỗ của instance rồi xoá instance — tức
 * `insertNode` × N cộng `removeNode`, đều là op đã có. Thêm một op mới nghĩa là
 * thêm một nhánh trong `apply`, một nhánh trong `invert`, và một hình dạng nữa mà
 * validator phải biết.
 *
 * Đổi lại, tổ hợp op có sẵn thì **undo hoạt động miễn phí**: `invert()` đã biết
 * nghịch đảo của `insertNode` là `removeNode` và ngược lại.
 *
 * Đó là chỗ ta hơn cả bốn công cụ có detach. Figma, Framer, Webflow và Wix đều
 * detach MỘT CHIỀU — Webflow nói thẳng mẹo chính thức là "nhân bản instance rồi
 * unlink bản nhân bản". Xem docs/BENCHMARK.md §1.1.
 *
 * ## Override được ÁP VÀO cây trước khi chèn
 *
 * Instance đang hiện chữ đã ghi đè, nên detach phải giữ đúng chữ đó. Không áp thì
 * detach âm thầm hoàn nguyên mọi ghi đè về nội dung component — một mất mát dữ
 * liệu trông như thành công.
 *
 * ## Ràng buộc từ Figma, và vì sao ta hẹp hơn
 *
 * Ở Figma, detach một instance LỒNG sẽ detach cả ancestor là instance, vì một
 * instance không thể chứa node đã rời khỏi cây component của nó.
 *
 * Ta không gặp: `apply-to-preset.ts` CHẶN instance lồng trong component ở đường
 * ghi. Nên detach ở đây luôn là detach một instance ở cấp trang, và không có
 * ancestor nào phải kéo theo. Ghi ra để ai mở nới ràng buộc kia thì biết chỗ này
 * phải sửa cùng.
 */

import { applyOverride } from '@/lib/render/instance';
import { presetToOps, type PresetTree } from '@/lib/doc/preset';
import type { Op } from '@/lib/doc/ops';
import type { ComponentTree } from '@/lib/render/components';
import type { Doc, Node } from '@/lib/doc/types';

export interface DetachPlan {
  ops: Op[];
  /** Số node sẽ được chèn — để nhãn version nói đúng chuyện gì xảy ra. */
  nodeCount: number;
  /** Số ghi đè được nướng vào cây tách ra. */
  appliedOverrides: number;
}

/**
 * Sinh op để tách một instance.
 *
 * Ném khi node không phải Instance hoặc khi cây component vắng mặt: cả hai đều là
 * lỗi của chỗ gọi, và tách một instance mồ côi sẽ chèn cây rỗng rồi xoá instance —
 * tức xoá nội dung mà trông như đã tách.
 */
export function detachOps(doc: Doc, instanceId: string, tree: ComponentTree): DetachPlan {
  const inst = doc.nodes[instanceId];
  if (!inst) throw new Error(`Không có node ${instanceId}`);
  if (inst.type !== 'Instance') {
    throw new Error(`Node ${instanceId} là ${inst.type}, không phải Instance`);
  }
  if (!tree.nodes[tree.rootId]) {
    throw new Error(`Cây component của ${instanceId} không có node gốc`);
  }

  const parentId = inst.parentId;
  if (!parentId) throw new Error('Không tách được instance ở gốc doc');

  const siblings = doc.nodes[parentId]?.children ?? [];
  const index = siblings.indexOf(instanceId);
  if (index < 0) throw new Error(`${instanceId} không nằm trong children của ${parentId}`);

  // Áp override vào từng node TRƯỚC khi sinh op chèn.
  let appliedOverrides = 0;
  const nodes: Record<string, Node> = {};
  for (const [localId, node] of Object.entries(tree.nodes)) {
    const override = inst.overrides?.[localId];
    if (override) appliedOverrides += 1;
    nodes[localId] = applyOverride(node, override);
  }

  const withOverrides: PresetTree = { rootId: tree.rootId, nodes };

  // `existingIds` là mọi id đang có trong doc: `presetToOps` sinh id mới và phải
  // tránh đụng. Bỏ tham số này là tạo ra id trùng, và validator sẽ từ chối cả batch
  // — hoặc tệ hơn, ghi đè một node khác nếu có ngày ai nới validator.
  const ops = presetToOps(withOverrides, parentId, index, new Set(Object.keys(doc.nodes)));

  // Xoá instance SAU khi chèn: xoá trước thì `index` không còn đúng, và cây trung
  // gian có một khoảng trống mà validator cấu trúc phải đi qua.
  ops.push({ op: 'removeNode', nodeId: instanceId });

  return { ops, nodeCount: Object.keys(tree.nodes).length, appliedOverrides };
}
