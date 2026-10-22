import 'server-only';

/**
 * Đọc dữ liệu cho builder.
 *
 * Khác `render/page.ts` ở một điểm bản chất: builder luôn đọc **bản nháp**
 * (`Page.draftVersionId`), còn site công khai luôn đọc **release đang active**.
 * Hai đường tách hẳn nhau, nên sửa trong builder không bao giờ chạm tới thứ
 * khách đang xem — đó chính là ý nghĩa của draft/publish.
 *
 * Cũng KHÔNG bọc `unstable_cache`: builder phải thấy ngay thứ vừa lưu.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { rollbackWindowIds } from '@/lib/builder/rollback-window';
import { prisma } from '@/lib/db';
import { rootTokens, TOKENS_CSS } from '@/lib/design/token-source';
import { migrateDoc, migratePresetTree } from '@/lib/doc/migrate';
import { CURRENT_SCHEMA_VERSION, type Doc } from '@/lib/doc/types';
import { shareImageWarning } from '@/lib/render/share-meta';

export interface PageSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  updatedAt: Date;
  /** Bản nháp đã khác bản đang publish chưa. */
  hasUnpublishedChanges: boolean;
  isPublished: boolean;
  /** `Page.collection` thô — người đọc tự parse. */
  collection: unknown;
  /** Con trỏ bản nháp — để biết lần nhập gần nhất còn hoàn tác được không. */
  draftVersionId: string | null;
  /** `Page.system` — `'not-found'` cho trang 404 hệ thống, còn lại `null`. */
  system: string | null;
}

export async function listPages(): Promise<PageSummary[]> {
  const site = await prisma.site.findFirst({ select: { id: true, activeReleaseId: true } });
  if (!site) return [];

  const pages = await prisma.page.findMany({
    where: { siteId: site.id, archivedAt: null },
    orderBy: [{ slug: 'asc' }],
    select: {
      id: true, slug: true, title: true, description: true,
      updatedAt: true, draftVersionId: true, collection: true, system: true,
    },
  });

  const published = site.activeReleaseId
    ? await prisma.releaseEntry.findMany({
        where: { releaseId: site.activeReleaseId },
        select: { pageId: true, versionId: true },
      })
    : [];
  const publishedByPage = new Map(published.map((e) => [e.pageId, e.versionId]));

  return pages.map((p) => {
    const liveVersion = publishedByPage.get(p.id);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      updatedAt: p.updatedAt,
      isPublished: Boolean(liveVersion),
      // Nháp khác bản live, hoặc chưa publish lần nào.
      hasUnpublishedChanges: Boolean(p.draftVersionId) && p.draftVersionId !== liveVersion,
      collection: p.collection,
      draftVersionId: p.draftVersionId,
      system: p.system,
    };
  });
}

export interface ArchivedPage {
  id: string;
  slug: string;
  title: string;
  archivedAt: Date;
  /** Số release có chứa trang — xoá hẳn sẽ gỡ trang khỏi chừng ấy release. */
  releaseCount: number;
}

/**
 * Trang đã lưu trữ, mới nhất trước.
 *
 * Truy vấn RIÊNG chứ không một cờ trên `listPages`: mọi chỗ gọi `listPages` — trang
 * chủ builder, và bất cứ chỗ nào sau này — đều muốn danh sách trang đang dùng. Một
 * tham số `includeArchived` là một chỗ để quên, và quên ở đây nghĩa là trang đã xoá
 * hiện lại trong một danh sách nào đó.
 */
export async function listArchivedPages(): Promise<ArchivedPage[]> {
  const rows = await prisma.page.findMany({
    where: { archivedAt: { not: null } },
    orderBy: { archivedAt: 'desc' },
    select: { id: true, slug: true, title: true, archivedAt: true },
    take: 50,
  });
  // `ReleaseEntry.pageId` là cột trần, không có quan hệ tới `Page` — nên không `_count`
  // được, phải một lượt `groupBy` riêng cho cả trang lưu trữ.
  const counts = rows.length
    ? await prisma.releaseEntry.groupBy({
        by: ['pageId'],
        where: { pageId: { in: rows.map((r) => r.id) } },
        _count: { _all: true },
      })
    : [];
  const releasesOf = new Map(counts.map((c) => [c.pageId, c._count._all]));
  return rows.map((r) => ({ ...r, archivedAt: r.archivedAt!, releaseCount: releasesOf.get(r.id) ?? 0 }));
}

