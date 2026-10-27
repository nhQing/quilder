import 'server-only';

/**
 * Nối doc với dữ liệu collection: giải slug, nạp entry, giải quyết mọi khối lặp.
 *
 * ## Vì sao giải quyết mọi `repeat` trong MỘT lượt
 *
 * Một trang có thể có ba khối lặp (tin mới nhất, tin nổi bật, FAQ). Giải quyết chúng
 * lần lượt là ba lượt chờ nối tiếp cho ba truy vấn độc lập. `Promise.all` làm chúng
 * chồng lên nhau, và SỐ lượt đọc DB không đổi — chỉ tổng thời gian chờ đổi.
 *
 * ## Vì sao ở đây chứ không trong renderer
 *
 * `NodeRenderer` đồng bộ và gọi đệ quy. Xem khối "Collection" trong `RenderContext`.
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/db';
import { matchSlugTemplate, paramNames } from '@/lib/builder/slug';
import {
  parsePageCollection as parseCollection,
  templateBase as baseOfTemplate,
  type PageCollection,
} from '@/lib/builder/page-collection';
import { collectionTag } from '@/lib/collections/cache';
import type { FieldDef } from '@/lib/collections/field-def';
import { resolveEntrySeo, type EntrySeo, type JsonLd } from '@/lib/collections/seo';
import {
  getCollectionTypes,
  getEntryBySlug,
  getEntryForPreview,
  relationTargets,
  type EntryRow,
} from '@/lib/collections/queries';
import { itemOverrides, type RepeatItem } from '@/lib/collections/repeat';
import {
  expandRelations, MAX_RELATION_FANOUT, relationFields, relationIds, toRelationRef,
} from '@/lib/collections/relation-expand';
import {
  resolveRepeat,
  resolveTaxonomyTree,
  type RepeatContext,
} from '@/lib/collections/resolve-repeat';
import { zRichDoc, zRichText } from '@/lib/doc/schema';
import type { Doc, InstanceNode, NodeId, RichDoc, RichText } from '@/lib/doc/types';
import type { EntryBody } from './NodeRenderer';
import { getPublishedPage } from './page';
import { isBlankHtml, sanitizeArticleHtml } from '@/lib/collections/html-sanitize';
import { collectDocAssetIds } from './richdoc';

/*
 * Hình dạng và phép đọc của `Page.collection` sống ở `@/lib/builder/page-collection`
 * — file THUẦN, vì đường ghi cần đúng những luật ấy và file này khai `server-only`.
 * Re-export để chỗ đọc không phải biết chúng đã dọn đi đâu.
 */
export { parsePageCollection, templateBase } from '@/lib/builder/page-collection';
export type { PageCollection, PageParamRole } from '@/lib/builder/page-collection';

export interface PageTemplate {
  slug: string;
  collection: PageCollection;
}

/**
 * Mọi trang MẪU của site — vài hàng, đã cache.
 *
 * Lọc `collection` trong JS chứ không trong `where`: cột là JSONB, và `{ not: null }`
 * trên JSONB của Prisma đòi `Prisma.DbNull` — một sentinel phân biệt "JSON null" với
 * "SQL NULL", tức đúng thứ dễ đặt sai và sai thì im lặng trả rỗng. Bộ lọc `contains: '['`
 * đã cắt xuống còn vài hàng trước khi tới JS.
 */
export const listPageTemplates = unstable_cache(
  async (): Promise<PageTemplate[]> => {
    const rows = await prisma.page.findMany({
      where: { archivedAt: null, slug: { contains: '[' } },
      select: { slug: true, collection: true },
      orderBy: { slug: 'asc' },
    });
    const out: PageTemplate[] = [];
    for (const r of rows) {
      const col = parseCollection(r.collection);
      // Mẫu KHÔNG khai `collection` là một URL 404 im lặng — bỏ nó khỏi bảng định
      // tuyến thay vì để nó khớp rồi render một trang chưa bind. Đường ghi đã chặn ca
      // này; đây là hàng rào cho dữ liệu ghi trước khi luật đó tồn tại.
      if (col && col.param !== 'list') out.push({ slug: r.slug, collection: col });
    }
    return out;
  },
  ['page-templates'],
  // 'release' vì publish là lúc một trang mới có thể trở thành mẫu.
  { tags: ['release'], revalidate: 3600 },
);

