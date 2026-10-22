/**
 * Hợp đồng của một GÓI DỰ ÁN Quilder (`projects/<tên>/index.ts`).
 *
 * Gói mang những thứ riêng của một website mà không thuộc lõi builder: composite (khối
 * tự dựng DOM, ví dụ bộ tính lãi) và luật riêng cho AI ở đây; EFFECT ở `effects.ts` riêng
 * (`@project/effects` — chạy cả ở trình duyệt, xem effects/registry.ts). CSS, font và ảnh của gói
 * nằm ở `styles/` và `public/` cạnh `index.ts` — không khai ở đây.
 *
 * Chọn gói lúc build bằng `QUILDER_PROJECT` (scripts/project-dir.mjs), nạp qua alias
 * `@project`. Không có gói = `src/project/none` = Quilder thuần.
 */

import type { ReactNode } from 'react';
import type { z } from 'zod';


/** Props mọi composite của gói nhận được khi render. */
export interface CompositeRenderProps<P = unknown> {
  nodeId: string;
  /** Đã parse qua `ProjectComposite.params`. */
  params: P;
  /** Slot → id các node con trong cây. Render bằng `renderChild`. */
  slots: Record<string, string[]>;
  renderChild: (id: string) => ReactNode;
  /** `Site.globals` của release đang render (hotline, endpoint…). */
  site: Record<string, unknown>;
  /** Kết quả `loadData` của composite này cho node này, hoặc `null` (chưa nạp — ví dụ preview). */
  data: unknown;
}

export interface ProjectComposite<P = unknown> {
  /** Tên composite trong doc (`node.composite`). Không được trùng composite lõi. */
  key: string;
  // Đầu vào `unknown`: params đến từ JSONB, và schema `.catch()` nhận mọi thứ.
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  /** Mô tả cho AI — đi vào catalog `get_node_schema`. */
  description: string;
  // `NoInfer`: P suy ra từ `params`, không từ tham số của Component (chưa có kiểu → unknown).
  Component: (props: CompositeRenderProps<NoInfer<P>>) => ReactNode;
  /**
   * Đường dẫn trong `params` là chữ DỊCH ĐƯỢC, kèm trần độ dài — cùng dạng bảng trắng
   * `TRANSLATABLE_PARAMS` của lõi (src/lib/render/param-paths.ts): `[['title', 200], ['items.*.label', 120]]`.
   */
  translatableParams?: readonly (readonly [template: string, max: number])[];
  /**
   * Dữ liệu tầng trang, nạp trên server trước khi render (ví dụ chuỗi NAV của biểu đồ quỹ).
   * Nhận mọi node của composite này trên trang; trả map nodeId → dữ liệu.
   */
  loadData?: (nodes: { id: string; params: P }[], site: Record<string, unknown>) => Promise<Map<string, unknown>>;
}

export interface QuilderProject {
  /** Trùng tên thư mục `projects/<name>`. */
  name: string;
  /** Khai bằng `defineComposite` — nó xoá kiểu tham số để mọi composite nằm chung một mảng. */
  composites?: ProjectComposite[];
  /** Thêm vào cuối hướng dẫn cho AI (`src/lib/ai/guide.ts`) — luật riêng của dự án. */
  guideNotes?: string;
}

/** Trợ giúp khai báo có kiểu, để gói viết `defineProject({...})`. */
export function defineProject(p: QuilderProject): QuilderProject {
  return p;
}

/**
 * Khai composite có kiểu chặt BÊN TRONG (params, Component cùng một `P`), trả về bản đã
 * xoá `P` để nằm chung mảng `composites`. An toàn vì lõi luôn parse `params` bằng chính
 * schema của composite trước khi gọi `Component`.
 */
export function defineComposite<P>(c: ProjectComposite<P>): ProjectComposite {
  return c as unknown as ProjectComposite;
}
