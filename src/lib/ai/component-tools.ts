import 'server-only';

/**
 * Tool cho AI sửa thư viện component.
 *
 * Tách khỏi `tools.ts` vì đó đã là 500 dòng, và vì đây là một MIỀN khác: tool ở
 * kia thao tác trên trang (có nháp, có publish, khách nhìn thấy), tool ở đây
 * thao tác trên thư viện (không publish, chưa ai nhìn thấy).
 *
 * ## Điều AI phải hiểu, và mọi mô tả dưới đây đều nhắc lại
 *
 * Component là KHUÔN ĐÓNG DẤU, không phải component đồng bộ. Chèn nó vào trang
 * là sao chép cây node với id mới. **Sửa component không đổi trang nào đã chèn
 * nó.** Không nói rõ thì model sẽ hứa với người dùng rằng sửa một component là
 * sửa cả site — và đó là lời hứa sai.
 *
 * ## Vẫn KHÔNG có tool publish
 *
 * Cùng nguyên tắc như `tools.ts`. Ở đây còn dễ hơn: component không publish được
 * theo bất kỳ nghĩa nào.
 */

import { z } from 'zod';

import { prisma } from '@/lib/db';
import { applyOpsToPreset } from '@/lib/doc/apply-to-preset';
import { copyName, uniqueKey } from '@/lib/builder/preset-key';
import type { PresetTree } from '@/lib/doc/preset';
import { plainText } from '@/lib/render/richtext';
import { componentNodeScope } from '@/lib/render/sanitize-css';
// CHỈ import kiểu. `tools.ts` import ngược lại file này để gom vào `TOOLS`, và
// một import giá trị hai chiều tạo vòng — vòng đó biểu hiện thành `undefined`
// lúc chạy chứ không thành lỗi biên dịch. Import kiểu bị xoá lúc biên dịch nên
// không có cạnh nào ở runtime.
import type { ToolDef } from './tools';

/** Cây component → dàn ý phẳng, cùng dạng `get_page_outline` trả về. */
function outline(tree: PresetTree, maxText = 60): unknown[] {
  const rows: unknown[] = [];
  const seen = new Set<string>();

  const walk = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = tree.nodes[id];
    if (!node) return;

    const text =
      node.type === 'Text' ? plainText(node.content)
      : node.type === 'Button' ? plainText(node.label)
      : '';

    rows.push({
      id: node.id,
      type: node.type,
      depth,
      ...(node.name ? { name: node.name } : {}),
      ...('tag' in node && node.tag ? { tag: node.tag } : {}),
      ...(text ? { text: text.length > maxText ? `${text.slice(0, maxText)}…` : text } : {}),
      ...(node.part ? { part: node.part } : {}),
      ...(node.effects.length ? { effects: node.effects.map((e) => e.effect) } : {}),
      ...(node.children.length ? { children: node.children } : {}),
    });
    for (const child of node.children) walk(child, depth + 1);
  };

  walk(tree.rootId, 0);
  return rows;
}

/*
 * Tên biến giữ nguyên (`STAMP_NOTE`) để khỏi đụng mọi chỗ dùng, nhưng NỘI DUNG đã đổi:
 * component giờ là component LIÊN KẾT. Bản cũ nói ngược lại (khuôn đóng dấu) và sẽ làm
 * agent báo sai cho người dùng rằng sửa component không ảnh hưởng trang.
 */
const STAMP_NOTE =
  'Component có HAI cách dùng. (1) Node `Instance` (componentId) là LIÊN KẾT: sửa '
  + 'component đổi MỌI trang đang cắm nó, nhưng chỉ lên site thật ở lần Publish kế '
  + 'tiếp — và Publish BẤT KỲ trang nào cũng đưa mọi thay đổi component lên site '
  + '(release chụp toàn bộ thư viện). (2) Chèn bằng op `insertNode` là ĐÓNG DẤU một '
  + 'bản sao độc lập: sau đó sửa component không đổi bản sao. Header/footer dùng chung '
  + 'cho cả site phải là Instance. Component không chứa được Instance lồng nhau, và '
  + 'effect gắn trên node trong component chạy một lần cho mỗi Instance không lặp.';