export interface DraftPage {
  id: string;
  slug: string;
  title: string;
  doc: Doc;
  versionId: string | null;
  versionLabel: string | null;
  /** Số phiên bản của bản nháp đang mở — chip trạng thái lưu hiện nó. */
  seq: number | null;
  /** `Page.collection` thô. Người đọc tự `parsePageCollection` — xem lý do ở `render/page.ts`. */
  collection: unknown;
  /**
   * Metadata SEO — khối "Trang" ở đáy pane phải bày ra và sửa nó.
   *
   * Đọc cùng lượt với doc chứ không một truy vấn riêng: đây là cùng một hàng
   * `Page`, nên bốn cột nữa không thêm lượt đọc nào. Trước 11/09/2026 không chỗ
   * nào trong builder đọc chúng, và cũng không chỗ nào ghi được — xem `setPageSeo`.
   */
  seo: {
    description: string | null;
    ogImageId: string | null;
    /** URL của ảnh chia sẻ RIÊNG của trang — thẻ xem trước trong khối "Trang" vẽ nó. */
    ogImageUrl: string | null;
    canonical: string | null;
    noindex: boolean;
    /** Chỉ CÓ hay KHÔNG: blob JSON không sửa được trong pane 300px. */
    hasJsonLd: boolean;
    /**
     * Ảnh chia sẻ có vấn đề gì không, tính từ luật của Facebook/Zalo.
     *
     * Tính ở ĐÂY vì luật cần `width`/`height` của asset — client không có chúng
     * nếu không đọc thêm kho ảnh, và một lượt đọc chỉ để hiện một dòng cảnh báo
     * là một lượt đọc cho mỗi lần mở trang sửa.
     */
    ogWarning: string | null;
  };
}

export async function getDraftPage(pageId: string): Promise<DraftPage | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true, slug: true, title: true, collection: true,
      description: true, ogImageId: true, canonical: true, noindex: true, jsonLd: true,
      draftVersion: { select: { id: true, doc: true, label: true, seq: true } },
    },
  });
  if (!page?.draftVersion) return null;

  /*
   * Ảnh chia sẻ đọc RIÊNG, sau truy vấn trang.
   *
   * `ogImageId` cố ý không có khoá ngoại (xem `Page.ogImageId`), nên `include`
   * không dùng được. Chỉ chạy khi trang CÓ đặt ảnh — trang không đặt thì không
   * tốn lượt đọc nào.
   */
  const ogAsset = page.ogImageId
    ? await prisma.asset.findUnique({
        where: { id: page.ogImageId },
        select: { url: true, width: true, height: true },
      })
    : null;

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    doc: migrateDoc(page.draftVersion.doc),
    versionId: page.draftVersion.id,
    versionLabel: page.draftVersion.label,
    seq: page.draftVersion.seq,
    collection: page.collection,
    seo: {
      description: page.description,
      ogImageId: page.ogImageId,
      ogImageUrl: ogAsset?.url ?? null,
      canonical: page.canonical,
      noindex: page.noindex,
      hasJsonLd: page.jsonLd !== null,
      ogWarning: page.ogImageId
        ? shareImageWarning({
            url: ogAsset?.url ?? '',
            width: ogAsset?.width,
            height: ogAsset?.height,
          })
        : null,
    },
  };
}

/**
 * `seq` của bản đang nằm trong release ĐANG CHẠY — mốc để đếm "bao nhiêu lần sửa
 * chưa publish".
 *
 * `null` nghĩa là trang này chưa publish lần nào, và ba đường dẫn tới nó đều xảy ra
 * thật: chưa có site, site chưa publish lần nào, hoặc release đang chạy không chứa
 * trang này (trang được tạo sau lần publish gần nhất). Cả ba đều đúng một câu trả
 * lời cho người dùng, nên không cần phân biệt ở đây.
 */
