import 'server-only';

/**
 * Đọc cho màn admin. KHÁC `queries.ts` ở hai điểm chịu lực:
 *
 *  1. **Thấy cả entry nháp và entry hẹn giờ.** `queries.ts` cố ý không thấy chúng
 *     (bốn điều kiện nền), vì nó phục vụ site thật.
 *  2. **KHÔNG bọc `unstable_cache`.** Cùng lý do `builder/queries.ts` không bọc:
 *     builder phải thấy ngay thứ vừa lưu. Bọc cache ở đây nghĩa là bấm Lưu rồi
 *     thấy bản cũ, và người dùng bấm Lưu lần nữa.
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { validateCollectionSchema, type FieldDef } from './field-def';
import { localeCoverage } from './i18n';
import { seoKeyOf } from './seo';
import { ACTIVITY_LIMIT, activityLabel, type ActivityPerson, type EntryActivity, type WriterOption } from './entry-activity';
import { loadGroupTable } from './group-table';
import { sortedTaxonomies } from './queries';

export interface AdminEntryRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  publishedAt: Date | null;
  updatedAt: Date;
  updatedBy: string;
  taxonomies: { id: string; name: string }[];
  locales: Record<string, { translated: number; total: number }>;
}

export interface EntryFilter {
  typeKey: string;
  status?: 'draft' | 'published' | 'scheduled' | 'archived';
  taxonomyId?: string;
  q?: string;
  /** Chỉ những entry này — bộ chọn `relation` tra tên của bài đã chọn. */
  ids?: string[];
  page: number;
  pageSize: number;
}

/**
 * 'scheduled' KHÔNG phải một giá trị của cột `status`.
 *
 * Nó là "đã đăng nhưng mốc còn ở tương lai" — một trạng thái suy ra, không phải
 * một trạng thái lưu. Thêm nó vào cột `status` nghĩa là phải có một cron đổi nó
 * thành 'published' đúng giờ, và một cron chết thì bài không bao giờ lên.
 */
function statusWhere(status: EntryFilter['status'], now: Date): Prisma.EntryWhereInput {
  if (status === 'draft') return { status: 'draft' };
  if (status === 'published') return { status: 'published', publishedAt: { lte: now } };
  if (status === 'scheduled') return { status: 'published', publishedAt: { gt: now } };
  return {};
}

/**
 * `base` cộng điều kiện trạng thái — lặp bốn lần trong `listAdminEntries` (một
 * cho `where`, ba cho ba `count` theo trạng thái). Rút ra một hàm để bốn chỗ đó
 * không thể lệch nhau khi có người sửa một trong số đó mà quên ba chỗ còn lại.
 */
function whereFor(
  base: Prisma.EntryWhereInput,
  status: EntryFilter['status'],
  now: Date,
): Prisma.EntryWhereInput {
  return { ...base, ...statusWhere(status, now) };
}

