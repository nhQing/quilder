import { NextResponse } from 'next/server';

/**
 * Bề mặt HTTP cho bộ tool AI.
 *
 *   GET  → danh mục tool kèm JSON Schema
 *   POST → chạy một tool
 *
 * MCP server (mcp/server.ts) là một vỏ mỏng quanh đúng hai endpoint này. Nó cố ý
 * KHÔNG import gì từ `src/` — nếu nó import thì phải kéo theo alias `@/`,
 * `server-only` và một connection pool Prisma thứ hai vào một tiến trình chạy
 * ngoài Next. Đi qua HTTP thì mọi phép kiểm quyền, mọi tầng validator và mọi
 * dòng AuditLog chỉ tồn tại đúng một bản.
 *
 * Cái giá: builder phải đang chạy. Với công cụ này thì đó không phải cái giá
 * thật — muốn xem trang mình vừa sửa thì server phải chạy sẵn rồi.
 */

import { requireAuth } from '@/lib/auth/guard';
import { contractHash, MIN_MCP_CLIENT } from '@/lib/ai/contract';
import { toolInputSchema } from '@/lib/ai/json-schema';
import { runTool, TOOL_BY_NAME, TOOLS } from '@/lib/ai/tools';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Trần tần suất, tính theo token chứ không theo IP.
 *
 * Tool ghi chặt hơn hẳn tool đọc: mỗi lời gọi `apply_ops` tạo một `PageVersion`,
 * nên một vòng lặp mất kiểm soát sẽ bơm phình bảng đó chứ không chỉ tốn CPU.
 * Con số đặt cao hơn nhiều so với nhịp làm việc thật của một người — nó là hàng
 * rào chống chạy loạn, không phải hạn mức sử dụng.
 */
const READ_LIMIT = { limit: 240, windowMs: 60_000 };
const WRITE_LIMIT = { limit: 40, windowMs: 60_000 };

/**
 * Hash hợp đồng của bộ tool, tính MỘT lần mỗi tiến trình — registry là code, chỉ đổi
 * khi deploy. Gắn vào mọi response (`x-mm-contract`) để `mcp/server.mjs` biết khi nào
 * builder vừa deploy bộ tool mới. Xem `src/lib/ai/contract.ts`.
 */
let cachedContract: string | null = null;
const contract = () => (cachedContract ??= contractHash(TOOLS));

/**
 * Bản `mcp/server.mjs` quá cũ thì trả 426 với một câu bảo tải lại — thay vì để nó gọi
 * theo hợp đồng cũ rồi hỏng khó hiểu. Bản không gửi header là bản trước 08/10/2026,
 * tính là 1.
 */
function clientTooOld(request: Request): NextResponse | null {
  const version = Number(request.headers.get('x-mm-client') ?? '1');
  if (Number.isFinite(version) && version >= MIN_MCP_CLIENT) return null;
  return NextResponse.json(
    {
      ok: false,
      error:
        'Bản mcp/server.mjs trên máy này đã cũ so với builder. Tải bản mới ở ' +
        '/builder/claude rồi khởi động lại Claude.',
    },
    { status: 426, headers: { 'x-mm-contract': contract() } },
  );
}

/** Danh mục tool. Deterministic — cùng code sinh cùng bytes, để cache prompt được. */
export async function GET(request: Request) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  const old = clientTooOld(request);
  if (old) return old;

  return NextResponse.json({
    contractHash: contract(),
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      readOnly: tool.readOnly,
      inputSchema: toolInputSchema(tool),
    })),
  }, { headers: { 'x-mm-contract': contract() } });
}

interface Body {
  tool?: string;
  input?: unknown;
}

/**
 * Gốc URL công khai, để tool trả về link bấm được.
 *
 * Đường dẫn tương đối chỉ dùng được khi client cùng gốc. Khi builder ở abc.com
 * còn Claude Desktop ở máy khác, `"/preview/abc"` là một chuỗi vô dụng — người
 * dùng cần một link mở được.
 *
 * Ưu tiên `PUBLIC_URL` vì sau reverse proxy thì Host header có thể là tên nội bộ.
 */
function origin(request: Request): string {
  const configured = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  if (configured) return configured;

  const headers = request.headers;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  const proto = headers.get('x-forwarded-proto') ?? 'http';
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

export async function POST(request: Request) {
  const old = clientTooOld(request);
  if (old) return old;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const name = body.tool;
  if (!name) return NextResponse.json({ error: 'Thiếu tên tool' }, { status: 400 });

  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return NextResponse.json({ error: `Không có tool "${name}"` }, { status: 404 });

  // Quyền theo TỪNG tool, không theo endpoint. Tool đọc cần 'read', tool ghi cần
  // 'write' — nếu gộp thành một mức cho cả endpoint thì tài khoản viewer sẽ mất
  // luôn quyền đọc, hoặc tệ hơn theo chiều ngược lại.
  const auth = await requireAuth(tool.readOnly ? 'read' : 'write');
  if (auth instanceof NextResponse) return auth;

  // Tính theo jti của token, không theo IP: nhiều người sau một NAT sẽ bị gộp
  // chung, còn một token lộ thì đổi IP là thoát. Phiên trình duyệt tính theo
  // userId — cũng là một danh tính ổn định.
  const { limit, windowMs } = tool.readOnly ? READ_LIMIT : WRITE_LIMIT;
  const quota = rateLimit(`tool:${auth.jti ?? auth.sub}:${tool.readOnly}`, limit, windowMs);
  if (!quota.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Vượt trần tần suất (${limit} lượt/phút). Thử lại sau ${quota.retryAfter} giây.`,
      },
      { status: 429, headers: { 'retry-after': String(quota.retryAfter) } },
    );
  }

  try {
    const result = await runTool(name, body.input, { session: auth, origin: origin(request) });
    return NextResponse.json({ ok: true, result }, { headers: { 'x-mm-contract': contract() } });
  } catch (error) {
    // Lỗi trả về 200 với ok:false chứ không phải mã lỗi HTTP: bên gọi là một
    // model, và thứ nó cần là một thông điệp đọc được để thử lại — không phải
    // một status code khiến vỏ MCP ném exception rồi cắt luôn lượt.
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { headers: { 'x-mm-contract': contract() } });
  }
}
