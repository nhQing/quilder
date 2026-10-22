import { NextResponse } from 'next/server';

/**
 * Lời dặn (`instructions`) và prompt MCP, phục vụ cho `mcp/server.mjs`.
 *
 *   GET  → { guideVersion, instructions, prompts: [meta] }   — lúc `initialize` / `prompts/list`
 *   POST → { prompt, arguments }  →  { description, text }   — lúc `prompts/get`
 *
 * Xem `src/lib/ai/guide.ts` cho lý do chúng nằm ở đây thay vì cứng trong server.mjs. Chỉ là chữ,
 * không chạm dữ liệu, nên quyền `read` là đủ.
 */

import { requireAuth } from '@/lib/auth/guard';
import { guide, renderPrompt } from '@/lib/ai/guide';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(guide(), { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;

  let body: { prompt?: unknown; arguments?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON không hợp lệ' }, { status: 400 });
  }
  if (typeof body.prompt !== 'string') {
    return NextResponse.json({ ok: false, error: 'Thiếu tên prompt' }, { status: 400 });
  }
  const args =
    body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
      ? (body.arguments as Record<string, unknown>)
      : {};

  const r = renderPrompt(body.prompt, args);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, description: r.description, text: r.text });
}
