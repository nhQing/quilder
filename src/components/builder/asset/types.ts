/**
 * Kiểu dùng chung của kho ảnh.
 *
 * Tách khỏi component vì cả `AssetGrid`, cây thư mục, thẻ ảnh và thanh chọn nhiều
 * đều cần chúng — để ở một component rồi import chéo là cách nhanh nhất tạo ra một
 * vòng import giữa các file client.
 */

import { ASSET_PAGE_SIZE } from '@/lib/assets/paging';

export interface AssetUse {
  pageId: string;
  slug: string;
  title: string;
  nodeIds: string[];
}

export interface AssetItem {
  id: string;
  key: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  createdAt: string;
  folder: string | null;
  useCount: number;
  usedBy: AssetUse[];
}

export interface FolderItem {
  path: string;
  name: string;
  depth: number;
  count: number;
  total: number;
  /**
   * Người đang đăng nhập có xoá được thư mục này không.
   *
   * Tính ở SERVER (`page.tsx`) chứ không ở đây: luật là "người tạo hoặc admin, và
   * phải sở hữu cả nhánh", nó cần `createdBy` của mọi thư mục con — dữ liệu mà
   * client không nên phải cầm. Client chỉ cần biết có hiện nút Xoá hay không, còn
   * quyền thật vẫn được kiểm lại ở API.
   */
  canDelete: boolean;
}

/**
 * `undefined` = tất cả, `null` = chưa phân loại, chuỗi = một nhánh.
 *
 * `null` là MẶC ĐỊNH của trang (URL trơn không `?folder=` cũng đọc thành `null`) —
 * xem docblock "Mặc định 'Chưa phân loại'" ở `page.tsx`. Vì vậy "tất cả" cần một
 * địa chỉ TƯỜNG MINH để còn bấm vào được: `scopeHref(undefined)` viết ra
 * `?folder=*`, một sentinel không bao giờ trùng tên thư mục thật (`*` bị
 * `FOLDER_SEGMENT_RE` từ chối).
 */
export type Scope = string | null | undefined;

/**
 * Địa chỉ của một thư mục, và tuỳ chọn một trang trong đó.
 *
 * `page` không truyền = TRANG 1, cố ý. Mọi lần đổi thư mục đều gọi hàm này không có
 * `page`, và đó là hành vi đúng: giữ `?page=4` khi vừa nhảy sang một thư mục có 3
 * ảnh cho một lưới trống mà không có lý do nhìn thấy được.
 *
 * `size` thì ngược lại — nó là sở thích của người dùng chứ không phải vị trí, nên
 * nơi gọi nên chuyền nó qua. `q`/`used` là bộ lọc đang mở — thiếu chúng thì đổi
 * trang hay đổi thư mục sẽ âm thầm xoá bộ lọc người dùng vừa đặt. Tất cả chỉ vào
 * URL khi khác mặc định, để đường dẫn hay dùng nhất vẫn là `/builder/assets` trơn.
 */
export function scopeHref(
  scope: Scope,
  opts: { page?: number; size?: number; q?: string; used?: 'used' | 'unused' } = {},
): string {
  const qs = new URLSearchParams();
  if (scope === undefined) qs.set('folder', '*');
  else if (scope !== null) qs.set('folder', scope);
  if (opts.page !== undefined && opts.page > 1) qs.set('page', String(opts.page));
  if (opts.size !== undefined && opts.size !== ASSET_PAGE_SIZE) qs.set('size', String(opts.size));
  if (opts.q) qs.set('q', opts.q);
  if (opts.used) qs.set('used', opts.used);
  const q = qs.toString();
  return q ? `/builder/assets?${q}` : '/builder/assets';
}

/**
 * Địa chỉ của màn thùng rác: `?trash=1` là MỘT phạm vi riêng (không kết hợp với
 * `folder`/`used`). Mang `q`/`size`/`page` như `scopeHref`, chỉ khi khác mặc định.
 */
export function trashHref(opts: { page?: number; size?: number; q?: string } = {}): string {
  const qs = new URLSearchParams({ trash: '1' });
  if (opts.page !== undefined && opts.page > 1) qs.set('page', String(opts.page));
  if (opts.size !== undefined && opts.size !== ASSET_PAGE_SIZE) qs.set('size', String(opts.size));
  if (opts.q) qs.set('q', opts.q);
  return `/builder/assets?${qs.toString()}`;
}