export async function publishedSeq(pageId: string): Promise<number | null> {
  const site = await prisma.site.findFirst({ select: { activeReleaseId: true } });
  if (!site?.activeReleaseId) return null;

  const entry = await prisma.releaseEntry.findUnique({
    where: { releaseId_pageId: { releaseId: site.activeReleaseId, pageId } },
    select: { version: { select: { seq: true } } },
  });
  return entry?.version.seq ?? null;
}

export interface ReleaseSummary {
  id: string;
  label: string;
  note: string | null;
  createdAt: Date;
  createdBy: string;
  isActive: boolean;
  pageCount: number;
}

export async function listReleases(limit = 20): Promise<ReleaseSummary[]> {
  const site = await prisma.site.findFirst({ select: { id: true, activeReleaseId: true } });
  if (!site) return [];

  const releases = await prisma.release.findMany({
    where: { siteId: site.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, label: true, note: true, createdAt: true, createdBy: true,
      _count: { select: { entries: true } },
    },
  });

  return releases.map((r) => ({
    id: r.id,
    label: r.label,
    note: r.note,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    isActive: r.id === site.activeReleaseId,
    pageCount: r._count.entries,
  }));
}

export interface PresetSummary {
  id: string;
  key: string;
  name: string;
  category: string;
  aiDescription: string;
  nodeCount: number;
  /**
   * Component do `scripts/extract-presets.ts` trích ra.
   *
   * Pane trái cần biết để cảnh báo TRƯỚC khi mở nó ra sửa: chạy lại script là
   * GHI ĐÈ, nên công sửa tay trên một builtin sẽ mất mà không có lỗi nào.
   */
  builtin: boolean;
  /**
   * Cây này được ghi ở schema CŨ hơn code đang chạy.
   *
   * Dưới mô hình "mỗi domain một bản builder, và các bản đó nâng cấp được", đây là
   * trường hợp THƯỜNG: nâng cấp builder làm `schemaVersion` tăng, và cây trong
   * database vẫn ở bản cũ cho tới khi có ai sửa nó.
   *
   * Site đang chạy AN TOÀN, vì `Release.components` đã chụp cây tại thời điểm
   * publish. Chỗ hở là BẢN NHÁP: người dùng mở builder lên và thấy một cây vừa
   * được migrate trong bộ nhớ, khác với thứ họ để lại lần trước.
   *
   * Chỉ BÁO, không tự sửa. Đây là mô hình "Check for updates" của Plasmic ở dạng
   * một dòng — người dùng phải biết cái gì đã đổi trước khi nó đổi trang của họ.
   */
  staleSchema: boolean;
  /** Cây node, để client sinh op chèn mà không cần gọi thêm API. */
  tree: unknown;
}

/**
 * Component tái dùng được.
 *
 * Preset là một CÂY NODE dựng sẵn, không phải template đóng: chèn xong thì mọi
 * node bên trong sửa được tự do. Đó là lý do trả luôn `tree` xuống client —
 * chèn preset chỉ là sinh ra N op `insertNode` bình thường, đi qua đúng
 * validator và undo được như mọi thao tác khác.
 */
export async function listPresets(): Promise<PresetSummary[]> {
  const rows = await prisma.preset.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: {
      id: true, key: true, name: true, category: true,
      aiDescription: true, tree: true, builtin: true,
    },
  });

  return rows.map((r) => {
    const raw = r.tree as { schemaVersion?: number; nodes?: Record<string, unknown> } | null;

    /*
     * Migrate cây TRƯỚC khi trả xuống client.
     *
     * Client dùng cây này để sinh op `insertNode`. Gửi một cây chưa nâng cấp nghĩa
     * là chèn node ở schema cũ vào một doc ở schema mới — validator có thể nhận,
     * và cái sai chỉ lộ ra lúc render.
     *
     * Cây hỏng thì trả về cây gốc kèm `nodeCount: 0`: pane trái vẫn liệt kê được
     * component đó để người dùng biết nó tồn tại và đang có vấn đề, thay vì nó biến
     * mất không dấu vết.
     */
    let tree: unknown = r.tree;
    try {
      tree = migratePresetTree(r.tree);
    } catch {
      tree = r.tree;
    }

    return {
      id: r.id, key: r.key, name: r.name, category: r.category,
      aiDescription: r.aiDescription,
      nodeCount: raw?.nodes ? Object.keys(raw.nodes).length : 0,
      builtin: r.builtin,
      // Thiếu `schemaVersion` cũng là lệch: nghĩa là cây ghi trước khi trường này
      // tồn tại, tức v1 — và nếu code đã lên v2 thì nó thật sự lạc hậu.
      staleSchema: (raw?.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION,
      tree,
    };
  });
}