/** Gốc của mẫu `param:'entry'` cho một loại, ví dụ '/blogs/post'. */
export const detailBaseForType = (typeKey: string) => baseForType(typeKey, 'entry');

/**
 * Gốc của mẫu `param:'taxonomy'`, ví dụ '/blogs'.
 *
 * Tách khỏi `detailBase` chứ không dùng chung: một khối lặp nguồn `taxonomy` (dải
 * danh mục) và một khối thẻ tin nằm trên CÙNG một trang danh sách, và hai gốc của
 * chúng khác nhau. Dùng chung một gốc là dải danh mục trỏ vào gốc bài viết — đúng
 * lỗi "bấm ra 404" mà docblock cũ ở hàm này đã mô tả cho ca kia.
 */
export const taxonomyBaseForType = (typeKey: string) => baseForType(typeKey, 'taxonomy');

const baseForType = (typeKey: string, role: 'entry' | 'taxonomy') =>
  unstable_cache(
    async () => {
      const templates = await listPageTemplates();
      const hit = templates.find(
        (t) => t.collection.param === role && t.collection.typeKey === typeKey,
      );
      return hit ? baseOfTemplate(hit.slug) : null;
    },
    ['template-base', role, typeKey],
    // `collectionTag` bên cạnh `release`: đổi danh mục của một bài mà trang danh mục
    // vẫn cũ tới một tiếng là một lỗi không ai nối được với nguyên nhân.
    { tags: ['release', collectionTag(typeKey)], revalidate: 3600 },
  )();

export interface TemplateHit {
  page: NonNullable<Awaited<ReturnType<typeof getPublishedPage>>>;
  collection: PageCollection;
  /** Giá trị của đoạn động. Slug entry, hoặc key danh mục. */
  paramValue: string;
  /** Gốc của chính mẫu này. */
  base: string;
}

/**
 * Tìm mẫu khớp một URL.
 *
 * Gọi SAU khi khớp chính xác đã thất bại. Thứ tự đó là điều kiện để thêm tính năng
 * này không đổi một URL nào đang chạy: `/blogs/gioi-thieu-chuyen-muc` là một trang
 * thật thì nó vẫn thắng một entry cùng slug.
 */
export async function findTemplateForSlug(slug: string): Promise<TemplateHit | null> {
  const templates = await listPageTemplates();
  if (!templates.length) return null;

  const hit = matchSlugTemplate(slug, templates);
  if (!hit) return null;

  const names = paramNames(hit.template.slug);
  const paramValue = names[0] ? hit.params[names[0]] : undefined;
  if (!paramValue) return null;

  // Đọc trang SAU khi biết nó là mẫu: `getPublishedPage` là ba truy vấn, và chạy nó
  // cho mọi URL 404 nhiều đoạn là trả giá đó cho mỗi con bot quét site.
  const page = await getPublishedPage(hit.template.slug);
  if (!page) return null;

  return {
    page,
    collection: hit.template.collection,
    paramValue,
    base: baseOfTemplate(hit.template.slug),
  };
}

/** Danh mục theo `key`, trong phạm vi một loại. `null` = URL không có thật → 404. */
export const taxonomyByKey = (typeKey: string, key: string) =>
  unstable_cache(
    async () =>
      prisma.taxonomy.findUnique({
        where: { typeKey_key: { typeKey, key } },
        select: { id: true, key: true, name: true },
      }),
    ['taxonomy-by-key', typeKey, key],
    { tags: [collectionTag(typeKey)], revalidate: 3600 },
  )();

export function loadDetailEntry(typeKey: string, entrySlug: string, locale?: string) {
  return getEntryBySlug(typeKey, entrySlug, locale);
}

/* ── Vai `relation` ───────────────────────────────────────────────────── */