/** Thông tin xoá của một ảnh trong thùng rác, đã chuẩn bị sẵn để hiển thị. */
export interface TrashMeta {
  /** ISO — thời điểm xoá. */
  at: string;
  /** Tên hiển thị hoặc email của người xoá; `null` = không rõ. */
  by: string | null;
}

/** Chế độ thanh chọn nhiều: thư viện thường hay thùng rác. */
export type BulkMode = 'library' | 'trash';

/** Byte → chuỗi người đọc được, dấu phẩy thập phân như mọi con số khác trong vỏ ("6,1 MB"). */
export function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** `public/builder/hero-a1b2.png` → `hero-a1b2.png`. */
export function baseName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

/**
 * Tên để ĐỌC trên thẻ: bỏ đuôi băm của khoá lưu trữ.
 *
 * Khoá là `tên-<8 hex nội dung>.đuôi` (xem `nextAssetKey`), và ảnh nhập từ site cũ còn
 * mang thêm một mã hex dài phía trước (`google-play-bd551c9a8d-b32efd6b.png`). Cả hai
 * giống nhau về hình ở mọi thẻ, nên chúng chiếm đúng phần tên dễ bị cắt nhất mà không
 * phân biệt được hai ảnh. Mã thứ hai chỉ bị bỏ khi nó có CẢ chữ lẫn số — một dãy toàn
 * số (`large-1918755436`) hay một từ (`cafe`) là tên thật. Khoá đầy đủ vẫn ở `title`.
 */
export function displayName(key: string): string {
  const base = baseName(key);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  const short = stem
    .replace(/-[0-9a-f]{8}$/, '')
    .replace(/-(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,}$/, '');
  return short ? short + ext : base;
}

/** Màu icon thư mục (`folder-*` của design system). */
export type FolderTone = 'slate' | 'amber' | 'teal' | 'rose';

/** Viết đủ chuỗi để Tailwind thấy được class. */
export const FOLDER_TEXT: Record<FolderTone, string> = {
  slate: 'text-folder-slate',
  amber: 'text-folder-amber',
  teal: 'text-folder-teal',
  rose: 'text-folder-rose',
};

const ROOT_TONES: readonly FolderTone[] = ['amber', 'teal', 'rose'];

/**
 * Màu của một thư mục: theo thư mục GỐC của nó, để cả nhánh cùng một màu.
 *
 * DB chưa có cột màu do người dùng gán, nên màu suy từ TÊN gốc (băm) chứ không từ thứ
 * tự trong cây: theo thứ tự thì tạo một thư mục mới ở đầu cây là mọi nhánh đổi màu.
 * "Tất cả" và "Chưa phân loại" (không có gốc) dùng `slate`.
 */
export function folderTone(path: string | null | undefined): FolderTone {
  if (!path) return 'slate';
  const root = path.split('/')[0] ?? '';
  let h = 0;
  for (let i = 0; i < root.length; i += 1) h = (h * 31 + root.charCodeAt(i)) >>> 0;
  return ROOT_TONES[h % ROOT_TONES.length] ?? 'slate';
}

/** Nền nhãn đuôi file (`kind-*`) theo đuôi; đuôi lạ dùng màu trung tính của font. */
const KIND_BG: Record<string, string> = {
  png: 'bg-kind-png',
  jpg: 'bg-kind-jpg',
  jpeg: 'bg-kind-jpg',
  webp: 'bg-kind-jpg',
  avif: 'bg-kind-jpg',
  gif: 'bg-kind-png',
  svg: 'bg-kind-svg',
  pdf: 'bg-kind-pdf',
  mp4: 'bg-kind-video',
  webm: 'bg-kind-video',
  mov: 'bg-kind-video',
  m4v: 'bg-kind-video',
};

export function kindBg(ext: string): string {
  return KIND_BG[ext] ?? 'bg-kind-font';
}

/** `jpeg` → `JPG`: cùng một định dạng thì cùng một nhãn. */
export function extLabel(ext: string): string {
  return ext === 'jpeg' ? 'JPG' : ext.toUpperCase();
}

/**
 * Kiểu dữ liệu kéo-thả cho một lô ảnh.
 *
 * MIME tự đặt chứ không phải `text/plain`: nó cho phép `onDragOver` phân biệt "ảnh
 * trong kho đang được kéo" với "file từ máy đang được kéo" (`Files`) **trước khi
 * thả**, nên node thư mục sáng lên đúng cách cho từng loại. Với `text/plain` thì
 * mọi thao tác kéo chữ trong trang cũng làm cây nhấp nháy.
 */
export const ASSET_DND_MIME = 'application/x-quilder-asset-ids';
