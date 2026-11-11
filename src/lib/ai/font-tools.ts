import 'server-only';

/**
 * Tool font cho Agent: `list_fonts` (đọc) và `upload_font` (ghi).
 *
 * `upload_font` có ba nguồn, đúng một trong ba:
 *  1. `filePath` — `mcp/server.mjs` bắt tại chỗ, đọc file trên máy người dùng và POST
 *     multipart vào `/api/fonts`. Nhánh này KHÔNG bao giờ chạy tới đây; nó vẫn nằm trong
 *     schema để tool công bố được tham số. Gọi thẳng qua `/api/ai/tool` thì bị từ chối
 *     (server không có đĩa của người dùng, và đọc đường dẫn tuỳ ý là lỗ đọc file).
 *  2. `sourceUrl` — server tải về (cùng helper chống SSRF với POST /api/fonts).
 *  3. `google` — server gọi css2 của Google Fonts.
 *
 * `licenseConfirmed` KHÔNG được điền hộ: đó là lời xác nhận của người dùng, không phải của AI.
 */

import { z } from 'zod';

import { fetchUrlBytes } from '@/lib/assets/fetch-url';
import { importGoogleFamily } from '@/lib/fonts/google';
import { resolveFallback } from '@/lib/fonts/http';
import { addFace, listFonts } from '@/lib/fonts/service';
import { FontError, MAX_LICENSE_NOTE, parseWeight } from '@/lib/fonts/types';
import type { ToolContext, ToolDef } from './tools';

const listFontsTool: ToolDef = {
  name: 'list_fonts',
  title: 'Liệt kê font',
  description:
    'Liệt kê các họ font của site: tên CSS, token, nguồn (builtin | upload | google), các face, ' +
    'fallback, nơi đang dùng (`usage`: trang, component, và `variables` — biến CSS như ' +
    '`--font-body` nhắc tên họ trong Token hoặc CSS của gói), cảnh báo và cờ chưa publish.\n\n' +
    'Kiểm font đã có trước khi tải mới.\n\n' +
    'Gán font bằng `apply_ops`, `setStyle` với `typography.family: { $token: \'<token>\' }`.\n\n' +
    'Font mới chỉ lên site thật sau khi người dùng Publish.',
  input: z.object({}).strict(),
  readOnly: true,
  async run() {
    return { ok: true, fonts: await listFonts() };
  },
};

