/**
 * Kiểu dùng chung của bộ clone — phía trình duyệt (extractor), phía MCP local và phía server.
 *
 * File này THUẦN (không prisma, không `server-only`) để cả test lẫn kit đọc được.
 *
 * ## Ba nơi chạy, một hợp đồng
 *
 *  1. TRÌNH DUYỆT của máy chạy MCP: `extractor.ts` được bơm vào trang nguồn, trả về cây node thô.
 *  2. NODE của máy chạy MCP (`mcp/server.mjs`): điều khiển Playwright, tải/upload ảnh, gọi API.
 *  3. SERVER builder: `assemble.ts` ép cây thô về đúng schema rồi `create-draft.ts` ghi trang nháp.
 *
 * Hợp đồng giữa (1)+(2) và (3) là `CloneDraftInput` bên dưới. Đổi hình dạng của nó là đổi
 * `CLONE_KIT_VERSION`.
 */

/**
 * Phiên bản của kit (extractor + bảng token + cách đóng gói). Tăng khi hình dạng dữ liệu giữa
 * `mcp/server.mjs` và builder đổi mà bản server.mjs cũ không hiểu được. `server.mjs` khai bản
 * nó biết; builder trả `kitVersion` cao hơn thì server.mjs bảo người dùng tải bản mới.
 */
export const CLONE_KIT_VERSION = 1;

/** Bản `mcp/server.mjs` tối thiểu được dùng kit (`x-mm-client`). */
export const CLONE_MIN_CLIENT = 3;

/** Khổ trích: mỗi khổ ghi vào đúng lớp style cùng tên (xem `BREAKPOINT_PX`). */
export interface CloneViewport {
  width: number;
  layer: 'base' | 'sm' | 'md' | 'lg' | 'xl';
}

/** Bảng tra ngược giá trị → tên token của BUILDER, đo ở một bề rộng cụ thể. */
export interface TokenTables {
  /** `rgb(r, g, b)` / `rgba(...)` chuẩn hoá → tên token màu. */
  colors: Record<string, string>;
  /** Họ font đầu tiên (chữ thường) → tên token font. */
  families: Record<string, string>;
  /** `vai|giá trị px` (vai: radius | space | generic) → tên token độ dài. */
  lengths: Record<string, string>;
  /** Số nguyên dạng chuỗi → tên token z-index. */
  zs: Record<string, string>;
}

/** Một điều đáng báo lại cho người dùng — thứ KHÔNG clone được hoặc clone gần đúng. */
export interface CloneReportItem {
  /** Mã ổn định, để test và để Claude gom nhóm. */
  code: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  count?: number;
  /** Vài ví dụ (tên node, URL, họ font…). */
  samples?: string[];
}

/** Ghi chú thô do extractor đếm: `code` → số lần + mẫu. Server đổi thành `CloneReportItem`. */
export type CloneNotes = Record<string, { count: number; samples: string[] }>;

/** Node thô do extractor sinh ra: giống `Node` của doc nhưng còn khoá giàn giáo `_…`. */
export type RawNode = Record<string, unknown> & {
  id: string;
  parentId: string | null;
  children: string[];
  type: string;
  style: Record<string, unknown>;
};

export interface RawDoc {
  rootId: string;
  nodes: Record<string, RawNode>;
}

/** Thông tin đầu trang nguồn, để đặt SEO cho trang nháp. */
export interface ClonePageMeta {
  title: string;
  description: string;
  lang: string;
  ogImage: string;
  url: string;
}

/** Kết quả một lần `merge` trong trình duyệt. */
export interface CloneExtraction extends RawDoc {
  /** SVG nội dòng đã xuất ra dạng file: khoá → mã nguồn SVG. Node trỏ tới bằng `_src: 'svg:<khoá>'`. */
  svgs: Record<string, string>;
  notes: CloneNotes;
  page: ClonePageMeta;
  stats: {
    elements: number;
    nodes: number;
    pruned: number;
    tokenValues: number;
    literalValues: number;
  };
}

/** Kết quả tải một asset (do `mcp/server.mjs` làm tại chỗ, hoặc server tự tải qua `sourceUrl`). */
export type CloneAssetResult =
  | { assetId: string; reused?: boolean }
  | { error: string; code?: 'too-large' | 'fetch' | 'upload' | 'unsupported' };

export interface CloneDraftInput {
  /** URL nguồn, để ghi vào báo cáo và nhãn phiên bản. */
  url: string;
  title: string;
  slug: string;
  /** Thư mục ảnh do CHỦ SITE chọn — bắt buộc, không bao giờ tự đặt. */
  folder: string;
  doc: RawDoc;
  /** URL (hoặc `svg:<khoá>`) → kết quả tải. Thiếu khoá = server tự tải bằng `sourceUrl`. */
  assets: Record<string, CloneAssetResult>;
  notes: CloneNotes;
  page: Partial<ClonePageMeta>;
}
