import 'server-only';

/**
 * `open_builder_link` — từ một link "Copy link cho AI" đến đúng element cần sửa.
 *
 * ## Vì sao cần tool riêng khi đã có `get_node` / `get_component_node`
 *
 * Chủ site dán một dòng như `[Quilder] Trang chủ › Hero › Nút CTA — https://…/builder/<id>?node=<id>`
 * kèm "đổi chữ nút này thành …". Model phải: tách URL, đoán link thuộc loại nào (node trang,
 * phần tử trong component, node trong chế độ sửa component), chọn đúng tool ghi, và nhớ rằng sửa
 * cấu trúc một component đổi MỌI trang dùng nó. Mỗi bước đó là một chỗ đoán sai im lặng.
 * Tool này làm hết phần đoán và trả `howToEdit` — tên tool + id cụ thể — để model chỉ việc làm.
 *
 * Chỉ ĐỌC. Mọi thay đổi vẫn đi qua `apply_ops` / `apply_component_ops` / `set_translation`,
 * nên vẫn một validator, một history stack.
 *
 * Chỉ import KIỂU từ `./tools` (xem ghi chú ở component-tools: import giá trị hai chiều tạo vòng).
 */

import { z } from 'zod';

import { parseAiLink, type ParsedAiLink } from '@/lib/builder/ai-link';
import { ancestorPath, labelOf } from '@/lib/builder/node-label';
import { prisma } from '@/lib/db';
import { migrateDoc, presetTreeToDoc } from '@/lib/doc/migrate';
import type { Doc, Node } from '@/lib/doc/types';
import type { ToolDef } from './tools';

/** Nhãn + id: đủ để model đối chiếu với dòng đã dán mà không phải tải cả node. */
function brief(node: Node) {
  return { id: node.id, type: node.type, label: labelOf(node) };
}

function ancestorsOf(doc: Doc, nodeId: string) {
  // Bỏ chính node: nó nằm ở `target`.
  return ancestorPath(doc, nodeId).slice(0, -1).map(brief);
}

function childrenOf(doc: Doc, node: Node) {
  return node.children.flatMap((id) => {
    const child = doc.nodes[id];
    return child ? [brief(child)] : [];
  });
}

const sameOrigin = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/** Câu dặn về ngôn ngữ — chữ ở bản dịch KHÔNG ghi bằng setText. */
function localeNote(link: ParsedAiLink, nodeAddress: string, pageId: string) {
  if (!link.locale) return null;
  return {
    locale: link.locale,
    tool: 'set_translation',
    args: { pageId, locale: link.locale, nodeId: nodeAddress },
    note:
      `Link được copy khi editor đang ở bản dịch "${link.locale}". Sửa CHỮ/ảnh ở đây phải ghi bằng ` +
      '`set_translation` (field: content | label | alt | a11yLabel, hoặc `param:<đường dẫn>` cho ' +
      'tham số Composite) — KHÔNG dùng setText/setOverride, vì chúng đổi bản gốc. Gọi ' +
      '`list_translations` để lấy đúng field. Style và bố cục dùng chung mọi ngôn ngữ.',
  };
}

