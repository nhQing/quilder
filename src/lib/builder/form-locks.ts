import 'server-only';

/**
 * Form nằm trong một COMPONENT: có trang nào đang giữ chữ theo chỉ số ô của nó không?
 *
 * ## Vì sao cần
 *
 * Bản dịch (`Translation.field = param:fields.2.label`) và ghi đè nội dung của Instance
 * (`overrides[localId].params['fields.2.label']`) đánh địa chỉ ô theo CHỈ SỐ. Kéo hay bỏ
 * một ô trong component thì chỉ số đổi trên MỌI trang dùng nó, và chữ tiếng Anh / chữ
 * riêng của trang nằm lên ô khác.
 *
 * Với form trên trang, sidebar dời bản dịch theo ô sau khi lưu (xem `translationRemapPlan`).
 * Với form trong component thì phải dời trên mọi trang, cả bản dịch lẫn ghi đè trong doc
 * của từng trang — một thay đổi xuyên nhiều đối tượng mà sidebar không có đường ghi nào
 * làm nguyên tử được. Nên sidebar CHẶN kéo/bỏ ô khi có thứ phụ thuộc chỉ số, và hàm này
 * là chỗ đếm thứ đó.
 *
 * Quét doc trong bộ nhớ, cùng lý lẽ với `componentUsage`: vài chục trang, không đáng một
 * chỉ mục JSONB.
 */

import { prisma } from '@/lib/db';
import { instanceAddress } from '@/lib/builder/text-units';
import type { Doc } from '@/lib/doc/types';

export interface FormFieldLocks {
  /** Hàng bản dịch `param:fields.*` của form này, trên mọi trang. */
  translations: number;
  /** Ghi đè `params.fields.*` của form này trong các Instance. */
  overrides: number;
  /** Đường dẫn trang có ít nhất một trong hai thứ trên. */
  pages: string[];
}

const FIELD_PATH = 'fields.';

export async function formFieldLocks(componentId: string, localId: string): Promise<FormFieldLocks> {
  const pages = await prisma.page.findMany({
    // Kể cả trang đã lưu trữ: khôi phục nó thì bản dịch lệch ô vẫn hiện ra.
    select: { id: true, slug: true, draftVersion: { select: { doc: true } } },
  });

  let overrides = 0;
  const addresses: { pageId: string; nodeId: string }[] = [];
  const touched = new Map<string, string>();

  for (const p of pages) {
    const doc = p.draftVersion?.doc as unknown as Doc | undefined;
    if (!doc?.nodes) continue;
    for (const node of Object.values(doc.nodes)) {
      if (node.type !== 'Instance' || node.componentId !== componentId) continue;
      addresses.push({ pageId: p.id, nodeId: instanceAddress(node.id, localId) });
      const params = node.overrides?.[localId]?.params ?? {};
      const n = Object.keys(params).filter((k) => k.startsWith(FIELD_PATH)).length;
      if (n) {
        overrides += n;
        touched.set(p.id, `/${p.slug}`);
      }
    }
  }

  let translations = 0;
  if (addresses.length) {
    const rows = await prisma.translation.findMany({
      where: { OR: addresses, field: { startsWith: `param:${FIELD_PATH}` } },
      select: { pageId: true },
    });
    translations = rows.length;
    const slugOf = new Map(pages.map((p) => [p.id, `/${p.slug}`]));
    for (const r of rows) touched.set(r.pageId, slugOf.get(r.pageId) ?? r.pageId);
  }

  return { translations, overrides, pages: [...touched.values()].sort() };
}
