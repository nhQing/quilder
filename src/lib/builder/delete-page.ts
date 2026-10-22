import 'server-only';

/**
 * Lưu trữ, khôi phục, và xoá hẳn một trang.
 *
 * ## Vì sao "xoá" mặc định là LƯU TRỮ
 *
 * Cùng luật với `archiveEntry`, và cùng lý do: bên gọi là một cú bấm trong giao diện.
 * Nếu mặc định là xoá hẳn thì lần đầu ai đó bấm nhầm sẽ mất một trang thật cùng toàn
 * bộ lịch sử chỉnh sửa của nó — và họ chỉ biết mình bấm nhầm sau khi đã mất.
 *
 * `archivedAt` là cột đã có, và mọi truy vấn của builder lẫn của renderer đều đã lọc
 * `archivedAt: null`. Nên lưu trữ không cần một dòng code nào ở phía đọc.
 *
 * ## Trang ĐÃ TỪNG PUBLISH: gỡ khỏi release cũ rồi mới xoá (đổi ngày 21/10/2026)
 *
 * `ReleaseEntry.versionId` trỏ tới `PageVersion` và KHÔNG cascade — bất biến "release
 * là một ảnh chụp bất biến" cắm xuống tầng database. Trước 21/10/2026 hàm này vì thế
 * TỪ CHỐI xoá hẳn trang đã publish, và trang đó nằm lại trong DB mãi mãi: hàng `Page`,
 * mọi `PageVersion` (mỗi bản là nguyên cây doc), mọi bản dịch.
 *
 * Từ chối là bảo vệ một thứ không còn tồn tại. `loadFromRelease` trả `null` cho trang
 * có `archivedAt` ở MỌI release, kể cả release cũ và cả màn "xem bản cũ" — nên từ lúc
 * trang vào lưu trữ, không lần lùi nào còn hiện được nó nữa. Gỡ hàng `ReleaseEntry` của
 * nó không đổi gì người đọc thấy: lùi về một bản cũ, đường dẫn đó vẫn 404 như ngay bây
 * giờ. Thứ mất đi duy nhất là dòng "release X từng chứa trang này", và `AuditLog` giữ
 * lại slug, tiêu đề, số release đã gỡ.
 *
 * Hàng `ReleaseEntry` bị xoá TRONG cùng transaction với trang: xoá chúng trước rồi lỗi
 * giữa chừng thì release cũ mất trang mà trang vẫn còn — một nửa thao tác không ai
 * gọi tên được.
 *
 * ## Vì sao xoá hẳn đòi trang đã ở trong lưu trữ
 *
 * Hai bước, hai cú bấm, mỗi cú một hậu quả gọi được tên — cùng khuôn với
 * `EntryDangerBox`. Một thao tác không lùi được thì không được nằm cách một cú bấm.
 */

import { revalidateTag } from 'next/cache';

import { prisma } from '@/lib/db';
import { REDIRECTS_TAG } from '@/lib/render/redirects';

export type PageDeleteResult =
  | { ok: true; archived: true; slug: string }
  | { ok: true; purged: true; slug: string; versions: number; redirects: number; releases: number }
  | { ok: true; restored: true; slug: string }
  | { ok: false; status: number; error: string };

async function loadPage(pageId: string) {
  return prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, slug: true, title: true, archivedAt: true, fixture: true, system: true },
  });
}

