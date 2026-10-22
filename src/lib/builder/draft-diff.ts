import 'server-only';

/**
 * So bản nháp với bản đang chạy trên site.
 *
 * ## Vì sao thứ này tồn tại
 *
 * Quyết định của Đợt 2 là "Agent dựng, người soát và Publish". Người soát cần trả
 * lời được một câu trước khi bấm nút: **trang sắp lên khác trang đang chạy ở chỗ
 * nào**. Không có công cụ này thì cách duy nhất là mở hai tab và nhìn.
 *
 * Agent dùng CÙNG dữ liệu đó để tự kiểm trước khi báo xong — nó thay câu "tôi đã
 * sửa xong" bằng "tôi đã sửa 3 node, đây là chữ trước và sau".
 *
 * ## Vì sao chỉ so id node và chữ thuần
 *
 * Diff style ở mức thuộc tính là một dự án riêng, và với người soát nó là nhiễu:
 * "n42.style.md.spacing.pt đổi từ 24 sang 32" không trả lời được câu hỏi trên.
 * Thứ trả lời được là: thêm gì, mất gì, chữ nào đổi.
 *
 * ## Vì sao cả hai doc phải đi qua `migrateDoc` TRƯỚC khi so
 *
 * Bản live nằm trong một `PageVersion` có thể đã cũ vài tháng. Không migrate thì
 * một lần tăng `schemaVersion` sẽ hiện thành "mọi node đều đổi" — báo cáo đúng về
 * mặt byte và vô dụng về mặt ý nghĩa.
 */

import { prisma } from '@/lib/db';
import { diffDocs, type DocDiff } from './doc-diff';
import { describeDiff, liveHref, type DiffView } from './diff-view';
import { migrateDoc } from '@/lib/doc/migrate';
import type { Doc } from '@/lib/doc/types';

// Phép so đã chuyển sang `./doc-diff` — nó thuần, còn file này khai `server-only`
// và import prisma. Re-export để mọi chỗ đang import từ đây vẫn chạy.
export { diffDocs, type DocDiff, type TextChange } from './doc-diff';

export interface PageDiff {
  pageId: string;
  slug: string;
  title: string;
  status: 'moi' | 'da-sua' | 'khong-doi';
  diff: DocDiff;
}

/** Bản nháp + bản đang chạy (đã migrate) của mọi trang, hoặc một trang. */
async function loadPairs(pageId?: string) {
  const site = await prisma.site.findFirst({ select: { id: true, activeReleaseId: true } });
  if (!site) return [];

  const pages = await prisma.page.findMany({
    where: {
      siteId: site.id,
      archivedAt: null,
      draftVersionId: { not: null },
      ...(pageId ? { id: pageId } : {}),
    },
    orderBy: { slug: 'asc' },
    select: {
      id: true, slug: true, title: true,
      draftVersion: { select: { doc: true } },
    },
  });

  const liveByPage = new Map<string, unknown>();
  if (site.activeReleaseId) {
    const entries = await prisma.releaseEntry.findMany({
      where: { releaseId: site.activeReleaseId },
      select: { pageId: true, version: { select: { doc: true } } },
    });
    for (const e of entries) liveByPage.set(e.pageId, e.version.doc);
  }

  return pages.map((p) => {
    const draft = migrateDoc(p.draftVersion!.doc);
    const rawLive = liveByPage.get(p.id);
    const live = rawLive ? migrateDoc(rawLive) : null;
    return { page: p, live, draft };
  });
}

function toPageDiff(p: { id: string; slug: string; title: string }, live: Doc | null, draft: Doc): PageDiff {
  const diff = diffDocs(live, draft);
  const touched = diff.added.length + diff.removed.length + diff.textChanged.length;
  return {
    pageId: p.id,
    slug: p.slug,
    title: p.title,
    status: live === null ? 'moi' : touched ? 'da-sua' : 'khong-doi',
    diff,
  };
}

/**
 * So bản nháp của mọi trang (hoặc một trang) với release đang chạy.
 *
 * Trang có `draftVersionId` nhưng không có `ReleaseEntry` là trang MỚI — chưa từng
 * lên site. Đó là trạng thái riêng, không phải "đã sửa": người soát cần biết mình
 * sắp công bố một địa chỉ mới chứ không phải sửa một địa chỉ đang có.
 */
export async function draftDiff(pageId?: string): Promise<PageDiff[]> {
  return (await loadPairs(pageId)).map(({ page, live, draft }) => toPageDiff(page, live, draft));
}

export interface PageDiffDetail extends PageDiff {
  /** Danh sách đã gom theo section, có tên và chữ — xem `diff-view.ts`. */
  view: DiffView;
  /** Địa chỉ bản đang chạy trên site; `null` = chưa lên site, hoặc trang mẫu. */
  liveHref: string | null;
}

/**
 * Chi tiết MỘT trang, cho hộp "Xem diff".
 *
 * Tách khỏi `draftDiff()` chứ không thêm trường vào nó: `draftDiff()` là thứ tool
 * MCP trả cho model, và nhãn/section cho người đọc chỉ phình payload đó ra. Nhãn phải
 * dựng ở server vì node BỊ XOÁ chỉ còn trong doc của bản đang chạy — client không có.
 */
export async function draftDiffDetail(pageId: string): Promise<PageDiffDetail | null> {
  const [pair] = await loadPairs(pageId);
  if (!pair) return null;
  const base = toPageDiff(pair.page, pair.live, pair.draft);
  return {
    ...base,
    view: describeDiff(pair.live, pair.draft, base.diff),
    liveHref: liveHref(base.slug, base.status),
  };
}

/** Một câu tiếng Việt để model thuật lại cho người dùng. */
export function summarize(diffs: PageDiff[]): string {
  const moi = diffs.filter((d) => d.status === 'moi');
  const sua = diffs.filter((d) => d.status === 'da-sua');

  if (!moi.length && !sua.length) {
    return 'Bản nháp giống hệt bản đang chạy — không có gì để publish.';
  }

  const parts: string[] = [];
  if (moi.length) parts.push(`${moi.length} trang MỚI (${moi.map((d) => `/${d.slug}`).join(', ')})`);
  for (const d of sua) {
    const bits: string[] = [];
    if (d.diff.added.length) bits.push(`thêm ${d.diff.added.length} node`);
    if (d.diff.removed.length) bits.push(`xoá ${d.diff.removed.length} node`);
    if (d.diff.textChanged.length) bits.push(`đổi chữ ở ${d.diff.textChanged.length} chỗ`);
    parts.push(`/${d.slug}: ${bits.join(', ')}`);
  }
  return parts.join('; ') + '. Site thật chưa đổi cho tới khi người dùng bấm Publish.';
}
