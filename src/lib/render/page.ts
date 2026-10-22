/**
 * Đọc trang đã publish.
 *
 * Đường đi: Site.activeReleaseId → ReleaseEntry(slug) → PageVersion.doc.
 * Publish và rollback đều chỉ đổi `activeReleaseId`, nên hàm này không cần biết
 * gì về chuyện đó — nó luôn đọc "bản đang chạy" theo đúng một con trỏ.
 *
 * Prisma không phải `fetch`, nên Next không tự cache. Phải bọc `unstable_cache`
 * với tag để `revalidateTag` lúc publish có tác dụng.
 */

import { unstable_cache } from 'next/cache';

import { effectAssetIds } from '@/lib/builder/asset-refs';
import { prisma } from '@/lib/db';
import { migrateDoc } from '@/lib/doc/migrate';
import type { Doc } from '@/lib/doc/types';
import { instanceAssetIds, styleAssetIds } from './instance';
import type { AssetSeal } from './release-snapshot';

export interface PublishedPage {
  pageId: string;
  slug: string;
  title: string;
  description: string | null;
  /**
   * Ảnh chia sẻ RIÊNG của trang — `og:image`.
   *
   * Cột `Page.ogImageId` có từ đầu, nhưng `loadFromRelease` chưa bao giờ select nó
   * và `generateMetadata` chưa bao giờ đọc nó. Hệ quả đo được: mọi trang KHÔNG
   * phải bài viết đều chia sẻ ra một thẻ không ảnh.
   */
  ogImageId: string | null;
  canonical: string | null;
  noindex: boolean;
  jsonLd: unknown;
  doc: Doc;
  siteGlobals: Record<string, unknown>;
  releaseId: string;
  /**
   * Ảnh chụp bản dịch của chính release này — xem `Release.translations`.
   *
   * Đi kèm trang chứ không phải một truy vấn riêng: nó nằm cùng release, nên tách
   * ra là một lượt đọc nữa cho cùng một hàng, và mở đường cho hai bên lệch nhau
   * nếu có lần publish chen vào giữa.
   */
  translations: unknown;
  /** Ảnh chụp cây component của chính release này — xem `Release.components`. */
  components: unknown;
  /**
   * Ảnh chụp token tự tạo của chính release này — xem `Release.tokens`.
   *
   * Rỗng trong HAI trường hợp không phân biệt được, và không cần phân biệt:
   * release cũ chưa có cột này, hoặc site không có token tự tạo nào. Cả hai đều
   * nghĩa là "không phát khai báo `:root` nào".
   */
  tokens: Record<string, string>;
  /**
   * Ảnh chụp metadata asset của chính release này — xem `Release.assets`.
   *
   * Rỗng với release cũ. Lúc đó ảnh không hiện — và đó là hành vi ĐÚNG cho một
   * bản chụp không có dữ liệu ảnh, còn hơn là lặng lẽ rơi về bảng live và làm
   * người soát tưởng release cũ vẫn nguyên vẹn.
   */
  assets: Record<string, AssetSeal>;
  /**
   * `Page.collection` NGUYÊN TRẠNG — `{ typeKey, mode }` hoặc `null`.
   *
   * Để `unknown` chứ không parse ở đây: `parsePageCollection` sống ở
   * `collection-page.ts`, và file đó đã import file này. Parse tại đây là một vòng
   * import, và cách chữa vòng import bằng một bản parse thứ hai là đúng thứ trôi khỏi
   * nhau sau lần đầu có ai thêm một `mode`.
   *
   * Đọc từ ảnh chụp? Không: cột này quyết trang này LÀ GÌ (danh sách / chi tiết /
   * trang thường), tức chuyện định tuyến, không phải nội dung được niêm phong.
   */
  collection: unknown;
  /**
   * `Page.system` — `'not-found'` hoặc `null`. Trang hệ thống không mở thẳng bằng URL:
   * catch-all thấy cột này thì trả 404. Cũng là cột định tuyến, đọc từ bảng live.
   */
  system: string | null;
}