const listComponents: ToolDef = {
  name: 'list_components',
  title: 'Thư viện component',
  description:
    'Liệt kê component dựng sẵn: id, key, tên, nhóm, mô tả và số node.\n\n'
    + 'Gọi trước tiên để lấy `componentId` cho các tool component khác.\n\n'
    + STAMP_NOTE,
  input: z.object({}).strict(),
  readOnly: true,
  async run() {
    const rows = await prisma.preset.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true, key: true, name: true, category: true,
        aiDescription: true, builtin: true, tree: true, updatedAt: true,
      },
    });

    return {
      count: rows.length,
      note: STAMP_NOTE,
      components: rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        category: r.category,
        about: r.aiDescription,
        nodeCount: Object.keys((r.tree as unknown as PresetTree).nodes ?? {}).length,
        // Component builtin bị `extract-presets.ts` ghi đè khi chạy lại. Model
        // cần biết trước khi khuyên người dùng sửa thẳng vào nó.
        builtin: r.builtin,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  },
};

const getComponent: ToolDef = {
  name: 'get_component',
  title: 'Xem component',
  description:
    'Cây node của một component, dạng danh sách phẳng — id, type, tên, tag, đoạn '
    + 'text đầu, part và effect. KHÔNG kèm style; dùng `get_component_node` khi cần style.',
  input: z.object({ componentId: z.string().min(1) }).strict(),
  readOnly: true,
  async run(input: { componentId: string }) {
    const preset = await prisma.preset.findUnique({
      where: { id: input.componentId },
      select: {
        id: true, key: true, name: true, category: true,
        aiDescription: true, builtin: true, tree: true,
      },
    });
    if (!preset) return { error: `Không tìm thấy component ${input.componentId}` };

    const tree = preset.tree as unknown as PresetTree;
    return {
      component: {
        id: preset.id, key: preset.key, name: preset.name,
        category: preset.category, about: preset.aiDescription, builtin: preset.builtin,
      },
      rootId: tree.rootId,
      nodeCount: Object.keys(tree.nodes ?? {}).length,
      nodes: outline(tree),
      note: STAMP_NOTE,
    };
  },
};

const getComponentNode: ToolDef = {
  name: 'get_component_node',
  title: 'Node trong component',
  description:
    'Node đầy đủ (kèm style theo từng breakpoint) bên trong một component. Đọc '
    + 'trước khi sửa style — `setStyle` TRỘN vào lớp đang có, nên phải biết lớp đó có gì.\n\n'
    + 'Kết quả kèm `cssScope`: selector mà `customCss` của node đó được scope về. Nó '
    + 'KHÁC node cấp trang (`[data-n="<id>"]`) vì một trang mang nhiều instance của '
    + 'cùng component, nên rule phải dùng chung theo component.',
  input: z
    .object({
      componentId: z.string().min(1),
      nodeIds: z.array(z.string().min(1)).min(1).max(20),
    })
    .strict(),
  readOnly: true,
  async run(input: { componentId: string; nodeIds: string[] }) {
    const preset = await prisma.preset.findUnique({
      where: { id: input.componentId },
      select: { tree: true },
    });
    if (!preset) return { error: `Không tìm thấy component ${input.componentId}` };

    const tree = preset.tree as unknown as PresetTree;
    const nodes: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const id of input.nodeIds) {
      const node = tree.nodes[id];
      if (node) nodes[id] = node;
      else missing.push(id);
    }

    /*
     * `cssScope` cho từng node có customCss.
     *
     * Có mặt vì "CSS lưu đúng mà không ra output" là ca khó chẩn nhất của cả
     * panel — và nó đã xảy ra thật: tới 07/09/2026 `compileDoc` không phát
     * customCss cho node component, nên chuỗi CSS ở đây trả về đúng trong khi
     * HTML không có nó. Nói ra selector thật là cách để câu hỏi "nó có ra CSS
     * không, và ra selector nào" trả lời được bằng một tool call.
     */
    const cssScope: Record<string, string> = {};
    for (const [id, node] of Object.entries(nodes)) {
      if ((node as { customCss?: string }).customCss) {
        cssScope[id] = componentNodeScope(input.componentId, id);
      }
    }

    return {
      nodes,
      ...(Object.keys(cssScope).length ? { cssScope } : {}),
      ...(missing.length ? { missing } : {}),
    };
  },
};

