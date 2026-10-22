import { NextResponse } from 'next/server';

/**
 * Tìm chung cho `Ctrl+K`: trang, loại nội dung, component — một lượt, một danh sách.
 *
 * ## Vì sao tìm ở SERVER, không nạp hết rồi lọc ở client
 *
 * Nạp hết là nạp mọi trang, mọi loại, mọi component vào bundle của mọi màn builder —
 * kể cả màn đăng nhập, và kể cả khi người dùng không bao giờ gõ `Ctrl+K`. Số lượng
 * cũng không đứng yên: bài viết sẽ vào đây ở lát sau, và một loại có 4000 bài thì
 * "lọc ở client" là một quyết định phải lật lại.
 *
 * ## Vì sao một route riêng thay vì dùng `/api/ai/tool`
 *
 * `list_pages` của tool MCP trả đúng dữ liệu này. Nhưng nó là **bề mặt cho agent**:
 * nó trả kèm `previewUrl`, `editUrl`, cờ `fixture`, và hình dạng của nó được quyết
 * định bởi thứ model cần đọc. Nối giao diện vào đó nghĩa là mỗi lần sửa mô tả cho
 * agent là một lần có thể làm hỏng palette — hai người dùng khác nhau trên một hợp
 * đồng.
 */

import { requireAuth } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Trần mỗi nhóm. Palette hiện được chừng này mà không phải cuộn. */
const PER_GROUP = 6;

export interface SearchHit {
  kind: 'page' | 'type' | 'component';
  id: string;
  title: string;
  /** Dòng phụ: đường dẫn, khoá, hoặc phân loại. */
  hint: string;
  href: string;
}

export async function GET(request: Request) {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();

  /*
   * `q` rỗng vẫn trả kết quả, không trả rỗng.
   *
   * Palette mở ra trống rồi chờ người gõ là một hộp không nói được nó tìm cái gì.
   * Vài dòng gần nhất trả lời câu đó bằng ví dụ — và với một site 6 trang thì đó
   * thường đã là toàn bộ câu trả lời.
   */
  const like = q ? { contains: q, mode: 'insensitive' as const } : undefined;

  const [pages, types, presets] = await Promise.all([
    prisma.page.findMany({
      where: {
        archivedAt: null,
        ...(like ? { OR: [{ title: like }, { slug: like }] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: PER_GROUP,
      select: { id: true, slug: true, title: true },
    }),
    prisma.collectionType.findMany({
      where: like ? { OR: [{ name: like }, { key: like }] } : {},
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      take: PER_GROUP,
      select: { key: true, name: true, namePlural: true },
    }),
    prisma.preset.findMany({
      where: like ? { OR: [{ name: like }, { key: like }] } : {},
      orderBy: { name: 'asc' },
      take: PER_GROUP,
      select: { id: true, name: true, category: true },
    }),
  ]);

  const hits: SearchHit[] = [
    ...pages.map((p) => ({
      kind: 'page' as const,
      id: p.id,
      title: p.title,
      hint: `/${p.slug}`,
      href: `/builder/${p.id}`,
    })),
    ...types.map((t) => ({
      kind: 'type' as const,
      id: t.key,
      title: t.namePlural || t.name,
      hint: t.key,
      href: `/builder/content/${t.key}`,
    })),
    ...presets.map((c) => ({
      kind: 'component' as const,
      id: c.id,
      title: c.name,
      hint: c.category,
      href: `/builder/components/${c.id}`,
    })),
  ];

  return NextResponse.json({ hits });
}
