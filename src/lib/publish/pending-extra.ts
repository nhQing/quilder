/**
 * Thay đổi chưa publish mà cây node của trang KHÔNG thấy: bản dịch và component.
 *
 * ## Vì sao cần (17/11/2026)
 *
 * Nút "Publish trang này" so `seq` của bản nháp với bản đang chạy — tức chỉ đếm sửa đổi
 * trên cây node. Bản dịch (`Translation`) và cây component (`Preset.tree`) nằm ngoài
 * doc, nên một trang chỉ có bản tiếng Anh mới thì nút MỜ ("không có gì để đẩy") dù bấm
 * Publish sẽ đổi site thật. Người dùng không có cách publish ngoài "Publish toàn bộ
 * site" — đẩy luôn bản nháp của mọi trang khác.
 *
 * Hai phép đếm ở đây là thuần (không DB) để test được; chỗ nạp dữ liệu là
 * `pendingExtras` trong `lib/builder/queries.ts`.
 */

import { entriesFromSnapshot } from '@/lib/render/translations';

export interface PendingExtra {
  /** Số đơn vị bản dịch khác bản đang chạy (thêm, sửa hoặc xoá). */
  translations: number;
  /** Số component trang đang dùng có cây khác bản đã chụp. */
  components: number;
}

export interface DraftTranslationRow {
  locale: string;
  nodeId: string;
  field: string;
  value: unknown;
}

const unitKey = (nodeId: string, field: string) => `${nodeId}\u0000${field}`;

/**
 * Đơn vị bản dịch nháp khác ảnh chụp đang chạy, cho các ngôn ngữ `locales`.
 *
 * `docNodeIds` giới hạn phía ảnh chụp về node CỦA trang này: release cũ (khoá không mang
 * trang) trả bản dịch của mọi trang, và không lọc thì mọi bản dịch của trang khác bị đếm
 * là "đã xoá". Đơn vị trong instance (`inst/local`) thuộc trang khi `inst` thuộc trang.
 */
export function countTranslationDrift(
  rows: readonly DraftTranslationRow[],
  snapshot: unknown,
  pageId: string,
  locales: readonly string[],
  docNodeIds: ReadonlySet<string>,
): number {
  const ownsNode = (nodeId: string) =>
    nodeId.startsWith('$') || docNodeIds.has(nodeId.split('/')[0] ?? nodeId);

  let drift = 0;
  for (const locale of locales) {
    const live = new Map<string, string>();
    for (const e of entriesFromSnapshot(snapshot, locale, pageId)) {
      if (ownsNode(e.nodeId)) live.set(unitKey(e.nodeId, e.field), JSON.stringify(e.value));
    }
    const draft = new Map<string, string>();
    for (const r of rows) {
      // Cùng bộ lọc với phía ảnh chụp: bản dịch của node đã bị xoá khỏi trang không được
      // publish (release chỉ chụp đơn vị còn có node), nên đếm nó là một "bản dịch chưa
      // publish" không bao giờ hết — Publish xong nút vẫn báo (17/11/2026, /events/[slug]).
      if (r.locale === locale && ownsNode(r.nodeId)) {
        draft.set(unitKey(r.nodeId, r.field), JSON.stringify(r.value));
      }
    }
    for (const [key, value] of draft) if (live.get(key) !== value) drift++;
    for (const key of live.keys()) if (!draft.has(key)) drift++;
  }
  return drift;
}

/**
 * Đơn vị bản dịch NHÁP mới hoặc đã sửa so với ảnh chụp đang chạy, cho MỘT ngôn ngữ — để
 * màn xem trước tô chỗ đó. Cùng bộ lọc node với `countTranslationDrift`, nhưng KHÔNG tính
 * đơn vị đã xoá (không còn chỗ nào trên trang để tô).
 */
export function changedTranslationUnits(
  rows: readonly DraftTranslationRow[],
  snapshot: unknown,
  pageId: string,
  locale: string,
  docNodeIds: ReadonlySet<string>,
): { nodeId: string; field: string }[] {
  const live = new Map<string, string>();
  for (const e of entriesFromSnapshot(snapshot, locale, pageId)) {
    live.set(unitKey(e.nodeId, e.field), JSON.stringify(e.value));
  }
  const out: { nodeId: string; field: string }[] = [];
  for (const r of rows) {
    if (r.locale !== locale) continue;
    if (!(r.nodeId.startsWith('$') || docNodeIds.has(r.nodeId.split('/')[0] ?? r.nodeId))) continue;
    if (live.get(unitKey(r.nodeId, r.field)) !== JSON.stringify(r.value)) {
      out.push({ nodeId: r.nodeId, field: r.field });
    }
  }
  return out;
}

/** Component (theo id) có cây hiện tại khác cây trong ảnh chụp của release đang chạy. */
export function countComponentDrift(
  current: readonly { id: string; tree: unknown }[],
  snapshot: unknown,
): number {
  const sealed =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : {};
  let drift = 0;
  for (const c of current) {
    // JSONB chuẩn hoá thứ tự khoá ở cả hai phía, nên so chuỗi JSON là so nội dung.
    if (JSON.stringify(c.tree) !== JSON.stringify(sealed[c.id])) drift++;
  }
  return drift;
}
