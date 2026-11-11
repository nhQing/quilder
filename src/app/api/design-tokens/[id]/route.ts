import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

/**
 * Một design token: XOÁ (chỉ token tự tạo).
 *
 * Từng có thêm `PATCH` để sửa 12 token nền tảng từ màn Cài đặt. Gỡ ngày
 * 13/10/2026 cùng mục Nền tảng — lý do ở `lib/design/foundations.ts`. Token tĩnh
 * giờ chỉ sửa trong `src/styles/tokens.css`.
 *
 * ## Vì sao phải quét trước khi xoá
 *
 * Xoá token là xoá khai báo `:root`. Node nào còn `{ $token: 'tên' }` sẽ resolve
 * `var(--tên)` về rỗng, trình duyệt bỏ qua cả thuộc tính, và màu biến mất — KHÔNG
 * có lỗi, không có cảnh báo, không có gì trong log. Nếu node đó nằm ở một trang
 * ít ai mở thì lỗi sống rất lâu trước khi có người thấy.
 *
 * Nên quét trước, và từ chối kèm danh sách chỗ đang dùng.
 *
 * ## Quét cả bản nháp lẫn bản đang chạy
 *
 * Chỉ quét nháp là bỏ sót trường hợp nguy hiểm nhất: node đã bị gỡ khỏi nháp
 * nhưng release đang active vẫn dùng token đó. Xoá lúc ấy làm hỏng SITE THẬT
 * trong khi builder trông sạch sẽ. Phép quét (trang + component) nằm ở
 * `lib/fonts/usage.ts`, dùng chung với màn Font.
 *
 * ## Token của họ font
 *
 * Token `font-<slug>` thuộc một `FontFamily` chỉ được xoá cùng họ đó ở Cài đặt › Font
 * — xoá riêng token là để lại họ font không còn token nào trỏ tới.
 */

import { requireAuth } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { tokenUsage } from '@/lib/fonts/usage';
import { CUSTOM_TOKENS_TAG } from '@/lib/render/custom-tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const token = await prisma.token.findUnique({
    where: { id },
    select: { id: true, name: true, value: true, custom: true },
  });
  if (!token) return NextResponse.json({ error: 'Không tìm thấy biến' }, { status: 404 });

  if (token.name.startsWith('font-')) {
    const family = await prisma.fontFamily.findUnique({
      where: { slug: token.name.slice('font-'.length) },
      select: { id: true },
    });
    if (family) {
      return NextResponse.json(
        { error: `"${token.name}" thuộc họ font, xoá ở Cài đặt › Font.` },
        { status: 409 },
      );
    }
  }

  if (!token.custom) {
    // Token tĩnh sống trong tokens.css. Xoá hàng DB chỉ làm mất nó khỏi gợi ý
    // và khỏi validator, còn CSS vẫn khai báo — tức là biến thành một token
    // "tồn tại nhưng không chọn được", trạng thái tệ hơn cả hai đầu.
    return NextResponse.json(
      { error: `"${token.name}" là token gốc trong tokens.css, sửa ở file đó.` },
      { status: 400 },
    );
  }

  const used = await tokenUsage(token.name);
  if (used.pages.length || used.components.length) {
    const where = [
      used.pages.length ? `${used.pages.length} trang` : '',
      used.components.length ? `${used.components.length} component` : '',
    ].filter(Boolean);
    const names = [...used.pages, ...used.components].map((u) => u.title);
    return NextResponse.json(
      {
        error: `Còn ${where.join(', ')} đang dùng "${token.name}": ${names.join(', ')}. Đổi ở những chỗ đó trước.`,
        pages: used.pages,
        components: used.components,
      },
      { status: 409 },
    );
  }

  await prisma.token.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      userId: auth.sub,
      action: 'designToken.delete',
      targetType: 'Token',
      targetId: id,
      meta: { name: token.name, value: token.value },
    },
  });

  revalidateTag(CUSTOM_TOKENS_TAG);
  return NextResponse.json({ ok: true });
}

