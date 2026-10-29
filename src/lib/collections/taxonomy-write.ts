import 'server-only';

/**
 * Danh mục. Bảng riêng, cây, thuộc về MỘT loại nội dung.
 *
 * Xoá một danh mục KHÔNG xoá entry: liên kết bị gỡ, entry ở lại. Cách khác là làm
 * một nút "quản lý danh mục" xoá được nội dung, và không ai chờ điều đó.
 */

import { prisma } from '@/lib/db';
import { toSlug } from '@/lib/builder/create-page';
// Không `import { revalidateTag }` ở đây: `cache.ts` tự nhận là CHỖ DUY NHẤT gọi nó
// cho nội dung, và một lời tự nhận không đúng thì tệ hơn không có — khi mỗi chỗ ghi
// tự chọn tag, không còn một chỗ nào để đọc và thấy đang thiếu tag nào.
import { revalidateCollection } from './cache';
import { isUniqueCollision } from './unique-retry';
import { setTaxonomyName, translatedName, type TaxonomyI18n } from './taxonomy-locale';

export async function createTaxonomy(args: {
  typeKey: string;
  name: string;
  parentId?: string;
  actorSub: string;
}): Promise<{ ok: true; taxonomy: { id: string; key: string } } | { ok: false; status: number; error: string }> {
  const name = args.name.trim();
  if (!name) return { ok: false, status: 400, error: 'Thiếu tên danh mục' };

  const type = await prisma.collectionType.findUnique({ where: { key: args.typeKey }, select: { id: true } });
  if (!type) return { ok: false, status: 404, error: `Không có loại nội dung "${args.typeKey}"` };

  if (args.parentId) {
    const parent = await prisma.taxonomy.findUnique({
      where: { id: args.parentId },
      select: { typeKey: true },
    });
    // Danh mục cha thuộc loại khác nghĩa là cây danh mục của tin tức mọc một nhánh
    // của FAQ — và form nhập liệu sẽ hiện nhánh đó.
    if (!parent || parent.typeKey !== args.typeKey) {
      return { ok: false, status: 400, error: 'Danh mục cha không thuộc loại nội dung này' };
    }
  }

  const base = toSlug(name) || 'muc';

  const writeTaxonomy = (key: string) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.taxonomy.create({
        data: { typeKey: args.typeKey, key, name, parentId: args.parentId ?? null },
        select: { id: true, key: true },
      });
      await tx.auditLog.create({
        data: {
          userId: args.actorSub,
          action: 'taxonomy.create',
          targetType: 'Taxonomy',
          targetId: created.id,
          meta: { typeKey: args.typeKey, key, name },
        },
      });
      return created;
    });

  /*
   * `key` tính từ danh sách đã dùng RỒI mới ghi, nên hai lần tạo đồng thời có thể
   * tính ra cùng một `key` và đụng `@@unique([typeKey, key])`.
   *
   * Đúng ca đua mà `createEntry` đã vá cho slug: thử lại MỘT lần với danh sách đọc
   * lại. `key` là giá trị suy ra, không phải lựa chọn của người dùng — bắt họ thử
   * lại cho một thứ họ không chọn là đẩy việc của máy sang cho người.
   */
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const taken = await prisma.taxonomy.findMany({
      where: { typeKey: args.typeKey },
      select: { key: true },
    });
    const keys = taken.map((t) => t.key);
    let key = base;
    let n = 2;
    while (keys.includes(key)) { key = `${base}-${n}`; n += 1; }

    try {
      const taxonomy = await writeTaxonomy(key);
      revalidateCollection(args.typeKey);
      return { ok: true, taxonomy };
    } catch (e) {
      // Lỗi KHÔNG phải đụng key thì ném tiếp: một lỗi kết nối DB bị biến thành
      // "khoá bị chiếm" là một thông báo nói sai chuyện.
      if (!isUniqueCollision(e, 'key')) throw e;
      if (attempt === 2) {
        return {
          ok: false,
          status: 409,
          error: 'Khoá danh mục vừa bị một danh mục khác chiếm. Thử lại.',
        };
      }
    }
  }

  // Không tới được: vòng lặp luôn `return` hoặc `throw`. Có mặt để TypeScript thấy
  // mọi đường đều trả giá trị.
  return { ok: false, status: 500, error: 'Không tạo được danh mục' };
}

/**
 * Bật/tắt hiển thị một danh mục.
 *
 * ## Vì sao là một hàm riêng chứ không một `updateTaxonomy` chung
 *
 * Hai field còn lại của bảng này có luật riêng và không đổi cùng nhịp: `key` là
 * BẤT BIẾN (mọi URL danh mục dựng từ nó), còn `name` và `order` là thao tác sửa
 * thường. Trạng thái đăng thì khác cả hai: nó ĐỔI THỨ NGƯỜI ĐỌC THẤY, nên nó cần
 * một dòng audit nói rõ ai bật, ai tắt — thứ mà một `PATCH` gộp sẽ ghi thành
 * "taxonomy.update" và không ai đọc lại được.
 *
 * Không kiểm "danh mục cuối cùng" như `deleteTaxonomy` kiểm số bài: tắt một danh
 * mục không mất dữ liệu và bật lại là một cú bấm.
 */