/**
 * Loại mà đoạn động của vai `relation` mang SLUG của nó.
 *
 * `Page.collection` khai `{ typeKey, param: 'relation', field }`: `typeKey` là loại
 * mà trang này là mặt tiền (`tin-tuc`), `field` là một field `relation` của nó, và
 * loại ĐÍCH của field ấy (`danh-muc`) là thứ hàm này trả về.
 *
 * ## Vì sao suy ra thay vì lưu thẳng tên loại đích
 *
 * Vì loại đích đã được khai ở một chỗ rồi — trong schema của field. Lưu bản thứ hai
 * ở `Page.collection` thì hai bản lệch nhau ngay lần đầu có ai trỏ `category` sang
 * một loại khác, và bản KHÔNG được sửa là bản dùng để định tuyến: URL vẫn khớp, vẫn
 * render, chỉ là tra slug trong một loại không còn liên quan.
 *
 * `null` cho mọi ca không phân giải được — vai khác, thiếu `field`, field không có
 * thật, hoặc field có thật nhưng không phải `relation`. Chỗ gọi phải coi `null` là
 * "URL này không có thật", không phải "bỏ qua điều kiện": xem `resolveTarget`.
 *
 * `getCollectionTypes` đã bọc cache và đã được gọi ở đường render (`expandAllRelations`
 * gọi chính nó), nên đây không phải một lượt đọc DB mới trong ca thường.
 */
export async function relationTargetType(col: PageCollection): Promise<string | null> {
  if (col.param !== 'relation' || !col.field) return null;
  const shape = (await getCollectionTypes()).find((t) => t.key === col.typeKey);
  if (!shape) return null;
  const def = (shape.schema as FieldDef[]).find((f) => f.key === col.field);
  return def && def.t === 'relation' ? def.typeKey : null;
}

/**
 * Bản ghi mà đoạn động trỏ tới. `null` = URL không có thật.
 *
 * Đi qua `getEntryBySlug`, nên phép lọc "đã đăng và đã tới mốc" là CHÍNH phép lọc
 * của trang chi tiết — một danh mục còn nháp không được có trang công khai, y như
 * một bài còn nháp.
 */
export async function relationEntryBySlug(
  col: PageCollection,
  slug: string,
  locale?: string,
): Promise<EntryRow | null> {
  const targetType = await relationTargetType(col);
  if (!targetType) return null;
  return getEntryBySlug(targetType, slug, locale);
}

/**
 * Gốc của mẫu `param:'relation'` phục vụ một loại ĐÍCH, ví dụ '/blogs' cho `danh-muc`.
 *
 * Anh em của `detailBaseForType` / `taxonomyBaseForType`, và tồn tại vì đúng lý do
 * của chúng: một bản ghi `danh-muc` hiện ra dưới dạng huy hiệu trên thẻ tin cần một
 * href, và href ấy trỏ tới trang danh mục — thứ mà loại `danh-muc` có thay cho một
 * trang chi tiết riêng.
 */
export const relationBaseForType = (targetTypeKey: string) =>
  unstable_cache(
    async () => {
      for (const t of await listPageTemplates()) {
        if (t.collection.param !== 'relation') continue;
        if ((await relationTargetType(t.collection)) === targetTypeKey) {
          return baseOfTemplate(t.slug);
        }
      }
      return null;
    },
    ['relation-base', targetTypeKey],
    { tags: ['release', collectionTag(targetTypeKey)], revalidate: 3600 },
  )();

/* ── Xem trước ────────────────────────────────────────────────────────── */

export interface PreviewBinding {
  detailBase?: string;
  taxonomyBase?: string;
  entry?: EntryRow;
  urlTaxonomyId?: string;
  /** Bản ghi đích của vai `relation`, trên trang danh mục kiểu mới. */
  urlRelationId?: string;
  /** Chữ cho dải xem trước: "đang xem với: Lãi suất tháng 8". `null` = trang thường. */
  label: string | null;
}

/**
 * Ngữ cảnh collection cho một trang đang ở BẢN NHÁP.
 *
 * ## Vì sao preview cần hàm riêng thay vì gọi `resolveTarget`
 *
 * URL xem trước là `/preview/<pageId>` — nó không mang giá trị đoạn động. Một trang
 * `blogs/post/[slug]` xem trước thì không có bài nào để mở, và câu trả lời đúng KHÔNG
 * phải là render mẫu rỗng: đó chính là cái bẫy đã tốn một buổi ngày 08/09/2026, khi
 * một khối `repeat` hợp lệ hiện ra một thẻ chưa bind, người dựng kết luận "repeat
 * chưa có runtime", rồi đi đường vòng dựng 11 instance tĩnh bằng ~40 op. Toàn bộ chi
 * phí đến từ việc preview nói dối.
 *
 * Nên: không có giá trị thì lấy BẢN GHI MỚI NHẤT, và nói ra là đang xem với bản nào.
 * `?param=<giá trị>` để chọn đúng một bản.
 *
 * ## Vì sao entry và taxonomy đọc bản LIVE khi doc đọc bản nháp
 *
 * Entry có vòng đời publish riêng — "bấm Đăng là lên site ngay", không đi qua release.
 * Nên không có "bản nháp của một entry" để mà đọc; bản live LÀ bản duy nhất.
 */