export interface PresetCard {
  id: string;
  key: string;
  name: string;
  category: string;
  aiDescription: string;
}

/**
 * Component để BÀY, không phải để chèn.
 *
 * Tách khỏi `listPresets` vì cây node là phần nặng nhất của bảng Preset và
 * trang chủ không chèn gì cả — nó chỉ liệt kê. Dùng lại `listPresets` ở đây
 * nghĩa là đọc và deserialize toàn bộ cây của mọi preset để in ra vài cái tên.
 */
export async function listPresetCards(): Promise<PresetCard[]> {
  return prisma.preset.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: { id: true, key: true, name: true, category: true, aiDescription: true },
  });
}

// `listCustomTokens` từng ở đây, phục vụ khối "Biến màu tự tạo" của trang chủ.
// Khối đó nay là "Cài đặt" và đọc qua `builder/settings.ts` (`loadSettingsSummary`),
// thứ trả lời được cả câu ngôn ngữ/tổng số biến chứ không riêng màu tự tạo.

export interface TokenOption {
  name: string;
  value: string;
  category: string;
  /** Khai trong `src/styles/tokens.css` lõi — token mặc định của Quilder, không bày trong bộ chọn. */
  core?: boolean;
}

let coreNames: Set<string> | null = null;

/** Tên token khai trong `tokens.css` lõi. File là code, chỉ đổi khi deploy — đọc một lần. */
function coreTokenNames(): Set<string> {
  return (coreNames ??= new Set(rootTokens(readFileSync(join(process.cwd(), TOKENS_CSS), 'utf8')).keys()));
}

/**
 * Design token cho inspector.
 *
 * Nạp hết một lần và truyền xuống client thay vì gọi API mỗi lần chọn node: bảng
 * này nhỏ (vài trăm dòng, ~20KB) và gần như không đổi trong một phiên làm việc.
 * Một round-trip cho mỗi lần bấm vào element sẽ làm inspector giật.
 *
 * Đây cũng là thứ khiến "Cách B" dùng được: không có arbitrary value, nên gợi ý
 * token phải nằm ngay trong ô nhập — nếu không, người dùng không có cách nào
 * biết `space-l` tồn tại còn `space-large` thì không.
 */
export async function listTokens(): Promise<TokenOption[]> {
  const rows = await prisma.token.findMany({
    where: { deprecated: false },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: { name: true, value: true, category: true },
  });
  const core = coreTokenNames();
  return rows.map((r) => (core.has(r.name) ? { ...r, core: true } : r));
}

export interface ReleaseTimelineEntry extends ReleaseSummary {
  /** Trang có nội dung KHÁC release liền trước. */
  changedPages: { slug: string; title: string; kind: 'added' | 'changed' | 'removed' }[];
  /**
   * Trong cửa sổ rollback (`rollback-window.ts`): lùi về bản này được đảm bảo ra đúng
   * trang lúc publish, kể cả ảnh đã bị xoá hoàn toàn sau đó. `false` = không còn hứa.
   */
  inRollbackWindow: boolean;
}

/**
 * Lịch sử publish, kèm "bản này đổi gì so với bản trước".
 *
 * Danh sách release trần gần như vô dụng lúc cần lùi: mọi dòng đều tên
 * "Publish 2026-08-12 09:14" và không có gì phân biệt. Thứ người ta thật sự cần
 * biết là *bản nào đã đụng vào trang đang hỏng*.
 *
 * So sánh bằng `versionId` chứ không so nội dung: `PageVersion` là bất biến, nên
 * hai release trỏ cùng một versionId thì chắc chắn giống hệt nhau — không cần
 * đọc và diff hai cây JSON.
 */
