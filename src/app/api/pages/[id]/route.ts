import { NextResponse } from 'next/server';

/**
 * Đổi tiêu đề / đường dẫn của một trang.
 *
 * Vỏ HTTP mỏng quanh `renamePage()` — luật, redirect và AuditLog nằm ở đó, vì tool
 * MCP `update_page` gọi đúng hàm ấy. Cùng khuôn "một hàm, hai vỏ" như `createPage`.
 */

import { requireAuth } from '@/lib/auth/guard';
import { archivePage, purgePage, unarchivePage } from '@/lib/builder/delete-page';
import type { PageCollection } from '@/lib/builder/page-collection';
import { renamePage } from '@/lib/builder/rename-page';
import { setPageSeo } from '@/lib/builder/set-page-seo';
import { parseCollectionInput, setPageCollection } from '@/lib/builder/set-page-collection';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  let body: {
    title?: string;
    slug?: string;
    collection?: unknown;
    description?: string | null;
    ogImageId?: string | null;
    canonical?: string | null;
    noindex?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const wantsCollection = 'collection' in body;
  /*
   * Metadata SEO tách hẳn khỏi nhánh tiêu đề/slug/collection.
   *
   * Ba thứ kia ràng buộc lẫn nhau (xem ghi chú dưới) nên chúng phải đi cùng một
   * lượt kiểm. Bốn cột SEO thì độc lập với cả ba, và gộp chúng vào cùng nhánh là
   * buộc một lần sửa mô tả phải đi qua `renamePage` — nơi có luật redirect và
   * luật ghép slug–collection, không liên quan gì.
   */
  const SEO_KEYS = ['description', 'ogImageId', 'canonical', 'noindex'] as const;
  const wantsSeo = SEO_KEYS.some((k) => k in body);

  if (body.title === undefined && body.slug === undefined && !wantsCollection && !wantsSeo) {
    return NextResponse.json(
      { error: 'Cần "title", "slug", "collection", hoặc một trường SEO' },
      { status: 400 },
    );
  }

  if (wantsSeo) {
    const seo = await setPageSeo({
      pageId: id,
      input: {
        ...('description' in body ? { description: body.description ?? null } : {}),
        ...('ogImageId' in body ? { ogImageId: body.ogImageId ?? null } : {}),
        ...('canonical' in body ? { canonical: body.canonical ?? null } : {}),
        ...(body.noindex !== undefined ? { noindex: body.noindex } : {}),
      },
      actorSub: auth.sub,
    });
    if (!seo.ok) return NextResponse.json({ error: seo.error }, { status: seo.status });
    // Chỉ sửa SEO thì xong ở đây. Gửi kèm tiêu đề/slug thì đi tiếp xuống dưới —
    // hai việc rời nhau, không phải một việc.
    if (body.title === undefined && body.slug === undefined && !wantsCollection) {
      return NextResponse.json({ ok: true, seo: seo.seo });
    }
  }

  /*
   * Slug và `collection` phải khớp nhau, nên đổi RIÊNG từng cái sẽ kẹt ở cả hai chiều:
   * đặt `param:'taxonomy'` trước khi slug có `[..]` thì hỏng, mà đổi slug thành
   * `blogs/[category]` trước khi khai vai cũng hỏng. Không có thứ tự nào cứu được.
   *
   * Nên `renamePage` nhận lời khai SẮP TỚI và kiểm cặp với nó, chứ không với lời khai
   * còn trong DB. Hai lượt ghi vẫn nối tiếp, nhưng cả hai đều đã được kiểm theo trạng
   * thái cuối cùng — không có bước trung gian nào bị từ chối vì một nửa của cùng một
   * thay đổi chưa xảy ra.
   */
  let nextCollection: PageCollection | null | undefined;
  if (wantsCollection) {
    const parsed = parseCollectionInput(body.collection);
    if (parsed && 'error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    nextCollection = parsed;
  }

  if (body.title !== undefined || body.slug !== undefined) {
    const result = await renamePage({
      pageId: id,
      title: body.title,
      slug: body.slug,
      collection: nextCollection,
      actorSub: auth.sub,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (wantsCollection) {
      const set = await setPageCollection({
        pageId: id,
        collection: nextCollection ?? null,
        actorSub: auth.sub,
      });
      if (!set.ok) return NextResponse.json({ error: set.error }, { status: set.status });
    }

    return NextResponse.json({
      ok: true,
      page: result.page,
      redirected: result.redirected,
      note: result.note,
      ...(wantsCollection ? { collection: nextCollection ?? null } : {}),
    });
  }

  const set = await setPageCollection({
    pageId: id,
    collection: nextCollection ?? null,
    actorSub: auth.sub,
  });
  if (!set.ok) return NextResponse.json({ error: set.error }, { status: set.status });
  return NextResponse.json({ ok: true, collection: set.collection });
}

/**
 * DELETE = LƯU TRỮ, không phải xoá hẳn.
 *
 * `?purge=1` mới là xoá hẳn, và nó chỉ chạy với trang đã ở trong lưu trữ; trang đã
 * publish thì bị gỡ khỏi release cũ trước — luật nằm trong `purgePage`, không ở đây.
 * `?restore=1` bỏ lưu trữ.
 *
 * Cùng hình dạng với `DELETE /api/collections/entries/:id`. Hai endpoint xoá mà một
 * cái mặc định an toàn, một cái mặc định huỷ là cách chắc chắn để có ngày ai đó gọi
 * nhầm cái thứ hai.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const sp = new URL(request.url).searchParams;

  const result =
    sp.get('purge') === '1'
      ? await purgePage({ pageId: id, actorSub: auth.sub })
      : sp.get('restore') === '1'
        ? await unarchivePage({ pageId: id, actorSub: auth.sub })
        : await archivePage({ pageId: id, actorSub: auth.sub });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
