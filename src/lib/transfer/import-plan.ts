/**
 * Kế hoạch nhập — THUẦN: gói + ảnh chụp trạng thái đích → sẽ làm gì, chặn gì, cần làm gì sau.
 *
 * Chạy ở CẢ preview lẫn commit (spec §7): commit không tin kết quả preview, vì giữa hai lần
 * bấm có người có thể đã sửa trang đích.
 */

import { assetKeyBase, assetKeyFromDigest } from '@/lib/assets/key';
import { findOrphanOverrides } from '@/lib/builder/orphan-overrides';
import { parsePageCollection, type PageCollection } from '@/lib/builder/page-collection';
import { isTemplateSlug } from '@/lib/builder/slug';
import { TOKEN_COLOR_RE, TOKEN_NAME_RE } from '@/lib/design/foundations';
import { endpointFormsIn } from '@/lib/doc/endpoint-usage';
import type { CompatResult } from './compat';
import { tokenRefsOf, type TreeShape } from './collect';
import { issue, type TransferIssue } from './guides';
import type { PageBundle } from './manifest';

// Hộp thoại nhập (trình duyệt) cần hàm này mà không kéo `node:crypto` của file này theo.
export { uploadsNeeded } from './uploads';

export interface TargetPage { id: string; slug: string; title: string; draftVersionId: string | null; fixture: boolean; collection: PageCollection | null; hasUnpublishedChanges: boolean }
export interface TargetSnapshot {
  pages: TargetPage[];
  /** `bytes`: để không nhận nhầm file khác nội dung chỉ vì trùng khoá nguồn (khoá cũ không chứa sha). */
  assetsByKey: Map<string, { id: string; key: string; trashed: boolean; alt: string | null; bytes: number }>;
  presetsByKey: Map<string, { id: string; tree: TreeShape }>;
  tokens: Map<string, string>;              // tên → giá trị, mọi token cùng tên ở đích
  /** Tên token có hàng ở đích, trong số tên `$token` mà gói dùng (deprecated vẫn tính: nguồn cũng đang dùng nó). */
  tokenNames: Set<string>;
  locales: Map<string, { enabled: boolean }>;
  endpointUrls: Record<string, string>;
  embedHosts: string[];
  collectionTypes: Map<string, { fields: string[] }>;
  folders: string[];
}
export type ImportTarget = { kind: 'existing'; pageId: string } | { kind: 'new'; slug: string; title: string };
export interface AssetPlanRow { sourceId: string; name: string; sha256: string; bytes: number; mime: string; folder: string | null; alt: string | null; file: string; status: 'reuse' | 'restore' | 'upload'; targetId: string | null; targetKey: string }
export interface ComponentPlanRow { sourceId: string; key: string; name: string; action: 'create' | 'use-target'; targetId: string | null; differs: boolean; orphanOverrides: number }
export interface ImportPlan {
  source: { siteName: string; origin: string; exportedBy: string; exportedAt: string; slug: string; title: string };
  choices: { id: string; slug: string; title: string }[];   // trang đích chọn được (đã lọc dạng)
  suggestedPageId: string | null;
  target: { pageId: string; draftVersionId: string | null; hasUnpublishedChanges: boolean } | null;
  assets: AssetPlanRow[];
  components: ComponentPlanRow[];
  tokens: { name: string; action: 'create' | 'keep'; differs: boolean }[];
  locales: { code: string; status: 'ok' | 'disabled' | 'missing'; count: number }[];
  folders: string[];
  issues: TransferIssue[];
}

export function candidateKeys(a: { key: string; name: string; sha256: string }): string[] {
  const derived = assetKeyFromDigest(assetKeyBase(a.name), a.sha256);
  return derived === a.key ? [a.key] : [a.key, derived];
}

/** So hai cây BỎ QUA id ảnh — id ảnh khác nhau giữa hai môi trường dù cùng file. */
function shapeOf(tree: TreeShape): string {
  return JSON.stringify(tree, (k, v) =>
    k === 'assetId' || k === 'posterAssetId' || k === 'frames' || k === 'framesNarrow' || k === 'framesSuper' ? '#' : v,
  );
}