export async function archivePage(args: {
  pageId: string;
  actorSub: string;
}): Promise<PageDeleteResult> {
  const page = await loadPage(args.pageId);
  if (!page) return { ok: false, status: 404, error: 'Không có trang này' };
  if (page.archivedAt) return { ok: true, archived: true, slug: page.slug };

  /*
   * Trang đồ gá của test không lưu trữ được.
   *
   * `/gioi-thieu` là chỗ thao tác của 12 spec e2e. Lưu trữ nó làm cả 12 spec đỏ cùng
   * lúc, và người gây ra sẽ đi tìm nguyên nhân ở chỗ khác — xem docblock `Page.fixture`.
   */
  if (page.fixture) {
    return {
      ok: false,
      status: 409,
      error: `"${page.title}" là trang đồ gá của test e2e, không xoá được. Xem cờ Page.fixture.`,
    };
  }

  /*
   * Trang hệ thống (404) không lưu trữ được: site luôn phải có đúng một trang 404 để
   * sửa. Muốn đổi nội dung thì sửa nó; xoá đi thì lần cài đặt hay bootstrap kế tiếp
   * cũng sẽ tạo lại một trang mới (`ensureSiteDefaults`).
   */
  if (page.system) {
    return { ok: false, status: 409, error: `"${page.title}" là trang hệ thống, không xoá được.` };
  }

  await prisma.$transaction([
    prisma.page.update({ where: { id: page.id }, data: { archivedAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'page.archive',
        targetType: 'Page',
        targetId: page.id,
        meta: { slug: page.slug, title: page.title },
      },
    }),
  ]);

  /*
   * Trang có thể là một MẪU, và `listPageTemplates` đã cache bảng định tuyến dưới tag
   * 'release'. Không xoá tag thì mẫu vừa lưu trữ còn phục vụ URL công khai tới một
   * giờ — trong khi builder đã hiện là nó biến mất.
   */
  revalidateTag('release');
  return { ok: true, archived: true, slug: page.slug };
}

export async function unarchivePage(args: {
  pageId: string;
  actorSub: string;
}): Promise<PageDeleteResult> {
  const page = await loadPage(args.pageId);
  if (!page) return { ok: false, status: 404, error: 'Không có trang này' };
  if (!page.archivedAt) return { ok: true, restored: true, slug: page.slug };

  // Slug có thể đã bị một trang khác chiếm trong lúc trang này nằm trong lưu trữ:
  // `@@unique([siteId, slug])` không loại trừ hàng đã lưu trữ, nên thật ra không thể
  // — nhưng nói ra ở đây để người sửa sau không đi tìm phép kiểm đó.
  await prisma.$transaction([
    prisma.page.update({ where: { id: page.id }, data: { archivedAt: null } }),
    prisma.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'page.unarchive',
        targetType: 'Page',
        targetId: page.id,
        meta: { slug: page.slug, title: page.title },
      },
    }),
  ]);

  revalidateTag('release');
  return { ok: true, restored: true, slug: page.slug };
}

export async function purgePage(args: {
  pageId: string;
  actorSub: string;
}): Promise<PageDeleteResult> {
  const page = await loadPage(args.pageId);
  if (!page) return { ok: false, status: 404, error: 'Không có trang này' };

  if (!page.archivedAt) {
    return {
      ok: false,
      status: 409,
      error: 'Đưa trang vào lưu trữ trước, rồi mới xoá hẳn được.',
    };
  }

  const [versions, redirects, releases] = await prisma.$transaction([
    prisma.pageVersion.count({ where: { pageId: page.id } }),
    prisma.redirect.count({ where: { pageId: page.id } }),
    prisma.releaseEntry.count({ where: { pageId: page.id } }),
  ]);

  await prisma.$transaction([
    // Gỡ con trỏ nháp TRƯỚC: `Page.draftVersionId` là khoá ngoại trỏ vào `PageVersion`,
    // và để nguyên thì thứ tự xoá phụ thuộc cách database dọn cascade.
    prisma.page.update({ where: { id: page.id }, data: { draftVersionId: null } }),
    // Gỡ trang khỏi ảnh chụp của release cũ — xem docblock đầu file. Phải đứng TRƯỚC
    // `page.delete`: khoá ngoại `ReleaseEntry.versionId` không cascade, nên còn một hàng
    // là cascade `Page → PageVersion` bị chặn và cả transaction lùi lại.
    prisma.releaseEntry.deleteMany({ where: { pageId: page.id } }),
    // Redirect không có khoá ngoại tới Page (cột `pageId` trần), nên nó KHÔNG tự đi
    // theo. Để lại thì site còn chuyển hướng tới một địa chỉ không còn trang nào.
    prisma.redirect.deleteMany({ where: { pageId: page.id } }),
    prisma.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'page.purge',
        targetType: 'Page',
        targetId: page.id,
        meta: { slug: page.slug, title: page.title, versions, redirects, releases },
      },
    }),
    // `PageVersion` và `Translation` cascade theo schema.
    prisma.page.delete({ where: { id: page.id } }),
  ]);

  revalidateTag('release');
  if (redirects) revalidateTag(REDIRECTS_TAG);

  return { ok: true, purged: true, slug: page.slug, versions, redirects, releases };
}
