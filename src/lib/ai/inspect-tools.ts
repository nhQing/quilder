import 'server-only';

/**
 * Tool đọc cho hai bề mặt sửa mới của bảng thuộc tính.
 *
 * ## Vì sao cần tool ĐỌC khi `apply_ops` đã ghi được mọi thứ
 *
 * `apply_ops` cho Agent phát mọi op mà giao diện phát. Nhưng ghi đúng cần biết ba
 * thứ mà `get_node` không nói, và cả ba đều là chỗ Agent làm hỏng ÂM THẦM:
 *
 *  1. **Đơn vị chữ nào sửa được bằng chuỗi.** `RichText` là cây inline node. Ghi một
 *     chuỗi vào cây có `link`/`split`/nhiều đoạn sẽ san phẳng nó: link mất `href`,
 *     hiệu ứng tách chữ mất mục tiêu và chết im lặng. Giao diện có cờ `flat` để chặn;
 *     Agent phải có cùng cờ đó, nếu không nó là đường ghi kém an toàn hơn con người.
 *  2. **Chữ nằm trong instance ghi bằng op KHÁC.** `setText` trên một node local của
 *     component sẽ sửa cây component, tức đổi mọi trang đang dùng. Địa chỉ
 *     `instanceId/localId` là dấu hiệu duy nhất, và nó không xuất hiện trong
 *     `get_page_outline`.
 *  3. **Ô inspector nào phát ra property CSS nào.** Nhãn panel giờ LÀ tên property
 *     (`inline-size`, `padding-block-start`). Người dùng nói "đổi width" thì Agent
 *     phải biết đó là `size.width`, và biết `customCss` của node có đang đè nó không —
 *     nếu có thì `setStyle` thành công mà trang không đổi gì.
 *
 * Cả hai tool ở đây chỉ đọc. Không có tool ghi mới nào: mọi thay đổi vẫn đi qua
 * `apply_ops`, nên vẫn một validator, một history stack, một audit trail.
 */

import { z } from 'zod';

import { prisma } from '@/lib/db';
import { migrateDoc } from '@/lib/doc/migrate';
import { loadComponents } from '@/lib/render/components';
import { extractUnits, fieldValueKind, unitKey } from '@/lib/builder/text-units';
import { effectiveStyle, ownLayer } from '@/lib/builder/style-resolve';
import { STYLE_CSS_PROPERTY, cssAlias, propertiesFor } from '@/lib/builder/style-css-map';
import { declaredProperties } from '@/lib/render/sanitize-css';
import { BREAKPOINTS } from '@/lib/design/breakpoints';
import { checkLayout } from '@/lib/builder/layout-checks';
import type { Doc } from '@/lib/doc/types';
import type { ToolDef } from './tools';

/** Bản nháp của một trang, đã migrate. Trả `null` khi không có trang đó. */
async function loadDraft(pageId: string): Promise<{ doc: Doc; slug: string } | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { slug: true, draftVersion: { select: { doc: true } } },
  });
  if (!page?.draftVersion) return null;
  return { doc: migrateDoc(page.draftVersion.doc), slug: page.slug };
}

