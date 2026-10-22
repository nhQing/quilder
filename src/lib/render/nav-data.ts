import 'server-only';

/**
 * Nạp chuỗi NAV cho mọi `NavChart` trên một doc, TRƯỚC khi render.
 *
 * ## Vì sao ở tầng trang chứ không trong composite
 *
 * `NodeRenderer` là hàm ĐỒNG BỘ gọi đệ quy — ghi chú ở `RenderContext` nói rõ vì
 * sao và nói rõ cái giá của việc đổi: *"biến nó thành async nghĩa là mọi node trên
 * trang thành một Promise — mười nghìn Promise cho một trang, và mất luôn khả năng
 * suy luận về số truy vấn"*. Nên composite không fetch được, và không nên fetch:
 * đây đúng khuôn mà `resolveAllRepeats` đã dựng cho collection.
 *
 * Gom theo URL rồi fetch song song MỘT lần cho mỗi URL: hai biểu đồ cùng nguồn
 * trên một trang là hai node nhưng một lượt gọi mạng.
 *
 * ## Vì sao `unstable_cache`
 *
 * Không có nó, mỗi lượt render trang là một lượt gọi sang BE — và trang chủ thì
 * mọi khách đều mở. NAV đổi mỗi ngày một lần, nên `revalidate` một giờ là quá đủ
 * và nó cắt tải cho BE xuống gần như bằng không. Cùng cơ chế mà
 * `allowedEmbedHostnames` và `public-read.ts` đang dùng.
 *
 * ## Lỗi KHÔNG được làm trắng trang
 *
 * BE sập, timeout, hay trả JSON sai hình dạng đều cho ra `null`, và composite
 * render khung kèm một dòng nói chưa có số liệu. Ném ở đây nghĩa là một endpoint
 * chậm làm cả trang chủ trả 500 — đổi một khối lấy cả trang.
 */

import { unstable_cache } from 'next/cache';

import { zNavPayload, normalizePoints, type NavPayload } from '@/lib/composites/nav-series';
import { siteEndpoint } from '@/lib/doc/site-bindings';
import type { Doc, NodeId } from '@/lib/doc/types';

export const NAV_TAG = 'nav-series';

/** Node `NavChart` trên doc, kèm khoá endpoint của nó. */
function navNodes(doc: Doc): { id: NodeId; endpointKey: string }[] {
  const out: { id: NodeId; endpointKey: string }[] = [];
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'Composite' || node.composite !== 'NavChart') continue;
    const params = node.params as { endpointKey?: unknown } | null | undefined;
    const key = params && typeof params === 'object' ? params.endpointKey : undefined;
    // Khoá thiếu hay sai kiểu: vẫn đăng ký node với khoá rỗng để `resolve` trả
    // `null` cho nó, và composite nói ra rằng nó chưa được cấu hình.
    out.push({ id: node.id, endpointKey: typeof key === 'string' ? key : '' });
  }
  return out;
}

/**
 * Một lượt gọi, đã cache.
 *
 * `timeout` bằng `AbortSignal`: `fetch` không có timeout mặc định, nên một BE
 * treo sẽ giữ lượt render cho tới khi Next tự bỏ — tức trang chủ đứng.
 */
const load = unstable_cache(
  async (url: string): Promise<NavPayload | null> => {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;

      const parsed = zNavPayload.safeParse(await res.json());
      // Hình dạng sai nghĩa là hợp đồng đã đổi. Trả `null` để khối nói ra, chứ
      // không vẽ một đường thiếu điểm mà không ai biết là thiếu.
      if (!parsed.success) return null;

      return { ...parsed.data, points: normalizePoints(parsed.data.points) };
    } catch {
      return null;
    }
  },
  ['nav-series'],
  { tags: [NAV_TAG], revalidate: 3600 },
);

/** `node.id` → chuỗi NAV, hoặc `null` khi chưa cấu hình / không nạp được. */
export type ResolvedNav = ReadonlyMap<NodeId, NavPayload | null>;

export async function resolveAllNavCharts(
  doc: Doc,
  globals: Record<string, unknown> | undefined,
): Promise<ResolvedNav> {
  const nodes = navNodes(doc);
  if (!nodes.length) return new Map();

  // Gom theo URL: hai biểu đồ cùng nguồn là một lượt gọi.
  const byUrl = new Map<string, string[]>();
  const out = new Map<NodeId, NavPayload | null>();

  for (const n of nodes) {
    const url = n.endpointKey ? siteEndpoint(globals, n.endpointKey) : null;
    if (!url) {
      out.set(n.id, null);
      continue;
    }
    byUrl.set(url, [...(byUrl.get(url) ?? []), n.id]);
  }

  await Promise.all(
    [...byUrl.entries()].map(async ([url, ids]) => {
      const payload = await load(url);
      for (const id of ids) out.set(id, payload);
    }),
  );

  return out;
}