export async function previewBinding(args: {
  collection: PageCollection | null;
  /** Giá trị `?param=` người dùng gõ, nếu có. */
  paramValue?: string;
  locale?: string;
}): Promise<PreviewBinding> {
  const col = args.collection;
  if (!col) return { label: null };

  const [detailBase, taxonomyBase] = await Promise.all([
    detailBaseForType(col.typeKey),
    taxonomyBaseForType(col.typeKey),
  ]);
  const bases = {
    detailBase: detailBase ?? undefined,
    taxonomyBase: taxonomyBase ?? undefined,
  };

  if (col.param === 'list') return { ...bases, label: null };

  if (col.param === 'taxonomy') {
    const tax = args.paramValue
      ? await taxonomyByKey(col.typeKey, args.paramValue)
      : await prisma.taxonomy.findFirst({
          where: { typeKey: col.typeKey },
          orderBy: [{ order: 'asc' }, { name: 'asc' }],
          select: { id: true, key: true, name: true },
        });
    return tax
      ? { ...bases, urlTaxonomyId: tax.id, label: `danh mục "${tax.name}"` }
      : { ...bases, label: 'chưa có danh mục nào để xem thử' };
  }

  /*
   * Vai `relation`: đoạn động là slug của một BẢN GHI thuộc loại đích.
   *
   * Dùng `getEntryForPreview` chứ không `relationEntryBySlug` vì đúng lý do nhánh
   * entry ngay dưới dùng nó: người đang dựng mẫu thường vừa tạo một danh mục thử và
   * chưa đăng nó, và một màn xem trước trống đúng lúc nó cần hữu ích nhất là cái bẫy
   * mà cả hàm này tồn tại để tránh.
   */
  if (col.param === 'relation') {
    const targetType = await relationTargetType(col);
    if (!targetType) {
      return {
        ...bases,
        label: `vai này trỏ tới field "${col.field ?? ''}" — không phải một field relation của loại "${col.typeKey}"`,
      };
    }
    const target = await getEntryForPreview(targetType, args.paramValue, args.locale);
    return target
      ? { ...bases, urlRelationId: target.id, label: `mục "${target.slug}"` }
      : { ...bases, label: `chưa có bản ghi "${targetType}" nào để xem thử` };
  }

  const entry = await getEntryForPreview(col.typeKey, args.paramValue, args.locale);

  return entry
    ? { ...bases, entry, label: `bài "${entry.slug}"` }
    : { ...bases, label: 'chưa có bài nào để xem thử' };
}

/* ── Khối lặp ─────────────────────────────────────────────────────────── */

export interface ResolvedRepeats {
  items: Map<NodeId, RepeatItem[]>;
  groups: Map<NodeId, { item: RepeatItem; taxonomyId: string }[]>;
  groupEntries: Map<NodeId, Map<string, RepeatItem[]>>;
}

function repeatNodes(doc: Doc): InstanceNode[] {
  return Object.values(doc.nodes).filter(
    (n): n is InstanceNode => n.type === 'Instance' && n.repeat !== undefined,
  );
}

/** `nodeId` có nằm dưới `ancestorId` không. `seen` chặn treo nếu doc có cycle. */
function hasAncestor(doc: Doc, nodeId: NodeId, ancestorId: NodeId): boolean {
  let cur = doc.nodes[nodeId]?.parentId ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return false;
}

