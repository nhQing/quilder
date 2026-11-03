import { NextResponse } from 'next/server';

/**
 * Component: xem, đổi thông tin, xoá.
 *
 * Cây node KHÔNG sửa ở đây — nó đi qua `[id]/ops`, để mọi thay đổi cấu trúc đều
 * qua cùng một validator và cùng một lịch sử version, dù đến từ builder hay từ AI.
 */

import { requireAuth } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { componentUsers } from '@/lib/builder/component-detail';
import { slugify } from '@/lib/builder/preset-key';
import type { PresetTree } from '@/lib/doc/preset';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const preset = await prisma.preset.findUnique({
    where: { id },
    select: {
      id: true, key: true, name: true, category: true, aiDescription: true,
      builtin: true, tree: true, createdAt: true, updatedAt: true,
      versions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, label: true, prompt: true, createdBy: true, createdAt: true },
      },
    },
  });
  if (!preset) return NextResponse.json({ error: 'Không tìm thấy component' }, { status: 404 });

  return NextResponse.json({ preset });
}

interface Body {
  name?: string;
  category?: string;
  aiDescription?: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const preset = await prisma.preset.findUnique({
    where: { id },
    select: { id: true, key: true, name: true },
  });
  if (!preset) return NextResponse.json({ error: 'Không tìm thấy component' }, { status: 404 });

  const data: { name?: string; category?: string; aiDescription?: string } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: 'Tên không được rỗng' }, { status: 400 });
    if (name.length > 80) return NextResponse.json({ error: 'Tên tối đa 80 ký tự' }, { status: 400 });

    const clash = await prisma.preset.findFirst({
      where: { name, NOT: { id } },
      select: { id: true },
    });
    if (clash) return NextResponse.json({ error: `Đã có component tên "${name}"` }, { status: 409 });
    data.name = name;
  }

  if (body.category !== undefined) {
    const category = slugify(body.category);
    // Danh mục chỉ để gom nhóm trong danh sách; không có danh sách cố định vì
    // ràng buộc nó sẽ chặn đúng lúc người dùng cần một nhóm mới.
    data.category = category;
  }

  if (body.aiDescription !== undefined) {
    const desc = body.aiDescription.trim();
    if (!desc) {
      // Mô tả là thứ AI đọc để chọn component. Rỗng nghĩa là AI không bao giờ
      // chọn được nó, và không có gì trên giao diện cho biết vì sao.
      return NextResponse.json(
        { error: 'Mô tả không được rỗng — đây là thứ AI đọc để biết khi nào dùng component này.' },
        { status: 400 },
      );
    }
    if (desc.length > 500) {
      return NextResponse.json({ error: 'Mô tả tối đa 500 ký tự' }, { status: 400 });
    }
    data.aiDescription = desc;
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: 'Không có gì để đổi' }, { status: 400 });
  }

  // `key` KHÔNG đổi theo tên.
  //
  // Nó là định danh ổn định mà `extract-presets.ts` upsert theo và AI gọi theo.
  // Đổi nó khi người dùng sửa chính tả một cái tên sẽ làm lần trích xuất sau tạo
  // một component thứ hai thay vì cập nhật cái đang có.
  const updated = await prisma.preset.update({
    where: { id },
    data,
    select: { id: true, key: true, name: true, category: true, aiDescription: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: auth.sub,
      action: 'preset.update',
      targetType: 'Preset',
      targetId: id,
      meta: { key: preset.key, changed: Object.keys(data) },
    },
  });

  return NextResponse.json({ ok: true, preset: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const preset = await prisma.preset.findUnique({
    where: { id },
    select: { id: true, key: true, name: true, builtin: true, tree: true },
  });
  if (!preset) return NextResponse.json({ error: 'Không tìm thấy component' }, { status: 404 });

  // Rào là "còn trang dùng", không phải "có sẵn".
  //
  // Trước 03/11/2026 component có sẵn bị chặn xoá vì "lần trích xuất sau tạo lại nó".
  // Nhưng không bước triển khai nào chạy trích xuất (bootstrap không đụng tới Preset),
  // nên rào đó chỉ để lại component nháp không ai dùng trong thư viện. Còn rào thật
  // thì thiếu: xoá component mà Instance trên trang còn trỏ tới làm khối đó biến mất
  // khỏi bản nháp, và lần publish kế đưa chỗ trống ra site.
  const users = await componentUsers(id);
  if (users.length) {
    return NextResponse.json(
      {
        error:
          `"${preset.name}" đang dùng ở ${users.length} trang: ${users.join(', ')}. `
          + 'Gỡ Instance của nó khỏi các trang đó trước rồi mới xoá.',
        pages: users,
      },
      { status: 409 },
    );
  }

  const tree = preset.tree as unknown as PresetTree;
  await prisma.preset.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      userId: auth.sub,
      action: 'preset.delete',
      targetType: 'Preset',
      targetId: id,
      // Ghi lại cả cây: xoá là thao tác duy nhất ở đây không lùi được bằng
      // version, nên audit log là bản sao cuối cùng còn lại.
      meta: { key: preset.key, name: preset.name, tree: tree as unknown as object },
    },
  });

  return NextResponse.json({ ok: true });
}
