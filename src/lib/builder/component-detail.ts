import 'server-only';

/**
 * Hai câu hỏi mà trang chi tiết component chưa trả lời được.
 *
 * 1. *Trang cha truyền được gì vào đây?* — mô hình instance chỉ cho ghi đè NỘI
 *    DUNG, và danh sách chính xác những chỗ ghi đè được chưa hiện ở đâu cả.
 *    Không thấy nó thì người dùng hoặc tưởng sửa gì cũng được (rồi ngạc nhiên
 *    khi cỡ chữ không đổi theo trang), hoặc tưởng không sửa được gì (rồi nhân
 *    bản component ra năm bản chỉ vì khác một dòng chữ).
 *
 * 2. *Đang dùng ở đâu?* — sửa một component là sửa mọi trang đang nhúng nó.
 *    Không biết "mọi trang" gồm những trang nào thì mỗi lần sửa là một lần đoán.
 */

import { prisma } from '@/lib/db';
import { treeToDoc } from '@/lib/doc/apply-to-preset';
import { extractUnits, type TextUnit } from '@/lib/builder/text-units';
import { findOrphanOverrides, type OrphanOverride } from '@/lib/builder/orphan-overrides';
import type { PresetTree } from '@/lib/doc/preset';
import type { Doc } from '@/lib/doc/types';

export interface OverrideSlot {
  nodeId: string;
  /** `h1`, `p`, `nút`, `alt`… — nhãn loại, cùng bộ với bảng Văn bản. */
  kind: string;
  /** Trường trong `ContentOverride` mà trang cha ghi vào. */
  field: TextUnit['field'];
  path: string;
  /** Giá trị của component — thứ hiện ra khi trang cha KHÔNG ghi đè. */
  fallback: string;
  locked: boolean;
}

/**
 * Những chỗ trang cha ghi đè được.
 *
 * Dùng lại `extractUnits` chứ không tự duyệt cây: đây phải là **cùng một danh
 * sách** mà `InstancePanel` bày ra khi chọn instance trong trang. Hai bản của
 * cùng một quy tắc sẽ trôi khỏi nhau, và thứ trôi mất sẽ là một loại node mà
 * trang này hứa ghi đè được còn panel kia không cho.
 */
export function overrideSlots(tree: PresetTree): OverrideSlot[] {
  return extractUnits(treeToDoc(tree)).map((u) => ({
    nodeId: u.nodeId,
    kind: u.kind,
    field: u.field,
    path: u.path,
    fallback: u.text,
    locked: u.locked,
  }));
}

export interface ComponentUsage {
  pageId: string;
  slug: string;
  title: string;
  /** Số instance của component này trong trang — một trang nhúng được nhiều lần. */
  count: number;
  /** Đã ghi đè nội dung ở bao nhiêu chỗ. 0 nghĩa là đang dùng nguyên bản. */
  overridden: number;
  /**
   * Override trỏ tới node KHÔNG còn trong cây component.
   *
   * Renderer bỏ qua chúng khi vẽ, nên chúng vô hình — và tích lại theo từng lần
   * ai đó dọn cây. Đây là chỗ duy nhất chúng hiện ra. Xem orphan-overrides.ts.
   */
  orphaned: OrphanOverride[];
}

/**
 * Trang nào đang nhúng component này (bản NHÁP).
 *
 * Nháp chứ không phải release đang chạy: người dùng hỏi câu này ngay trước khi
 * sửa, và thứ sắp bị ảnh hưởng là cái họ sẽ publish, không phải cái đang chạy.
 *
 * Quét trong bộ nhớ thay vì truy vấn JSON trong Postgres: site có 2 trang và
 * trần thực tế là vài chục. Một chỉ mục JSONB ở quy mô đó là chi phí bảo trì
 * không đổi lấy gì.
 */
export async function componentUsage(componentId: string): Promise<ComponentUsage[]> {
  const site = await prisma.site.findFirst({ select: { id: true } });
  if (!site) return [];

  // Tập id node của CHÍNH component này, để biết override nào còn đích.
  //
  // Chỉ nạp một component thay vì cả thư viện: câu hỏi ở đây là về một component,
  // và `findOrphanOverrides` bỏ qua instance của component vắng mặt — nên map một
  // phần tử vừa đủ, và nó không thể báo sai cho component khác.
  const preset = await prisma.preset.findUnique({
    where: { id: componentId },
    select: { tree: true },
  });
  const knownIds: Map<string, Set<string>> = preset
    ? new Map([
        [componentId, new Set(Object.keys((preset.tree as unknown as PresetTree).nodes ?? {}))],
      ])
    : new Map();

  const pages = await prisma.page.findMany({
    where: { siteId: site.id, archivedAt: null },
    orderBy: { slug: 'asc' },
    select: {
      id: true, slug: true, title: true,
      draftVersion: { select: { doc: true } },
    },
  });

  const out: ComponentUsage[] = [];
  for (const p of pages) {
    if (!p.draftVersion) continue;
    const doc = p.draftVersion.doc as unknown as Doc;
    if (!doc?.nodes) continue;

    let count = 0;
    let overridden = 0;
    for (const node of Object.values(doc.nodes)) {
      if (node.type !== 'Instance' || node.componentId !== componentId) continue;
      count += 1;
      overridden += Object.keys(node.overrides ?? {}).length;
    }
    if (count) {
      const orphaned = findOrphanOverrides(doc, knownIds);
      out.push({ pageId: p.id, slug: p.slug, title: p.title, count, overridden, orphaned });
    }
  }
  return out;
}
