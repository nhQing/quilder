import { NextResponse } from 'next/server';

/** Sửa / xoá một view của API công khai. Chỉ admin — xem route tạo. */

import { requireAuth } from '@/lib/auth/guard';
import { deleteApiView, saveApiView } from '@/lib/collections/api-view-store';
import { readViewBody } from '../body';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * `PUT` chứ không `PATCH`: màn quản lý gửi LẠI cả view mỗi lần lưu, và một view là một
 * khối — đổi `typeKey` mà giữ `query` của loại cũ là một view hỏng.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const body = await readViewBody(request);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });

  const { id } = await params;
  const result = await saveApiView({ id, input: body.input, note: body.note, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, view: result.view });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const result = await deleteApiView({ id, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
