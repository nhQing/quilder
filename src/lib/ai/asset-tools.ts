import 'server-only';

/**
 * Tool cho Agent làm việc với ảnh.
 *
 * ## Ba đường vào, và thứ tự ưu tiên có lý do
 *
 *  1. **`filePath`** — `mcp/server.mjs` bắt tool này TẠI CHỖ, đọc file trên máy
 *     người dùng và POST multipart vào `/api/assets`. Byte không đi qua context.
 *     Đây là đường chính, và mô tả tool nói rõ như vậy.
 *  2. **`sourceUrl`** — server tải về rồi tải lên. Cho Agent chạy phía server, nơi
 *     không có đĩa của người dùng.
 *  3. **`bytesBase64`** — dự phòng, trần 256 KB. Có để không bí đường, KHÔNG phải
 *     để dùng thường: một ảnh 400 KB thành ~530 KB văn bản, tức khoảng 130 nghìn
 *     token.
 *
 * Nhánh 1 không bao giờ chạy tới file này — nó bị chặn ở `server.mjs`. Nó vẫn phải
 * có trong schema để tool công bố được tham số đó.
 */

import { z } from 'zod';

import { normalizeFolder } from '@/lib/assets/folder';
import { listFolders } from '@/lib/builder/asset-folders';
import { MAX_ASSET_BYTES, uploadAsset } from '@/lib/builder/upload-asset';
import { prisma } from '@/lib/db';
import type { ToolContext, ToolDef } from './tools';

/** Trần cho nhánh base64. Thấp có chủ đích — xem docblock đầu file. */
const MAX_BASE64_BYTES = 256 * 1024;

const uploadAssetTool: ToolDef = {
  name: 'upload_asset',
  title: 'Tải ảnh lên',
  description:
    'Tải một ảnh lên kho asset và trả về assetId để gắn vào node Image.\n\n' +
    'ƯU TIÊN `filePath` — đường dẫn file trên máy người dùng. MCP server đọc file ' +
    'tại chỗ nên ảnh KHÔNG đi qua cuộc hội thoại.\n\n' +
    'Dùng `sourceUrl` khi ảnh nằm trên web. Chỉ dùng `bytesBase64` khi không còn ' +
    'cách nào khác, và chỉ với ảnh rất nhỏ — base64 phình 33% và tiêu tốn context ' +
    'khủng khiếp.\n\n' +
    'Chấp nhận PNG, JPEG, SVG. Kiểu file được dò từ NỘI DUNG, không từ đuôi, và ' +
    'file phải khai được kích thước.\n\n' +
    'Nếu file trùng một ảnh đang nằm trong thùng rác thì ảnh đó được TỰ KHÔI PHỤC ' +
    '(`restored: true`) và dùng lại như asset cũ.\n\n' +
    'Tải lại đúng một file đã có sẽ trả về asset cũ (`reused: true`) chứ không tạo ' +
    'bản trùng — khoá được tính từ nội dung. Khi đó `folder` bạn gửi bị BỎ QUA: ' +
    'ảnh cũ giữ nguyên chỗ của nó.\n\n' +
    'Đặt `folder` theo trang bạn đang dựng, ví dụ `trang-chu/hero`. Gọi ' +
    '`list_asset_folders` trước để dùng lại thư mục đã có thay vì đẻ ra tên mới.',
  input: z
    .object({
      filePath: z.string().optional().describe('Đường dẫn trên máy người dùng. Ưu tiên dùng cái này.'),
      sourceUrl: z.string().url().optional().describe('Tải ảnh từ URL này.'),
      bytesBase64: z.string().optional().describe('Chỉ cho ảnh rất nhỏ. Tối đa 256 KB.'),
      fileName: z.string().max(200).optional().describe('Tên gợi ý, dùng cho khoá lưu trữ.'),
      folder: z
        .string()
        .max(120)
        .optional()
        .describe('Thư mục ảo, tối đa 3 cấp, ví dụ `trang-chu/hero`. Bỏ trống = chưa phân loại.'),
    })
    .strict(),
  readOnly: false,
  async run(
    input: {
      filePath?: string;
      sourceUrl?: string;
      bytesBase64?: string;
      fileName?: string;
      folder?: string;
    },
    ctx: ToolContext,
  ) {
    let bytes: Uint8Array;
    let fileName = input.fileName ?? '';

    if (input.sourceUrl) {
      let res: Response;
      try {
        res = await fetch(input.sourceUrl);
      } catch (e) {
        return { ok: false, error: `Không tải được ${input.sourceUrl}: ${String(e)}` };
      }
      if (!res.ok) {
        return { ok: false, error: `Tải ${input.sourceUrl} trả về ${res.status}` };
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > MAX_ASSET_BYTES) {
        return { ok: false, error: `Ảnh ở URL đó vượt ${MAX_ASSET_BYTES / 1024 / 1024} MB` };
      }
      bytes = buf;
      fileName ||= new URL(input.sourceUrl).pathname.split('/').pop() ?? 'asset';
    } else if (input.bytesBase64) {
      const buf = Buffer.from(input.bytesBase64, 'base64');
      if (buf.length > MAX_BASE64_BYTES) {
        return {
          ok: false,
          error:
            `Nhánh base64 chỉ nhận tối đa ${MAX_BASE64_BYTES / 1024} KB. ` +
            'Dùng filePath (nếu ảnh ở máy người dùng) hoặc sourceUrl.',
        };
      }
      bytes = new Uint8Array(buf);
      fileName ||= 'asset';
    } else if (input.filePath) {
      // Tới đây nghĩa là tool được gọi KHÔNG qua mcp/server.mjs — ví dụ qua
      // /api/ai/tool trực tiếp. Server không có đĩa của người dùng, và đọc một
      // đường dẫn tuỳ ý từ phía server là một lỗ đọc file.
      return {
        ok: false,
        error:
          'filePath chỉ dùng được qua MCP server chạy trên máy bạn. ' +
          'Ở đây hãy dùng sourceUrl hoặc bytesBase64.',
      };
    } else {
      return { ok: false, error: 'Cần một trong: filePath, sourceUrl, bytesBase64' };
    }

    const r = await uploadAsset({
      bytes,
      fileName,
      actorEmail: ctx.session.email,
      actorSub: ctx.session.sub,
      folder: input.folder ?? null,
    });
    if (!r.ok) return { ok: false, error: r.error };

    return {
      ok: true,
      assetId: r.asset.id,
      url: r.asset.url,
      width: r.asset.width,
      height: r.asset.height,
      mime: r.asset.mime,
      folder: r.asset.folder,
      reused: r.asset.reused,
      note:
        'Dùng assetId trong op setProps để gắn vào một node Image. ' +
        'Ảnh chỉ lên site thật sau khi người dùng bấm Publish.',
    };
  },
};