export async function setTaxonomyStatus(args: {
  id: string;
  published: boolean;
  actorSub: string;
}): Promise<{ ok: true; status: string } | { ok: false; status: number; error: string }> {
  const tax = await prisma.taxonomy.findUnique({
    where: { id: args.id },
    select: { id: true, typeKey: true, key: true, status: true },
  });
  if (!tax) return { ok: false, status: 404, error: 'Không có danh mục này' };

  const next = args.published ? 'published' : 'draft';
  // Không ghi khi không đổi gì: một dòng audit "đổi từ published sang published"
  // làm loãng đúng nhật ký mà hàm này tồn tại để giữ.
  if (tax.status === next) return { ok: true, status: next };

  await prisma.$transaction(async (tx) => {
    await tx.taxonomy.update({ where: { id: args.id }, data: { status: next } });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: next === 'published' ? 'taxonomy.publish' : 'taxonomy.unpublish',
        targetType: 'Taxonomy',
        targetId: args.id,
        meta: { typeKey: tax.typeKey, key: tax.key, from: tax.status, to: next },
      },
    });
  });

  revalidateCollection(tax.typeKey);
  return { ok: true, status: next };
}

/** Trần tên danh mục — cùng con số với `create_taxonomy`. */
const MAX_NAME = 120;

/**
 * Đặt (hoặc gỡ, khi `name` rỗng/`null`) tên của một danh mục ở một ngôn ngữ.
 *
 * Khoá locale phải có trong bảng `Locale` — cùng luật với `Entry.i18n`: khoá tự do
 * nghĩa là cột này phình bằng những ngôn ngữ site không bao giờ phục vụ. Ngôn ngữ
 * mặc định bị từ chối vì tên gốc nằm ở cột `name`; ghi nó vào `i18n` là tạo ra một
 * tên thứ hai mà không đường đọc nào dùng.
 */
export async function setTaxonomyLocaleName(args: {
  id: string;
  locale: string;
  name: string | null;
  actorSub: string;
}): Promise<{ ok: true; i18n: TaxonomyI18n } | { ok: false; status: number; error: string }> {
  if (args.name !== null && args.name.trim().length > MAX_NAME) {
    return { ok: false, status: 400, error: `Tên danh mục dài quá ${MAX_NAME} ký tự` };
  }

  const tax = await prisma.taxonomy.findUnique({
    where: { id: args.id },
    select: { id: true, typeKey: true, key: true, i18n: true },
  });
  if (!tax) return { ok: false, status: 404, error: 'Không có danh mục này' };

  const loc = await prisma.locale.findUnique({
    where: { code: args.locale },
    select: { code: true, isDefault: true },
  });
  if (!loc) return { ok: false, status: 400, error: `Không có ngôn ngữ '${args.locale}'` };
  if (loc.isDefault) {
    return { ok: false, status: 400, error: 'Ngôn ngữ mặc định dùng tên gốc của danh mục — sửa ở đó' };
  }

  const next = setTaxonomyName(tax.i18n, args.locale, args.name);
  const before = translatedName(tax.i18n, args.locale);
  const after = next[args.locale]?.name ?? null;
  // Không ghi khi không đổi gì — cùng lý do với `setTaxonomyStatus`.
  if (before === after) return { ok: true, i18n: next };

  await prisma.$transaction(async (tx) => {
    await tx.taxonomy.update({ where: { id: args.id }, data: { i18n: next } });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: after === null ? 'taxonomy.locale.clear' : 'taxonomy.locale.set',
        targetType: 'Taxonomy',
        targetId: args.id,
        meta: { typeKey: tax.typeKey, key: tax.key, locale: args.locale, from: before, to: after },
      },
    });
  });

  revalidateCollection(tax.typeKey);
  return { ok: true, i18n: next };
}

export async function deleteTaxonomy(args: {
  id: string;
  actorSub: string;
}): Promise<{ ok: true; detached: number } | { ok: false; status: number; error: string }> {
  const tax = await prisma.taxonomy.findUnique({
    where: { id: args.id },
    select: { id: true, typeKey: true, key: true, _count: { select: { entries: true } } },
  });
  if (!tax) return { ok: false, status: 404, error: 'Không có danh mục này' };

  const detached = tax._count.entries;

  await prisma.$transaction(async (tx) => {
    // `EntryTaxonomy` có onDelete: Cascade nên liên kết tự đi; entry ở lại.
    // `Taxonomy.parentId` có onDelete: SetNull nên con thành gốc, không mất theo.
    await tx.taxonomy.delete({ where: { id: args.id } });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'taxonomy.delete',
        targetType: 'Taxonomy',
        targetId: args.id,
        meta: { typeKey: tax.typeKey, key: tax.key, detached },
      },
    });
  });

  revalidateCollection(tax.typeKey);
  return { ok: true, detached };
}