const uploadFontTool: ToolDef = {
  name: 'upload_font',
  title: 'Tải font lên',
  description:
    'Thêm một face font vào kho font. Đúng MỘT nguồn trong ba: `filePath` (file trên máy người ' +
    'dùng, MCP server đọc tại chỗ), `sourceUrl` (server tải về) hoặc `google` ({ family, weights?, ' +
    'italic? } — lấy từ Google Fonts, không cần xác nhận giấy phép).\n\n' +
    'Mỗi lần gọi một file; cả bộ font thì gọi nhiều lần, gọi tuần tự, không gọi song song ' +
    '(các file cùng họ gọi song song sẽ tranh nhau tạo họ; gặp `conflict` thì gọi lại).\n\n' +
    'Chạy `dryRun: true` trước để cho người dùng xem tên họ và weight đọc được, rồi mới lưu thật.\n\n' +
    'Với `filePath` và `sourceUrl`, hỏi người dùng về giấy phép ("Bạn có quyền dùng font này trên ' +
    'web không?") và chỉ gửi `licenseConfirmed: true` khi họ đã trả lời có. KHÔNG tự điền ' +
    'licenseConfirmed.\n\n' +
    '`family`, `weight`, `style` dùng để đè metadata đọc từ file. `fallback`: sans | serif | mono ' +
    'hoặc một chuỗi font-family tự do. Kết quả giống phản hồi `POST /api/fonts`. Font mới chỉ lên ' +
    'site thật sau khi người dùng Publish.',
  input: z
    .object({
      filePath: z.string().optional().describe('Đường dẫn file font trên máy người dùng.'),
      sourceUrl: z.string().url().optional().describe('Tải file font từ URL này.'),
      google: z
        .object({
          family: z.string().describe('Tên họ hoặc link fonts.google.com/specimen/…'),
          weights: z.array(z.number().int().min(1).max(1000)).optional(),
          italic: z.boolean().optional(),
        })
        .strict()
        .optional()
        .describe('Nhập một họ từ Google Fonts.'),
      family: z.string().max(120).optional().describe('Đè tên họ đọc từ file.'),
      weight: z.string().max(20).optional().describe('Đè weight, ví dụ `400` hoặc `100 900`.'),
      style: z.enum(['normal', 'italic']).optional().describe('Đè kiểu chữ.'),
      fallback: z.string().max(300).optional().describe('sans | serif | mono | chuỗi tự do.'),
      licenseConfirmed: z
        .boolean()
        .optional()
        .describe('Chỉ true khi NGƯỜI DÙNG đã xác nhận có quyền dùng font. Bắt buộc với filePath/sourceUrl.'),
      licenseNote: z.string().max(MAX_LICENSE_NOTE).optional().describe('Ghi chú giấy phép.'),
      dryRun: z.boolean().optional().describe('Chỉ đọc và báo, không lưu.'),
    })
    .strict(),
  readOnly: false,
  async run(
    input: {
      filePath?: string;
      sourceUrl?: string;
      google?: { family: string; weights?: number[]; italic?: boolean };
      family?: string;
      weight?: string;
      style?: 'normal' | 'italic';
      fallback?: string;
      licenseConfirmed?: boolean;
      licenseNote?: string;
      dryRun?: boolean;
    },
    ctx: ToolContext,
  ) {
    // Chuỗi rỗng / toàn khoảng trắng coi như KHÔNG khai nguồn đó.
    const filePath = input.filePath?.trim() || undefined;
    const sourceUrl = input.sourceUrl?.trim() || undefined;
    const sources = [filePath, sourceUrl, input.google].filter((s) => s !== undefined);
    if (sources.length !== 1) {
      return { ok: false, error: 'Cần đúng một trong: filePath, sourceUrl, google' };
    }
    if (filePath) {
      // Tới đây nghĩa là tool được gọi KHÔNG qua mcp/server.mjs — xem docblock đầu file.
      return {
        ok: false,
        error:
          'filePath chỉ dùng được qua MCP server chạy trên máy bạn. ' +
          'Ở đây hãy dùng sourceUrl hoặc google.',
      };
    }

    if (input.style !== undefined && input.style !== 'normal' && input.style !== 'italic') {
      return { ok: false, error: 'Kiểu chữ (style) chỉ nhận "normal" hoặc "italic".' };
    }

    const actor = { email: ctx.session.email, sub: ctx.session.sub };
    try {
      const weight = parseWeight(input.weight);
      const fallback = input.fallback ? resolveFallback(input.fallback) : undefined;

      if (input.google) {
        return await importGoogleFamily(
          {
            family: input.google.family,
            weights: input.google.weights,
            italic: input.google.italic,
            fallback,
            dryRun: input.dryRun,
          },
          actor,
        );
      }

      const got = await fetchUrlBytes(sourceUrl!, 'Font');
      if (!got.ok) return { ok: false, error: got.error, ...(got.code ? { code: got.code } : {}) };
      return await addFace(
        {
          bytes: got.bytes,
          fileName: got.fileName,
          family: input.family,
          weight,
          style: input.style,
          fallback,
          licenseConfirmed: input.licenseConfirmed === true,
          licenseNote: input.licenseNote,
          dryRun: input.dryRun,
        },
        actor,
      );
    } catch (e) {
      if (e instanceof FontError) return { ...(e.extra ?? {}), ok: false, error: e.message, code: e.code };
      throw e;
    }
  },
};

export const FONT_TOOLS: ToolDef[] = [listFontsTool, uploadFontTool];