function sameShape(bundleCol: PageCollection | null, page: { slug: string; collection: PageCollection | null }): boolean {
  if (!bundleCol) return !page.collection && !isTemplateSlug(page.slug);
  return page.collection?.typeKey === bundleCol.typeKey && page.collection.param === bundleCol.param;
}

export function buildImportPlan(
  bundle: PageBundle,
  compat: CompatResult,
  snap: TargetSnapshot,
  target: ImportTarget | null,
): ImportPlan {
  const issues: TransferIssue[] = [...compat.issues];
  const bundleCol = parsePageCollection(bundle.page.collection);

  const choices = snap.pages
    .filter((p) => !p.fixture && sameShape(bundleCol, p))
    .map((p) => ({ id: p.id, slug: p.slug, title: p.title }));
  const suggestedPageId = choices.find((c) => c.slug === bundle.page.slug)?.id ?? null;

  let resolved: ImportPlan['target'] = null;
  if (target?.kind === 'existing') {
    const page = snap.pages.find((p) => p.id === target.pageId);
    if (!page) issues.push(issue('target-changed', 'block', { detail: 'Trang đích không còn tồn tại.' }));
    else if (page.fixture) issues.push(issue('target-fixture', 'block'));
    else if (!sameShape(bundleCol, page)) {
      const shape = (c: PageCollection | null) => (c ? `trang mẫu của loại "${c.typeKey}" (vai ${c.param})` : 'trang thường');
      issues.push(issue('target-shape-mismatch', 'block', { vars: { bundleShape: shape(bundleCol), targetShape: shape(page.collection) } }));
    } else {
      resolved = { pageId: page.id, draftVersionId: page.draftVersionId, hasUnpublishedChanges: page.hasUnpublishedChanges };
    }
  }

  // Loại nội dung của trang mẫu: thiếu là CHẶN (G8); thiếu field chỉ là việc cần làm (C7).
  const needCol = bundle.needs.collection;
  if (needCol) {
    const type = snap.collectionTypes.get(needCol.typeKey);
    if (!type) {
      issues.push(issue('collection-type-missing', 'block', { vars: { typeKey: needCol.typeKey, fields: needCol.fields.join(', ') || '(không có)' } }));
    } else {
      for (const field of needCol.fields.filter((f) => !type.fields.includes(f))) {
        issues.push(issue('collection-field-missing', 'todo', { vars: { field, typeKey: needCol.typeKey } }));
      }
    }
  }
  for (const typeKey of bundle.needs.collectionTypes) {
    if (!snap.collectionTypes.has(typeKey)) issues.push(issue('collection-missing', 'todo', { vars: { typeKey } }));
  }

  const assets: AssetPlanRow[] = bundle.assets.map((a) => {
    const keys = candidateKeys(a);
    const derived = keys[keys.length - 1]!;
    // Khoá suy ra chứa sha nên trùng khoá là trùng nội dung. Khoá nguồn kiểu cũ (không chứa sha)
    // thì không: ít nhất cỡ file phải khớp, nếu không đó là một file khác mang cùng tên.
    const hit = keys
      .map((k) => ({ k, row: snap.assetsByKey.get(k) }))
      .find(({ k, row }) => row && (k === derived || row.bytes === a.bytes))?.row;
    return {
      sourceId: a.id, name: a.name, sha256: a.sha256, bytes: a.bytes, mime: a.mime, folder: a.folder,
      alt: a.alt, file: a.file,
      status: hit ? (hit.trashed ? 'restore' : 'reuse') : 'upload',
      targetId: hit?.id ?? null,
      targetKey: hit?.key ?? derived,
    };
  });

  const components: ComponentPlanRow[] = bundle.components.map((c) => {
    const there = snap.presetsByKey.get(c.key);
    const mine = compat.trees.get(c.id);
    if (!there || !mine) return { sourceId: c.id, key: c.key, name: c.name, action: 'create', targetId: null, differs: false, orphanOverrides: 0 };
    const orphans = compat.doc
      ? findOrphanOverrides(compat.doc, new Map([[c.id, new Set(Object.keys(there.tree.nodes))]])).length
      : 0;
    return { sourceId: c.id, key: c.key, name: c.name, action: 'use-target', targetId: there.id, differs: shapeOf(mine) !== shapeOf(there.tree), orphanOverrides: orphans };
  });
  for (const c of components.filter((x) => x.differs || x.orphanOverrides)) {
    issues.push(issue('component-differs', 'todo', {
      vars: { name: c.name, orphans: c.orphanOverrides ? `${c.orphanOverrides} chỉnh riêng của trang không khớp bản ở đây.` : '' },
      items: c.targetId ? [{ label: `Mở component ${c.name}`, href: `/builder/components/${c.targetId}` }] : undefined,
    }));
  }

  const tokens = bundle.tokens.map((t) => {
    const there = snap.tokens.get(t.name);
    return { name: t.name, action: there === undefined ? ('create' as const) : ('keep' as const), differs: there !== undefined && there !== t.value };
  });
  // Token sẽ TẠO đi thẳng vào stylesheet (`:root { --tên: giá-trị }`): cùng luật với ô tạo token,
  // vì gói sửa tay có thể nhét chuỗi CSS bất kỳ.
  const badTokens = bundle.tokens.filter((t) =>
    tokens.find((x) => x.name === t.name)?.action === 'create'
    && (!TOKEN_NAME_RE.test(t.name) || (t.category === 'color' && !TOKEN_COLOR_RE.test(t.value))));
  if (badTokens.length) {
    issues.push(issue('file-corrupt', 'block', {
      detail: `${badTokens.length} token tự tạo trong gói không hợp lệ.`,
      items: badTokens.map((t) => ({ label: `--${t.name}: ${t.value}` })),
    }));
  }

  // Token tĩnh nằm trong tokens.css của bản builder; đích chưa có thì `var(--x)` rỗng → G3.
  if (compat.doc) {
    const own = new Set(bundle.tokens.map((t) => t.name));
    const unknown = tokenRefsOf([compat.doc.nodes, ...[...compat.trees.values()].map((t) => t.nodes)])
      .filter((n) => !own.has(n) && !snap.tokenNames.has(n));
    if (unknown.length) {
      issues.push(issue('builder-too-old', 'block', { vars: { missing: unknown.map((n) => `token "--${n}"`).join(', ') } }));
    }
  }

  const counts = new Map<string, number>();
  for (const t of bundle.translations) counts.set(t.locale, (counts.get(t.locale) ?? 0) + 1);
  const locales = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => {
    const there = snap.locales.get(code);
    const status = !there ? ('missing' as const) : there.enabled ? ('ok' as const) : ('disabled' as const);
    if (status !== 'ok') issues.push(issue(status === 'missing' ? 'locale-missing' : 'locale-disabled', 'todo', { vars: { locale: code, count: String(count) } }));
    return { code, status, count };
  });

  if (compat.doc) {
    const forms = endpointFormsIn(compat.doc);
    for (const key of bundle.needs.endpointKeys.filter((k) => !snap.endpointUrls[k])) {
      const form = forms.find((f) => f.key === key);
      issues.push(issue('endpoint-missing', 'todo', {
        vars: { key, form: form?.label ?? key },
        items: [{ label: 'Mở Cài đặt › Form', href: '/builder/settings#settings-endpoints' }],
      }));
    }
  }
  for (const origin of bundle.needs.embedOrigins) {
    // Gói không đáng tin: chuỗi hỏng coi như chưa được phép, không ném ra khỏi hàm thuần này.
    let host: string | null = null;
    try { host = new URL(origin).hostname; } catch { /* host giữ null */ }
    if (host === null || !snap.embedHosts.includes(host)) issues.push(issue('embed-origin-missing', 'todo', { vars: { origin } }));
  }
  issues.push(issue('publish', 'todo'));

  return {
    source: {
      siteName: bundle.source.siteName, origin: bundle.source.origin, exportedBy: bundle.exportedBy,
      exportedAt: bundle.exportedAt, slug: bundle.page.slug, title: bundle.page.title,
    },
    choices, suggestedPageId, target: resolved, assets, components, tokens, locales,
    folders: snap.folders, issues,
  };
}
