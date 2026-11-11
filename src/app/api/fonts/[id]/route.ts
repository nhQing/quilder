import { NextResponse } from 'next/server';

/**
 * Sửa (`PATCH`) hoặc xoá hẳn (`DELETE`) một họ font (§10).
 *
 * Xoá cả họ là việc của admin và token service luôn bị từ chối (xem `requireAuth`);
 * sửa thì editor làm được. Luật chặn xoá khi còn dùng (`in_use`) nằm ở service.
 */

import { requireAuth } from '@/lib/auth/guard';
import { fontErrorResponse, resolveFallback } from '@/lib/fonts/http';
import { deleteFamily, updateFamily } from '@/lib/fonts/service';
import { MAX_LICENSE_NOTE } from '@/lib/fonts/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Thân JSON không hợp lệ' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Thân JSON không hợp lệ' }, { status: 400 });
  }

  const patch: { cssName?: string; fallback?: string; licenseNote?: string | null } = {};
  for (const k of ['cssName', 'fallback', 'licenseNote'] as const) {
    const v = body[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' && !(k === 'licenseNote' && v === null)) {
      return NextResponse.json({ error: `"${k}" phải là chuỗi` }, { status: 400 });
    }
    if (k === 'licenseNote' && typeof v === 'string' && v.length > MAX_LICENSE_NOTE) {
      return NextResponse.json({ error: `Ghi chú giấy phép tối đa ${MAX_LICENSE_NOTE} ký tự.` }, { status: 422 });
    }
    if (k === 'fallback') patch.fallback = resolveFallback(v as string);
    else if (k === 'cssName') patch.cssName = v as string;
    else patch.licenseNote = v as string | null;
  }

  try {
    await updateFamily(id, patch, { email: auth.email, sub: auth.sub });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fontErrorResponse(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    await deleteFamily(id, { email: auth.email, sub: auth.sub });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fontErrorResponse(e);
  }
}
