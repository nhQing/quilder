import { NextResponse } from 'next/server';

/**
 * Đổi TÁC GIẢ của một bài. Chỉ admin.
 *
 * ## Vì sao đường này phải tồn tại
 *
 * Từ 11/09/2026, `Entry.createdBy` là nội dung hiển thị ra site — byline trên thẻ
 * tin và trên trang bài. Trước đó nó là một dấu vết kỹ thuật, và "ai tạo hàng
 * này" thì đúng mãi mãi. Một thứ người đọc nhìn thấy thì không thể chỉ đúng vào
 * lúc hàng được tạo, vì có ba ca có thật:
 *
 *  1. Nhập bài cũ vào hệ thống — người bấm nút không phải người viết.
 *  2. Soạn hộ: trợ lý gõ, tác giả là người khác.
 *  3. Tác giả nghỉ việc, bài vẫn phải đứng đúng tên họ.
 *
 * Không có đường này thì ba ca ấy được chữa bằng cách sửa thẳng database, và một
 * thao tác không đi qua audit là một thao tác không ai đối chiếu lại được.
 *
 * ## Vì sao route RIÊNG chứ không một field trong `PATCH /entries/[id]`
 *
 * Route kia là `write`; route này là `admin`. Gộp lại thì hoặc cả route thành
 * admin (biên tập viên không sửa được bài nữa), hoặc quyền phải kiểm theo field —
 * một hình dạng mà chưa chỗ nào trong repo này dùng, và là chỗ mà một lần refactor
 * làm mất phép kiểm mà không có gì báo.
 *
 * ## Vì sao nhận EMAIL chứ không id
 *
 * Vì `createdBy` LÀ email (khoá ngoại tới `User.email` — xem `Entry.author`).
 * Nhận id rồi tra ra email là thêm một bước dịch cho đúng giá trị sắp ghi.
 *
 * Tài khoản ĐÃ KHOÁ vẫn nhận được: đó chính là ca 3 ở trên.
 */

import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';
import { revalidateCollection } from '@/lib/collections/cache';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) {
    return NextResponse.json({ error: 'Thiếu trường email' }, { status: 400 });
  }

  const entry = await prisma.entry.findUnique({
    where: { id },
    select: { id: true, typeKey: true, slug: true, createdBy: true },
  });
  if (!entry) return NextResponse.json({ error: 'Không có bài này' }, { status: 404 });

  /*
   * Kiểm tài khoản có thật TRƯỚC khi ghi, dù khoá ngoại cũng chặn.
   *
   * Khoá ngoại chặn bằng một lỗi Postgres mà route sẽ trả ra thành 500 — đúng
   * nhưng không đọc được. Ở đây nói thẳng email nào không có tài khoản.
   */
  const user = await prisma.user.findUnique({
    where: { email },
    select: { email: true, name: true, lockedAt: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: `Không có tài khoản nào dùng email ${email}` },
      { status: 400 },
    );
  }

  if (entry.createdBy === email) {
    return NextResponse.json({ ok: true, createdBy: email });
  }

  await prisma.$transaction(async (tx) => {
    // KHÔNG chạm `updatedBy`: đổi tác giả là một thao tác quản trị, không phải
    // một lần sửa nội dung. Ghi tên admin vào `updatedBy` sẽ làm bảng nội dung
    // nói rằng bài vừa được biên tập, và đẩy nó lên đầu danh sách "sửa gần nhất".
    await tx.entry.update({ where: { id }, data: { createdBy: email } });
    await tx.auditLog.create({
      data: {
        userId: auth.sub,
        action: 'entry.author',
        targetType: 'Entry',
        targetId: id,
        meta: { typeKey: entry.typeKey, slug: entry.slug, from: entry.createdBy, to: email },
      },
    });
  });

  revalidateCollection(entry.typeKey);

  return NextResponse.json({
    ok: true,
    createdBy: email,
    // Nói ra khi tác giả mới là tài khoản đã khoá: đó là ca hợp lệ (tác giả nghỉ
    // việc), nhưng người bấm nên thấy mình vừa làm đúng điều đó chứ không phải gõ
    // nhầm một email cũ.
    locked: user.lockedAt !== null,
  });
}