const updateComponent: ToolDef = {
  name: 'update_component',
  title: 'Đổi thông tin component',
  description:
    'Đổi tên, nhóm hoặc mô tả của một component. KHÔNG đổi cây node — dùng '
    + '`apply_component_ops` cho việc đó.\n\n'
    + '`key` không bao giờ đổi: nó là định danh ổn định mà script trích xuất và '
    + 'các tool khác dùng.',
  input: z
    .object({
      componentId: z.string().min(1),
      name: z.string().min(1).max(80).optional(),
      category: z.string().min(1).max(40).optional(),
      about: z.string().min(1).max(500).optional()
        .describe('Mô tả cho AI đọc — chính là thứ giúp chọn đúng component sau này.'),
    })
    .strict(),
  readOnly: false,
  async run(
    input: { componentId: string; name?: string; category?: string; about?: string },
    ctx,
  ) {
    const preset = await prisma.preset.findUnique({
      where: { id: input.componentId },
      select: { id: true, key: true },
    });
    if (!preset) return { error: `Không tìm thấy component ${input.componentId}` };

    if (input.name) {
      const clash = await prisma.preset.findFirst({
        where: { name: input.name, NOT: { id: preset.id } },
        select: { id: true },
      });
      if (clash) return { error: `Đã có component tên "${input.name}"` };
    }

    const updated = await prisma.preset.update({
      where: { id: preset.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.about ? { aiDescription: input.about } : {}),
      },
      select: { id: true, key: true, name: true, category: true, aiDescription: true },
    });

    await prisma.auditLog.create({
      data: {
        userId: ctx.session.sub,
        action: 'preset.update.ai',
        targetType: 'Preset',
        targetId: preset.id,
        meta: { key: preset.key, changed: Object.keys(input).filter((k) => k !== 'componentId') },
      },
    });

    return { ok: true, component: updated };
  },
};

const duplicateComponent: ToolDef = {
  name: 'duplicate_component',
  title: 'Nhân bản component',
  description:
    'Tạo một bản sao độc lập của một component.\n\n'
    + 'Dùng khi cần một biến thể: nhân bản rồi sửa bản sao, thay vì sửa bản gốc — '
    + 'nhất là với component `builtin`, thứ sẽ bị ghi đè khi script trích xuất chạy lại.',
  input: z
    .object({
      componentId: z.string().min(1),
      name: z.string().min(1).max(80).optional()
        .describe('Bỏ trống thì tự đặt "<tên gốc> (bản sao)".'),
    })
    .strict(),
  readOnly: false,
  async run(input: { componentId: string; name?: string }, ctx) {
    const source = await prisma.preset.findUnique({
      where: { id: input.componentId },
      select: { name: true, category: true, aiDescription: true, tree: true },
    });
    if (!source) return { error: `Không tìm thấy component ${input.componentId}` };

    const existing = await prisma.preset.findMany({ select: { key: true, name: true } });
    const names = new Set(existing.map((p) => p.name));
    const name = input.name?.trim() || copyName(source.name, names);
    if (names.has(name)) return { error: `Đã có component tên "${name}"` };

    const tree = structuredClone(source.tree) as unknown as PresetTree;
    const created = await prisma.preset.create({
      data: {
        key: uniqueKey(name, new Set(existing.map((p) => p.key))),
        name,
        category: source.category,
        aiDescription: source.aiDescription,
        tree: tree as unknown as object,
        builtin: false,
        versions: {
          create: { tree: tree as unknown as object, label: 'nhân bản (AI)', createdBy: `ai:${ctx.session.email}` },
        },
      },
      select: { id: true, key: true, name: true, category: true },
    });

    await prisma.auditLog.create({
      data: {
        userId: ctx.session.sub,
        action: 'preset.duplicate.ai',
        targetType: 'Preset',
        targetId: created.id,
        meta: { from: input.componentId, key: created.key },
      },
    });

    return { ok: true, component: created };
  },
};

