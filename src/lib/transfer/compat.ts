/**
 * Gói này đọc được ở BẢN BUILDER NÀY không — và gói có tự kín không.
 *
 * Hai môi trường có thể chạy hai bản code khác nhau (dev thường đi trước product). Bắt ở đây
 * thứ bản này chưa biết: schemaVersion mới hơn, node type / composite / effect lạ (G3). Không
 * bắt được một thay đổi NGỮ NGHĨA không đổi schema — spec §14 chấp nhận điều đó.
 */

import { isKnownComposite } from '@/lib/composites/registry';
import { DocVersionError, migrateDoc, migratePresetTree } from '@/lib/doc/migrate';
import { zDoc } from '@/lib/doc/schema';
import { structuralIssues } from '@/lib/doc/structure';
import { CURRENT_SCHEMA_VERSION, type Doc } from '@/lib/doc/types';
import { isKnownEffect } from '@/lib/motion/effects/registry';
import { assetUses, componentIdsOf, treeAsDoc, type TreeShape } from './collect';
import { issue, type TransferIssue } from './guides';
import type { PageBundle } from './manifest';

/** Bằng `MAX_ASSET_BYTES` của `upload-asset.ts` (file đó kéo prisma nên khai lại; test Task 11 canh khớp). */
export const IMPORT_FILE_LIMIT = 10 * 1024 * 1024;

export interface CompatResult {
  doc: Doc | null;
  trees: Map<string, TreeShape>;
  issues: TransferIssue[];
}

function unknownParts(doc: Doc): string[] {
  const out = new Set<string>();
  // Chạy TRƯỚC zDoc (zod chỉ báo lỗi đầu tiên, và tên composite lạ bị nuốt vào "Invalid enum value"),
  // nên đọc phòng thủ: dữ liệu chưa qua schema.
  for (const node of Object.values(doc.nodes ?? {})) {
    if (!node || typeof node !== 'object') continue;
    for (const a of Array.isArray(node.effects) ? node.effects : []) {
      if (!a || typeof a !== 'object') continue;
      if (!isKnownEffect(a.effect)) out.add(`effect "${a.effect}"`);
    }
    // hasOwn: "toString"/"constructor" nằm trong prototype nên `in` sẽ cho qua nhầm.
    if (node.type === 'Composite' && !isKnownComposite(node.composite)) {
      out.add(`composite "${node.composite}"`);
    }
  }
  return [...out];
}

/**
 * `missing`: thứ bản builder này chưa biết (G3). `corrupt`: qua được schema mà cây vẫn hỏng —
 * mồ côi, con trùng, vòng lặp (G4): bản builder nào cũng không đọc được, nên không phải lỗi phiên bản.
 */
function readDoc(raw: unknown, label: string, missing: string[], corrupt: string[]): Doc | null {
  let doc: Doc;
  try {
    doc = migrateDoc(raw);
  } catch (e) {
    missing.push(e instanceof DocVersionError ? `${label}: ${e.message}` : `${label}: không đọc được`);
    return null;
  }
  const unknown = unknownParts(doc);
  if (unknown.length) {
    missing.push(...unknown);
    return null;
  }
  const parsed = zDoc.safeParse(doc);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    missing.push(`${label}: ${first?.path.join('.')} — ${first?.message}`);
    return null;
  }
  // Cùng bộ luật tầng 4 mà đường ghi op dùng (spec §7): renderer không tự đỡ được cây hỏng.
  const broken = structuralIssues(doc);
  if (broken.length) {
    corrupt.push(`${label}: ${broken.slice(0, 3).map((b) => b.message).join('; ')}${broken.length > 3 ? '…' : ''}`);
    return null;
  }
  return doc;
}

export function checkBundle(bundle: PageBundle): CompatResult {
  const issues: TransferIssue[] = [];
  const missing: string[] = [];
  const corrupt: string[] = [];
  const trees = new Map<string, TreeShape>();

  if (bundle.schemaVersion > CURRENT_SCHEMA_VERSION) {
    missing.push(`cấu trúc dữ liệu v${bundle.schemaVersion} (ở đây mới có v${CURRENT_SCHEMA_VERSION})`);
  }

  const doc = missing.length ? null : readDoc(bundle.doc, 'trang', missing, corrupt);

  for (const c of bundle.components) {
    let tree: TreeShape;
    try {
      tree = migratePresetTree(c.tree);
    } catch {
      missing.push(`component "${c.name}": không đọc được`);
      continue;
    }
    const asDoc = readDoc(treeAsDoc(tree), `component "${c.name}"`, missing, corrupt);
    if (asDoc) trees.set(c.id, tree);
  }

  if (missing.length) issues.push(issue('builder-too-old', 'block', { vars: { missing: [...new Set(missing)].join(', ') } }));
  if (corrupt.length) issues.push(issue('file-corrupt', 'block', { detail: `Cấu trúc cây hỏng — ${corrupt.join(' · ')}` }));
  if (issues.length || !doc) return { doc: null, trees, issues };

  // Gói phải KÍN: mọi component và ảnh mà doc dùng đều nằm trong gói.
  const ids = new Set(bundle.assets.map((a) => a.id));
  const holes: string[] = [];
  const missingComps = new Set(componentIdsOf(doc.nodes));
  // Component lồng component: cây trong gói cũng có thể trỏ tới component vắng mặt.
  for (const tree of trees.values()) for (const cid of componentIdsOf(tree.nodes)) missingComps.add(cid);
  for (const cid of missingComps) if (!trees.has(cid)) holes.push(`component ${cid}`);
  const uses = assetUses({
    doc, trees, translations: bundle.translations.map((t) => ({ ...t, value: t.value })), ogImageId: bundle.page.ogImageId,
  });
  for (const id of uses.keys()) if (!ids.has(id)) holes.push(`ảnh ${id}`);
  if (holes.length) {
    issues.push(issue('file-corrupt', 'block', { detail: `Gói thiếu: ${holes.slice(0, 5).join(', ')}${holes.length > 5 ? '…' : ''}` }));
  }

  const big = bundle.assets.filter((a) => a.bytes > IMPORT_FILE_LIMIT);
  if (big.length) {
    issues.push(issue('file-too-large', 'block', {
      detail: `${big.length} file lớn hơn 10 MB`,
      items: big.map((a) => ({ label: `${a.name} (${(a.bytes / 1024 / 1024).toFixed(1)} MB)` })),
    }));
  }

  return { doc, trees, issues };
}
