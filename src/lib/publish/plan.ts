/**
 * Hai phép tính thuần của publish: chọn phiên bản cho từng trang, và trộn ảnh
 * chụp bản dịch.
 *
 * Tách khỏi `app/api/publish/route.ts` vì đây là chỗ dễ sai nhất của tính năng
 * "publish từng trang" và là chỗ duy nhất kiểm được mà không cần database: một
 * lỗi ở đây không ném exception, nó chỉ lặng lẽ đẩy nhầm một trang lên site thật
 * — hoặc lặng lẽ gỡ một trang khỏi site vì quên mang nó sang release mới.
 */

import { pageMarkerKey, snapshotKey } from '@/lib/render/translations';

/** Một dòng trong `ReleaseEntry` sắp tạo. */
export interface PlannedEntry {
  id: string;
  slug: string;
  versionId: string;
}

export interface PlanInput {
  /** Mọi trang chưa lưu trữ của site. */
  sitePages: { id: string; slug: string; draftVersionId: string | null }[];
  /** Entry của release ĐANG CHẠY. Rỗng khi site chưa publish lần nào. */
  liveEntries: { pageId: string; slug: string; versionId: string }[];
  /** `null` = publish cả site. Mảng = chỉ những trang này lấy bản nháp. */
  selection: string[] | null;
}

export type PlanResult =
  | { ok: true; pages: PlannedEntry[]; publishedIds: string[] }
  | { ok: false; error: string };

/**
 * Dựng danh sách entry cho release mới.
 *
 * Publish cả site: mọi trang có bản nháp, lấy bản nháp. Trang chưa từng có nháp
 * không vào release — y như trước.
 *
 * Publish từng trang: nền là release đang chạy (giữ nguyên mọi trang khác), rồi
 * ghi đè đúng những trang được chọn bằng bản nháp của chúng. Hai điểm dễ mất khi
 * viết vội, và cả hai đều im lặng:
 *
 *  1. `slug` của trang KHÔNG publish phải lấy từ `ReleaseEntry`, không phải từ
 *     `Page`. Đổi slug là một thay đổi nháp; lấy `Page.slug` sẽ làm một lần đổi
 *     slug chưa publish lên sóng qua nút Publish của một trang khác.
 *  2. Trang đã xoá/lưu trữ trong release cũ thì KHÔNG mang sang — release mới
 *     không được hồi sinh một URL người dùng đã gỡ.
 */
export function planReleaseEntries({ sitePages, liveEntries, selection }: PlanInput): PlanResult {
  if (!selection) {
    const pages = sitePages
      .filter((p) => p.draftVersionId)
      .map((p) => ({ id: p.id, slug: p.slug, versionId: p.draftVersionId! }));
    return { ok: true, pages, publishedIds: pages.map((p) => p.id) };
  }

  const wanted = [...new Set(selection.filter((id) => !!id))];
  if (!wanted.length) return { ok: false, error: 'pageIds rỗng' };

  const byId = new Map(sitePages.map((p) => [p.id, p]));
  const bad = wanted.filter((id) => !byId.get(id)?.draftVersionId);
  if (bad.length) {
    return {
      ok: false,
      error:
        'Không publish được: trang không tồn tại, đã lưu trữ, hoặc chưa có bản nháp '
        + `(${bad.join(', ')})`,
    };
  }

  const merged = new Map<string, PlannedEntry>();
  for (const entry of liveEntries) {
    if (!byId.has(entry.pageId)) continue;
    merged.set(entry.pageId, { id: entry.pageId, slug: entry.slug, versionId: entry.versionId });
  }
  for (const id of wanted) {
    const page = byId.get(id)!;
    merged.set(id, { id: page.id, slug: page.slug, versionId: page.draftVersionId! });
  }

  return { ok: true, pages: [...merged.values()], publishedIds: wanted };
}

/**
 * Ảnh chụp bản dịch cho một lần publish từng trang.
 *
 * Nền là ảnh chụp của release đang chạy — bản dịch của trang không publish phải
 * đứng yên. Nhưng phải XOÁ mọi khoá của trang được publish TRƯỚC khi trộn bản mới
 * vào: nếu chỉ trộn đè, một bản dịch VỪA BỊ XOÁ sẽ sống sót từ ảnh chụp cũ và trang
 * tiếng Anh hiện lại đúng chuỗi mà người dùng tưởng đã bỏ.
 *
 * Từ 17/11/2026 khoá mang `pageId` (`locale@pageId:nodeId:field`, xem `snapshotKey`),
 * nên "khoá của trang được publish" là đúng khoá có `@pageId` — không còn đoán qua
 * tập nodeId, vốn gom nhầm node trùng id của trang KHÁC. Khoá dạng cũ (không mang
 * trang) được GIỮ: trang chưa publish lại vẫn đọc chúng, còn trang vừa publish mang
 * cờ `@pageId` nên không bao giờ đọc chúng nữa.
 */
export function mergeTranslationSnapshot(
  previous: Record<string, unknown> | null | undefined,
  fresh: Record<string, unknown>,
  touchedPageIds: ReadonlySet<string>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(previous ?? {}) };
  for (const key of Object.keys(base)) {
    const at = key.indexOf('@');
    if (at < 0) continue;
    const colon = key.indexOf(':', at);
    const pageId = colon < 0 ? key.slice(at + 1) : key.slice(at + 1, colon);
    if (touchedPageIds.has(pageId)) delete base[key];
  }
  return { ...base, ...fresh };
}

/**
 * Ảnh chụp bản dịch MỚI của các trang được publish: khoá theo trang, cộng cờ
 * `@pageId` cho MỌI trang được publish — kể cả trang không có bản dịch nào, để nó
 * không rơi về khoá dạng cũ của trang khác.
 */
export function freshTranslationSnapshot(
  rows: readonly { pageId: string; locale: string; nodeId: string; field: string; value: unknown }[],
  publishedPageIds: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of publishedPageIds) out[pageMarkerKey(id)] = true;
  for (const r of rows) out[snapshotKey(r.locale, r.nodeId, r.field, r.pageId)] = r.value;
  return out;
}

/** Tập nodeId của một loạt doc. `Doc.nodes` là map theo id nên không phải duyệt cây. */
export function nodeIdsOf(docs: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const doc of docs) {
    const nodes = (doc as { nodes?: Record<string, unknown> } | null)?.nodes;
    if (nodes && typeof nodes === 'object') for (const id of Object.keys(nodes)) out.add(id);
  }
  return out;
}