export async function listReleaseTimeline(limit = 30): Promise<ReleaseTimelineEntry[]> {
  const site = await prisma.site.findFirst({ select: { id: true, activeReleaseId: true } });
  if (!site) return [];

  const releases = await prisma.release.findMany({
    where: { siteId: site.id },
    orderBy: { createdAt: 'desc' },
    // Lấy dư một bản để bản cuối trong danh sách vẫn so được với bản trước nó.
    take: limit + 1,
    select: {
      id: true, label: true, note: true, createdAt: true, createdBy: true,
      entries: { select: { pageId: true, versionId: true, slug: true } },
    },
  });

  const titles = new Map(
    (await prisma.page.findMany({ select: { id: true, title: true } })).map((p) => [p.id, p.title]),
  );

  // Danh sách bắt đầu từ bản MỚI NHẤT, nên thứ hạng trong nó cũng là thứ hạng trong
  // toàn bộ release — đủ để xét luật "N bản gần nhất" mà không đọc thêm hàng nào.
  const inWindow = rollbackWindowIds(releases, [site.activeReleaseId]);

  return releases.slice(0, limit).map((release, index) => {
    const previous = releases[index + 1];
    const changed: ReleaseTimelineEntry['changedPages'] = [];

    if (previous) {
      const before = new Map(previous.entries.map((e) => [e.pageId, e.versionId]));
      for (const entry of release.entries) {
        const was = before.get(entry.pageId);
        if (!was) {
          changed.push({ slug: entry.slug, title: titles.get(entry.pageId) ?? entry.slug, kind: 'added' });
        } else if (was !== entry.versionId) {
          changed.push({ slug: entry.slug, title: titles.get(entry.pageId) ?? entry.slug, kind: 'changed' });
        }
      }
      const now = new Set(release.entries.map((e) => e.pageId));
      for (const entry of previous.entries) {
        if (!now.has(entry.pageId)) {
          changed.push({ slug: entry.slug, title: titles.get(entry.pageId) ?? entry.slug, kind: 'removed' });
        }
      }
    }

    return {
      id: release.id,
      label: release.label,
      note: release.note,
      createdAt: release.createdAt,
      createdBy: release.createdBy,
      isActive: release.id === site.activeReleaseId,
      pageCount: release.entries.length,
      changedPages: changed.sort((a, b) => a.slug.localeCompare(b.slug)),
      inRollbackWindow: inWindow.has(release.id),
    };
  });
}

/**
 * Tên site và ảnh chia sẻ MẶC ĐỊNH — thứ thẻ chia sẻ của một trang lùi về khi trang
 * không đặt ảnh riêng. Cùng thứ tự ưu tiên với `generateMetadata` của site.
 *
 * Đọc thẳng bảng, không qua `getSiteShare`: hàm đó cache tới một giờ cho site, còn
 * khối "Trang" trong builder phải nói đúng thứ đang có — người vừa đổi ảnh mặc định ở
 * màn Cài đặt rồi mở trang sửa sẽ không hiểu vì sao thẻ xem trước còn ảnh cũ.
 */
export async function siteShareDefaults(): Promise<{
  siteName: string | null;
  defaultImageUrl: string | null;
  titleTemplate: string | null;
  defaultDescription: string | null;
}> {
  const site = await prisma.site.findFirst({
    select: { name: true, ogImageId: true, seoTitleTemplate: true, seoDescription: true },
  });
  const image = site?.ogImageId
    ? await prisma.asset.findUnique({ where: { id: site.ogImageId }, select: { url: true } })
    : null;
  return {
    siteName: site?.name ?? null,
    defaultImageUrl: image?.url ?? null,
    titleTemplate: site?.seoTitleTemplate ?? null,
    defaultDescription: site?.seoDescription ?? null,
  };
}
