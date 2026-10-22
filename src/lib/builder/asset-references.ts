import 'server-only';

/**
 * Ai đang dùng những ảnh này — phần NẠP DB của phép kiểm trước khi xoá ảnh.
 *
 * Phép duyệt và lý do chọn nguồn nằm ở `asset-references-scan.ts`; file này chỉ nạp
 * dữ liệu thô và giao cho nó.
 *
 * ## Vì sao mỗi nguồn MỘT truy vấn cho cả lô, không một truy vấn mỗi ảnh
 *
 * "Dọn sạch thùng rác" gửi tới hai nghìn id một lượt. Hỏi theo từng ảnh là hai nghìn
 * lượt đọc lại toàn bộ bản nháp, entry, release — trong khi câu trả lời cho cả lô nằm
 * trong đúng một lượt đọc mỗi bảng. Số truy vấn ở đây cố định, không phụ thuộc số id.
 *
 * Chi phí còn lại là BỘ NHỚ: mọi bản nháp, mọi entry, mọi version mà một release trỏ
 * tới. Version dùng chung giữa các release được nạp MỘT lần (truy vấn thứ hai, theo
 * tập `versionId` khác nhau), không nạp lại theo từng release.
 */

import { prisma } from '@/lib/db';
import { componentsFromSnapshot } from '@/lib/render/components';
import {
  ASSET_TRANSLATION_FIELDS,
  scanAssetReferences,
  type AssetReferenceMap,
  type ReleaseSource,
} from './asset-references-scan';

export type { AssetReferenceMap, AssetUsage } from './asset-references-scan';

/**
 * Với mỗi id: chỗ đang dùng nó (chặn xoá) và release cũ sẽ vỡ ảnh nếu vẫn xoá.
 *
 * Mọi id đầu vào đều có mặt trong Map — rỗng nếu không ai dùng, kể cả id không còn
 * hàng `Asset` nào.
 */
export async function assetReferences(ids: readonly string[]): Promise<AssetReferenceMap> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();

  const [assets, pages, translations, presets, effectPresets, entries, sites, users, tokens, releases] =
    await Promise.all([
      prisma.asset.findMany({ where: { id: { in: unique } }, select: { id: true, key: true } }),
      // MỌI trang, kể cả đã lưu trữ — khôi phục là trang quay lại cùng ảnh của nó.
      prisma.page.findMany({
        select: {
          id: true, slug: true, title: true, archivedAt: true, ogImageId: true, jsonLd: true,
          draftVersion: { select: { doc: true } },
        },
      }),
      prisma.translation.findMany({
        where: { field: { in: [...ASSET_TRANSLATION_FIELDS] } },
        select: { pageId: true, locale: true, value: true },
      }),
      prisma.preset.findMany({ select: { id: true, name: true, tree: true } }),
      prisma.effectPreset.findMany({
        select: { id: true, name: true, effectKey: true, params: true },
      }),
      prisma.entry.findMany({
        select: {
          id: true, typeKey: true, slug: true, archivedAt: true, data: true, i18n: true,
          type: { select: { name: true, titleField: true } },
        },
      }),
      prisma.site.findMany({
        select: { faviconAssetId: true, ogImageId: true, globals: true, activeReleaseId: true },
      }),
      // Cột trỏ thẳng tới id: lọc ở DB được, khỏi nạp cả bảng người dùng.
      prisma.user.findMany({
        where: { avatarAssetId: { in: unique } },
        select: { email: true, name: true, avatarAssetId: true },
      }),
      prisma.token.findMany({ select: { name: true, value: true } }),
      /*
       * KHÔNG select `assets`: ảnh chụp đó chép MỌI asset có lúc publish, dùng hay
       * không. Doc thật của release mới là thứ nói ảnh nào đang hiện.
       */
      prisma.release.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, label: true, createdAt: true,
          components: true, translations: true, tokens: true, globals: true,
          entries: { select: { slug: true, versionId: true } },
        },
      }),
    ]);

  const versionIds = [...new Set(releases.flatMap((r) => r.entries.map((e) => e.versionId)))];
  const versions = versionIds.length
    ? await prisma.pageVersion.findMany({
        where: { id: { in: versionIds } },
        select: { id: true, doc: true },
      })
    : [];

  const liveIds = new Set(sites.map((s) => s.activeReleaseId).filter((id): id is string => !!id));
  const liveReleases: ReleaseSource[] = [];
  const oldReleases: ReleaseSource[] = [];
  for (const r of releases) {
    const source: ReleaseSource = {
      id: r.id,
      label: r.label,
      createdAt: r.createdAt,
      entries: r.entries,
      // Cây của CHÍNH release đó: sửa hay xoá component sau khi publish không đổi
      // thứ site thật đang vẽ.
      components: componentsFromSnapshot(r.components),
      translations: r.translations,
      tokens: r.tokens,
      globals: r.globals,
    };
    (liveIds.has(r.id) ? liveReleases : oldReleases).push(source);
  }

  return scanAssetReferences(unique, assets, {
    pages: pages.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      archived: p.archivedAt !== null,
      ogImageId: p.ogImageId,
      jsonLd: p.jsonLd,
      draftDoc: p.draftVersion?.doc ?? null,
    })),
    draftTranslations: translations,
    presets,
    effectPresets,
    entries: entries.map((e) => ({
      id: e.id,
      typeKey: e.typeKey,
      typeName: e.type.name,
      titleField: e.type.titleField,
      slug: e.slug,
      archived: e.archivedAt !== null,
      data: e.data,
      i18n: e.i18n,
    })),
    sites,
    users,
    tokens,
    liveReleases,
    oldReleases,
    versionDocs: new Map(versions.map((v) => [v.id, v.doc])),
  });
}