async function loadPublishedPage(slug: string): Promise<PublishedPage | null> {
  const site = await prisma.site.findFirst({
    where: { activeReleaseId: { not: null } },
    // KHÔNG select `globals`: nó giờ đến từ ảnh chụp của release. Đọc bảng live ở
    // đây nghĩa là sửa hotline hay số giấy phép là đổi ngay site đang chạy — bỏ
    // qua publish, và im lặng.
    select: { id: true, activeReleaseId: true },
  });
  if (!site?.activeReleaseId) return null;

  return loadFromRelease(site.activeReleaseId, slug);
}

/**
 * Một trang, đọc từ MỘT release cụ thể — không nhất thiết là release đang chạy.
 *
 * Tách khỏi `loadPublishedPage` để màn "xem một bản cũ trước khi lùi" dùng lại đúng
 * đường dựng trang của site thật. Một đường dựng thứ hai sẽ trôi khỏi đường này, và
 * thứ trôi mất chính là điều màn đó tồn tại để trả lời: *bản này trông ra sao*.
 */
async function loadFromRelease(releaseId: string, slug: string): Promise<PublishedPage | null> {
  const entry = await prisma.releaseEntry.findFirst({
    where: { releaseId, slug },
    select: {
      pageId: true,
      slug: true,
      version: { select: { doc: true } },
      release: {
        select: {
          translations: true,
          components: true,
          tokens: true,
          globals: true,
          assets: true,
        },
      },
    },
  });
  if (!entry) return null;

  const page = await prisma.page.findUnique({
    where: { id: entry.pageId },
    select: {
      title: true, description: true, ogImageId: true, canonical: true,
      noindex: true, jsonLd: true, archivedAt: true, collection: true, system: true,
    },
  });
  if (!page || page.archivedAt) return null;

  return {
    pageId: entry.pageId,
    slug: entry.slug,
    title: page.title,
    description: page.description,
    ogImageId: page.ogImageId,
    canonical: page.canonical,
    noindex: page.noindex,
    jsonLd: page.jsonLd,
    doc: migrateDoc(entry.version.doc),
    siteGlobals: (entry.release.globals ?? {}) as Record<string, unknown>,
    releaseId,
    translations: entry.release.translations,
    components: entry.release.components,
    tokens: (entry.release.tokens ?? {}) as Record<string, string>,
    assets: (entry.release.assets ?? {}) as unknown as Record<string, AssetSeal>,
    collection: page.collection,
    system: page.system,
  };
}

export function getPublishedPage(slug: string) {
  return unstable_cache(
    () => loadPublishedPage(slug),
    ['published-page', slug],
    {
      // 'release' bị invalidate mỗi lần publish/rollback; 'page:<slug>' cho phép
      // invalidate hẹp khi chỉ một trang đổi.
      tags: ['release', `page:${slug}`],
      revalidate: 3600,
    },
  )();
}

/**
 * Trang HỆ THỐNG đã publish trong release đang chạy (hiện chỉ có `'not-found'`).
 *
 * Tra theo `Page.system` rồi đọc bằng ĐÚNG `loadFromRelease` như mọi trang — slug của
 * trang hệ thống chỉ là nhãn, và nó có thể khác `404` (xem `ensureSiteDefaults`).
 * `null` khi trang chưa từng được publish: `not-found.tsx` khi đó dùng bản trong code.
 */
