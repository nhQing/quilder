import 'server-only';

/**
 * Đổi tiêu đề và/hoặc đường dẫn của một trang đã có.
 *
 * ## Vì sao đổi slug an toàn hơn trông thấy
 *
 * Render đi đường `Site.activeReleaseId → ReleaseEntry(slug) → PageVersion.doc`, và
 * `ReleaseEntry` có cột `slug` RIÊNG. Nên đổi `Page.slug` **không chạm site thật**:
 * địa chỉ cũ vẫn render trang cũ cho tới lần Publish tiếp theo, và lùi release là
 * lùi luôn slug. Đúng hợp đồng "máy dựng bản nháp, người bấm Publish" của cả dự án,
 * không cần thêm cơ chế nào.
 *
 * Hệ quả cho redirect: hàng `cũ → mới` được ghi NGAY tại đây, nhưng nó nằm im cho
 * tới lúc publish, vì route site chỉ tra redirect sau khi `getPublishedPage()` trả
 * null. Ghi sớm thay vì ghi lúc publish, để đường publish không phải biết gì về
 * việc đổi tên — nó vốn đã là đoạn code đông đúc nhất trong dự án.
 *
 * ## Vì sao KHÔNG tạo `PageVersion` mới
 *
 * Slug và tiêu đề nằm trên `Page`, không nằm trong `doc`. Tạo một version cho việc
 * đổi tên là làm bẩn lịch sử chỉnh sửa bằng những bản ghi không đổi một node nào —
 * đúng thứ mà dialog Lịch sử sinh ra để lọc bớt. AuditLog mới là chỗ của nó.
 */

import { revalidateTag } from 'next/cache';

import { prisma } from '@/lib/db';
import { REDIRECTS_TAG } from '@/lib/render/redirects';
import { getLocales } from '@/lib/i18n/queries';
import { planRedirects, type RedirectRow } from './redirect-plan';
import {
  checkCollectionPairing,
  parsePageCollection,
  type PageCollection,
} from './page-collection';
import { checkSlugShapeFree } from './set-page-collection';
import { checkSlugPath, toSlugPath } from './slug';

export type RenameResult =
  | {
      ok: true;
      page: { id: string; slug: string; title: string };
      /** Slug đã đổi và trang từng publish → có hàng redirect mới. */
      redirected: boolean;
      note: string;
    }
  | { ok: false; status: number; error: string };