const listTextUnits: ToolDef = {
  name: 'list_text_units',
  title: 'Danh sách đơn vị chữ',
  description:
    'Mọi đoạn chữ gốc của một trang, kèm khoá "nodeId:field" mà bảng Văn bản và ' +
    'bảng thuộc tính đều dùng. Mỗi đơn vị nói rõ: sửa được bằng chuỗi hay không ' +
    '(flat), có bị khoá không, và có nằm trong instance không. ĐỌC TOOL NÀY TRƯỚC ' +
    'khi sửa chữ: đơn vị flat=false có cấu trúc (link, ngắt dòng, tách chữ) và ghi ' +
    'một chuỗi vào sẽ làm mất cấu trúc đó mà không báo lỗi. Đơn vị trong instance ' +
    'ghi bằng setOverride (nodeId = instanceId, localId), KHÔNG phải setText — ' +
    'setText ở đó sửa cây component, tức đổi mọi trang đang dùng nó. ' +
    'KHÔNG phải đơn vị nào cũng là chữ: đọc `valueKind` trước khi ghi. ' +
    '`text` = văn xuôi, dịch được. `asset` = ID ảnh/video, chỉ nhận ID asset có ' +
    'thật (lấy từ list_assets) — ghi văn xuôi vào đây làm ảnh MẤT mà không báo ' +
    'lỗi. `href` = đường dẫn, chỉ đổi khi thật sự muốn trỏ sang trang khác.',
  input: z
    .object({
      pageId: z.string().min(1),
      /** Lọc theo chữ, không phân biệt hoa thường và dấu. */
      text: z.string().min(1).optional(),
      editableOnly: z
        .boolean()
        .default(false)
        .describe('Chỉ đơn vị sửa được bằng chuỗi: flat và không bị khoá.'),
      limit: z.number().int().min(1).max(200).default(80),
    })
    .strict(),
  readOnly: true,
  async run(input: {
    pageId: string; text?: string; editableOnly: boolean; limit: number;
  }) {
    const page = await loadDraft(input.pageId);
    if (!page) return { error: `Không tìm thấy bản nháp của trang ${input.pageId}` };

    // Cây component là bắt buộc: thiếu nó thì mọi chữ của mọi instance bị bỏ sót
    // IM LẶNG — và đó là loại thiếu sót không ai phát hiện, vì danh sách vẫn dài.
    const components = await loadComponents(page.doc);
    const all = extractUnits(page.doc, components);

    const fold = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
    const needle = input.text ? fold(input.text) : null;

    const rows = all
      .filter((u) => (needle ? fold(u.text).includes(needle) : true))
      .filter((u) => (input.editableOnly ? u.flat && !u.locked : true))
      .slice(0, input.limit)
      .map((u) => ({
        key: unitKey(u.nodeId, u.field),
        nodeId: u.nodeId,
        field: u.field,
        nodeType: u.nodeType,
        kind: u.kind,
        /*
         * `valueKind` — ô này nhận CHỮ, hay nhận một mã?
         *
         * Từ lúc `TranslatableField` mở từ 4 lên 7 giá trị, danh sách này không còn
         * thuần chữ: `assetId` / `posterAssetId` mang id asset, `href` mang đường dẫn.
         * Cả ba đều `flat: true`, nên `editableOnly: true` TRẢ CHÚNG RA — và cái tên
         * `list_text_units` thì hứa ngược lại.
         *
         * Hệ quả nếu không nói ra: agent được bảo "dịch trang sang tiếng Anh" sẽ ghi
         * một câu tiếng Anh vào `assetId`. `setProps` nhận, validator nhận (nó là
         * string hợp lệ), rồi renderer tra một asset không tồn tại và ảnh mất. Không
         * lỗi, không log — đúng loại hỏng mà cả file này tồn tại để chặn.
         *
         * `kind` ở trên KHÔNG thay được: nó là nhãn tiếng Việt để bày trong bảng
         * ('ảnh', 'đường dẫn', 'ảnh chờ'), nên bắt agent suy từ nó là bắt nó đoán
         * nghĩa một chuỗi hiển thị. `fieldValueKind` suy từ `field` — một hàm, dùng
         * chung với `TextTable` và `ContentPanel`, nên ba bề mặt không thể nói khác nhau.
         */
        valueKind: fieldValueKind(u.field),
        path: u.path,
        text: u.text,
        flat: u.flat,
        ...(u.locked ? { locked: true } : {}),
        ...(u.inInstance
          ? {
              // Nói THẲNG op phải dùng, không để Agent tự suy: suy sai ở đây sửa vào
              // cây component và đổi mọi trang.
              writeWith: 'setOverride',
              instanceId: u.inInstance.instanceId,
              localId: u.nodeId.split('/')[1],
            }
          : {
              writeWith:
                u.field === 'content' || u.field === 'label' ? 'setText' : 'setProps',
            }),
      }));

    return {
      page: { id: input.pageId, path: `/${page.slug}` },
      total: all.length,
      shown: rows.length,
      units: rows,
      hint:
        'setText nhận RichText, không nhận chuỗi: value = [{ "t": "text", "v": "..." }]. ' +
        'alt ghi bằng setProps { alt }, a11yLabel bằng setProps { a11y: { label } }.',
    };
  },
};

