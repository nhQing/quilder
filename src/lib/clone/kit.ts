/**
 * "Bộ đồ nghề" clone mà `mcp/server.mjs` kéo từ builder: token, khổ đo, mã extractor, mã so sánh.
 *
 * ## Vì sao đi qua API thay vì nằm sẵn trong server.mjs
 *
 * `mcp/server.mjs` nằm trên máy người dùng hàng tháng và máy đó KHÔNG có repo — không có
 * `src/styles/tokens.css`, không có `breakpoints.ts`. Token lại đổi (chủ site sửa ở màn Cài đặt) và
 * converter còn đang được cải thiện. Nên mọi thứ máy kia cần để đo đúng — bảng token, khổ đo,
 * extractor chạy trong trình duyệt, luật so sánh — được phục vụ từ chính builder đang chạy:
 * cải thiện converter = deploy builder, không ai phải tải lại file nào.
 *
 * Token đọc từ bảng `Token` (đúng thứ site đang dùng, gồm token tự tạo và token đã sửa), không từ
 * file CSS: bản build production không mang `src/styles/`.
 *
 * ## Vì sao mã gửi dạng chuỗi
 *
 * `installCloneKit` và `compareMeasurements` là hàm tự đủ (không import, không hằng module) nên
 * `toString()` ra đúng thứ cần chạy. `clone-kit.test.ts` bơm chuỗi vào một Chromium thật để chắc
 * rằng bundler (SWC/esbuild) không chèn helper làm nó chết lúc chạy ở trang khác.
 */

import { BREAKPOINT_PX } from '@/lib/design/breakpoints';
import { CURRENT_SCHEMA_VERSION } from '@/lib/doc/types';
import { compareMeasurements } from './compare';
import { installCloneKit } from './extractor';
import { CLONE_KIT_VERSION, type CloneViewport } from './types';

/** Khổ trích: 390 làm `base`, mỗi mốc lớn hơn đo ĐÚNG tại min-width của lớp đó. */
export const CLONE_VIEWPORTS: CloneViewport[] = [
  { width: 390, layer: 'base' },
  { width: BREAKPOINT_PX.sm, layer: 'sm' },
  { width: BREAKPOINT_PX.md, layer: 'md' },
  { width: BREAKPOINT_PX.lg, layer: 'lg' },
  { width: BREAKPOINT_PX.xl, layer: 'xl' },
];

/** Trần số node một lần clone. Doc to hơn là một trang không ai sửa nổi bằng tay. */
export const CLONE_MAX_NODES = 2500;

export interface CloneKit {
  kitVersion: number;
  schemaVersion: number;
  viewports: CloneViewport[];
  maxNodes: number;
  /** Trần một asset (byte) — cùng `MAX_ASSET_BYTES` của kho ảnh. */
  maxAssetBytes: number;
  tokenNames: string[];
  /** Tên token → loại (`space`, `typeScale`, `figma`…) để extractor biết vai của từng token. */
  tokenCategories: Record<string, string>;
  tokensCss: string;
  /** Mã chạy TRONG trình duyệt: cài `window.__mmClone`. */
  extractorSource: string;
  /** Biểu thức hàm chạy trong Node: `(reference, draft, options) => CompareResult`. */
  compareSource: string;
}

/**
 * `toString()` của hàm đã qua bundler có thể chứa lời gọi `__name(...)` (esbuild `keepNames`) mà
 * trình duyệt đích không có. Khai một bản no-op đứng trước — vô hại khi không dùng tới.
 */
const NAME_SHIM = 'globalThis.__name = globalThis.__name || function (f) { return f; };\n';

export function extractorSource(): string {
  return `${NAME_SHIM}(${installCloneKit.toString()})(globalThis);`;
}

export function compareSource(): string {
  return `${NAME_SHIM}(${compareMeasurements.toString()})`;
}

const SAFE_VALUE = (v: string) => !/[{};]|<\/style/i.test(v);

/** `tokens`: các hàng `Token` chưa deprecated. Giá trị có ký tự phá khối CSS thì bỏ — không bao giờ ghép bừa. */
export function buildCloneKit(
  tokens: ReadonlyArray<{ name: string; value: string; category?: string }>,
  maxAssetBytes: number,
): CloneKit {
  const usable = tokens.filter((t) => /^[a-zA-Z0-9_-]+$/.test(t.name) && SAFE_VALUE(t.value));
  return {
    kitVersion: CLONE_KIT_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    viewports: CLONE_VIEWPORTS,
    maxNodes: CLONE_MAX_NODES,
    maxAssetBytes,
    tokenNames: usable.map((t) => t.name),
    tokenCategories: Object.fromEntries(usable.filter((t) => t.category).map((t) => [t.name, t.category as string])),
    tokensCss: `:root{${usable.map((t) => `--${t.name}:${t.value}`).join(';')}}`,
    extractorSource: extractorSource(),
    compareSource: compareSource(),
  };
}