/**
 * Mọi khối lặp của một doc, giải quyết song song.
 *
 * ## "FAQ theo danh mục" là HAI truy vấn, và đây là chỗ giữ lời hứa đó
 *
 * Cấp ngoài (`taxonomy`) và cấp trong (`group-entries`) dùng CHUNG một lượt
 * `resolveTaxonomyTree`, vốn gọi `taxonomyGroups()` đúng một lần = hai truy vấn
 * (danh mục, rồi entry của mọi danh mục). Cách hiển nhiên hơn — để cấp trong tự
 * resolve khi renderer đi tới nó — là N+1 với N là số danh mục, VÀ nó bắt renderer
 * phải async. Cả hai hậu quả đều không lộ ra cho tới khi có danh mục thứ ba mươi.
 *
 * `limit` của truy vấn thứ hai lấy từ cấp TRONG, vì chính nó quyết định mỗi nhóm lấy
 * bao nhiêu bài. Không có cấp trong (một khối chỉ liệt kê tên danh mục) thì `1` là đủ
 * — nhưng vẫn phải > 0, vì `taxonomyGroups` dùng nó làm `take`.
 *
 * ## Ghi chú về lồng hai cấp
 *
 * Cây "outer `taxonomy` → inner `group-entries`" DỰNG ĐƯỢC qua đường op từ
 * 11/09/2026. Trước đó thì không: `Instance` nằm trong `LEAF_TYPES` nên không
 * nhận node con, và code ở đây (cùng luật `repeat_group_parent`) là phần đã sẵn
 * sàng cho một đường ghi chưa tồn tại — nhánh `group-entries` chỉ chạy khi có ai
 * dựng doc bằng tay.
 *
 * Giờ `nestedRepeatIssue` ở validator mở đúng một cửa: một Instance đang lặp theo
 * `taxonomy` nhận MỘT con, và con ấy phải là Instance lặp nguồn `group-entries`.
 * `Instance` vẫn ở trong `LEAF_TYPES`, nên mọi instance thường không đổi gì.
 *
 * Vẫn còn một hạn chế: `applyOpsToPreset` chặn `Instance` lồng trong cây
 * component. Đó là ràng buộc khác và nó vẫn đúng — cây ở đây nằm trong DOC.
 */
export async function resolveAllRepeats(doc: Doc, ctx: RepeatContext): Promise<ResolvedRepeats> {
  const out: ResolvedRepeats = { items: new Map(), groups: new Map(), groupEntries: new Map() };
  const all = repeatNodes(doc);

  await resolveEach(all, doc, ctx, out);
  await expandAllRelations(out, ctx.locale);

  return out;
}

async function resolveEach(
  all: InstanceNode[],
  doc: Doc,
  ctx: RepeatContext,
  out: ResolvedRepeats,
): Promise<void> {
  await Promise.all(
    all.map(async (n) => {
      const spec = n.repeat!;

      if (spec.source.kind === 'taxonomy') {
        const inner = all.find(
          (m) => m.repeat!.source.kind === 'group-entries' && hasAncestor(doc, m.id, n.id),
        );
        const innerSource = inner?.repeat!.source;
        const limit = innerSource && innerSource.kind === 'group-entries' ? innerSource.limit : 1;

        const tree = await resolveTaxonomyTree(spec.source.typeKey, limit, ctx.locale);
        out.groups.set(n.id, tree.groups);
        if (inner) out.groupEntries.set(inner.id, tree.entriesByTaxonomy);
        return;
      }

      // Cấp trong được nạp cùng lượt với cấp ngoài ngay trên. Bỏ qua ở đây CÓ CHỦ ĐÍCH
      // — resolve nó riêng là đúng cái N+1 mà cả khối này tồn tại để tránh.
      if (spec.source.kind === 'group-entries') return;

      out.items.set(n.id, await resolveRepeat(spec, ctx));
    }),
  );
}

/** Mọi item của mọi khối lặp, gộp một danh sách phẳng để đi qua một lượt. */
function allItems(resolved: ResolvedRepeats): RepeatItem[] {
  const out: RepeatItem[] = [];
  for (const list of resolved.items.values()) out.push(...list);
  for (const groups of resolved.groups.values()) for (const g of groups) out.push(g.item);
  for (const byTax of resolved.groupEntries.values()) {
    for (const list of byTax.values()) out.push(...list);
  }
  return out;
}

/**
 * Nở mọi field `relation` của MỌI khối lặp trên trang — trong một lượt.
 *
 * ## Vì sao ở đây chứ không trong `resolveRepeat`
 *
 * Vì gộp cả trang lại mới cắt được lượt đọc. Ba khối trên một trang danh sách
 * thường trỏ tới cùng một nhúm chuyên đề; nở từng khối riêng là ba truy vấn cho
 * cùng một tập ID, và nở từng ITEM riêng là N+1 với N là số thẻ — đúng thứ mà
 * cả tầng này được viết ra để tránh.
 *
 * Ở đây cũng là chỗ DUY NHẤT biết `detailBaseForType`: gốc trang chi tiết của
 * loại ĐÍCH, thứ mà `resolve-repeat.ts` không với tới được (nó nằm dưới file
 * này trong đồ thị import).
 *
 * ## Chi phí, nói thẳng
 *
 * Trang KHÔNG có field `relation` nào: 0 truy vấn thêm — vòng lặp đầu thoát sớm.
 * Trang có: 1 truy vấn cho toàn bộ bản ghi đích, cộng `getCollectionTypes` (đã
 * cache) và một `detailBaseForType` cho mỗi LOẠI đích (cũng đã cache).
 *
 * Sửa `item.data` TẠI CHỖ: item vừa được dựng ở ngay trên, chưa ai giữ tham
 * chiếu tới nó, và dựng lại cả ba Map chỉ để thay một field là chép lại toàn bộ
 * kết quả của trang.
 */
