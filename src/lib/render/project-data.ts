import 'server-only';

/**
 * Dữ liệu tầng trang cho composite của gói dự án — `ProjectComposite.loadData`.
 *
 * Cùng khuôn với `resolveAllNavCharts`: `NodeRenderer` là đồng bộ nên composite không tự
 * fetch được; tầng trang gom mọi node của từng composite rồi nạp một lượt, kết quả đi vào
 * `RenderContext.projectData` theo nodeId.
 *
 * Lỗi của một gói không được làm trắng trang: bắt, log, và composite nhận `data: null`.
 */

import type { Doc } from '@/lib/doc/types';
import { projectComposites } from '@/lib/project/active';

export async function resolveProjectData(
  doc: Doc,
  site: Record<string, unknown> | undefined,
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  await Promise.all(
    projectComposites().map(async (c) => {
      if (!c.loadData) return;
      const nodes = Object.values(doc.nodes)
        .filter((n) => n.type === 'Composite' && n.composite === c.key)
        .map((n) => ({ id: n.id, params: c.params.parse((n as { params?: unknown }).params ?? {}) }));
      if (!nodes.length) return;
      try {
        const loaded = await c.loadData!(nodes, site ?? {});
        loaded.forEach((v, k) => out.set(k, v));
      } catch (err) {
        console.error(`[project-data] ${c.key}: không nạp được dữ liệu`, err);
      }
    }),
  );
  return out;
}