const listAssetsTool: ToolDef = {
  name: 'list_assets',
  title: 'Ảnh đang có',
  description:
    'Liệt kê ảnh trong kho, mới nhất trước.\n\n' +
    'Gọi nó TRƯỚC khi tải ảnh mới: ảnh cần dùng có thể đã có sẵn, và tải lại chỉ ' +
    'tạo thêm một bản trùng để người dùng phải phân biệt.\n\n' +
    '`folder` lọc theo NHÁNH: `trang-chu` trả cả `trang-chu/hero`.',
  input: z
    .object({
      limit: z.number().int().min(1).max(200).default(50),
      folder: z.string().max(120).optional().describe('Chỉ ảnh trong nhánh thư mục này.'),
    })
    .strict(),
  readOnly: true,
  async run(input: { limit: number; folder?: string }) {
    const folder = normalizeFolder(input.folder);
    if (!folder.ok) return { ok: false, error: folder.error };

    const rows = await prisma.asset.findMany({
      where: {
        trashedAt: null,
        ...(folder.value
          ? { OR: [{ folder: folder.value }, { folder: { startsWith: `${folder.value}/` } }] }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: {
        id: true, key: true, url: true, mime: true,
        width: true, height: true, folder: true,
      },
    });
    return { count: rows.length, assets: rows };
  },
};

/**
 * Thư mục nào đang có.
 *
 * Tồn tại để Agent DÙNG LẠI thư mục thay vì đặt tên mới mỗi lần. Không có tool này
 * thì mỗi phiên sẽ đẻ ra `trang-chu`, `trangchu`, `home` cho cùng một chỗ — và kho
 * thành ba nửa mang ba quy ước, đúng cái mà thư mục sinh ra để tránh.
 */
const listAssetFoldersTool: ToolDef = {
  name: 'list_asset_folders',
  title: 'Thư mục ảnh',
  description:
    'Liệt kê thư mục ảo trong kho ảnh, kèm số ảnh mỗi thư mục.\n\n' +
    'Gọi nó TRƯỚC `upload_asset` để đặt `folder` trùng với thư mục đã có thay vì ' +
    'tạo một tên gần giống.\n\n' +
    'Thư mục rỗng vẫn có thật (người dùng tạo trước để đặt cấu trúc), nên `total: 0` ' +
    'là một thư mục hợp lệ để tải ảnh vào, không phải rác.',
  input: z.object({}).strict(),
  readOnly: true,
  async run() {
    const tree = await listFolders();
    /*
     * `createdBy` KHÔNG đi ra ngoài. Nó là `sub` của một người dùng thật, phục vụ
     * đúng một việc là kiểm quyền xoá ở server — Agent không có việc gì với nó, và
     * mọi thứ Agent đọc được đều có thể xuất hiện lại trong một câu trả lời.
     */
    return {
      ...tree,
      folders: tree.folders.map(({ createdBy: _createdBy, ...rest }) => rest),
    };
  },
};

export const ASSET_TOOLS: ToolDef[] = [uploadAssetTool, listAssetsTool, listAssetFoldersTool];