export async function listAdminEntries(f: EntryFilter) {
  const now = new Date();
  const base: Prisma.EntryWhereInput = { typeKey: f.typeKey, archivedAt: null };

  if (f.taxonomyId) base.taxonomies = { some: { taxonomyId: f.taxonomyId } };
  const type = await prisma.collectionType.findUnique({
    where: { key: f.typeKey },
    select: { titleField: true, schema: true },
  });
  const titleField = type?.titleField ?? 'title';
  // Đọc thô, không validate: chỉ cần biết field nào là `seo` cho cột độ phủ bản dịch.
  const seoKey = Array.isArray(type?.schema) ? seoKeyOf(type.schema as FieldDef[]) : null;
  /*
   * Tìm theo TIÊU ĐỀ và slug, không phân biệt hoa thường. Đủ cho vài nghìn entry, không cần
   * index; cần hơn thì đó là Postgres FTS, một quyết định riêng.
   *
   * Bản trước dùng `data: { string_contains }` trên cả object `data` — Prisma chỉ so được
   * `string_contains` với một GIÁ TRỊ chuỗi, nên trên object nó không bao giờ khớp: ô tìm của
   * bảng bài viết và bộ chọn "Tin liên quan" luôn trả rỗng (đo 21/10/2026: 0/72 bài).
   */
  const term = f.q?.trim();
  let idIn = f.ids;
  if (term) {
    // `\`, `%`, `_` của người gõ là chữ thường, không phải ký tự đại diện của LIKE.
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const hits = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Entry"
      WHERE "typeKey" = ${f.typeKey}
        AND ((data ->> ${titleField}) ILIKE ${like} OR slug ILIKE ${like})`;
    const found = hits.map((h) => h.id);
    idIn = idIn ? idIn.filter((x) => found.includes(x)) : found;
  }
  if (idIn) base.id = { in: idIn };

  /*
   * `archived` ĐẢO một điều kiện của `base` thay vì cộng thêm vào nó — và `base` vẫn
   * là mốc của bốn bộ đếm kia.
   *
   * Bài trong lưu trữ không được lẫn vào chúng: "Nháp 12" mà gồm cả bài đã xoá là một
   * con số nói dối ở đúng chỗ người ta tin nó nhất. Ngược lại, đếm ba trạng thái
   * TRONG lưu trữ cũng vô nghĩa — chúng phải nói về bài đang dùng, bất kể tab nào
   * đang mở.
   */
  const archivedWhere: Prisma.EntryWhereInput = { ...base, archivedAt: { not: null } };
  const where = f.status === 'archived' ? archivedWhere : whereFor(base, f.status, now);

  const [rows, total, all, published, draft, scheduled, archivedCount, locales] = await Promise.all([
    prisma.entry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true, slug: true, data: true, i18n: true, status: true,
        publishedAt: true, updatedAt: true, updatedBy: true,
        taxonomies: { select: { taxonomy: { select: { id: true, name: true } } } },
      },
    }),
    prisma.entry.count({ where }),
    prisma.entry.count({ where: base }),
    prisma.entry.count({ where: whereFor(base, 'published', now) }),
    prisma.entry.count({ where: whereFor(base, 'draft', now) }),
    prisma.entry.count({ where: whereFor(base, 'scheduled', now) }),
    prisma.entry.count({ where: archivedWhere }),
    prisma.locale.findMany({ where: { isDefault: false }, select: { code: true } }),
  ]);

  return {
    rows: rows.map((r): AdminEntryRow => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const raw = data[titleField];
      return {
        id: r.id,
        slug: r.slug,
        // Bài chưa đặt tiêu đề vẫn phải có một dòng đọc được trong bảng — để
        // trống thì hàng trông như dữ liệu hỏng.
        title: typeof raw === 'string' && raw.trim() ? raw : '[chưa đặt tiêu đề]',
        status: r.status,
        publishedAt: r.publishedAt,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
        taxonomies: r.taxonomies.map((t) => t.taxonomy),
        locales: Object.fromEntries(
          locales.map((l) => [l.code, localeCoverage(data, r.i18n, l.code, seoKey)]),
        ),
      };
    }),
    total,
    counts: { all, published, draft, scheduled, archived: archivedCount },
  };
}

export async function getAdminEntry(id: string) {
  const e = await prisma.entry.findUnique({
    where: { id },
    select: {
      id: true, typeKey: true, slug: true, data: true, i18n: true, status: true,
      publishedAt: true, createdAt: true, createdBy: true, updatedAt: true, updatedBy: true,
      // Kèm `key`/`name`/`order` vì `repeatEntryContext` dựng `EntryRow` từ hàng
      // này, và `EntryRow.taxonomies` là thứ huy hiệu danh mục trên thẻ đọc tới.
      taxonomies: { select: { taxonomyId: true, taxonomy: { select: { key: true, name: true, order: true } } } },
      // Tác giả — cùng lý do: `repeatEntryContext` dựng `EntryRow`, và byline đọc nó.
      author: { select: { email: true, name: true, avatarAssetId: true, lockedAt: true } },
      /*
       * Slug và trạng thái đăng của từng ngôn ngữ.
       *
       * Nạp cùng entry chứ không để form đọc riêng: form là `'use client'`, nên một
       * lượt đọc riêng nghĩa là một endpoint nữa và một trạng thái tải nữa, cho một
       * dữ liệu nhỏ và luôn luôn cần.
       */
      locales: { select: { locale: true, slug: true, status: true, publishedAt: true } },
    },
  });
  if (!e) return null;
  const taxonomies = sortedTaxonomies(e.taxonomies);
  return {
    ...e,
    data: (e.data ?? {}) as Record<string, unknown>,
    i18n: (e.i18n ?? {}) as Record<string, unknown>,
    taxonomyIds: taxonomies.map((t) => t.id),
    taxonomies,
  };
}

/**
 * Ô "Tác giả" và "Nhật ký" của form bài: tác giả, người tạo thật, người sửa gần nhất —
 * kèm avatar — và `ACTIVITY_LIMIT` dòng lịch sử gần nhất, đọc từ `AuditLog`.
 *
 * ## Tác giả ≠ người tạo
 *
 * `Entry.createdBy` là TÁC GIẢ (byline ra site, đổi được qua `entries/[id]/author`).
 * Người bấm tạo bài là một sự thật khác, và nó nằm ở dòng `entry.create` của nhật ký —
 * đổi tác giả không được xoá dấu vết đó. Dòng ấy đọc RIÊNG: bài sửa nhiều thì nó trôi
 * khỏi `ACTIVITY_LIMIT` dòng gần nhất.
 *
 * Số lượt đọc cố định, không phụ thuộc số dòng: người và ảnh được gom rồi đọc một lần.
 * `AuditLog.userId` là `User.id` (`session.sub`), còn `createdBy`/`updatedBy` là EMAIL —
 * nên tra người bằng cả hai khoá.
 */
export async function getEntryActivity(e: {
  id: string;
  createdBy: string;
  updatedBy: string;
}): Promise<EntryActivity> {
  const [logs, createLog] = await Promise.all([
    prisma.auditLog.findMany({
      where: { targetType: 'Entry', targetId: e.id },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_LIMIT,
      select: { id: true, userId: true, action: true, meta: true, createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { targetType: 'Entry', targetId: e.id, action: 'entry.create' },
      select: { userId: true },
    }),
  ]);

  const ids = new Set(logs.map((l) => l.userId));
  if (createLog) ids.add(createLog.userId);
  const users = await prisma.user.findMany({
    where: { OR: [{ id: { in: [...ids] } }, { email: { in: [e.createdBy, e.updatedBy] } }] },
    select: { id: true, email: true, name: true, avatarAssetId: true },
  });
  const assetIds = users.map((u) => u.avatarAssetId).filter((x): x is string => !!x);
  const assets = assetIds.length
    ? await prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, url: true } })
    : [];
  const urlOf = new Map(assets.map((a) => [a.id, a.url]));

  const person = (u: (typeof users)[number] | undefined): ActivityPerson | null =>
    u
      ? { name: u.name, email: u.email, avatarUrl: u.avatarAssetId ? urlOf.get(u.avatarAssetId) ?? null : null }
      : null;
  const byId = new Map(users.map((u) => [u.id, u]));
  const byEmail = new Map(users.map((u) => [u.email, u]));

  const byEmailOr = (email: string) => person(byEmail.get(email)) ?? { name: null, email, avatarUrl: null };

  return {
    writer: byEmailOr(e.createdBy),
    // Bài nhập trước khi nhật ký có `entry.create` thì không biết người tạo thật —
    // rơi về tác giả, thứ đúng cho mọi bài chưa ai đổi tác giả.
    createdBy: (createLog ? person(byId.get(createLog.userId)) : null) ?? byEmailOr(e.createdBy),
    updatedBy: byEmailOr(e.updatedBy),
    history: logs.map((l) => ({
      id: l.id,
      at: l.createdAt,
      label: activityLabel(l.action, l.meta),
      person: person(byId.get(l.userId)),
    })),
  };
}

/**
 * Mọi tài khoản, cho bộ chọn TÁC GIẢ của form bài — kèm avatar.
 *
 * Kể cả tài khoản ĐÃ KHOÁ (đánh dấu `locked`): tác giả nghỉ việc, bài vẫn phải đứng
 * đúng tên họ — cùng luật với route `entries/[id]/author`. Hai lượt đọc cố định.
 */
export async function listWriterOptions(): Promise<WriterOption[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    select: { email: true, name: true, avatarAssetId: true, lockedAt: true },
  });
  const assetIds = users.map((u) => u.avatarAssetId).filter((x): x is string => !!x);
  const assets = assetIds.length
    ? await prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, url: true } })
    : [];
  const urlOf = new Map(assets.map((a) => [a.id, a.url]));
  return users.map((u) => ({
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarAssetId ? urlOf.get(u.avatarAssetId) ?? null : null,
    locked: u.lockedAt !== null,
  }));
}

/**
 * Hàng admin → `EntryRow`, cho hai chỗ đếm thử một khối lặp.
 *
 * Một hàm chứ hai lần chép tay: `resolve_repeat` (tool của AI) và endpoint cùng
 * tên đều dựng ngữ cảnh này, và trước đây cả hai liệt kê bảy field bằng tay. Thêm
 * `taxonomies` vào `EntryRow` làm cả hai không biên dịch được — đó là lần đầu
 * TypeScript báo, và lần sau nó sẽ báo tiếp nếu vẫn còn hai bản.
 */
export function repeatEntryContext(e: NonNullable<Awaited<ReturnType<typeof getAdminEntry>>>) {
  return {
    id: e.id,
    slug: e.slug,
    typeKey: e.typeKey,
    data: e.data,
    publishedAt: e.publishedAt,
    updatedAt: e.updatedAt,
    taxonomyIds: e.taxonomyIds,
    taxonomies: e.taxonomies,
    author: {
      email: e.author.email,
      name: e.author.name,
      avatarAssetId: e.author.avatarAssetId,
      locked: e.author.lockedAt !== null,
    },
  };
}

export async function getTypeShape(typeKey: string) {
  const type = await prisma.collectionType.findUnique({
    where: { key: typeKey },
    select: {
      id: true, key: true, name: true, namePlural: true, schema: true,
      titleField: true, slugField: true, singleton: true,
    },
  });
  if (!type) return null;

  const groups = await loadGroupTable();
  const checked = validateCollectionSchema(type.schema, groups);

  const taxonomies = await prisma.taxonomy.findMany({
    where: { typeKey },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { id: true, key: true, name: true, parentId: true, status: true },
  });

  return {
    type: {
      id: type.id, key: type.key, name: type.name, namePlural: type.namePlural,
      titleField: type.titleField, slugField: type.slugField, singleton: type.singleton,
    },
    // Cấu trúc hỏng thì trả rỗng chứ không ném: một hàng schema sai không được làm
    // cả màn không mở được, vì màn này chính là chỗ sửa nó.
    fields: (checked.ok ? checked.fields : []) as FieldDef[],
    groups,
    taxonomies,
  };
}
