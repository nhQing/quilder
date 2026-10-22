/**
 * Kiểu dùng chung cho tính năng thùng rác ảnh. Thuần TypeScript: không import
 * server-only hay prisma để cả client lẫn server dùng được.
 */

/** Loại nơi đang tham chiếu tới một ảnh. */
export type AssetRefKind =
  | 'page'
  | 'archived-page'
  | 'entry'
  | 'component'
  | 'effect-preset'
  | 'favicon'
  | 'site-og'
  | 'page-og'
  | 'avatar'
  | 'live-release'
  | 'token'
  | 'site-globals';

/** Một chỗ đang dùng ảnh: nhãn hiển thị và (nếu có) đường dẫn tới chỗ đó. */
export interface AssetRef {
  kind: AssetRefKind;
  label: string;
  href?: string;
}

/** Một release cũ có doc chứa ảnh. */
export interface OldReleaseRef {
  id: string;
  label: string;
  createdAt: string;
  /**
   * Release nằm trong cửa sổ rollback (`rollback-window.ts`): xoá hoàn toàn ảnh thì
   * object S3 vẫn được GIỮ cho release này, lùi về vẫn đúng. `false` = ngoài cửa sổ,
   * lùi về sẽ ra ảnh vỡ. Thiếu (`undefined`) ở chỗ chưa xếp theo cửa sổ.
   */
  inWindow?: boolean;
}

/** Ảnh bị bỏ qua khỏi thao tác kèm lý do và các chỗ đang dùng nó. */
export interface SkippedAsset {
  id: string;
  key: string;
  url: string;
  mime: string;
  reason: 'in-use' | 'not-trashed' | 'missing';
  refs: AssetRef[];
}

/** Kết quả chuyển ảnh vào thùng rác. */
export interface TrashResult {
  trashed: string[];
  skipped: SkippedAsset[];
}

/** Kết quả khôi phục ảnh từ thùng rác. */
export interface RestoreResult {
  restored: string[];
  skipped: SkippedAsset[];
}

/**
 * Một lô xoá hoàn toàn kèm token xác nhận (`confirm-token.ts`). Token là chữ ký của
 * đúng thứ dialog hiện: các id này, release nào giữ ảnh, release nào sẽ vỡ. Lúc xoá
 * server tính lại từ DB; khác đi là 409, dialog xem lại.
 */
export interface PurgeBatch {
  ids: string[];
  confirmToken: string;
}

/** Bản xem trước trước khi xoá hoàn toàn: ảnh xoá được, ảnh bị chặn, release cũ bị ảnh hưởng. */
export interface PurgePreview {
  deletable: Array<{
    id: string;
    key: string;
    url: string;
    mime: string;
    bytes: number;
    oldReleases: OldReleaseRef[];
  }>;
  blocked: SkippedAsset[];
  /** Hợp các release cũ bị ảnh hưởng, không trùng, có `inWindow`. */
  oldReleases: OldReleaseRef[];
  /** `deletable` chia lô theo trần của server, mỗi lô một token. */
  batches: PurgeBatch[];
  /** Câu mô tả cửa sổ rollback, để dialog nói đúng một con số với server. */
  rollbackWindow: string;
}

/**
 * Kết quả xoá hoàn toàn. `s3Failed`: key S3 chưa xoá được. `held`: key S3 cố ý giữ
 * lại vì release trong cửa sổ rollback còn trỏ tới (bảng `AssetHold`).
 */
export interface PurgeResult {
  purged: string[];
  skipped: SkippedAsset[];
  s3Failed: string[];
  held: string[];
}

/** Một ảnh trong danh sách thùng rác. */
export interface TrashedAssetItem {
  id: string;
  key: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  folder: string | null;
  trashedAt: string;
  trashedBy: string | null;
  trashedByName: string | null;
}

/** Một trang danh sách thùng rác có phân trang. */
export interface TrashPage {
  items: TrashedAssetItem[];
  total: number;
  page: number;
  pageSize: number;
}