export function getPublishedSystemPage(kind: 'not-found') {
  return unstable_cache(
    async (): Promise<PublishedPage | null> => {
      const site = await prisma.site.findFirst({
        where: { activeReleaseId: { not: null } },
        select: { id: true, activeReleaseId: true },
      });
      if (!site?.activeReleaseId) return null;
      const page = await prisma.page.findFirst({
        where: { siteId: site.id, system: kind },
        select: { id: true },
      });
      if (!page) return null;
      const entry = await prisma.releaseEntry.findFirst({
        where: { releaseId: site.activeReleaseId, pageId: page.id },
        select: { slug: true },
      });
      if (!entry) return null;
      return loadFromRelease(site.activeReleaseId, entry.slug);
    },
    ['published-system-page', kind],
    { tags: ['release'], revalidate: 3600 },
  )();
}

/** Mọi slug đã publish — dùng cho sitemap và generateStaticParams. */
/**
 * Một trang của MỘT release, cho màn xem lại bản cũ.
 *
 * ## Vì sao cache theo `releaseId` mà không cần tag nào
 *
 * Release là **bất biến** — đó là bất biến trung tâm của cả hệ thống publish
 * (`PageVersion` chỉ thêm, `Release` chỉ tạo mới, lùi bản chỉ đổi con trỏ). Nên nội
 * dung của `release:<id>` không bao giờ đổi, và không có sự kiện nào cần xoá cache
 * này. Khác hẳn `getPublishedPage`, vốn phải gắn tag `release` vì "release đang chạy"
 * là một con trỏ di động.
 */
export function getReleasePage(releaseId: string, slug: string) {
  return unstable_cache(
    () => loadFromRelease(releaseId, slug),
    ['release-page', releaseId, slug],
    { revalidate: false },
  )();
}

/**
 * Tên site và ảnh chia sẻ mặc định — hai thứ mọi trang cần cho thẻ chia sẻ.
 *
 * ## Vì sao đọc bảng LIVE, không đọc ảnh chụp release
 *
 * Cùng lý lẽ với favicon (xem docblock của `Site.faviconAssetId`): đây là chrome
 * của site, không phải nội dung trang. Lùi một release để quay lại ảnh chia sẻ cũ
 * là hành vi không ai chờ đợi.
 *
 * ## Vì sao MỘT hàm cho cả hai
 *
 * Chúng nằm cùng một hàng `Site`, và mọi trang đều cần cả hai. Hai hàm là hai
 * truy vấn cho cùng một hàng, và hai khoá cache cho cùng một nhịp invalidate.
 *
 * Tag `release` chứ không một tag riêng: chỉnh tên site hay ảnh chia sẻ là thao
 * tác hiếm, và gộp vào nhịp đã có thì không phải dựng thêm một đường gỡ cache mà
 * mỗi chỗ ghi phải nhớ gọi.
 */
export const getSiteShare = unstable_cache(
  async (): Promise<{ name: string | null; ogImageId: string | null }> => {
    const site = await prisma.site.findFirst({ select: { name: true, ogImageId: true } });
    return { name: site?.name ?? null, ogImageId: site?.ogImageId ?? null };
  },
  ['site-share'],
  { tags: ['release'], revalidate: 3600 },
);

/** Slug của mọi trang trong một release, để màn xem lại có bộ chuyển trang. */
export function listReleaseSlugs(releaseId: string) {
  return unstable_cache(
    async () => {
      const rows = await prisma.releaseEntry.findMany({
        where: { releaseId },
        orderBy: { slug: 'asc' },
        select: { slug: true },
      });
      return rows.map((r) => r.slug);
    },
    ['release-slugs', releaseId],
    { revalidate: false },
  )();
}

export function getPublishedSlugs() {
  return unstable_cache(
    async () => {
      const site = await prisma.site.findFirst({
        where: { activeReleaseId: { not: null } },
        select: { activeReleaseId: true },
      });
      if (!site?.activeReleaseId) return [] as string[];
      const entries = await prisma.releaseEntry.findMany({
        where: { releaseId: site.activeReleaseId },
        select: { slug: true },
      });
      return entries.map((e) => e.slug);
    },
    ['published-slugs'],
    { tags: ['release'], revalidate: 3600 },
  )();
}

