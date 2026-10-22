import 'server-only';

/**
 * Đường ghi cho `Page.collection`, và bất biến hình dạng cho `Page.slug`.
 *
 * ## Vì sao một hàm, ba vỏ
 *
 * `PATCH /api/pages/:id`, tool MCP `update_page`, và ô chọn trong builder gọi cùng
 * hàm này. Cùng khuôn với `createPage`: hai bản của một luật sẽ trôi khỏi nhau, và ở
 * đây thứ trôi mất là "một loại chỉ được một trang chi tiết" — vi phạm nó thì
 * `detailBaseForType` trả về cái nó gặp trước, tức href của MỌI thẻ tin trên site
 * phụ thuộc thứ tự đọc DB.
 *
 * ## Vì sao cột này cần một đường ghi, khi nó đã tồn tại từ lâu
 *
 * Nó tồn tại và renderer đọc nó, nhưng không API nào, không tool MCP nào, không màn
 * hình nào đặt được — đặt tay trong Prisma Studio là cách duy nhất. Một tính năng có
 * mà không ai dùng được thì trên thực tế là không có.
 */

import { Prisma } from '@prisma/client';
import { revalidateTag } from 'next/cache';

import { prisma } from '@/lib/db';
import { collectionTag } from '@/lib/collections/cache';
import {
  checkCollectionPairing,
  parsePageCollection,
  type PageCollection,
  type PageParamRole,
} from './page-collection';
import { isTemplateSlug, slugShape } from './slug';

export type CollectionInput = { typeKey: string; param: PageParamRole } | null;

/**
 * Đọc đầu vào thô (JSON body, tham số MCP) thành `PageCollection` hoặc `null`.
 *
 * `null` là một giá trị CÓ NGHĨA — "trang này không còn là mặt tiền của loại nào" —
 * nên nó khác `undefined` ("đừng đụng cột này"). Chỗ gọi phải phân biệt hai thứ đó
 * trước khi vào đây.
 */
export function parseCollectionInput(v: unknown): CollectionInput | { error: string } {
  if (v === null) return null;
  const col = parsePageCollection(v);
  if (!col) {
    return {
      error: 'collection phải là { typeKey, param } với param là list | entry | taxonomy, hoặc null để gỡ.',
    };
  }
  return col;
}

/**
 * Mọi luật của `collection` cần đọc DB. Trả câu lỗi, hoặc `null`.
 *
 * `pageId` để loại chính trang đang sửa ra khỏi phép kiểm trùng — không có nó thì lưu
 * lại một trang mà không đổi gì cũng bị từ chối.
 */
export async function checkCollection(args: {
  pageId: string | null;
  slug: string;
  collection: PageCollection | null;
}): Promise<string | null> {
  const pairing = checkCollectionPairing(args.slug, args.collection);
  if (pairing) return pairing;
  if (!args.collection) return null;

  const type = await prisma.collectionType.findUnique({
    where: { key: args.collection.typeKey },
    select: { key: true },
  });
  if (!type) return `Không có loại nội dung "${args.collection.typeKey}".`;

  // `list` không độc quyền: một loại có thể có nhiều trang liệt kê nó (trang chủ và
  // `/blogs` cùng hiện tin mới nhất là chuyện bình thường). Hai vai kia thì độc quyền
  // — xem docblock đầu file.
  if (args.collection.param === 'list') return null;

  const rows = await prisma.page.findMany({
    where: { archivedAt: null, ...(args.pageId ? { NOT: { id: args.pageId } } : {}) },
    select: { id: true, slug: true, title: true, collection: true },
  });

  for (const r of rows) {
    const other = parsePageCollection(r.collection);
    if (!other) continue;
    if (other.typeKey === args.collection.typeKey && other.param === args.collection.param) {
      const what = args.collection.param === 'entry' ? 'trang chi tiết' : 'trang danh mục';
      return `Loại "${args.collection.typeKey}" đã có ${what} rồi: "${r.title}" (/${r.slug}). Mỗi loại chỉ được một.`;
    }
  }

  return null;
}

/**
 * Hai mẫu không được cùng HÌNH DẠNG. Trả câu lỗi, hoặc `null`.
 *
 * `blogs/[category]` và `blogs/[thang]` cùng ra `blogs/*`. Không có luật này thì
 * mẫu nào khớp trước phụ thuộc thứ tự đọc DB — một cuộc bốc thăm thầm lặng, và thứ
 * đổi theo mỗi lần đọc là nội dung của một URL công khai.
 *
 * Kiểm ở ĐƯỜNG GHI chứ không ở đường đọc: `matchSlugTemplate` chọn tất định khi hoà,
 * nhưng "tất định" không phải "đúng" — người dựng vẫn cần biết mình vừa dựng một mẫu
 * không bao giờ khớp được.
 */
export async function checkSlugShapeFree(slug: string, pageId: string | null): Promise<string | null> {
  if (!isTemplateSlug(slug)) return null;
  const shape = slugShape(slug);

  const rows = await prisma.page.findMany({
    where: {
      archivedAt: null,
      slug: { contains: '[' },
      ...(pageId ? { NOT: { id: pageId } } : {}),
    },
    select: { slug: true, title: true },
  });

  const clash = rows.find((r) => slugShape(r.slug) === shape);
  return clash
    ? `Đường dẫn này cùng hình dạng với "${clash.title}" (/${clash.slug}) — hai mẫu ${shape} thì không có cách nào biết địa chỉ nào thuộc mẫu nào.`
    : null;
}

export type SetCollectionResult =
  | { ok: true; collection: PageCollection | null }
  | { ok: false; status: number; error: string };

export async function setPageCollection(args: {
  pageId: string;
  collection: PageCollection | null;
  actorSub: string;
}): Promise<SetCollectionResult> {
  const page = await prisma.page.findUnique({
    where: { id: args.pageId },
    select: { id: true, slug: true, collection: true, archivedAt: true },
  });
  if (!page) return { ok: false, status: 404, error: 'Không có trang này' };
  if (page.archivedAt) {
    return { ok: false, status: 409, error: 'Trang đã lưu trữ. Khôi phục trước khi sửa.' };
  }

  const problem = await checkCollection({
    pageId: page.id,
    slug: page.slug,
    collection: args.collection,
  });
  if (problem) return { ok: false, status: 409, error: problem };

  const before = parsePageCollection(page.collection);

  await prisma.$transaction([
    prisma.page.update({
      where: { id: page.id },
      data: { collection: (args.collection as unknown as Prisma.InputJsonObject) ?? Prisma.DbNull },
    }),
    prisma.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'page.collection',
        targetType: 'Page',
        targetId: page.id,
        meta: { slug: page.slug, before, after: args.collection } as Prisma.InputJsonObject,
      },
    }),
  ]);

  /*
   * Xoá tag của CẢ hai loại — loại cũ và loại mới.
   *
   * `listPageTemplates` gắn tag 'release'; `detailBaseForType` gắn thêm
   * `collection:<typeKey>`. Gỡ trang chi tiết của loại A rồi gán nó cho loại B mà chỉ
   * xoá tag B thì `detailBaseForType('A')` còn trả gốc cũ tới một giờ — và trong một
   * giờ đó, mọi thẻ tin của A trỏ vào một địa chỉ không còn mẫu nào phục vụ.
   */
  revalidateTag('release');
  if (before) revalidateTag(collectionTag(before.typeKey));
  if (args.collection) revalidateTag(collectionTag(args.collection.typeKey));

  return { ok: true, collection: args.collection };
}
