/**
 * SEO của bài → metadata của trang — phần QUYẾT ĐỊNH của `generateMetadata`, tách ra
 * để test được.
 *
 * `[[...slug]]/page.tsx` là một React Server Component kéo theo Prisma và `server-only`,
 * nên test của nó đọc nguồn chứ không import (xem `site-page-routing.test.ts`). Những gì
 * có logic — thứ tự ưu tiên, robots, canonical, alt — nằm ở đây, thuần.
 */

import type { EntrySeo, JsonLd } from '@/lib/collections/seo';

export interface MetaBase {
  /** Tiêu đề đang có: của trang (hoặc bản dịch metadata của trang). */
  title: string;
  description: string | undefined;
  /** Canonical mặc định của trang này — với bài là URL của chính nó. */
  canonical: string | null;
  /** Robots của TRANG (cột `Page.noindex` của trang mẫu). */
  robots: { index: false; follow: false } | undefined;
}

export interface MetaFromSeo {
  /** Chuỗi tiêu đề — cho `og:title` và các chỗ cần chữ. */
  title: string;
  /** Giá trị `metadata.title`: `{ absolute }` khi là tiêu đề SEO, để không nối template. */
  titleMeta: string | { absolute: string };
  description: string | undefined;
  keywords: string | undefined;
  canonical: string | null;
  robots: { index: false; follow: boolean } | undefined;
  /** Ứng viên ảnh chia sẻ đầu tiên, trước ảnh của trang và của site. */
  imageAssetId: string | null;
  imageAlt: string | null;
}

/**
 * Áp SEO (đã phủ ngôn ngữ, đã qua luật rơi về) lên metadata của trang.
 *
 * - `metaTitle` phát dạng `title.absolute`: người gõ tiêu đề SEO đang viết đúng dòng
 *   Google hiện, và nối "| Tên site" vào là "… | MaiMoney | MaiMoney" trên dữ liệu nhập.
 * - Robots của TRANG MẪU thắng và giữ `follow:false` như hôm nay. `noindex` của BÀI là
 *   `follow:true`: bài ẩn khỏi Google vẫn để Google đi theo link sang bài khác.
 */
export function applySeoToMeta(base: MetaBase, seo: EntrySeo | null): MetaFromSeo {
  const title = seo?.title ?? base.title;
  return {
    title,
    titleMeta: seo?.titleIsOverride && seo.title ? { absolute: seo.title } : title,
    description: seo?.description ?? base.description,
    keywords: seo?.keywords ?? undefined,
    canonical: seo?.canonical ?? base.canonical,
    robots: base.robots ?? (seo?.noindex ? { index: false, follow: true } : undefined),
    imageAssetId: seo?.imageAssetId ?? null,
    imageAlt: seo?.imageAlt ?? null,
  };
}

/**
 * `og:image:alt`: alt của ảnh OG đã khai CHỈ khi ảnh được chọn đúng là ảnh đó.
 *
 * Ảnh OG có thể đã bị xoá khỏi kho, và ứng viên kế tiếp (ảnh của trang, của site) được
 * chọn — gắn alt của một ảnh khác vào nó là mô tả sai thứ đang hiện.
 */
export function ogImageAlt(
  pickedAssetId: string,
  seo: Pick<EntrySeo, 'imageAssetId' | 'imageAlt'> | null,
  title: string,
): string {
  return seo?.imageAlt && seo.imageAssetId === pickedAssetId ? seo.imageAlt : title;
}

/**
 * JSON-LD: bài tự khai → trang mẫu khai → `Article` tự sinh.
 *
 * Bài đứng trước trang mẫu vì nó cụ thể hơn: trang mẫu dùng chung cho mọi bài, nên
 * `jsonLd` của nó là một blob giống hệt nhau ở mọi URL. `auto` là hàm để `Article` chỉ
 * được dựng khi thật sự cần.
 */
export function pickJsonLd(args: {
  entryJsonLd: JsonLd | null;
  pageJsonLd: unknown;
  auto: () => Record<string, unknown> | null;
}): unknown {
  return args.entryJsonLd ?? args.pageJsonLd ?? args.auto();
}