/**
 * Load asset theo id, gom một lần cho cả trang — CHỈ cho màn BẢN NHÁP.
 *
 * Site công khai KHÔNG dùng hàm này: nó đọc `Release.assets`. Đọc bảng live ở
 * đường publish nghĩa là thay một ảnh đổi ngay site đang chạy, bỏ qua publish —
 * đúng loại bypass mà `translations` và `components` đã đóng từ trước, chỉ khác
 * chỗ trú.
 *
 * Ba chỗ được phép gọi vì chúng hiển thị BẢN NHÁP, và cả ba đều cố ý đọc live:
 * `(site)/preview/[pageId]`, `(render)/render/[pageId]`,
 * `(render)/render/component/[id]`. Đừng "sửa cho nhất quán".
 *
 * Chỗ thứ tư, thêm ở mốc 3, có lý do KHÁC HẲN: `(site)/[[...slug]]` gọi nó cho ảnh
 * của NỘI DUNG — ảnh bìa của bài trong khối lặp, và ảnh trong thân bài `richdoc`.
 * Nội dung không đi qua nháp → publish ("bấm Đăng là lên site ngay", spec §3), nên
 * ảnh của một bài đăng chiều nay KHÔNG có trong ảnh chụp release sáng nay. Đọc ảnh
 * chụp ở đó là bài lên site mà không có ảnh, im lặng. Ảnh của cây NODE ở trang đó vẫn
 * đọc từ ảnh chụp — hai vòng đời, hai nguồn, và ranh giới nằm đúng ở "ai publish nó".
 */
export async function loadAssets(ids: string[]) {
  if (!ids.length) return {};
  const rows = await prisma.asset.findMany({
    where: { id: { in: ids } },
    // `mime` để `NodeRenderer` biết khi nào phải bỏ qua trình tối ưu ảnh — xem
    // nhánh SVG ở đó.
    select: { id: true, url: true, width: true, height: true, blurhash: true, mime: true },
  });
  return Object.fromEntries(rows.map((a) => [a.id, a]));
}

/** Mọi assetId doc tham chiếu — Image, Video, poster, background image, lô khung effect. */
export function collectAssetIds(
  doc: Doc,
  components?: ReadonlyMap<string, { nodes: Record<string, import('@/lib/doc/types').Node> }>,
): string[] {
  const ids = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    // Ảnh bên trong một instance: lấy theo bản ĐÃ PHỦ override, không phải theo
    // cây component. Lấy sai thì ảnh do người dùng thay không được nạp, và
    // `ImageNode` trả về null — ảnh biến mất mà không có lỗi nào.
    if (node.type === 'Instance') {
      const tree = components?.get(node.componentId);
      if (tree) for (const id of instanceAssetIds(tree, node.overrides)) ids.add(id);
    }
    if (node.type === 'Image' && node.assetId) ids.add(node.assetId);
    if (node.type === 'Video') {
      if (node.assetId) ids.add(node.assetId);
      if (node.posterAssetId) ids.add(node.posterAssetId);
    }
    // Ảnh nền, MỌI lớp — kể cả `states`, vốn là lớp lồng một cấp mà vòng lặp
    // cũ ở đây đọc trượt. Xem `styleAssetIds`.
    for (const id of styleAssetIds(node)) ids.add(id);
    /*
     * Lô khung của `image-sequence` — assetId nằm trong PARAMS của effect, không
     * nằm trong một node nào.
     *
     * Dùng lại `effectAssetIds` chứ không chép phép duyệt sang đây: bảng "tham
     * số nào chứa asset" phải có đúng một bản, nếu không thêm một effect mới sẽ
     * vá được nửa này mà quên nửa kia. Đó đúng là cách `styleAssetIds` đã lệch
     * một lần rồi.
     */
    for (const id of effectAssetIds(node)) ids.add(id);
  }
  return [...ids];
}
