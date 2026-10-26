import 'server-only';

/**
 * Bộ tool mà AI dùng để đọc và sửa site.
 *
 * ## Một lớp, hai vỏ
 *
 * File này KHÔNG biết gì về MCP lẫn về Anthropic SDK. Nó chỉ là một registry
 * gồm tên, schema Zod và handler. Hai vỏ bọc quanh nó:
 *
 *   mcp/server.ts        → Claude Desktop, suy luận chạy trong gói thuê bao
 *   /api/ai/chat (sau)   → chat ngay trong builder, suy luận tính theo credit
 *
 * Tách như vậy vì phần đắt nhất là *bộ tool* chứ không phải lớp vận chuyển. Đổi
 * cách nói chuyện với model không được kéo theo việc viết lại phần này.
 *
 * ## Một tool ghi, nhiều tool đọc
 *
 * Chỉ `apply_ops` được ghi. Phần còn lại là đọc, và chúng tồn tại để model TỰ
 * KÉO chi tiết nó cần thay vì bị nhồi cả cây node vào context. Trang chủ hiện có
 * 168 node; serialize hết kèm style là vài chục nghìn token cho một yêu cầu
 * "đổi tiêu đề".
 *
 * ## Cái cố ý KHÔNG có ở đây
 *
 * Không có tool publish. AI chỉ chạm bản nháp; đưa thay đổi ra site thật là một
 * hành động của con người, thực hiện trong builder sau khi đã xem preview. Đây
 * là ranh giới an toàn quan trọng nhất của cả lớp AI, và cách duy nhất để giữ nó
 * là không cấp công cụ — chứ không phải dặn model đừng làm.
 */

import { z } from 'zod';

import type { SessionPayload } from '@/lib/auth/session';
import { parsePageCollection } from '@/lib/builder/page-collection';
import { prisma } from '@/lib/db';
import { applyOpsToPage } from '@/lib/doc/apply-to-page';
import { migrateDoc } from '@/lib/doc/migrate';
import { plainText } from '@/lib/doc/plain-text';
import type { Doc, Node } from '@/lib/doc/types';
import { EFFECT_REGISTRY } from '@/lib/motion/effects/registry';
import { BREAKPOINTS, BREAKPOINT_INFO, BREAKPOINT_PX } from '@/lib/design/breakpoints';
import { COLLECTION_TOOLS } from './collection-tools';
import { SCHEMA_TOOLS } from './schema-tools';
import { COMPONENT_TOOLS } from './component-tools';
import { INSPECT_TOOLS } from './inspect-tools';
import { ASSET_TOOLS } from './asset-tools';
import { CLONE_TOOLS } from './clone-tools';
import { SITE_TOOLS } from './site-tools';
import { LINK_TOOLS } from './link-tools';

export interface ToolContext {
  session: SessionPayload;
  /**
   * Gốc URL công khai của builder, ví dụ `https://abc.com`.
   *
   * Tool trả link TUYỆT ĐỐI chứ không phải đường dẫn tương đối: bên đọc kết quả
   * là một model đang nói chuyện với người dùng ngồi ở máy khác, và
   * `/preview/abc` ở đó chỉ là một chuỗi vô dụng.
   */
  origin: string;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: z.ZodTypeAny;
  /** Tool đọc không đổi gì — vỏ MCP khai `readOnlyHint` để client biết. */
  readOnly: boolean;
  run: (input: never, ctx: ToolContext) => Promise<unknown>;
}

/* ── Tiện ích ─────────────────────────────────────────────────────────── */

// `plainText` đã chuyển sang `@/lib/doc/plain-text` — file này import prisma, nên
// một hàm thuần nằm ở đây là một hàm không test được. Re-export để mọi chỗ đang
// `import { plainText } from '@/lib/ai/tools'` vẫn chạy.
export { plainText } from '@/lib/doc/plain-text';

