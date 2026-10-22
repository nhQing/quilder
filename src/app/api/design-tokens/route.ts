import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

/**
 * Biến màu do người dùng tạo trong builder.
 *
 * ## Vì sao không nằm trong /api/tokens
 *
 * Đường đó là token SERVICE (MCP) — thông tin xác thực, chỉ admin, thu hồi được.
 * Đây là design token — nội dung, editor sửa được. Gộp hai thứ vào một route
 * nghĩa là hai mô hình quyền trong cùng một handler, và loại nhầm lẫn đó kết
 * thúc bằng việc cấp sai quyền cho một trong hai.
 *
 * ## Vì sao chỉ tạo và xoá, không sửa
 *
 * Đổi giá trị một token đang được N node dùng sẽ đổi cả N chỗ cùng lúc — đó là
 * điểm mạnh của token, nhưng cũng là một thao tác diện rộng KHÔNG đi qua hệ op,
 * nên không undo được và không để lại `PageVersion` để lùi. Chưa có đường lùi
 * thì chưa mở. Xoá thì an toàn hơn hẳn vì bị chặn khi còn node đang dùng.
 */

import { requireAuth } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import {
  CUSTOM_TOKENS_TAG,
  TOKEN_COLOR_RE,
  TOKEN_NAME_RE,
} from '@/lib/render/custom-tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const tokens = await prisma.token.findMany({
    where: { custom: true, deprecated: false },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, value: true, aiDescription: true },
  });
  return NextResponse.json({ tokens });
}

interface Body {
  name?: string;
  value?: string;
  description?: string;
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

  // Bỏ '--' đầu: người dùng quen viết `--brand-500` vì đó là dạng thấy trong
  // CSS, nhưng bảng lưu tên trần và `custom-tokens.ts` tự thêm '--' lúc phát.
  // Lưu cả hai dạng sẽ sinh ra `--(--brand-500)`.
  const name = (body.name ?? '').trim().replace(/^--/, '').toLowerCase();
  const value = (body.value ?? '').trim().toLowerCase();

  if (!TOKEN_NAME_RE.test(name)) {
    return NextResponse.json(
      {
        error:
          'Tên chỉ gồm chữ thường, số và dấu gạch ngang, bắt đầu bằng chữ. Ví dụ: "brand-500".',
      },
      { status: 400 },
    );
  }
  if (!TOKEN_COLOR_RE.test(value)) {
    return NextResponse.json(
      { error: 'Giá trị phải là hex, ví dụ "#0d1321".' },
      { status: 400 },
    );
  }

  // Trùng tên với token TĨNH là chuyện nguy hiểm nhất ở đây: khai báo tự tạo
  // được phát sau tokens.css nên nó sẽ THẮNG, âm thầm đổi màu ở mọi chỗ trong
  // toàn site đang dùng token gốc. Chặn thẳng, và nói rõ vì sao.
  const existing = await prisma.token.findUnique({
    where: { name },
    select: { custom: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: existing.custom
          ? `Đã có biến tên "${name}".`
          : `"${name}" là token gốc của design system. Đặt tên khác để không đè lên nó.`,
      },
      { status: 409 },
    );
  }

  const token = await prisma.token.create({
    data: {
      name,
      value,
      category: 'color',
      custom: true,
      aiDescription: (body.description ?? '').trim() || `Màu tự tạo trong builder: ${value}`,
    },
    select: { id: true, name: true, value: true, aiDescription: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: auth.sub,
      action: 'designToken.create',
      targetType: 'Token',
      targetId: token.id,
      meta: { name, value },
    },
  });

  // Không revalidate thì khai báo :root mới không xuất hiện, và node vừa gán
  // token sẽ hiện không màu cho tới lần cache hết hạn tự nhiên.
  revalidateTag(CUSTOM_TOKENS_TAG);

  return NextResponse.json({ ok: true, token });
}