const openBuilderLink: ToolDef = {
  name: 'open_builder_link',
  title: 'Mở link element từ builder',
  description:
    'Nhận link dán từ nút "Copy link cho AI" của builder (cả dòng `[Quilder] … — https://…/builder/<pageId>?node=…` ' +
    'cũng được) và trả đúng element đó: node đầy đủ (cùng dạng get_node), đường tổ tiên, tóm tắt con, ' +
    'và `howToEdit` — tool + id chính xác để sửa. GỌI TOOL NÀY ĐẦU TIÊN khi tin nhắn của người dùng có link ' +
    'dạng `/builder/<id>?node=…`; đừng hỏi người dùng element nằm ở đâu. ' +
    '`kind`: page-node (apply_ops), component-node (apply_component_ops), instance-child (phần tử trong ' +
    'component trên một trang: nội dung qua setOverride = chỉ trang đó; cấu trúc/style qua ' +
    'apply_component_ops = ĐỔI MỌI TRANG dùng component — phải nói rõ bạn đã làm cái nào).',
  input: z
    .object({
      url: z.string().min(1).max(4000).describe('Link hoặc cả dòng đã dán; lấy URL đầu tiên chứa /builder/.'),
    })
    .strict(),
  readOnly: true,
  async run(input: { url: string }, ctx) {
    const parsed = parseAiLink(input.url);
    if (!parsed.ok) return { error: parsed.error };
    const link = parsed.link;

    const warning =
      link.origin && !sameOrigin(link.origin, ctx.origin)
        ? `Link thuộc builder ${link.origin} nhưng MCP đang nối tới ${ctx.origin}. ` +
          'Id có thể không tồn tại ở đây — nếu không thấy, hỏi người dùng xem họ đang mở builder nào.'
        : undefined;
    const withWarning = <T extends object>(o: T) => (warning ? { ...o, warning } : o);

    const stale = 'Hãy bảo người dùng chọn lại element và copy link mới bằng nút "Copy link cho AI".';

    /* ── Node trong chế độ sửa component ────────────────────────────── */
    if (link.kind === 'component-node') {
      const preset = await prisma.preset.findUnique({
        where: { id: link.component! },
        select: { id: true, key: true, name: true, builtin: true, tree: true },
      });
      if (!preset) {
        return { error: `Không tìm thấy component ${link.component} (có thể đã bị xoá). ${stale}` };
      }
      const tree = presetTreeToDoc(preset.tree);
      const node = tree.nodes[link.node];
      if (!node) {
        return {
          error: `Component "${preset.name}" không có node ${link.node} ở bản hiện tại. ${stale}`,
        };
      }

      return withWarning({
        kind: link.kind,
        locale: link.locale,
        component: { id: preset.id, key: preset.key, name: preset.name, builtin: preset.builtin },
        target: {
          id: node.id,
          node,
          ancestors: ancestorsOf(tree, node.id),
          children: childrenOf(tree, node),
        },
        howToEdit: {
          tool: 'apply_component_ops',
          args: { componentId: preset.id, nodeId: node.id },
          scope: `Component "${preset.name}" — sửa ở đây ĐỔI MỌI TRANG đang dùng component này.`,
          notes: [
            'Đọc style hiện tại bằng get_component_node trước khi setStyle (setStyle trộn vào lớp đang có).',
            'Dùng dryRun: true nếu không chắc op hợp lệ.',
            ...(preset.builtin
              ? ['Component builtin bị ghi đè khi extract-presets chạy lại — cân nhắc duplicate_component trước.']
              : []),
            ...(node.locked ? [`Node bị khoá (${node.locked.reason}) — không sửa.`] : []),
          ],
          ...(link.locale
            ? {
                locale:
                  `Link có locale "${link.locale}" nhưng đây là node trong cây component: chữ trong ` +
                  'component dịch qua instance trên từng trang (set_translation với nodeId = instanceId/localId).',
              }
            : {}),
        },
      });
    }

    /* ── Node (hoặc instance) trên trang ────────────────────────────── */
    const page = await prisma.page.findUnique({
      where: { id: link.pageId },
      select: {
        id: true,
        slug: true,
        title: true,
        draftVersion: { select: { id: true, seq: true, doc: true } },
      },
    });
    if (!page?.draftVersion) {
      return { error: `Không tìm thấy bản nháp của trang ${link.pageId}. ${stale}` };
    }
    const doc = migrateDoc(page.draftVersion.doc);
    const pageInfo = {
      id: page.id,
      slug: page.slug,
      path: `/${page.slug}`,
      title: page.title,
      draftSeq: page.draftVersion.seq,
      draftVersionId: page.draftVersion.id,
    };

    const node = doc.nodes[link.node];
    if (!node) {
      return {
        error: `Trang "${page.title}" không có node ${link.node} trong bản nháp hiện tại (có thể đã bị xoá hoặc dựng lại). ${stale}`,
      };
    }

    /* Phần tử bên trong instance. */
    if (link.kind === 'instance-child') {
      if (node.type !== 'Instance') {
        return {
          error: `Link có cn=${link.cn} nhưng node ${node.id} là ${node.type}, không phải Instance. ${stale}`,
        };
      }
      const preset = await prisma.preset.findUnique({
        where: { id: node.componentId },
        select: { id: true, key: true, name: true, tree: true },
      });
      if (!preset) {
        return { error: `Instance ${node.id} trỏ tới component ${node.componentId} không còn tồn tại.` };
      }
      const tree = presetTreeToDoc(preset.tree);
      const inner = tree.nodes[link.cn!];
      if (!inner) {
        return {
          error: `Component "${preset.name}" không có phần tử ${link.cn} ở bản hiện tại. ${stale}`,
        };
      }

      const address = `${node.id}/${inner.id}`;
      const override = node.overrides[inner.id];
      const loc = localeNote(link, address, page.id);

      return withWarning({
        kind: link.kind,
        locale: link.locale,
        page: pageInfo,
        component: { id: preset.id, key: preset.key, name: preset.name },
        instance: { id: node.id, label: labelOf(node), ancestors: ancestorsOf(doc, node.id) },
        target: {
          id: inner.id,
          node: inner,
          // Đang có override cho phần tử này trên trang này không — model cần biết để
          // `setOverride` ghi chồng đúng thay vì tưởng đang sửa giá trị gốc.
          ...(override ? { currentOverride: override } : {}),
          // Đường bên trong component, từ gốc component xuống (không gồm chính nó).
          ancestors: ancestorsOf(tree, inner.id),
          children: childrenOf(tree, inner),
        },
        howToEdit: {
          choose:
            'Hai cách sửa, hậu quả KHÁC NHAU — chọn theo ý người dùng và NÓI RÕ bạn đã làm cái nào:',
          contentOnThisPageOnly: {
            tool: 'apply_ops',
            op: 'setOverride',
            args: { pageId: page.id, nodeId: node.id, localId: inner.id },
            scope: `Chỉ trang "${page.title}" — đổi nội dung (text/label/alt/href) của phần tử này ở instance này.`,
            note: 'Gọi list_text_units để biết đơn vị chữ có sửa được bằng chuỗi không (flat) trước khi ghi.',
          },
          structureOrStyleForAllPages: {
            tool: 'apply_component_ops',
            args: { componentId: preset.id, nodeId: inner.id },
            scope: `Component "${preset.name}" — ĐỔI MỌI TRANG đang dùng nó (style, cấu trúc, thêm/xoá node).`,
            note: 'Đọc node bằng get_component_node trước khi setStyle.',
          },
          ...(loc ? { translation: loc } : {}),
          reminder:
            'Yêu cầu chỉ đổi chữ/ảnh của riêng trang này → setOverride. Đổi giao diện/cấu trúc → apply_component_ops, ' +
            'và báo cho người dùng rằng các trang khác dùng component này cũng đổi theo.',
        },
      });
    }

    /* Node thường của trang (cũng gồm cả việc chọn nguyên một Instance). */
    const loc = localeNote(link, node.id, page.id);
    return withWarning({
      kind: link.kind,
      locale: link.locale,
      page: pageInfo,
      target: {
        id: node.id,
        node,
        ancestors: ancestorsOf(doc, node.id),
        children: childrenOf(doc, node),
      },
      howToEdit: {
        tool: 'apply_ops',
        args: { pageId: page.id, nodeId: node.id, baseSeq: pageInfo.draftSeq },
        scope: `Chỉ trang "${page.title}" (bản nháp).`,
        notes: [
          'Đọc style hiện tại bằng get_node trước khi setStyle (setStyle merge sâu).',
          ...(node.type === 'Instance'
            ? [
                'Đây là một Instance của component: đổi NỘI DUNG bằng setOverride { nodeId: <instanceId>, localId, patch } ' +
                  '(chỉ trang này). Đổi style/cấu trúc bên trong component dùng apply_component_ops (đổi mọi trang) — ' +
                  `componentId = ${node.componentId}.`,
              ]
            : []),
          ...(node.locked ? [`Node bị khoá (${node.locked.reason}) — không sửa.`] : []),
        ],
        ...(loc ? { translation: loc } : {}),
      },
    });
  },
};

export const LINK_TOOLS: ToolDef[] = [openBuilderLink];