export async function renamePage(args: {
  pageId: string;
  title?: string;
  /** `''` là trang chủ — KHÁC `undefined` nghĩa là "đừng đụng slug". */
  slug?: string;
  /**
   * Lời khai `collection` SẮP được ghi trong cùng lượt sửa này.
   *
   * `undefined` = không đổi, dùng lời khai đang có trong DB. Có mặt thì phép kiểm cặp
   * slug↔collection dùng giá trị này — nếu không, đổi cả hai cùng lúc sẽ kẹt: mỗi nửa
   * bị từ chối vì nửa kia chưa xảy ra.
   */
  collection?: PageCollection | null;
  actorSub: string;
}): Promise<RenameResult> {
  const page = await prisma.page.findUnique({
    where: { id: args.pageId },
    select: { id: true, siteId: true, slug: true, title: true, collection: true, archivedAt: true, system: true },
  });
  if (!page) return { ok: false, status: 404, error: 'Không có trang này' };
  if (page.archivedAt) {
    return { ok: false, status: 409, error: 'Trang đã lưu trữ. Khôi phục trước khi đổi tên.' };
  }

  const title = args.title === undefined ? page.title : args.title.trim();
  if (!title) return { ok: false, status: 400, error: 'Thiếu tiêu đề' };

  /*
   * `args.slug === undefined` là "giữ nguyên"; `''` là "đưa về trang chủ". Gộp hai
   * thứ đó lại là làm trang chủ không đổi tên được — cùng phân biệt mà
   * `validateNewPage` đã phải làm, và cùng lý do.
   */
  // `toSlugPath` chứ không `toSlug`: dấu `/` là ranh giới đoạn. Xem `validateNewPage`.
  const slug = args.slug === undefined ? page.slug : toSlugPath(args.slug);
  if (args.slug !== undefined && args.slug.trim() && !slug) {
    return {
      ok: false,
      status: 400,
      error: 'Đường dẫn không còn ký tự nào dùng được sau khi chuẩn hoá.',
    };
  }

  /*
   * Trang hệ thống (404) giữ slug: nó không mở bằng URL, nên slug chỉ là nhãn — đổi nó
   * không được gì, còn kéo theo một luật redirect từ slug cũ, tức mở lại đúng URL mà
   * catch-all đang chặn. Đổi TIÊU ĐỀ thì vẫn được.
   */
  if (page.system && slug !== page.slug) {
    return { ok: false, status: 409, error: 'Trang hệ thống không đổi được đường dẫn.' };
  }

  if (slug !== page.slug) {
    const localeCodes = (await getLocales()).map((l) => l.code);
    const bad = checkSlugPath(slug, { localeCodes });
    if (bad) return { ok: false, status: 400, error: bad };

    const badShape = await checkSlugShapeFree(slug, page.id);
    if (badShape) return { ok: false, status: 409, error: badShape };

    /*
     * Đổi slug có thể làm `collection` hiện tại trở nên vô nghĩa: một trang
     * `param:'entry'` mà slug mất đoạn động thì không bao giờ nhận được giá trị nào.
     * Kiểm CẶP ở đây thay vì để nó im lặng hỏng sau này.
     */
    const pairing = checkCollectionPairing(
      slug,
      args.collection !== undefined ? args.collection : parsePageCollection(page.collection),
    );
    if (pairing) return { ok: false, status: 409, error: pairing };
  }

  if (slug === page.slug && title === page.title) {
    return {
      ok: true,
      page: { id: page.id, slug, title },
      redirected: false,
      note: 'Không có gì đổi.',
    };
  }

  if (slug !== page.slug) {
    const taken = await prisma.page.findUnique({
      where: { siteId_slug: { siteId: page.siteId, slug } },
      select: { id: true },
    });
    if (taken) return { ok: false, status: 409, error: `Đường dẫn /${slug} đã có trang khác dùng` };
  }

  /*
   * "Từng publish" = từng có mặt trong một `ReleaseEntry` BẤT KỲ, không phải chỉ
   * release đang chạy. Một trang gỡ khỏi release hiện tại vẫn có thể còn link cũ
   * ngoài kia; đó chính là lúc redirect có giá trị nhất.
   */
  const wasPublished =
    slug !== page.slug &&
    // `ReleaseEntry` không có cột `id` — khoá chính là `@@id([releaseId, pageId])`.
    (await prisma.releaseEntry.findFirst({
      where: { pageId: page.id },
      select: { releaseId: true },
    })) !== null;

  const existing: RedirectRow[] =
    slug === page.slug
      ? []
      : await prisma.redirect.findMany({
          where: { siteId: page.siteId },
          select: { id: true, from: true, to: true },
        });

  const plan = planRedirects({
    oldSlug: page.slug,
    newSlug: slug,
    wasPublished,
    existing,
  });

  await prisma.$transaction([
    prisma.page.update({ where: { id: page.id }, data: { slug, title } }),

    ...(plan.remove.length
      ? [prisma.redirect.deleteMany({ where: { id: { in: plan.remove } } })]
      : []),

    ...plan.retarget.map((r) =>
      prisma.redirect.update({ where: { id: r.id }, data: { to: r.to } }),
    ),

    ...plan.create.map((r) =>
      prisma.redirect.create({
        data: { siteId: page.siteId, from: r.from, to: r.to, pageId: page.id },
      }),
    ),

    prisma.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'page.rename',
        targetType: 'Page',
        targetId: page.id,
        meta: {
          before: { slug: page.slug, title: page.title },
          after: { slug, title },
          redirects: {
            created: plan.create.length,
            retargeted: plan.retarget.length,
            removed: plan.remove.length,
          },
        },
      },
    }),
  ]);

  /*
   * Bảng redirect được bọc `unstable_cache`. Không xoá tag thì hàng vừa ghi chỉ có
   * hiệu lực sau khi cache tự hết hạn — và ở giữa, một địa chỉ cũ vẫn 404.
   */
  if (plan.create.length || plan.retarget.length || plan.remove.length) {
    revalidateTag(REDIRECTS_TAG);
  }

  const bits: string[] = [];
  if (slug !== page.slug) {
    bits.push(
      wasPublished
        ? `Địa chỉ cũ /${page.slug} sẽ chuyển hướng 301 sang /${slug} — nhưng chỉ SAU khi Publish. ` +
            'Tới lúc đó, site thật vẫn phục vụ địa chỉ cũ như bình thường.'
        : `Trang chưa từng publish nên không cần redirect cho /${page.slug}.`,
    );
  }
  if (title !== page.title) bits.push('Tiêu đề đã đổi.');

  return {
    ok: true,
    page: { id: page.id, slug, title },
    redirected: plan.create.length > 0,
    note: bits.join(' '),
  };
}
