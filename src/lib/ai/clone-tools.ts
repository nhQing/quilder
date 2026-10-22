import 'server-only';

/**
 * Nửa SERVER của bộ clone.
 *
 * ## Một tool ở đây, hai tool ở máy người dùng
 *
 * Việc clone cần trình duyệt, nên `clone_url` và `compare_with_url` chạy trong `mcp/server.mjs` (như
 * `screenshot_page`) — trình duyệt nằm ở máy chạy Claude, không nằm trong builder. Chúng không có
 * trong registry này. Thứ ở máy builder là bước GHI: nhận cây node đã trích + danh sách asset, ép về
 * schema, tạo trang nháp noindex. Mọi phép kiểm quyền, validator và AuditLog vì thế vẫn chỉ có một bản.
 *
 * Tool này công bố ra Claude (nó nằm trong `GET /api/ai/tool`), nhưng mô tả bảo KHÔNG gọi tay: cây
 * node do converter tất định sinh ra, không do model gõ — đó là cả lý do bộ clone tồn tại.
 *
 * Kit (token, extractor) phục vụ ở `GET /api/ai/clone-kit`; xem `src/lib/clone/kit.ts`.
 */

import { z } from 'zod';

import { CLONE_MAX_NODES } from '@/lib/clone/kit';
import { createCloneDraft } from '@/lib/clone/create-draft';
import type { CloneDraftInput } from '@/lib/clone/types';
import type { ToolContext, ToolDef } from './tools';

const zAssetResult = z.union([
  z.object({ assetId: z.string().min(1).max(60), reused: z.boolean().optional() }).strict(),
  z
    .object({
      error: z.string().max(400),
      code: z.enum(['too-large', 'fetch', 'upload', 'unsupported']).optional(),
    })
    .strict(),
]);

const createCloneDraftTool: ToolDef = {
  name: 'create_clone_draft',
  title: 'Tạo trang nháp từ bản clone',
  description:
    'BƯỚC GHI của clone_url — KHÔNG GỌI TAY. Nhận cây node mà trình trích (converter tất định) đã đo từ trang ' +
    'nguồn, nối asset, ép về đúng schema của builder rồi tạo MỘT TRANG NHÁP MỚI đặt noindex.\n\n' +
    'Quy tắc cứng: không publish; không bao giờ ghi đè trang có sẵn (slug trùng là lỗi); `folder` bắt buộc ' +
    'và do chủ site chọn. Cây node không được model tự dựng bằng tay — hãy dùng clone_url.\n\n' +
    'Trả về pageId, đường dẫn mở trong builder, số node và `report`: danh sách những gì KHÔNG clone được ' +
    'hoặc clone gần đúng. Phải đọc report đó cho người dùng, không được bỏ qua.',
  input: z
    .object({
      url: z.string().url().max(2000).describe('URL trang nguồn.'),
      title: z.string().min(1).max(200),
      slug: z.string().min(1).max(200).describe('Đường dẫn trang MỚI. Không được trùng trang có sẵn.'),
      folder: z
        .string()
        .min(1)
        .max(120)
        .describe('Thư mục ảnh do CHỦ SITE chọn. Hỏi họ, đừng tự đặt.'),
      doc: z
        .object({
          rootId: z.string().min(1).max(40),
          nodes: z.record(z.string(), z.record(z.string(), z.unknown())),
        })
        .strict(),
      assets: z.record(z.string(), zAssetResult).default({}),
      notes: z
        .record(
          z.string(),
          z.object({ count: z.number(), samples: z.array(z.string().max(160)).max(12) }).strict(),
        )
        .default({}),
      page: z
        .object({
          title: z.string().max(300).optional(),
          description: z.string().max(1000).optional(),
          lang: z.string().max(20).optional(),
          ogImage: z.string().max(2000).optional(),
          url: z.string().max(2000).optional(),
        })
        .strict()
        .default({}),
    })
    .strict(),
  readOnly: false,
  async run(input: CloneDraftInput, ctx: ToolContext) {
    const count = Object.keys(input.doc.nodes).length;
    if (count > CLONE_MAX_NODES + 200) {
      return { ok: false, error: `Cây có ${count} node, vượt trần ${CLONE_MAX_NODES}. Chia nhỏ trang nguồn.` };
    }
    const r = await createCloneDraft(input, {
      actorEmail: ctx.session.email,
      actorSub: ctx.session.sub,
      origin: ctx.origin,
    });
    if (!r.ok) {
      return { ok: false, error: r.error, ...(r.issues?.length ? { issues: r.issues } : {}) };
    }
    return {
      ok: true,
      pageId: r.pageId,
      slug: r.slug,
      title: r.title,
      nodeCount: r.nodeCount,
      editorUrl: r.editorUrl,
      previewUrl: r.previewUrl,
      folder: r.folder,
      noindex: r.noindex,
      stats: r.stats,
      landmarks: r.landmarks,
      report: r.report,
      note:
        'Trang nháp chưa publish và đã noindex. Bước tiếp: so với trang nguồn bằng compare_with_url (1440 và 390), ' +
        'sửa đúng các dòng lệch rồi đo lại; tách header/footer (landmarks) thành component dùng chung.',
    };
  },
};

export const CLONE_TOOLS: ToolDef[] = [createCloneDraftTool];
