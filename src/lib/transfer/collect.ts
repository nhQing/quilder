/**
 * Một trang dùng những gì: component, ảnh (kèm CHỖ dùng), token tự tạo, và cấu hình mà môi
 * trường đích phải có (`needs`). Thuần — xuất dùng nó để dựng gói, nhập dùng nó để kiểm gói.
 *
 * Ảnh đi qua `assetUsesInDoc` của `builder/asset-refs.ts`: một phép duyệt duy nhất cho "node
 * này dùng ảnh nào" (ảnh, video, poster, nền mọi lớp, khung effect, override). Chép phép duyệt
 * sang đây là hẹn ngày hai bên lệch nhau — đúng cách `styleAssetIds` đã lệch một lần.
 */

import { assetUsesInDoc } from '@/lib/builder/asset-refs';
import { parsePageCollection } from '@/lib/builder/page-collection';
import { endpointFormsIn } from '@/lib/doc/endpoint-usage';
import { CURRENT_SCHEMA_VERSION, type Doc, type Node } from '@/lib/doc/types';
import type { BundleNeeds } from './manifest';

export type TreeShape = { rootId: string; nodes: Record<string, Node> };

export function treeAsDoc(tree: TreeShape): Doc {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: tree.rootId, nodes: tree.nodes } as Doc;
}

export function componentIdsOf(nodes: Record<string, Node>): string[] {
  const out = new Set<string>();
  for (const node of Object.values(nodes)) {
    if (node.type !== 'Instance') continue;
    out.add(node.componentId);
    for (const id of Object.values(node.repeat?.blockComponents ?? {})) out.add(id);
  }
  return [...out];
}

export interface AssetUse {
  kind: 'page' | 'component' | 'translation' | 'og';
  nodeId?: string;
  componentId?: string;
  locale?: string;
}

const TRANSLATION_ASSET_FIELDS = new Set(['assetId', 'posterAssetId']);

export function assetUses(input: {
  doc: Doc;
  trees: ReadonlyMap<string, TreeShape>;
  translations: { locale: string; nodeId: string; field: string; value: unknown }[];
  ogImageId: string | null;
}): Map<string, AssetUse[]> {
  const out = new Map<string, AssetUse[]>();
  const add = (id: string, use: AssetUse) => {
    const list = out.get(id) ?? [];
    list.push(use);
    out.set(id, list);
  };

  for (const [id, nodeIds] of assetUsesInDoc(input.doc, input.trees)) {
    for (const nodeId of nodeIds) add(id, { kind: 'page', nodeId });
  }
  // TOÀN cây component, không chỉ phần instance đang hiện: đích có thể phải TẠO component
  // này, và một node ảnh bị override che ở trang này vẫn là một node của component.
  for (const [componentId, tree] of input.trees) {
    for (const [id, nodeIds] of assetUsesInDoc(treeAsDoc(tree))) {
      for (const nodeId of nodeIds) add(id, { kind: 'component', componentId, nodeId });
    }
  }
  for (const t of input.translations) {
    if (TRANSLATION_ASSET_FIELDS.has(t.field) && typeof t.value === 'string' && t.value) {
      add(t.value, { kind: 'translation', nodeId: t.nodeId, locale: t.locale });
    }
  }
  if (input.ogImageId) add(input.ogImageId, { kind: 'og' });
  return out;
}

export function useLink(pageId: string, use: AssetUse): string | undefined {
  if (use.kind === 'component' && use.componentId) {
    return `/builder/components/${use.componentId}${use.nodeId ? `?node=${encodeURIComponent(use.nodeId)}` : ''}`;
  }
  if ((use.kind === 'page' || use.kind === 'translation') && use.nodeId) {
    // Node trong instance mang địa chỉ `instanceId/localId` — link chọn instance.
    const nodeId = use.nodeId.split('/')[0]!;
    return `/builder/${pageId}?node=${encodeURIComponent(nodeId)}`;
  }
  return `/builder/${pageId}`;
}

/** Đi qua mọi object/mảng, gọi `visit` cho từng object (kể cả object gốc). */
function walk(value: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit);
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    visit(obj);
    for (const v of Object.values(obj)) walk(v, visit);
  }
}

const CSS_VAR_RE = /var\(\s*--([a-z0-9-]+)/gi;

export function tokenNamesOf(values: unknown[], customNames: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const scan = (css: string) => {
    for (const m of css.matchAll(CSS_VAR_RE)) {
      if (customNames.has(m[1]!)) out.add(m[1]!);
    }
  };
  for (const value of values) {
    walk(value, (obj) => {
      if (typeof obj.$token === 'string' && customNames.has(obj.$token)) out.add(obj.$token);
      if (typeof obj.customCss === 'string') scan(obj.customCss);
      // CSS của khối CustomCode cũng chạy trong trang: thiếu token ở đích thì `var(--x)` rỗng, màu mất lặng lẽ.
      if (obj.type === 'CustomCode' && typeof obj.css === 'string') scan(obj.css);
    });
  }
  return [...out].sort();
}

/**
 * Mọi tên `$token` mà các giá trị dùng — cả token tĩnh (khai trong `tokens.css`). Nhập dùng nó
 * để bắt token mà bản builder ở đích chưa có (G3): `var(--x)` của token lạ resolve về rỗng.
 */
export function tokenRefsOf(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    walk(value, (obj) => {
      if (typeof obj.$token === 'string') out.add(obj.$token);
    });
  }
  return [...out].sort();
}

const ORIGIN_RE = /https:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi;

export function needsOf(
  doc: Doc,
  trees: ReadonlyMap<string, TreeShape>,
  pageCollection: unknown,
): BundleNeeds {
  const all = [doc, ...[...trees.values()].map(treeAsDoc)];

  const endpointKeys = new Set<string>();
  for (const d of all) for (const f of endpointFormsIn(d)) endpointKeys.add(f.key);

  const embedOrigins = new Set<string>();
  const collectionTypes = new Set<string>();
  const fields = new Set<string>();
  for (const d of all) {
    for (const node of Object.values(d.nodes)) {
      if (node.type === 'CustomCode') {
        for (const src of [node.html, node.js, node.css]) {
          for (const m of (src ?? '').matchAll(ORIGIN_RE)) embedOrigins.add(m[0].toLowerCase());
        }
      }
      const part = (node as { part?: string }).part ?? '';
      for (const token of part.split(/\s+/)) {
        if (token.startsWith('entry:')) fields.add(token.slice('entry:'.length));
      }
    }
    walk(d.nodes, (obj) => {
      if (typeof obj.typeKey === 'string' && obj.typeKey) collectionTypes.add(obj.typeKey);
      const ref = obj.ref as { source?: string; path?: string } | undefined;
      if (obj.t === 'bind' && ref?.source === 'collection' && ref.path) {
        fields.add(ref.path.split('.')[0]!);
      }
    });
  }

  const col = parsePageCollection(pageCollection);
  if (col) collectionTypes.delete(col.typeKey); // loại của chính trang mẫu đi qua `collection`
  return {
    endpointKeys: [...endpointKeys].sort(),
    embedOrigins: [...embedOrigins].sort(),
    collectionTypes: [...collectionTypes].sort(),
    collection: col ? { typeKey: col.typeKey, role: col.param, fields: [...fields].sort() } : null,
  };
}