const applyComponentOps: ToolDef = {
  name: 'apply_component_ops',
  title: 'Sửa cây node của component',
  description:
    'Áp một batch op lên cây node của một component. CÙNG bộ op và cùng validator '
    + 'với `apply_ops` trên trang.\n\n'
    + STAMP_NOTE + '\n\n'
    + 'Component `builtin` sẽ bị ghi đè khi `extract-presets.ts` chạy lại — với '
    + 'chúng, hãy `duplicate_component` trước rồi sửa bản sao.\n\n'
    + 'Chỉ làm ĐÚNG thứ được yêu cầu. Tối đa 80 op mỗi lần; nếu bị từ chối, đọc '
    + '`issues` — mỗi issue có `index` trỏ tới op gây lỗi.\n\n'
    + 'Đặt `dryRun: true` để chạy validator mà KHÔNG ghi. Nó cũng báo được lỗi riêng '
    + 'của component (ví dụ chèn instance vào trong component), nên dùng nó khi bạn '
    + 'không chắc.',
  input: z
    .object({
      componentId: z.string().min(1),
      ops: z.array(z.unknown()).min(1).max(80),
      prompt: z.string().max(2000).optional()
        .describe('Yêu cầu gốc của người dùng, lưu vào lịch sử version để truy vết.'),
      label: z.string().max(120).optional(),
      dryRun: z.boolean().optional().describe('Chỉ kiểm, không ghi.'),
    })
    .strict(),
  readOnly: false,
  async run(
    input: {
      componentId: string;
      ops: unknown;
      prompt?: string;
      label?: string;
      dryRun?: boolean;
    },
    ctx,
  ) {
    const result = await applyOpsToPreset({
      presetId: input.componentId,
      ops: input.ops,
      actor: 'ai',
      session: ctx.session,
      label: input.label,
      prompt: input.prompt,
      dryRun: input.dryRun,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        issues: result.issues,
        hint:
          'Sửa theo issues rồi gọi lại. KHÔNG áp một batch khác để "bù" — chưa có '
          + 'gì được ghi vào database cả.',
      };
    }

    const tree = result.tree!;

    if (result.dryRun) {
      return {
        ok: true,
        dryRun: true,
        wouldApply: result.ops!.length,
        nodeCountAfter: Object.keys(tree.nodes).length,
        touched: result.touched,
        note:
          'CHƯA GHI GÌ. Batch này hợp lệ. Gọi lại KHÔNG có dryRun để ghi thật — và '
          + 'nhớ rằng hợp lệ không có nghĩa là đúng ý người dùng.',
      };
    }

    return {
      ok: true,
      versionId: result.versionId,
      applied: result.ops!.length,
      nodeCount: Object.keys(tree.nodes).length,
      componentUrl: `${ctx.origin}/builder/components/${input.componentId}`,
      note:
        'Đã ghi vào thư viện. ' + STAMP_NOTE
        + ' Đưa componentUrl cho người dùng để họ mở xem.',
    };
  },
};

export const COMPONENT_TOOLS: ToolDef[] = [
  listComponents,
  getComponent,
  getComponentNode,
  updateComponent,
  duplicateComponent,
  applyComponentOps,
];