async function expandAllRelations(resolved: ResolvedRepeats, locale?: string): Promise<void> {
  const items = allItems(resolved);
  if (!items.length) return;

  const types = await getCollectionTypes();
  const relByType = new Map<string, Extract<FieldDef, { t: 'relation' }>[]>();
  for (const t of types) {
    const rel = relationFields(t.schema as FieldDef[]);
    if (rel.length) relByType.set(t.key, rel);
  }
  if (!relByType.size) return;

  const ids = new Set<string>();
  for (const item of items) {
    const fields = item.typeKey ? relByType.get(item.typeKey) : undefined;
    if (!fields) continue;
    for (const f of fields) {
      for (const id of relationIds(item.data[f.key]).slice(0, MAX_RELATION_FANOUT)) ids.add(id);
    }
  }
  if (!ids.size) return;

  const targets = await relationTargets([...ids], locale);
  if (!targets.length) return;

  /*
   * Gốc trang chi tiết theo LOẠI ĐÍCH. Một lượt cho mỗi loại, không phải mỗi bản
   * ghi — `detailBaseForType` có cache, nhưng gọi nó 100 lần vẫn là 100 lần đi
   * qua lớp cache đó.
   *
   * Rơi về `relationBaseForType` khi loại đích KHÔNG có trang chi tiết: `danh-muc`
   * là loại như thế — mặt tiền công khai của nó là trang danh mục `/blogs/[…]`, chứ
   * không phải một trang riêng cho từng danh mục. Không có nhánh rơi này thì huy
   * hiệu danh mục trên mọi thẻ tin ra `href` rỗng. Chỉ chạm ca `detailBase === null`,
   * nên không href nào đang chạy đổi.
   */
  const targetTypes = [...new Set(targets.map((t) => t.typeKey))];
  const bases = new Map(
    await Promise.all(
      targetTypes.map(
        async (k) =>
          [k, (await detailBaseForType(k)) ?? (await relationBaseForType(k))] as const,
      ),
    ),
  );

  const refById = new Map(
    targets.map((t) => {
      const shape = types.find((x) => x.key === t.typeKey);
      return [
        t.id,
        toRelationRef(
          t,
          shape ? { titleField: shape.titleField, fields: shape.schema as FieldDef[] } : null,
          bases.get(t.typeKey) ?? null,
        ),
      ] as const;
    }),
  );

  for (const item of items) {
    const fields = item.typeKey ? relByType.get(item.typeKey) : undefined;
    if (!fields) continue;
    item.data = expandRelations(item.data, fields, refById);
  }
}

/**
 * Mọi `assetId` mà các khối lặp sẽ hỏi tới.
 *
 * Tính bằng chính `itemOverrides` chứ không bằng một vòng đọc `spec.map` thứ hai: hai
 * bản của cùng một luật sẽ trôi khỏi nhau, và thứ trôi mất ở đây là "ảnh bìa không
 * hiện trên đúng một loại thẻ" — `ImageNode` trả `null` khi thiếu asset, im lặng.
 */
export function repeatAssetIds(doc: Doc, resolved: ResolvedRepeats): string[] {
  const ids = new Set<string>();
  for (const n of repeatNodes(doc)) {
    const spec = n.repeat!;
    const lists: RepeatItem[][] = [];
    const items = resolved.items.get(n.id);
    if (items) lists.push(items);
    const groups = resolved.groups.get(n.id);
    if (groups) lists.push(groups.map((g) => g.item));
    const byTax = resolved.groupEntries.get(n.id);
    if (byTax) for (const list of byTax.values()) lists.push(list);

    for (const list of lists) {
      for (const item of list) {
        for (const ov of Object.values(itemOverrides(item, spec, {}))) {
          if (typeof ov.assetId === 'string') ids.add(ov.assetId);
        }
      }
    }
  }
  return [...ids];
}

