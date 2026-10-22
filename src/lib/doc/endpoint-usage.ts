/**
 * Form / biểu đồ nào đang đọc khoá endpoint nào.
 *
 * Tách khỏi `endpoint-table.ts` vì phải đi qua schema của registry (zod): phần kiểm
 * khoá/URL chạy cả trong trình duyệt (ô "Form" ở màn Cài đặt) và không nên kéo
 * cả registry theo.
 */

import { parseCompositeParams } from '@/lib/composites/registry';
import { plainText } from '@/lib/render/richtext';
import type { Node } from './types';

/** Composite đọc một khoá trong bảng endpoint. Cùng tập với `findSiteBindings`. */
const ENDPOINT_COMPOSITES = new Set(['Form', 'NavChart']);

/** Nhãn khi node không có tên và không có tiêu đề. */
const FALLBACK_LABEL: Record<string, string> = { Form: 'Form', NavChart: 'Biểu đồ NAV' };

/** Một form (hoặc biểu đồ) trong một cây, và khoá nó THẬT SỰ đọc lúc render. */
export interface EndpointFormRef {
  key: string;
  nodeId: string;
  composite: 'Form' | 'NavChart';
  /**
   * Tên để người đọc nhận ra form: tên node nếu tác giả đặt, không thì chữ của tiêu đề
   * (slot `heading`) — "Form" trần thì năm form trên một site là năm dòng giống nhau.
   */
  label: string;
  /** `params` THÔ của node — đường đổi khoá ghi lại nguyên phần còn lại. */
  params: Record<string, unknown>;
}

/**
 * Khoá mà một composite THẬT SỰ đọc lúc render — qua đúng schema của renderer. Schema
 * `.catch(DEFAULTS)`: params hỏng thì renderer dùng bộ mặc định, nên khoá thô ghi trong
 * params hỏng KHÔNG phải khoá đang được dùng.
 */
function endpointKeyOf(composite: string, params: unknown): string | null {
  const parsed = parseCompositeParams(composite, params) as { endpointKey?: unknown } | null;
  return typeof parsed?.endpointKey === 'string' ? parsed.endpointKey : null;
}

function labelOf(node: Extract<Node, { type: 'Composite' }>, nodes: Record<string, Node>): string {
  if (node.name?.trim()) return node.name.trim();
  for (const id of node.slots?.heading ?? []) {
    const child = nodes[id];
    if (child?.type === 'Text') {
      const text = plainText(child.content).trim();
      if (text) return text.length > 60 ? `${text.slice(0, 59)}…` : text;
    }
  }
  return FALLBACK_LABEL[node.composite] ?? node.composite;
}

/**
 * Mọi Form / NavChart trong một cây (doc trang hoặc cây component, đã migrate), kèm khoá
 * đã áp MẶC ĐỊNH của registry: một `Form` chưa đặt `endpointKey` vẫn đọc `newsletter`, và
 * bỏ sót nó là báo "không ai dùng" cho khoá đang giữ một form sống.
 */
export function endpointFormsIn(tree: { nodes: Record<string, Node> }): EndpointFormRef[] {
  const out: EndpointFormRef[] = [];
  for (const node of Object.values(tree.nodes)) {
    if (node.type !== 'Composite' || !ENDPOINT_COMPOSITES.has(node.composite)) continue;
    const key = endpointKeyOf(node.composite, node.params);
    if (!key) continue;
    out.push({
      key,
      nodeId: node.id,
      composite: node.composite as EndpointFormRef['composite'],
      label: labelOf(node, tree.nodes),
      params: (node.params ?? {}) as Record<string, unknown>,
    });
  }
  return out.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}
