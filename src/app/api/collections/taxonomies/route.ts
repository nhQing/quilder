import { NextResponse } from 'next/server';

/**
 * Danh mục: đọc danh sách theo loại, tạo mới.
 *
 * ## Vì sao GET nằm ở đây chứ không ở `/api/collections/[typeKey]/taxonomies`
 *
 * Danh mục là một bảng PHẲNG khoá theo `typeKey` (`@@unique([typeKey, key])`), không
 * phải một tài nguyên con của loại nội dung. `?typeKey=` phản ánh đúng điều đó, và nó
 * để ngỏ một lượt đọc không kèm loại về sau mà không phải đổi URL.
 *
 * Panel *Lặp theo* của Inspector cần nó cho ô "lọc theo danh mục cố định": một
 * `CollectionFilter` dạng `{ k: 'taxonomy', from: 'fixed', ids: [...] }` mang id cuid,
 * thứ không ai gõ tay được — nên ô đó bắt buộc phải có một danh sách để chọn, và
 * chính vì thiếu endpoint này mà nó đang là một dòng chú thích thay vì một ô chọn.
 */

import { requireAuth } from '@/lib/auth/guard';
import { createTaxonomy } from '@/lib/collections/taxonomy-write';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;

  const typeKey = new URL(request.url).searchParams.get('typeKey');
  if (!typeKey) {
    return NextResponse.json({ error: 'Thiếu tham số typeKey' }, { status: 400 });
  }

  const rows = await prisma.taxonomy.findMany({
    where: { typeKey },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { id: true, key: true, name: true, parentId: true, order: true },
  });

  /*
   * Đếm bằng MỘT `groupBy` chứ không bằng `_count` trên quan hệ.
   *
   * `_count: { entries: true }` đếm cả hàng `EntryTaxonomy` của entry đã lưu trữ — số
   * đó cao hơn số bài người dùng thấy trong bảng, và một con số không khớp với màn
   * bên cạnh làm người ta ngờ cả hai. Một `groupBy` là một truy vấn, không phải N.
   */
  const counts = await prisma.entryTaxonomy.groupBy({
    by: ['taxonomyId'],
    where: { entry: { typeKey, archivedAt: null } },
    _count: { entryId: true },
  });
  const byId = new Map(counts.map((c) => [c.taxonomyId, c._count.entryId]));

  return NextResponse.json({
    taxonomies: rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      parentId: r.parentId,
      order: r.order,
      entryCount: byId.get(r.id) ?? 0,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: { typeKey?: string; name?: string; parentId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await createTaxonomy({
    typeKey: body.typeKey ?? '',
    name: body.name ?? '',
    parentId: body.parentId,
    actorSub: auth.sub,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, taxonomy: result.taxonomy });
}