/* ── Thân bài của trang chi tiết ──────────────────────────────────────── */

/**
 * `data` đi qua NGUYÊN TRẠNG từ JSONB, nên mỗi giá trị phải được kiểm trước khi render:
 * một field vừa đổi kiểu, hoặc một hàng lưu trước khi luật hiện tại tồn tại, sẽ mang
 * hình dạng khác. Bỏ qua field đó còn hơn ném — một bài lỗi không được làm trắng cả
 * trang, và người đọc vẫn thấy phần còn lại.
 */
function asRichDoc(v: unknown): RichDoc | null {
  const r = zRichDoc.safeParse(v);
  return r.success ? (r.data as RichDoc) : null;
}

function asRichText(v: unknown): RichText | null {
  const r = zRichText.safeParse(v);
  return r.success ? (r.data as RichText) : null;
}

/**
 * Field chữ của entry → ô cắm `part="entry:<field>"`.
 *
 * Cả `richdoc` VÀ `richtext`: hai kiểu field khác nhau, hai renderer khác nhau
 * (`RichDocView` có tầng khối, `RichTextView` chỉ inline), và một trang chi tiết thật
 * thường có cả hai — `richtext` cho sapo, `richdoc` cho thân bài. Chọn nhầm renderer
 * cho một trong hai là mất hết cấu trúc khối, im lặng.
 */
/**
 * `iframeHosts` là tham số BẮT BUỘC vì hàm này làm sạch, không chỉ thu thập.
 *
 * Field `html` đi ra khỏi đây dưới dạng chuỗi sẽ vào `dangerouslySetInnerHTML`. Làm
 * sạch ở ĐÂY chứ không trong `ArticleHtml`: component đó render được ở cả cây server
 * và cây client, còn danh sách host thì nằm trong database — xem docblock của
 * `ArticleHtml` cho lý do đầy đủ.
 *
 * Truyền `[]` là một câu trả lời hợp lệ và có nghĩa: bài sẽ không có iframe nào.
 */
export function entryBodies(
  fields: FieldDef[],
  data: Record<string, unknown>,
  iframeHosts: readonly string[],
) {
  const bodies = new Map<string, EntryBody>();
  const assetIds = new Set<string>();

  for (const f of fields) {
    const raw = data[f.key];
    if (raw === undefined || raw === null) continue;

    if (f.t === 'richdoc') {
      const doc = asRichDoc(raw);
      if (!doc || doc.length === 0) continue;
      for (const id of collectDocAssetIds(doc)) assetIds.add(id);
      bodies.set(f.key, { kind: 'doc', value: doc });
    } else if (f.t === 'html') {
      if (typeof raw !== 'string') continue;
      const { html } = sanitizeArticleHtml(raw, { iframeHosts });
      // `isBlankHtml` chứ không `html === ''`: một hàng ghi trước khi `entry-data.ts`
      // chuẩn hoá bài rỗng về `''` vẫn còn `<p>&nbsp;</p>` trong JSONB, và đặt nó vào
      // `bodies` làm ô thân bài "có nội dung" — tức node bố cục không còn render nội
      // dung mẫu, và trang chi tiết có một khoảng trắng không giải thích được.
      if (isBlankHtml(html)) continue;
      // Ảnh trong HTML dùng `src` tuyệt đối (adapter tải lên trả URL của kho), nên
      // không có `assetId` nào để thu — khác hẳn `figure` của `richdoc`.
      bodies.set(f.key, { kind: 'html', value: html });
    } else if (f.t === 'richtext') {
      const rt = asRichText(raw);
      if (!rt || rt.length === 0) continue;
      bodies.set(f.key, { kind: 'text', value: rt });
    } else if (f.t === 'text') {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      bodies.set(f.key, { kind: 'plain', value: raw });
    } else if (f.t === 'image') {
      // Ảnh bìa cho node Image `part="entry:<field>"` — xem `EntryBody`.
      const img = raw as { assetId?: unknown; alt?: unknown };
      if (typeof img.assetId !== 'string' || !img.assetId) continue;
      assetIds.add(img.assetId);
      bodies.set(f.key, {
        kind: 'image',
        assetId: img.assetId,
        alt: typeof img.alt === 'string' ? img.alt : '',
      });
    }
  }

  return { bodies, assetIds: [...assetIds] };
}