function textOf(node: Node): string {
  if (node.type === 'Text') return plainText(node.content);
  if (node.type === 'Button') return plainText(node.label);
  if (node.type === 'Image') return node.alt;
  return '';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function loadDraft(
  pageId: string,
): Promise<{ doc: Doc; slug: string; title: string; seq: number } | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { slug: true, title: true, draftVersion: { select: { doc: true, seq: true } } },
  });
  if (!page?.draftVersion) return null;
  return {
    doc: migrateDoc(page.draftVersion.doc),
    slug: page.slug,
    title: page.title,
    seq: page.draftVersion.seq,
  };
}

/**
 * Doc → dàn ý phẳng.
 *
 * Cố ý KHÔNG mang style. Style là phần chiếm chỗ nhất trong doc và hầu như không
 * bao giờ cần để trả lời "sửa cái gì" — model đọc dàn ý để chọn node, rồi gọi
 * get_node cho đúng node đó. Nhồi sẵn style vào đây là đánh đổi ngược: tốn token
 * cho 167 node để tiết kiệm một lượt gọi cho 1 node.
 */
function outline(doc: Doc, maxText: number): unknown[] {
  const rows: unknown[] = [];
  const walk = (id: string, depth: number) => {
    const node = doc.nodes[id];
    if (!node) return;
    const text = textOf(node);
    rows.push({
      id: node.id,
      type: node.type,
      depth,
      ...(node.name ? { name: node.name } : {}),
      ...('tag' in node && node.tag ? { tag: node.tag } : {}),
      ...(text ? { text: truncate(text, maxText) } : {}),
      ...(node.effects.length ? { effects: node.effects.map((e) => e.effect) } : {}),
      ...(node.locked ? { locked: node.locked.reason } : {}),
      ...(node.customCss ? { hasCustomCss: true } : {}),
      ...(node.children.length ? { children: node.children } : {}),
    });
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(doc.rootId, 0);
  return rows;
}

/* ── Tool ─────────────────────────────────────────────────────────────── */

const listPages: ToolDef = {
  name: 'list_pages',
  title: 'Danh sách trang',
  description:
    'Liệt kê mọi trang của site kèm id, đường dẫn, tiêu đề và trạng thái publish. ' +
    'Gọi tool này trước tiên để lấy pageId cho các tool khác.',
  input: z.object({}).strict(),
  readOnly: true,
  async run(_input: unknown, ctx: ToolContext) {
    const site = await prisma.site.findFirst({
      select: {
        id: true, name: true, primaryDomain: true,
        activeRelease: { select: { id: true, label: true, entries: { select: { pageId: true } } } },
      },
    });
    if (!site) return { error: 'Chưa có site nào trong database.' };

    const published = new Set(site.activeRelease?.entries.map((e) => e.pageId) ?? []);
    const pages = await prisma.page.findMany({
      where: { siteId: site.id, archivedAt: null },
      orderBy: { slug: 'asc' },
      select: {
        id: true, slug: true, title: true, description: true,
        updatedAt: true, fixture: true, collection: true,
      },
    });

    return {
      site: { name: site.name, domain: site.primaryDomain },
      release: site.activeRelease
        ? { id: site.activeRelease.id, label: site.activeRelease.label }
        : null,
      pages: pages.map((p) => ({
        id: p.id,
        path: `/${p.slug}`,
        title: p.title,
        description: p.description,
        published: published.has(p.id),
        /*
         * Bảng định tuyến phải TỰ MÔ TẢ.
         *
         * `path` một mình không nói được `/blogs/[category]` phục vụ cái gì — nó chỉ
         * là một chuỗi có ngoặc. Không phát khoá này thì agent phải đoán, và đoán sai
         * ở đây nghĩa là dựng thêm một mẫu trùng hình dạng với mẫu đã có.
         */
        ...(parsePageCollection(p.collection)
          ? { collection: parsePageCollection(p.collection) }
          : {}),
        updatedAt: p.updatedAt.toISOString(),
        previewUrl: `${ctx.origin}/preview/${p.id}`,
        editUrl: `${ctx.origin}/builder/${p.id}`,
        /*
         * Chỉ phát khoá này khi nó TRUE.
         *
         * `fixture: false` trên mười trang bình thường là mười dòng nhiễu, và
         * khoá vắng mặt đọc tự nhiên hơn là một cờ phủ định. Còn khi nó có mặt
         * thì nó phải nổi bật — kèm luôn lý do, vì một cờ trần sẽ bị hiểu là
         * chuyện nội bộ không liên quan.
         */
        ...(p.fixture
          ? {
              fixture: true,
              fixtureNote:
                'ĐỒ GÁ CỦA TEST E2E — không dựng nội dung lên trang này. ' +
                'apply_ops sẽ từ chối (403).',
            }
          : {}),
      })),
      ...(pages.some((p) => p.fixture)
        ? {
            note:
              'Có trang mang cờ `fixture`: đó là đồ gá của test, không phải nội dung. ' +
              'Chọn trang khác, hoặc hỏi người dùng.',
          }
        : {}),
    };
  },
};

const getPageOutline: ToolDef = {
  name: 'get_page_outline',
  title: 'Dàn ý trang',
  description:
    'Cây node của bản nháp một trang, dạng danh sách phẳng: id, type, tên, tag, ' +
    'đoạn text đầu, effect đang gắn và danh sách con. KHÔNG kèm style — dùng ' +
    'get_node khi cần style của một node cụ thể.',
  input: z
    .object({
      pageId: z.string().min(1),
      maxTextLength: z.number().int().min(10).max(200).default(60),
    })
    .strict(),
  readOnly: true,
  async run(input: { pageId: string; maxTextLength: number }) {
    const page = await loadDraft(input.pageId);
    if (!page) return { error: `Không tìm thấy bản nháp của trang ${input.pageId}` };
    const nodes = outline(page.doc, input.maxTextLength);
    return {
      page: { id: input.pageId, path: `/${page.slug}`, title: page.title },
      // Gửi lại làm `baseSeq` của apply_ops: người khác sửa trang trong lúc bạn đọc
      // thì apply_ops từ chối thay vì áp lên một cây bạn chưa thấy.
      draftSeq: page.seq,
      rootId: page.doc.rootId,
      nodeCount: Object.keys(page.doc.nodes).length,
      nodes,
    };
  },
};

const getNode: ToolDef = {
  name: 'get_node',
  title: 'Chi tiết node',
  description:
    'Toàn bộ một node: style theo từng lớp (base/sm/md/lg/xl/hover/focusVisible/inView), ' +
    'effect, customCss và field riêng của type. Đọc node TRƯỚC khi sửa style của nó, ' +
    'vì setStyle merge sâu chứ không thay thế.',
  input: z
    .object({
      pageId: z.string().min(1),
      nodeIds: z.array(z.string().min(1)).min(1).max(20),
    })
    .strict(),
  readOnly: true,
  async run(input: { pageId: string; nodeIds: string[] }) {
    const page = await loadDraft(input.pageId);
    if (!page) return { error: `Không tìm thấy bản nháp của trang ${input.pageId}` };

    const found: Record<string, Node> = {};
    const missing: string[] = [];
    for (const id of input.nodeIds) {
      const node = page.doc.nodes[id];
      if (node) found[id] = node;
      else missing.push(id);
    }
    return { nodes: found, ...(missing.length ? { missing } : {}) };
  },
};

const findNodes: ToolDef = {
  name: 'find_nodes',
  title: 'Tìm node',
  description:
    'Tìm node theo nội dung text, tên, type hoặc effect đang gắn. Dùng khi người ' +
    'dùng chỉ vào thứ gì đó bằng lời ("nút đăng ký", "tiêu đề hero") thay vì bằng id.',
  input: z
    .object({
      pageId: z.string().min(1),
      text: z.string().min(1).optional().describe('Khớp một phần, không phân biệt hoa thường và dấu.'),
      type: z.string().min(1).optional().describe('Section, Stack, Grid, Text, Image, Button, …'),
      name: z.string().min(1).optional(),
      hasEffect: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  readOnly: true,
  async run(input: {
    pageId: string; text?: string; type?: string; name?: string;
    hasEffect?: string; limit: number;
  }) {
    const page = await loadDraft(input.pageId);
    if (!page) return { error: `Không tìm thấy bản nháp của trang ${input.pageId}` };

    // Bỏ dấu trước khi so: người dùng gõ "dang ky" vẫn phải tìm ra "Đăng ký".
    const fold = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

    const needle = input.text ? fold(input.text) : null;
    const nameNeedle = input.name ? fold(input.name) : null;

    const matches = Object.values(page.doc.nodes)
      .filter((n) => {
        if (input.type && n.type !== input.type) return false;
        if (input.hasEffect && !n.effects.some((e) => e.effect === input.hasEffect)) return false;
        if (nameNeedle && !fold(n.name ?? '').includes(nameNeedle)) return false;
        if (needle && !fold(textOf(n)).includes(needle)) return false;
        return true;
      })
      .slice(0, input.limit)
      .map((n) => ({
        id: n.id,
        type: n.type,
        ...(n.name ? { name: n.name } : {}),
        ...(textOf(n) ? { text: truncate(textOf(n), 80) } : {}),
        parentId: n.parentId,
        ...(n.effects.length ? { effects: n.effects.map((e) => e.effect) } : {}),
        ...(n.locked ? { locked: n.locked.reason } : {}),
      }));

    return { count: matches.length, nodes: matches };
  },
};

const searchTokens: ToolDef = {
  name: 'search_tokens',
  title: 'Tìm design token',
  description:
    'Tra design token theo tên hoặc nhóm. MỌI màu, khoảng cách, cỡ chữ, bo góc và ' +
    'thời lượng nên dùng token thay vì giá trị thô — validator từ chối token không ' +
    'tồn tại, nên hãy tra ở đây trước khi dùng.',
  input: z
    .object({
      query: z.string().optional().describe('Khớp một phần trong tên hoặc mô tả.'),
      category: z.string().optional().describe('color | space | typeScale | radius | duration | easing | shadow'),
      limit: z.number().int().min(1).max(100).default(40),
    })
    .strict(),
  readOnly: true,
  async run(input: { query?: string; category?: string; limit: number }) {
    const tokens = await prisma.token.findMany({
      where: {
        deprecated: false,
        ...(input.category ? { category: input.category } : {}),
        ...(input.query
          ? {
              OR: [
                { name: { contains: input.query, mode: 'insensitive' as const } },
                { aiDescription: { contains: input.query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      take: input.limit,
      select: {
        name: true, value: true, category: true,
        group: true, aiDescription: true, baseValue: true,
      },
    });

    return {
      count: tokens.length,
      hint: 'Dùng dưới dạng { "$token": "<name>" } trong giá trị style.',
      tokens: tokens.map((t) => ({
        $token: t.name,
        value: t.value,
        category: t.category,
        ...(t.group ? { group: t.group } : {}),
        ...(t.aiDescription ? { about: t.aiDescription } : {}),
        // Người dùng đã đặt giá trị này ở màn Cài đặt, đè lên tokens.css.
        ...(t.baseValue !== null ? { setByUser: true } : {}),
      })),
    };
  },
};

const listEffects: ToolDef = {
  name: 'list_effects',
  title: 'Thư viện hiệu ứng',
  description:
    'Các effect gắn được vào node, kèm schema params, chi phí runtime và điều kiện ' +
    'chạy. Đọc trước khi dùng attachEffect — effect không có trong registry sẽ bị từ chối.\n\n' +
    'Trả về HAI danh sách. `effects` là effect thật (code). `presets` là hiệu ứng đặt sẵn: ' +
    'một cái tên riêng cho một effect thật đã gắn sẵn tham số, sống trong DB chứ không ' +
    'trong code. Gắn preset bằng cách đưa `key` của nó vào attachEffect.effect — nó được ' +
    'giải ra effect thật + params đã trộn, và params bạn tự gõ GHI ĐÈ params của preset. ' +
    'Đọc `params` của effect gốc (`effectKey`) để biết gõ thêm được gì.',
  input: z.object({ key: z.string().optional() }).strict(),
  readOnly: true,
  async run(input: { key?: string }) {
    const [rows, presetRows] = await Promise.all([
      prisma.effect.findMany({
        where: input.key ? { key: input.key } : undefined,
        orderBy: { key: 'asc' },
      }),
      prisma.effectPreset.findMany({
        where: input.key ? { key: input.key } : undefined,
        orderBy: { key: 'asc' },
        select: {
          key: true,
          name: true,
          aiDescription: true,
          effectKey: true,
          params: true,
          note: true,
        },
      }),
    ]);

    // Registry là nguồn sự thật cho "chạy được hay không" — bảng Effect chỉ mô
    // tả. Một effect có row nhưng chưa có trong registry sẽ qua validator rồi
    // lặng lẽ không chạy, nên đánh dấu rõ ở đây.
    const runnable = new Set(Object.keys(EFFECT_REGISTRY));

    const described = rows.map((r) => ({
      key: r.key,
      name: r.name,
      about: r.aiDescription,
      appliesTo: r.appliesTo,
      params: r.paramsSchema,
      defaults: r.defaults,
      cost: r.runtimeCost,
      conflicts: r.conflicts,
      statesWritten: r.statesWritten,
      runnable: runnable.has(r.key),
    }));

    // Effect có trong registry nhưng chưa có row mô tả — vẫn dùng được.
    const undocumented = [...runnable].filter((k) => !rows.some((r) => r.key === k));

    /*
     * Preset TRÙNG key với một effect thật là một hàng CHẾT, và nó chết im lặng.
     *
     * `validateOps` chỉ đi tìm preset khi key không có trong registry, nên một
     * preset tên `slider` không bao giờ được giải: `attachEffect` gắn effect
     * `slider` trần với params rỗng, hợp lệ, và chạy — chỉ là không phải thứ
     * người ta đặt tên. `scripts/effect-preset.ts` chặn việc tạo mới; cờ này là
     * để hàng đã lọt vào từ trước (hoặc vào bằng SQL tay) hiện ra.
     */
    const presets = presetRows.map((p) => ({
      kind: 'preset' as const,
      key: p.key,
      name: p.name,
      about: p.aiDescription,
      effectKey: p.effectKey,
      params: p.params,
      ...(p.note ? { note: p.note } : {}),
      runnable: runnable.has(p.effectKey),
      ...(runnable.has(p.key)
        ? {
            shadowed:
              `Có một effect thật cùng tên "${p.key}" — preset này KHÔNG bao giờ được ` +
              'giải. Đổi key của nó đi.',
          }
        : {}),
    }));

    return {
      effects: described,
      ...(presets.length ? { presets } : {}),
      ...(undocumented.length && !input.key ? { undocumented } : {}),
    };
  },
};

const applyOps: ToolDef = {
  name: 'apply_ops',
  title: 'Áp thay đổi',
  description:
    'Áp một batch op lên BẢN NHÁP của một trang. Đây là tool ghi duy nhất.\n\n' +
    'Thay đổi chỉ nằm ở bản nháp: site thật không đổi cho tới khi người dùng tự ' +
    'bấm Publish trong builder. Sau khi áp, bảo người dùng mở previewUrl để xem.\n\n' +
    'Chỉ làm ĐÚNG thứ được yêu cầu, đúng phạm vi được yêu cầu. Không thêm section, ' +
    'không chỉnh lại style của node không liên quan, không "cải thiện" thứ không ai hỏi.\n\n' +
    'Tối đa 80 op mỗi lần. Nếu bị từ chối, đọc `issues` — mỗi issue có `index` trỏ ' +
    'tới op gây lỗi.\n\n' +
    'Đặt `dryRun: true` khi bạn không chắc batch có hợp lệ không: validator chạy đầy ' +
    'đủ và KHÔNG ghi gì. Nó tránh được vòng "ghi rồi undo", nhưng không tránh được ' +
    'việc sửa nhầm ý — batch hợp lệ mà sai ý vẫn qua dry-run.\n\n' +
    'Kết quả có thể mang `warnings`: op ĐÃ được áp nhưng không hoàn toàn như bạn ' +
    'viết — thường là customCss bị sanitize gỡ bớt (@keyframes, !important, ' +
    'position:fixed). ĐỌC chúng; chúng không phải lỗi nhưng chúng nói thứ gì đã mất.\n\n' +
    'Mỗi op là một object có field `op`. 15 op và field bắt buộc của chúng:\n' +
    '- insertNode { parentId, index, node } — node.id phải chưa tồn tại, children rỗng\n' +
    '- removeNode { nodeId } — xoá cả cây con\n' +
    '- moveNode { nodeId, newParentId, newIndex }\n' +
    '- duplicateNode { nodeId, newId } — chỉ node đó, không nhân cây con\n' +
    '- setProps { nodeId, props } — field riêng của node (tag, variant, action, alt…); ' +
    'KHÔNG đụng được id/parentId/children/type/style/effects\n' +
    '- setStyle { nodeId, target, patch } — target: base|sm|md|lg|xl|hover|focusVisible|inView, ' +
    'hoặc { state: "<tên>" } để ghi vào style.states (state do effect trên node điều khiển; ' +
    'tên phải có trong statesWritten của nó — đọc list_effects). patch merge sâu; null ở một ' +
    'key = xoá key đó\n' +
    '- setText { nodeId, field, value } — field: content (Text) | label (Button); value là RichText\n' +
    '- attachEffect { nodeId, attachment } / updateEffect { nodeId, instanceId, params } / ' +
    'detachEffect { nodeId, instanceId }\n' +
    '- setCustomCss { nodeId, css } — chỉ phần khai báo, tự scope; null để xoá\n' +
    '- setName { nodeId, name } | setLocked { nodeId, locked }\n' +
    '- setPresence { nodeId, render } — render:false cắt node và cả cây con khỏi DOM ở ' +
    'MỌI bề rộng. KHÔNG phải ẩn theo màn hình: cái đó là setStyle layout.display hoặc ' +
    'effects.visibility ở lớp breakpoint. null để xoá khoá (mặc định là có render)\n' +
    '- setOverride { nodeId, localId, patch } — ghi đè NỘI DUNG trong instance ' +
    '(content, label, alt, assetId, href, a11yLabel); patch: null để gỡ\n\n' +
    'Hình dạng chi tiết của `node`, `patch` style và RichText: đọc `get_design_system`, ' +
    '`get_node` một node tương tự, `search_tokens`, `list_effects` — rồi dùng `dryRun` để ' +
    'kiểm trước khi ghi.',
  input: z
    .object({
      pageId: z.string().min(1),
      /*
       * `z.array(z.unknown())` là CỐ Ý, không phải thiếu sót.
       *
       * `zOps` là union 15 op nhúng `zNode` và `zStylePatch` đệ quy; công bố nó ra
       * JSON Schema tự chứa cho ra 7,3 MB và làm chết context mọi phiên chat (xem
       * `json-schema.ts`). Luật thật không mất đi đâu: `validateOps` vẫn chạy
       * `zOps.safeParse` trong `applyOpsToPage` và trả `issues` có `index`. Đây
       * cũng là cách `apply_component_ops` làm từ đầu.
       */
      ops: z.array(z.unknown()).min(1).max(80),
      prompt: z.string().max(2000).optional()
        .describe('Yêu cầu gốc của người dùng, lưu vào lịch sử version để truy vết sau này.'),
      label: z.string().max(120).optional().describe('Nhãn ngắn cho version, ví dụ "đổi tiêu đề hero".'),
      dryRun: z.boolean().optional().describe('Chỉ kiểm, không ghi.'),
      baseSeq: z.number().int().min(0).optional().describe(
        'draftSeq từ get_page_outline lúc bạn đọc trang. Có thì người khác sửa trang ' +
          'trong lúc đó sẽ làm lời gọi bị từ chối (conflict) thay vì áp lên cây bạn chưa thấy. ' +
          'Nên luôn gửi.',
      ),
    })
    .strict(),
  readOnly: false,
  async run(
    input: {
      pageId: string; ops: unknown; prompt?: string; label?: string; dryRun?: boolean; baseSeq?: number;
    },
    ctx: ToolContext,
  ) {
    const result = await applyOpsToPage({
      pageId: input.pageId,
      ops: input.ops,
      actor: 'ai',
      session: ctx.session,
      label: input.label,
      prompt: input.prompt,
      dryRun: input.dryRun,
      baseSeq: input.baseSeq,
    });

    if (!result.ok && result.conflict) {
      return {
        ok: false,
        conflict: true,
        error: result.error,
        currentSeq: result.currentSeq,
        hint:
          'Chưa ghi gì. Trang vừa được sửa ở nơi khác (người dùng trong builder, hoặc một ' +
          'phiên khác). Gọi lại get_page_outline, kiểm node bạn định sửa còn đúng không, ' +
          'rồi gọi apply_ops với baseSeq mới.',
      };
    }

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        issues: result.issues,
        ...(result.warnings ? { warnings: result.warnings } : {}),
        hint:
          'Sửa theo issues rồi gọi lại. KHÔNG áp một batch khác để "bù" — chưa có ' +
          'gì được ghi vào database cả.',
      };
    }

    const doc = result.doc!;

    if (result.dryRun) {
      return {
        ok: true,
        dryRun: true,
        wouldApply: result.ops!.length,
        nodeCountAfter: Object.keys(doc.nodes).length,
        touched: result.touched,
        ...(result.warnings ? { warnings: result.warnings } : {}),
        note:
          'CHƯA GHI GÌ. Batch này hợp lệ. Gọi lại KHÔNG có dryRun để ghi thật — và ' +
          'nhớ rằng hợp lệ không có nghĩa là đúng ý người dùng.',
      };
    }

    return {
      ok: true,
      versionId: result.versionId,
      /** Bản nháp mới — làm `baseSeq` cho lần apply_ops kế tiếp. */
      draftSeq: result.seq,
      applied: result.ops!.length,
      nodeCount: Object.keys(doc.nodes).length,
      previewUrl: `${ctx.origin}/preview/${input.pageId}`,
      ...(result.warnings ? { warnings: result.warnings } : {}),
      note:
        'Đã ghi vào BẢN NHÁP. Site thật chưa đổi — cần bấm Publish trong builder. ' +
        'Đưa previewUrl cho người dùng để họ mở xem.',
    };
  },
};

const describeSystem: ToolDef = {
  name: 'get_design_system',
  title: 'Hệ thiết kế',
  description:
    'Quy ước nền của site: breakpoint, các lớp style, và luật viết style. Đọc một ' +
    'lần ở đầu phiên làm việc.',
  input: z.object({}).strict(),
  readOnly: true,
  async run() {
    /*
     * Từng trả thêm khối `foundations` — 12 token "nhận diện người dùng đã chọn" —
     * và luật "NỀN TẢNG TRƯỚC". Gỡ ngày 13/10/2026 cùng mục Nền tảng: các token đó
     * là bộ màu của một theme demo cũ, không phải màu trang thật đang dùng, nên
     * bảo AI ưu tiên chúng là dạy nó dựng trang lệch nhận diện. Xem
     * `lib/design/foundations.ts`.
     */
    const counts = await prisma.token.groupBy({
      by: ['category'],
      where: { deprecated: false },
      _count: true,
    });

    return {
      /*
       * BREAKPOINT, không phải khổ màn trên canvas.
       *
       * Trước 19/08/2026 hai thứ này là một, nên tool trả luôn `canvasWidth`. Giờ
       * khổ màn là lựa chọn giao diện của từng người dùng, lưu ở `localStorage` —
       * Agent không thấy được và cũng không cần: nó ghi vào LỚP STYLE, và lớp thì
       * cố định. Trả một bề rộng canvas ở đây là mời Agent tưởng rằng có một khổ
       * chuẩn để nhắm vào.
       */
      breakpoints: BREAKPOINTS.map((bp) => ({
        breakpoint: bp,
        label: BREAKPOINT_INFO[bp].label,
        applies: BREAKPOINT_INFO[bp].hint,
        minWidth: BREAKPOINT_PX[bp],
      })),
      styleLayers: {
        base: 'Nền mobile-first. Mọi lớp khác kế thừa từ đây. Style chung viết ở base.',
        'sm/md/lg/xl': 'Override theo min-width. Chỉ ghi thứ KHÁC base, không chép lại cả khối.',
        'hover/focusVisible/inView': 'State. inView map sang [data-in-view="true"] do effect ghi ra.',
      },
      /*
       * Thứ tự KHÔNG tuỳ ý: luật component đứng đầu vì nó quyết định hình dạng của
       * cả việc, còn luật style chỉ quyết định chi tiết. Một model đọc tới dòng thứ
       * ba rồi bắt tay vào làm sẽ làm đúng thứ quan trọng nhất.
       */
      rules: [
        'COMPONENT TRƯỚC. Gọi list_components và dùng lại bằng Instance. Cần biến thể thì SỬA component đã có và thêm tham số, đừng tạo bản gần giống.',
        'Component phải nhận tham số động để nhiều trang dùng chung một cây với nội dung và giao diện khác nhau. Component chỉ chạy được ở một trang là component sai.',
        'Thành phần NHỎ cũng thành component: text, button, field, image, thẻ, huy hiệu. Đừng rải node lẻ giống nhau ra nhiều trang.',
        'KHÔNG fix cứng thứ thuộc cấu hình. Tên công ty, hotline, số giấy phép, link store: gọi list_site_globals rồi bind (source:"site"). Builder này chạy cho nhiều dự án.',
        'SEO của trang nằm trên hàng Page — không nhét thẻ meta vào cây node. Tiêu đề: update_page. Mô tả, ảnh OG, canonical, noindex: set_page_seo.',
        'Dùng { "$token": "..." } cho màu, khoảng cách, cỡ chữ, bo góc, thời lượng. Giá trị thô chỉ khi thật sự không có token.',
        'setStyle merge SÂU vào lớp đang có. Muốn xoá một key thì đặt nó bằng null.',
        'Node có `locked` là nội dung tuân thủ pháp lý — không sửa.',
        'customCss là lối thoát cuối. Ưu tiên style có kiểu để inspector còn sửa được bằng tay.',
        'Site tiếng Việt. Nội dung mới viết bằng tiếng Việt trừ khi được yêu cầu khác.',
      ],
      tokenCounts: Object.fromEntries(counts.map((c) => [c.category, c._count])),
    };
  },
};

/**
 * Mọi tool, một danh sách.
 *
 * Vỏ MCP và route `/api/ai/tool` đều đọc từ đây, nên thêm tool là sửa đúng một
 * chỗ — và AI qua Claude Desktop thấy nó ngay mà không phải sửa `mcp/server.mjs`.
 *
 * Tool component nằm ở file riêng: chúng thao tác trên THƯ VIỆN (không publish,
 * chưa ai nhìn thấy), khác hẳn miền của tool trang.
 */
export const TOOLS: ToolDef[] = [
  describeSystem,
  listPages,
  getPageOutline,
  getNode,
  findNodes,
  searchTokens,
  listEffects,
  applyOps,
  ...INSPECT_TOOLS,
  ...COMPONENT_TOOLS,
  ...SITE_TOOLS,
  ...ASSET_TOOLS,
  ...CLONE_TOOLS,
  ...COLLECTION_TOOLS,
  ...SCHEMA_TOOLS,
  ...LINK_TOOLS,
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Chạy một tool theo tên. Ném lỗi nếu input không khớp schema. */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw new Error(`Không có tool tên "${name}"`);

  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new Error(
      `Input của ${name} không hợp lệ: ` +
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }

  return (tool.run as (i: unknown, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
}
