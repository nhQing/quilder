import 'server-only';

/**
 * Ghi hoặc xoá một bản dịch — dùng chung cho route HTTP và tool MCP.
 *
 * Cùng lý do tách như `create-page.ts` và `create-component.ts`.
 *
 * ## Ba luật chịu lực, đừng nới cái nào
 *
 *  1. **Ngôn ngữ gốc không ghi được ở đây.** Chữ gốc sống trong doc; cho ghi vào
 *     bảng dịch là tạo hai nguồn sự thật cho cùng một chuỗi, và chúng sẽ lệch.
 *  2. **Đơn vị chữ phải TỒN TẠI trong doc.** Không kiểm thì một `nodeId` gõ sai
 *     tạo một hàng vĩnh viễn không ai đọc tới và không ai biết là rác. Với AI ghi
 *     thì rủi ro này lớn hơn hẳn so với người gõ tay.
 *  3. **Node bị khoá thì từ chối.** Khoá là ý định của người dùng, và nó phải có
 *     hiệu lực với mọi đường ghi, không riêng đường giao diện.
 */

import { prisma } from '@/lib/db';
import { getDraftPage } from '@/lib/builder/queries';
import { META_ADDRESS, PAGE_META_FIELDS, type PageMetaField } from '@/lib/builder/page-meta';
import { loadComponents } from '@/lib/render/components';
import {
  extractUnits, sourceHash, unitKey, type BaseTranslatableField, type TranslatableField,
} from '@/lib/builder/text-units';
import { isParamField, paramMaxLength, paramPathOf } from '@/lib/render/param-paths';

/**
 * Trường mà đường ghi này nhận.
 *
 * Chép ra một mảng chạy được chứ không suy từ kiểu: `TranslatableField` là kiểu
 * TypeScript và nó BIẾN MẤT lúc chạy, mà `field` ở đây đến từ thân request.
 * `Record<TranslatableField, …>` ở `text-write.ts` là chỗ bắt hai bên lệch nhau.
 */
export const TRANSLATION_FIELDS: BaseTranslatableField[] = [
  'content', 'label', 'alt', 'a11yLabel', 'assetId', 'posterAssetId', 'href',
];

export type SetTranslationResult =
  | { ok: true; deleted: true }
  | { ok: true; translation: { id: string; sourceHash: string; updatedAt: Date } }
  | { ok: false; status: number; error: string };

/**
 * Giá trị có đúng hình dạng cho trường đó không.
 *
 * Kiểm nông cho RichText: mỗi phần tử phải có `t` là chuỗi. Kiểm sâu là việc của
 * schema doc; ở đây chỉ cần chặn thứ chắc chắn làm renderer ném.
 */
export function shapeError(field: TranslatableField, value: unknown): string | null {
  if (isParamField(field)) {
    if (typeof value !== 'string') return `"${field}" cần một chuỗi`;
    if (!value.trim()) return 'Chuỗi rỗng — gửi null để xoá bản dịch';
    // Trần theo từng đường (khớp `.max()` của composite): vượt trần thì `.catch()` của
    // schema vứt CẢ params về mặc định, mất hết ô nhập — nên chặn từ lúc ghi.
    const max = paramMaxLength(paramPathOf(field));
    if (max === null) return `"${field}" không phải đường dẫn params dịch được`;
    if (value.length > max) return `Chuỗi quá dài (tối đa ${max} ký tự cho ${field}, đang ${value.length})`;
    return null;
  }
  if (field === 'assetId' || field === 'posterAssetId') {
    // `null` không tới được đây — chỗ gọi coi `null` là XOÁ bản dịch. Nên một bản
    // dịch asset luôn là một id thật; "dùng lại asset bản gốc" diễn đạt bằng cách
    // xoá hàng, không phải bằng một hàng mang `null`.
    if (typeof value !== 'string' || !value) return `"${field}" cần một id asset`;
    if (value.length > 40) return 'Id asset quá dài';
    return null;
  }
  if (field === 'alt' || field === 'a11yLabel' || field === 'href') {
    if (typeof value !== 'string') return `"${field}" cần một chuỗi`;
    if (value.length > 2000) return 'Chuỗi quá dài (tối đa 2000 ký tự)';
    return null;
  }
  if (!Array.isArray(value)) return `"${field}" cần một mảng inline node (RichText)`;
  if (!value.length) return 'RichText rỗng — gửi null để xoá bản dịch';
  for (const n of value) {
    if (!n || typeof n !== 'object' || typeof (n as { t?: unknown }).t !== 'string') {
      return 'RichText chứa phần tử không hợp lệ';
    }
  }
  return null;
}

/**
 * Metadata trang: luôn là CHUỖI, và có trần.
 *
 * Trần của `description` khớp `setPageSeo` (300) chứ không dùng 2000 của trường
 * chữ: một mô tả dài hơn thế bị mọi công cụ cắt, và bản dịch không có lý do gì
 * được dài hơn bản gốc.
 */
function metaShapeError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Metadata trang cần một chuỗi';
  const v = value.trim();
  if (!v) return 'Chuỗi rỗng — gửi null để xoá bản dịch';
  if (v.length > 300) return `Tối đa 300 ký tự (đang ${v.length})`;
  return null;
}