/* ── SEO của trang chi tiết ───────────────────────────────────────────── */

export type { EntrySeo };

/**
 * Metadata của một entry: field `seo` của bài TRƯỚC, luật suy ra từ cấu trúc SAU.
 *
 * ## Đổi ngày 21/10/2026
 *
 * Trước đây docblock này nói cố ý KHÔNG thêm ô "SEO title / SEO description / OG image"
 * vào form, vì người biên tập sẽ để trống chúng, và một `<title>` trống là thứ Google
 * hiển thị. Quyết định đó đổi vì dữ liệu nhập từ Strapi đã có SEO riêng từng bài
 * (component `shared.seo`), và không có chỗ chứa thì phải bỏ đi khi nhập.
 *
 * Lý do gốc vẫn được giữ: mọi ô của field `seo` là TUỲ CHỌN và là GIÁ TRỊ GHI ĐÈ. Ô
 * trống rơi về đúng luật suy ra cũ (`titleField`, `excerpt/summary/…`, ảnh đầu tiên),
 * nên mọi bài vẫn có metadata ngay từ bài đầu tiên, và một loại không có field SEO ra
 * y hệt như trước. Không bao giờ ra `<title>` hay description rỗng.
 *
 * Luật nằm ở `resolveEntrySeo` (`collections/seo.ts`) để form admin — khung xem trước
 * Google, placeholder — dùng CHÍNH luật này.
 *
 * `titleField` là khai báo của loại (`CollectionType.titleField`), nên nó luôn đúng
 * field kể cả khi loại đó gọi tiêu đề là `cau_hoi`.
 */
export function entrySeo(
  shape: { titleField: string | null; fields: FieldDef[] },
  data: Record<string, unknown>,
): EntrySeo {
  return resolveEntrySeo(shape, data);
}

/**
 * JSON-LD `Article` cho một trang chi tiết.
 *
 * Chỉ dùng khi template KHÔNG tự khai `jsonLd`. Lý do phải có mặc định: một template
 * dùng cho mọi bài nên `Page.jsonLd` của nó là MỘT blob giống hệt nhau ở mọi URL —
 * khai `headline` trong đó là nói với Google rằng bốn trăm bài cùng một tiêu đề. Không
 * khai gì thì bài viết không có structured data, tức mất rich result.
 *
 * Không có `url`/`mainEntityOfPage`: dựng chúng cần origin tuyệt đối, mà origin ở đây
 * đến từ biến môi trường và sai origin trong JSON-LD còn tệ hơn thiếu nó. Schema.org
 * không đòi hai field đó.
 *
 * `headline` là TÊN BÀI (`articleTitle`), không phải tiêu đề SEO: một tiêu đề SEO kiểu
 * "Lãi suất 8/2026 | Ưu đãi…" viết cho trang kết quả Google, không phải tên bài.
 */
export function articleJsonLd(args: {
  seo: Pick<EntrySeo, 'articleTitle' | 'articleDescription'>;
  publishedAt: Date | null;
  updatedAt: Date;
  imageUrl?: string;
}): Record<string, unknown> | null {
  if (!args.seo.articleTitle) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: args.seo.articleTitle,
    ...(args.seo.articleDescription ? { description: args.seo.articleDescription } : {}),
    ...(args.imageUrl ? { image: [args.imageUrl] } : {}),
    ...(args.publishedAt ? { datePublished: args.publishedAt.toISOString() } : {}),
    dateModified: args.updatedAt.toISOString(),
  };
}

/**
 * `structuredData` tự khai của bản ghi đích, cho trang danh mục `param:'relation'`.
 *
 * Chỉ giá trị ghi đè (`derive: false`): trang danh mục không tự sinh `Article` từ một
 * bản ghi danh mục.
 */
export async function relationStructuredData(target: EntryRow): Promise<JsonLd | null> {
  const shape = await typeShape(target.typeKey);
  return shape ? resolveEntrySeo(shape, target.data, { derive: false }).jsonLd : null;
}

/** Cấu trúc của một loại nội dung, lấy từ danh sách đã cache. */
export async function typeShape(typeKey: string) {
  const types = await getCollectionTypes();
  const t = types.find((x) => x.key === typeKey);
  return t ? { titleField: t.titleField, fields: t.schema as FieldDef[] } : null;
}

export type { EntryRow };
