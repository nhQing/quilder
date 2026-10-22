import { NextResponse } from 'next/server';

/**
 * Bảng endpoint của form: `Site.globals.endpoint` (khoá → URL).
 *
 * Route riêng, không gộp vào `PATCH /api/settings`: hai form trên màn Cài đặt lưu độc
 * lập, nên mỗi form chỉ được ghi đúng phần của mình — xem `updateSiteEndpoints`.
 *
 * `admin`, cùng lý do với `globals`: đây là nơi dữ liệu khách nhập vào form được gửi
 * tới. GET trả bảng hiện tại kèm form nào dùng khoá nào.
 */

import { requireAuth } from '@/lib/auth/guard';
import {
  endpointUsage,
  formEndpointAction,
  updateSiteEndpoints,
  type FormEndpointAction,
} from '@/lib/builder/site-settings';
import { prisma } from '@/lib/db';
import { readEndpointTable, type EndpointTable } from '@/lib/doc/endpoint-table';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const site = await prisma.site.findFirst({ select: { globals: true } });
  const endpoints = readEndpointTable((site?.globals ?? {}) as Record<string, unknown>);
  return NextResponse.json({ ok: true, endpoints, usage: await endpointUsage() });
}

export async function PATCH(request: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  let body: { endpoints?: EndpointTable; renames?: Record<string, string>; force?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }
  if (body.renames !== undefined && (typeof body.renames !== 'object' || body.renames === null || Array.isArray(body.renames))) {
    return NextResponse.json({ error: 'renames phải là object khoá cũ → khoá mới' }, { status: 400 });
  }

  const result = await updateSiteEndpoints({
    session: auth,
    endpoints: body.endpoints as EndpointTable,
    renames: body.renames,
    force: body.force,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.inUseEndpoints ? { inUse: result.inUseEndpoints } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    moved: result.moved ?? 0,
    note:
      'Đã lưu. Bản xem nháp dùng ngay; site thật đổi khi bấm Publish (globals niêm phong theo release).' +
      (result.moved ? ` ${result.moved} form đã chuyển sang khoá mới trong bản nháp.` : ''),
  });
}

/**
 * Một hành động trên MỘT form — các nút trong box của form ở màn Cài đặt
 * (`setUrl` | `split` | `rename` | `removeKey`). Xem `formEndpointAction`.
 */
export async function POST(request: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  let body: FormEndpointAction;
  try {
    body = (await request.json()) as FormEndpointAction;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }
  if (!body || !['setUrl', 'split', 'rename', 'removeKey'].includes((body as { action?: string }).action ?? '')) {
    return NextResponse.json({ error: 'action phải là setUrl | split | rename | removeKey' }, { status: 400 });
  }

  const result = await formEndpointAction(auth, body);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.inUseEndpoints ? { inUse: result.inUseEndpoints } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, ...(result.key ? { key: result.key } : {}) });
}