export async function setTranslation(args: {
  pageId?: string;
  locale?: string;
  nodeId?: string;
  field?: string;
  /**
   * RichText cho content/label; chuỗi cho alt/a11yLabel/href; id asset cho
   * assetId/posterAssetId. `null` = xoá bản dịch, tức quay về bản gốc.
   */
  value?: unknown;
  actorEmail: string;
  actorSub: string;
}): Promise<SetTranslationResult> {
  const { pageId, locale, nodeId } = args;
  /*
   * Hai họ trường đi qua cùng một đường ghi: trường của NODE
   * (`TranslatableField`) và trường METADATA trang (`PageMetaField`). Chúng không
   * gộp vào một union được — `title` không phải một trường của node nào, và nhận
   * nó ở địa chỉ node sẽ là một hàng không bao giờ áp được.
   *
   * Nên kiểu ở đây rộng, và `allowed` bên dưới mới là chỗ siết theo ĐỊA CHỈ.
   */
  const field = args.field as (TranslatableField | PageMetaField) | undefined;

  if (!pageId || !locale || !nodeId || !field) {
    return { ok: false, status: 400, error: 'Cần pageId, locale, nodeId và field' };
  }

  const isMeta = nodeId === META_ADDRESS;
  const allowed: readonly string[] = isMeta ? PAGE_META_FIELDS : TRANSLATION_FIELDS;
  // Họ `param:<đường dẫn>` mở (số ô của Form không cố định) nên không liệt kê được vào
  // `allowed`; nó chỉ hợp lệ ở địa chỉ node, và đường dẫn phải có thật trong danh sách
  // đơn vị (kiểm bên dưới bằng `extractUnits`).
  const isParam = !isMeta && isParamField(field);
  if (!isParam && !allowed.includes(field)) {
    return {
      ok: false,
      status: 400,
      error: `field phải là một trong: ${allowed.join(', ')}, hoặc param:<đường dẫn> (chữ trong params của Composite)`,
    };
  }

  const loc = await prisma.locale.findUnique({ where: { code: locale } });
  if (!loc) return { ok: false, status: 404, error: `Không có ngôn ngữ "${locale}"` };
  if (loc.isDefault) {
    return {
      ok: false,
      status: 400,
      error: `"${locale}" là ngôn ngữ gốc — sửa nó bằng op trên doc, không phải bằng bản dịch.`,
    };
  }

  const page = await getDraftPage(pageId);
  if (!page) return { ok: false, status: 404, error: 'Không tìm thấy trang' };

  /*
   * Metadata trang KHÔNG đi qua `extractUnits`: nó không phải một node.
   *
   * Bản gốc của nó nằm trên cột `Page.title`/`Page.description`, nên vân tay
   * `sourceHash` chụp chính hai cột ấy — cùng cơ chế "bản gốc đã đổi sau khi dịch"
   * mà mọi đơn vị chữ đang dùng.
   */
  const sourceText = isMeta
    ? field === 'title'
      ? page.title
      : (page.seo.description ?? '')
    : null;

  let unitText: string;
  if (isMeta) {
    unitText = sourceText!;
  } else {
    // `allowed` ở trên đã loại trường metadata ra khỏi nhánh này, nên ở đây `field`
    // chắc chắn là trường của node — nhưng TypeScript không suy được điều đó qua
    // một mảng `readonly string[]`.
    const nodeField = field as TranslatableField;
    const components = await loadComponents(page.doc);
    const unit = extractUnits(page.doc, components).find(
      (u) => unitKey(u.nodeId, u.field) === unitKey(nodeId, nodeField),
    );
    if (!unit) {
      return { ok: false, status: 404, error: `Trang này không có đơn vị chữ ${nodeId}:${field}` };
    }
    if (unit.locked) {
      return { ok: false, status: 409, error: 'Node đang bị khoá. Mở khoá trong trang sửa trước.' };
    }
    unitText = unit.text;
  }

  if (args.value === null) {
    await prisma.translation.deleteMany({ where: { locale, pageId, nodeId, field } });
    return { ok: true, deleted: true };
  }

  const bad = isMeta ? metaShapeError(args.value) : shapeError(field as TranslatableField, args.value);
  if (bad) return { ok: false, status: 400, error: bad };

  const row = await prisma.translation.upsert({
    where: { locale_pageId_nodeId_field: { locale, pageId, nodeId, field } },
    // Vân tay chụp bản gốc ĐANG có lúc dịch. Bản gốc đổi sau đó thì vân tay lệch,
    // và bảng Văn bản đánh dấu "cần dịch lại" thay vì im lặng để hai bản nói khác
    // nhau.
    create: {
      locale, pageId, nodeId, field,
      value: args.value as object,
      sourceHash: sourceHash(unitText),
      updatedBy: args.actorEmail,
    },
    update: {
      value: args.value as object,
      sourceHash: sourceHash(unitText),
      updatedBy: args.actorEmail,
    },
    select: { id: true, sourceHash: true, updatedAt: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: args.actorSub,
      action: 'translation.set',
      targetType: 'Translation',
      targetId: row.id,
      meta: { locale, pageId, nodeId, field },
    },
  });

  return { ok: true, translation: row };
}
