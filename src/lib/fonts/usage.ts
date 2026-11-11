/**
 * Token đang được dùng ở trang nào, component nào — dùng chung cho màn Font, cho
 * `DELETE /api/design-tokens/[id]` và cho phép chặn xoá họ/face font.
 *
 * ## Quét cả bản nháp lẫn bản đang chạy
 *
 * Chỉ quét nháp là bỏ sót trường hợp nguy hiểm nhất: node đã bị gỡ khỏi nháp nhưng release
 * đang active vẫn dùng token đó. Xoá lúc ấy làm hỏng SITE THẬT trong khi builder trông sạch
 * sẽ. Nên trang quét `draftVersionId` + phiên bản trong `ReleaseEntry` của release đang
 * active, component quét `Preset.tree` + `Release.components` của release đó.
 *
 * ## Tìm trên chuỗi JSON thô
 *
 * `$token` chỉ xuất hiện đúng trong `TokenRef`, nên chuỗi `"$token":"tên"` không thể khớp
 * nhầm thứ khác. Duyệt cây sẽ phải biết trước MỌI chỗ một TokenRef có thể nằm (style, mọi
 * lớp breakpoint, prop của node, shadow…), và mỗi field mới thêm sau này là một chỗ quên.
 * `JSON.stringify` của Prisma Json không chèn khoảng trắng, nên dạng compact là dạng duy
 * nhất cần tìm; dấu `"` đóng sau tên giữ `font-gilroy` không khớp `font-gilroy-web`.
 */

import { prisma } from '@/lib/db';

export interface UsageRef {
  id: string;
  title: string;
  href: string;
}

export interface TokenUsage {
  pages: UsageRef[];
  components: UsageRef[];
}

const needleOf = (name: string) => `"$token":"${name}"`;

/** Như `tokenUsage` nhưng cho nhiều tên, đọc dữ liệu đúng một lần (màn Font cần mọi họ). */
export async function tokenUsageMany(names: string[]): Promise<Map<string, TokenUsage>> {
  const out = new Map<string, TokenUsage>(names.map((n) => [n, { pages: [], components: [] }]));
  if (!names.length) return out;

  const site = await prisma.site.findFirst({ select: { id: true, activeReleaseId: true } });

  // ── Trang ────────────────────────────────────────────────────────────────
  if (site) {
    const pages = await prisma.page.findMany({
      where: { siteId: site.id, archivedAt: null },
      select: { id: true, title: true, draftVersionId: true },
      orderBy: { title: 'asc' },
    });
    const live = site.activeReleaseId
      ? await prisma.releaseEntry.findMany({
          where: { releaseId: site.activeReleaseId },
          select: { pageId: true, versionId: true },
        })
      : [];
    const liveByPage = new Map(live.map((e) => [e.pageId, e.versionId]));

    const pagesOfVersion = new Map<string, string[]>();
    for (const p of pages) {
      for (const vid of [p.draftVersionId, liveByPage.get(p.id)]) {
        if (!vid) continue;
        pagesOfVersion.set(vid, [...(pagesOfVersion.get(vid) ?? []), p.id]);
      }
    }

    const hitPages = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
    if (pagesOfVersion.size) {
      const versions = await prisma.pageVersion.findMany({
        where: { id: { in: [...pagesOfVersion.keys()] } },
        select: { id: true, doc: true },
      });
      for (const v of versions) {
        const json = JSON.stringify(v.doc);
        for (const n of names) {
          if (!json.includes(needleOf(n))) continue;
          for (const pid of pagesOfVersion.get(v.id) ?? []) hitPages.get(n)!.add(pid);
        }
      }
    }
    for (const n of names) {
      const hits = hitPages.get(n)!;
      out.get(n)!.pages = pages
        .filter((p) => hits.has(p.id))
        .map((p) => ({ id: p.id, title: p.title, href: `/builder/${p.id}` }));
    }
  }

  // ── Component ────────────────────────────────────────────────────────────
  const presets = await prisma.preset.findMany({
    select: { id: true, name: true, tree: true },
    orderBy: { name: 'asc' },
  });
  const release = site?.activeReleaseId
    ? await prisma.release.findUnique({
        where: { id: site.activeReleaseId },
        select: { components: true },
      })
    : null;
  const liveTrees =
    release?.components && typeof release.components === 'object' && !Array.isArray(release.components)
      ? (release.components as Record<string, unknown>)
      : {};

  const titleOf = new Map(presets.map((p) => [p.id, p.name]));
  const treesOf = new Map<string, unknown[]>();
  for (const p of presets) treesOf.set(p.id, [p.tree]);
  for (const [id, tree] of Object.entries(liveTrees)) {
    treesOf.set(id, [...(treesOf.get(id) ?? []), tree]);
  }

  for (const [id, trees] of treesOf) {
    const json = trees.map((t) => JSON.stringify(t)).join('\n');
    for (const n of names) {
      if (!json.includes(needleOf(n))) continue;
      out.get(n)!.components.push({
        id,
        // Component đã xoá khỏi thư viện nhưng site thật vẫn chạy cây của nó.
        title: titleOf.get(id) ?? `Component đã xoá (${id})`,
        href: `/builder/components/${id}`,
      });
    }
  }

  return out;
}

/** Trang và component (nháp + release đang active) còn trỏ tới token `name`. */
export async function tokenUsage(name: string): Promise<TokenUsage> {
  return (await tokenUsageMany([name])).get(name)!;
}
