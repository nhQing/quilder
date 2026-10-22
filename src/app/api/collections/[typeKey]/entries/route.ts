import { NextResponse } from 'next/server';

/**
 * Tạo entry (POST) và liệt kê entry để CHỌN (GET).
 *
 * GET ở đây là bề mặt cho hai bộ chọn của màn nhập: field `relation` và khối "Tin
 * liên quan" ở sidebar. Nó KHÔNG phải API công khai (mốc 4, `/api/public/v1`) —
 * nó đòi session `read` và trả cả bài nháp, vì người soạn cần liên kết tới bài
 * mình chưa đăng.
 */

import { requireAuth } from '@/lib/auth/guard';
import { listAdminEntries } from '@/lib/collections/admin-queries';
import { createEntry } from '@/lib/collections/entry-write';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ typeKey: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { typeKey } = await params;

  let body: { data?: unknown; taxonomyIds?: string[] };
  try {
    body = (await request.json()) as { data?: unknown; taxonomyIds?: string[] };
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await createEntry({
    typeKey,
    data: body.data ?? {},
    taxonomyIds: body.taxonomyIds,
    actorEmail: auth.email,
    actorSub: auth.sub,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, entry: result.entry });
}

export async function GET(request: Request, { params }: { params: Promise<{ typeKey: string }> }) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;

  const { typeKey } = await params;
  const sp = new URL(request.url).searchParams;
  const q = sp.get('q') ?? undefined;
  // `ids=a,b`: tên của bài ĐÃ chọn, không phụ thuộc trang gợi ý (bài cũ nằm ngoài 100 bài
  // sửa gần nhất vẫn phải hiện tên). Trần 100 id một lần.
  const ids = sp.get('ids')?.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  // `limit`: bộ chọn chỉ cần vài gợi ý. Trần 100 và không phân trang: đây là nguồn cho một
  // bộ chọn, không phải cho một bảng — cần hơn thì gõ để tìm (`q`).
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 100));

  const { rows } = await listAdminEntries({
    typeKey, q, ids, page: 1, pageSize: ids ? ids.length || 1 : limit,
  });

  return NextResponse.json({
    ok: true,
    entries: rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, status: r.status })),
  });
}
