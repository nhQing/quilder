import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

/**
 * Tải `server.mjs` để cắm vào Claude Desktop.
 *
 * Tồn tại vì luồng thật là: deploy lên abc.com → đăng nhập từ một máy bất kỳ →
 * lấy token. Máy đó không có repo, nên không có file để trỏ tới trong cấu hình.
 *
 * Đọc file gốc thay vì nhúng chuỗi vào code: nhúng chuỗi nghĩa là có hai bản
 * server MCP, và bản trong trang tải sẽ là bản quên cập nhật.
 */

import { requireAuth } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // `write`: ai cấp được token (editor, admin) đều cần file này để cắm vào Claude Desktop.
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  try {
    // `process.cwd()` là gốc dự án ở dev và gốc standalone ở production; cả hai
    // đều chứa thư mục mcp/ (xem `outputFileTracingIncludes` trong next.config).
    const file = path.join(process.cwd(), 'mcp', 'server.mjs');
    const source = await readFile(file, 'utf8');

    return new NextResponse(source, {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'content-disposition': 'attachment; filename="quilder-mcp-server.mjs"',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Không đọc được mcp/server.mjs trên server.' },
      { status: 500 },
    );
  }
}