const resolveStyle: ToolDef = {
  name: 'resolve_style',
  title: 'Style có hiệu lực của node',
  description:
    'Giá trị style CÓ HIỆU LỰC của một node ở một lớp breakpoint, kèm: lớp nào đang ' +
    'đặt riêng thứ gì, property CSS mà mỗi ô phát ra, và customCss của node có đang ' +
    'đè ô nào không. Dùng khi người dùng nói bằng tên property CSS ("đổi width", ' +
    '"bỏ padding-top") thay vì bằng tên field trong schema, và trước khi kết luận ' +
    'một setStyle "không có tác dụng" — thường là customCss đang đè.',
  input: z
    .object({
      pageId: z.string().min(1),
      nodeId: z.string().min(1),
      breakpoint: z.enum(BREAKPOINTS).default('base'),
    })
    .strict(),
  readOnly: true,
  async run(input: { pageId: string; nodeId: string; breakpoint: (typeof BREAKPOINTS)[number] }) {
    const page = await loadDraft(input.pageId);
    if (!page) return { error: `Không tìm thấy bản nháp của trang ${input.pageId}` };

    const node = page.doc.nodes[input.nodeId];
    if (!node) return { error: `Trang này không có node ${input.nodeId}` };

    // Property nào trong customCss áp VÔ ĐIỀU KIỆN — cùng luật mà dấu ⚠ của panel
    // dùng: rule trong @media hay có pseudo chỉ đè trong một số hoàn cảnh.
    const shadowed = new Set(
      declaredProperties(node.customCss ?? '', node.id)
        .filter((d) => d.always)
        .map((d) => d.prop),
    );

    const effective = effectiveStyle(node, input.breakpoint);

    // Bảng ô → property, kèm trạng thái. Chỉ liệt kê ô ĐANG có giá trị: đổ cả 34 ô
    // rỗng vào context là đúng thứ mà thiết kế "model tự kéo chi tiết" muốn tránh.
    const fields = Object.keys(STYLE_CSS_PROPERTY)
      .map((key) => {
        const [group, field] = key.split('.') as [string, string];
        const value = (effective as Record<string, Record<string, unknown> | undefined>)[group]?.[
          field
        ];
        if (value === undefined) return null;

        const shadowingProp = propertiesFor(group, field).find((p) => shadowed.has(p));
        return {
          field: key,
          cssProperty: STYLE_CSS_PROPERTY[key]![0]!,
          ...(cssAlias(group, field) ? { alsoKnownAs: cssAlias(group, field) } : {}),
          value,
          ...(shadowingProp ? { shadowedByCustomCss: shadowingProp } : {}),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Lớp nào đang đặt riêng thứ gì — đúng bản đồ mà panel bày thành dải chip.
    const layers = Object.fromEntries(
      BREAKPOINTS.map((bp) => {
        const own = ownLayer(node, bp);
        const count = own
          ? Object.values(own).reduce(
              (n, v) => n + (v && typeof v === 'object' ? Object.keys(v).length : v ? 1 : 0),
              0,
            )
          : 0;
        return [bp, { count, ...(own ? { own } : {}) }];
      }),
    );

    return {
      nodeId: node.id,
      type: node.type,
      breakpoint: input.breakpoint,
      ...(node.locked ? { locked: node.locked.reason } : {}),
      fields,
      layers,
      ...(node.customCss ? { customCss: node.customCss } : {}),
      hint:
        'setStyle merge SÂU và ghi vào đúng lớp `target`. Đặt một khoá thành null để ' +
        'gỡ nó khỏi lớp đó. Nhãn trong giao diện là `cssProperty`, không phải `field`.',
    };
  },
};

/**
 * Soát bố cục từ toạ độ đã đo — phần PHÂN TÍCH của `verify_page`.
 *
 * Trình duyệt chạy ở máy người dùng (`mcp/server.mjs`) chỉ ĐO: toạ độ mọi node mang
 * `data-n`. Đánh giá nằm ở đây, trong `layout-checks.ts` — cùng hàm mà
 * `pnpm check:layout` dùng và đã có test. Nếu proxy tự chép luật vào, hai bản sẽ trôi
 * khỏi nhau ngay lần sửa đầu: đúng chuyện đã xảy ra với bản đầu của check-layout, khi
 * hàm đánh giá được nhét vào trình duyệt bằng `Function.toString()`.
 *
 * Model hiếm khi gọi thẳng tool này; nó tồn tại cho `verify_page`.
 */
const zRect = z.object({ top: z.number(), left: z.number(), width: z.number(), height: z.number() }).strict();
const analyzeLayout: ToolDef = {
  name: 'analyze_layout',
  title: 'Soát bố cục từ số đo',
  description:
    'Nhận toạ độ các node đã đo ở một khổ màn (do verify_page gửi), trả các vấn đề bố cục: ' +
    'tràn ngang, chồng lấn, khe hở ở mép — kèm nodeId. Thường không cần gọi trực tiếp: ' +
    'dùng verify_page.',
  input: z
    .object({
      viewport: z.number().positive(),
      nodes: z
        .array(
          z
            .object({
              nodeId: z.string().min(1),
              parentId: z.string().nullable(),
              rect: zRect,
              position: z.string(),
              insideComposite: z.boolean(),
            })
            .strict(),
        )
        .max(5000),
    })
    .strict(),
  readOnly: true,
  async run(input: Parameters<typeof checkLayout>[0]) {
    const issues = checkLayout(input);
    return { issueCount: issues.length, issues: issues.slice(0, 50) };
  },
};

export const INSPECT_TOOLS: ToolDef[] = [listTextUnits, resolveStyle, analyzeLayout];
