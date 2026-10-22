import { NextResponse } from 'next/server';

/**
 * Component: liệt kê và tạo mới.
 *
 * `POST` là vỏ HTTP mỏng quanh `createComponent()` trong
 * `@/lib/builder/create-component`. Toàn bộ luật — hai đường tạo, sinh khoá duy
 * nhất, đặt tên bản sao, ghi audit — nằm ở đó, vì tool MCP `create_component` cũng
 * gọi đúng hàm ấy.
 *
 * Không chép luật vào đây. Hai bản của một luật sẽ trôi khỏi nhau, và bản ít được
 * nhớ tới là bản mà người sau đọc.
 */

import { requireAuth } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { createComponent } from '@/lib/builder/create-component';
import type { PresetTree } from '@/lib/doc/preset';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const rows = await prisma.preset.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: {
      id: true, key: true, name: true, category: true, aiDescription: true,
      builtin: true, updatedAt: true, tree: true,
      _count: { select: { versions: true } },
    },
  });

  return NextResponse.json({
    presets: rows.map((r) => {
      const tree = r.tree as unknown as PresetTree;
      return {
        id: r.id, key: r.key, name: r.name, category: r.category,
        aiDescription: r.aiDescription, builtin: r.builtin,
        updatedAt: r.updatedAt.toISOString(),
        nodeCount: Object.keys(tree.nodes ?? {}).length,
        versionCount: r._count.versions,
      };
    }),
  });
}

interface Body {
  name?: string;
  category?: string;
  aiDescription?: string;
  /** Id của component nguồn. Có thì đây là thao tác nhân bản. */
  from?: string;
}

export async function POST(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await createComponent({
    name: body.name,
    category: body.category,
    aiDescription: body.aiDescription,
    from: body.from,
    actorEmail: auth.email,
    actorSub: auth.sub,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, preset: result.preset });
}
