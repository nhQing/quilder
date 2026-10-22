import 'server-only';

/**
 * Nạp cây component mà một doc đang tham chiếu.
 *
 * ## Vì sao nạp theo doc chứ không nạp cả thư viện
 *
 * Thư viện có thể lớn hơn nhiều so với thứ một trang cần. Nạp hết nghĩa là mọi
 * lượt render trả tiền cho component không dùng tới, và `compileDoc` sẽ phải tự
 * lọc lại — hai chỗ cùng biết một luật.
 *
 * ## Vì sao MỘT map dùng chung cho cả trang
 *
 * Một trang có thể mang mười instance của cùng component. Đọc một lần rồi truyền
 * xuống là mười lần đọc thành một. Hệ quả bắt buộc: `applyOverride` tuyệt đối
 * không được sửa cây tại chỗ — xem ghi chú ở đó.
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/db';
import { migratePresetTree } from '@/lib/doc/migrate';
import type { Doc, Node } from '@/lib/doc/types';

export interface ComponentTree {
  rootId: string;
  nodes: Record<string, Node>;
}

export const COMPONENTS_TAG = 'components';

/** Id component mà doc tham chiếu, đã bỏ trùng. */
export function componentIdsIn(doc: Doc): string[] {
  const ids = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (node.type === 'Instance') ids.add(node.componentId);
  }
  return [...ids].sort();
}

const load = unstable_cache(
  async (ids: string[]): Promise<[string, ComponentTree][]> => {
    if (!ids.length) return [];
    const rows = await prisma.preset.findMany({
      where: { id: { in: ids } },
      select: { id: true, tree: true },
    });
    // Migrate cả ở đường BẢN NHÁP, không chỉ ở ảnh chụp: cây trong bảng `Preset`
    // cũng là dữ liệu sống lâu hơn code. Bỏ qua cây hỏng thay vì ném, cùng lý do
    // như `componentsFromSnapshot`.
    return rows.flatMap((r): [string, ComponentTree][] => {
      try {
        return [[r.id, migratePresetTree(r.tree)]];
      } catch {
        return [];
      }
    });
  },
  ['component-trees'],
  { tags: [COMPONENTS_TAG], revalidate: 3600 },
);

/**
 * Cây component cho một doc.
 *
 * Trả `Map` chứ không phải object: `compileDoc` và renderer đều tra theo id, và
 * `Map` nói rõ đây là bảng tra chứ không phải một bản ghi có hình dạng cố định.
 *
 * Component đã bị xoá khỏi thư viện thì đơn giản là vắng mặt — renderer xử lý
 * instance mồ côi bằng cách không vẽ gì, không ném.
 */
export async function loadComponents(doc: Doc): Promise<Map<string, ComponentTree>> {
  const ids = componentIdsIn(doc);
  if (!ids.length) return new Map();
  return new Map(await load(ids));
}

/**
 * Cây component từ ẢNH CHỤP của một release.
 *
 * Site thật dùng hàm này, KHÔNG dùng `loadComponents`. Khác biệt là cả hợp đồng
 * nháp/publish: `loadComponents` đọc bảng `Preset` hiện tại, nên sửa một
 * component sẽ đổi ngay trang đang chạy; ảnh chụp thì chỉ đổi khi có người bấm
 * Publish.
 *
 * Ảnh chụp thiếu (release cũ, publish trước khi có tính năng này) trả về map
 * rỗng — instance render ra khoảng trống, chứ KHÔNG rơi về bảng live. Rơi về
 * live là lặng lẽ lấy lại đúng hành vi mà ảnh chụp tồn tại để ngăn.
 */
export function componentsFromSnapshot(snapshot: unknown): Map<string, ComponentTree> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return new Map();

  const out = new Map<string, ComponentTree>();
  for (const [id, tree] of Object.entries(snapshot as Record<string, unknown>)) {
    if (tree && typeof tree === 'object' && 'nodes' in tree && 'rootId' in tree) {
      /*
       * Cây trong ảnh chụp là cây ĐÃ LƯU, nên nó có thể ở schema cũ hơn code đang
       * chạy — và dưới mô hình "mỗi domain một bản builder, nâng cấp được" thì đó
       * là trường hợp THƯỜNG, không phải ngoại lệ. Trước đây chỗ này ép kiểu và đi
       * tiếp, nên ngày `Doc` lên 2 thì trang migrate còn component thì không.
       *
       * Bỏ qua cây hỏng thay vì ném: một component sai schema không đáng làm trắng
       * cả trang. Instance của nó sẽ không render, và đó là thứ thấy được — khác
       * hẳn một trang trắng không rõ nguyên nhân.
       */
      try {
        out.set(id, migratePresetTree(tree));
      } catch {
        continue;
      }
    }
  }
  return out;
}
