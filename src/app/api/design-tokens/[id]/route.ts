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
 * trong khi builder trông sạch sẽ.
 */

import { requireAuth } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { CUSTOM_TOKENS_TAG } from '@/lib/render/custom-tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Trang nào còn dùng token này.
 *
 * Tìm trên chuỗi JSON thô chứ không duyệt cây: `$token` chỉ xuất hiện đúng trong
 * `TokenRef`, nên chuỗi `"$token":"tên"` không thể khớp nhầm thứ khác. Duyệt cây
 * sẽ phải biết trước MỌI chỗ một TokenRef có thể nằm (style, mọi lớp breakpoint,
 * prop của node, shadow…), và mỗi field mới thêm sau này là một chỗ quên.
 */
async function pagesUsing(name: string): Promise<string[]> {
  const site = await prisma.site.findFirst({ select: { id: true, activeReleaseId: true } });
  if (!site) return [];

  const pages = await prisma.page.findMany({
    where: { siteId: site.id, archivedAt: null },
    select: { id: true, title: true, slug: true, draftVersionId: true },
  });

  const live = site.activeReleaseId
    ? await prisma.releaseEntry.findMany({
        where: { releaseId: site.activeReleaseId },
        select: { pageId: true, versionId: true },
      })
    : [];
  const liveByPage = new Map(live.map((e) => [e.pageId, e.versionId]));

  const versionIds = new Set<string>();
  const pageOfVersion = new Map<string, { title: string; slug: string }>();
  for (const p of pages) {
    for (const vid of [p.draftVersionId, liveByPage.get(p.id)]) {
      if (!vid) continue;
      versionIds.add(vid);
      pageOfVersion.set(vid, { title: p.title, slug: p.slug });
    }
  }
  if (!versionIds.size) return [];

  const versions = await prisma.pageVersion.findMany({
    where: { id: { in: [...versionIds] } },
    select: { id: true, doc: true },
  });

  const needle = `"$token":"${name}"`;
  const hits = new Set<string>();
  for (const v of versions) {
    // JSON.stringify của Prisma Json không chèn khoảng trắng, nên dạng compact
    // ở trên là dạng duy nhất cần tìm.
    if (JSON.stringify(v.doc).includes(needle)) {
      const p = pageOfVersion.get(v.id);
      if (p) hits.add(`${p.title} (/${p.slug})`);
    }
  }
  return [...hits];
}

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

  if (!token.custom) {
    // Token tĩnh sống trong tokens.css. Xoá hàng DB chỉ làm mất nó khỏi gợi ý
    // và khỏi validator, còn CSS vẫn khai báo — tức là biến thành một token
    // "tồn tại nhưng không chọn được", trạng thái tệ hơn cả hai đầu.
    return NextResponse.json(
      { error: `"${token.name}" là token gốc trong tokens.css, sửa ở file đó.` },
      { status: 400 },
    );
  }

  const used = await pagesUsing(token.name);
  if (used.length) {
    return NextResponse.json(
      {
        error: `Còn ${used.length} trang đang dùng "${token.name}": ${used.join(', ')}. Đổi màu ở những chỗ đó trước.`,
        pages: used,
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

