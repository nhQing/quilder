/**
 * Lõi của `scripts/transfer-dryrun.ts` — nhập thử gói xuất trang vào một site TRẮNG, không DB.
 *
 * Tách khỏi script để test được. Dùng ĐÚNG các hàm của đường nhập thật (`openBundle`,
 * `checkBundle`, `buildImportPlan`) trên một `TargetSnapshot` dựng tay giống thứ
 * `ensureSiteDefaults` + `import-tokens` để lại trên DB mới. Thêm một phép kiểm mà kế hoạch nhập
 * không có: binding `source:'site'` trỏ vào khoá `Site.globals` mà đích chưa đặt (chữ rơi về
 * `fallback`, trang vẫn 200 — xem `doc/site-bindings.ts`).
 */

import { parsePageCollection } from '@/lib/builder/page-collection';
import { readEndpointTable } from '@/lib/doc/endpoint-table';
import { migratePresetTree } from '@/lib/doc/migrate';
import { findSiteBindings } from '@/lib/doc/site-bindings';
import { fontTokenName } from '@/lib/fonts/token';
import { DEFAULT_HOME, DEFAULT_NOT_FOUND } from '@/lib/setup/default-docs';
import { DEFAULT_LOCALES } from '@/lib/setup/defaults';
import { SYSTEM_PRESETS } from '@/lib/setup/system-presets';
import { openBundle } from './client';
import { treeAsDoc, type TreeShape } from './collect';
import { checkBundle } from './compat';
import type { TransferIssue } from './guides';
import { buildImportPlan, type ImportTarget, type TargetSnapshot } from './import-plan';
import type { PageBundle } from './manifest';

export interface BlankSiteOptions {
  /** `Site.globals` sẽ đặt ở đích. Site mới: `{}`. */
  globals: Record<string, unknown>;
  /** Ngôn ngữ bật ở đích; null = `DEFAULT_LOCALES`. */
  locales: string[] | null;
  /** Khoá loại nội dung đã tạo sẵn ở đích. */
  collections: string[];
  /** Hostname được phép nhúng ở đích. */
  embed: string[];
}

export function blankSnapshot(opts: BlankSiteOptions, staticTokens: Set<string>): TargetSnapshot {
  const locales = opts.locales
    ? new Map(opts.locales.map((code) => [code, { enabled: true }]))
    : new Map(DEFAULT_LOCALES.map((l) => [l.code, { enabled: l.enabled }]));
  return {
    // `ensureSiteDefaults` luôn tạo trang chủ và trang 404: gói của hai trang này đè lên chúng.
    pages: [
      // Trang chủ là slug rỗng — đúng chỗ `ensureSiteDefaults` tìm nó.
      { id: 'blank:home', slug: '', title: DEFAULT_HOME.title, draftVersionId: 'blank:v-home', fixture: false, collection: null, hasUnpublishedChanges: false },
      { id: 'blank:404', slug: DEFAULT_NOT_FOUND.slug, title: DEFAULT_NOT_FOUND.title, draftVersionId: 'blank:v-404', fixture: false, collection: null, hasUnpublishedChanges: false },
    ],
    assetsByKey: new Map(),
    presetsByKey: new Map(SYSTEM_PRESETS.map((p) => [p.key, { id: `blank:${p.key}`, tree: migratePresetTree(p.tree) }])),
    tokens: new Map(),
    tokenNames: new Set(staticTokens),
    locales,
    endpointUrls: readEndpointTable(opts.globals),
    embedHosts: [...opts.embed],
    collectionTypes: new Map(opts.collections.map((k) => [k, { fields: [] }])),
    folders: [],
    fontFamilies: [],
    packFamilies: [],
  };
}

// ── một gói ──────────────────────────────────────────────────────────────

export interface PageReport {
  file: string;
  slug: string;
  title: string;
  target: 'trang có sẵn' | 'trang mới' | '—';
  issues: TransferIssue[];
  /** Khoá `Site.globals` mà trang dùng nhưng đích chưa có → chữ rơi về fallback. */
  missingSiteKeys: { key: string; where: string[] }[];
  counts: { upload: number; reuse: number; createComponents: number; createTokens: number };
}

/** Khoá `globals` mà cây dùng qua binding `site` (bỏ `endpoint` — kế hoạch nhập đã lo). */
export function siteKeysUsed(bundle: PageBundle, trees: ReadonlyMap<string, TreeShape>) {
  const usage = findSiteBindings(bundle.doc);
  for (const [id, tree] of trees) {
    const name = bundle.components.find((c) => c.id === id)?.name ?? id;
    for (const [key, nodes] of findSiteBindings(treeAsDoc(tree))) {
      usage.set(key, [...(usage.get(key) ?? []), ...nodes.map((n) => `component "${name}" › ${n}`)]);
    }
  }
  usage.delete('endpoint');
  return usage;
}

/** Có giá trị dùng được không — chuỗi rỗng cũng là "chưa đặt" (renderer rơi về fallback). */
function hasGlobal(globals: Record<string, unknown>, key: string): boolean {
  const v = globals[key];
  return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
}

export async function dryRunOne(
  file: string,
  zip: Uint8Array,
  snap: TargetSnapshot,
  globals: Record<string, unknown>,
): Promise<PageReport> {
  const opened = await openBundle(zip);
  if (!opened.ok) {
    return { file, slug: '?', title: '?', target: '—', issues: opened.issues, missingSiteKeys: [], counts: { upload: 0, reuse: 0, createComponents: 0, createTokens: 0 } };
  }
  const { bundle } = opened;
  const compat = checkBundle(bundle);

  // Cùng luật chọn đích với hộp thoại: trang cùng slug và cùng dạng thì đè lên, không thì tạo mới.
  const existing = snap.pages.find((p) => p.slug === bundle.page.slug);
  const target: ImportTarget = existing
    ? { kind: 'existing', pageId: existing.id }
    : { kind: 'new', slug: bundle.page.slug, title: bundle.page.title };
  const plan = buildImportPlan(bundle, compat, snap, target);

  const missingSiteKeys = [...siteKeysUsed(bundle, compat.trees)]
    .filter(([key]) => !hasGlobal(globals, key))
    .map(([key, where]) => ({ key, where }));

  const report: PageReport = {
    file,
    slug: bundle.page.slug,
    title: bundle.page.title,
    target: existing ? 'trang có sẵn' : 'trang mới',
    issues: plan.issues,
    missingSiteKeys,
    counts: {
      upload: plan.assets.filter((a) => a.status === 'upload').length,
      reuse: plan.assets.filter((a) => a.status !== 'upload').length,
      createComponents: plan.components.filter((c) => c.action === 'create').length,
      createTokens: plan.tokens.filter((t) => t.action === 'create').length,
    },
  };

  // Bị chặn thì lần nhập không ghi gì — đích giữ nguyên cho gói sau.
  if (plan.issues.some((i) => i.level === 'block')) return report;

  for (const a of plan.assets) {
    if (a.status === 'upload') snap.assetsByKey.set(a.targetKey, { id: `sim:${a.sha256.slice(0, 12)}`, key: a.targetKey, trashed: false, alt: a.alt, bytes: a.bytes });
  }
  for (const c of plan.components) {
    const tree = compat.trees.get(c.sourceId);
    if (c.action === 'create' && tree) snap.presetsByKey.set(c.key, { id: `sim:${c.key}`, tree });
  }
  for (const t of bundle.tokens) {
    if (!snap.tokens.has(t.name)) snap.tokens.set(t.name, t.value);
    snap.tokenNames.add(t.name);
  }
  for (const f of bundle.fonts) {
    if (!snap.fontFamilies.some((x) => x.slug === f.slug)) {
      snap.fontFamilies.push({
        id: `sim:${f.slug}`, slug: f.slug, cssName: f.cssName,
        faces: f.faces.map((x) => ({ weight: x.weight, style: x.style, unicodeRange: x.unicodeRange, key: bundle.assets.find((a) => a.id === x.assetRef)?.key ?? '' })),
      });
      snap.tokenNames.add(fontTokenName(f.slug));
      snap.tokens.set(fontTokenName(f.slug), f.cssName);
    }
  }
  if (!existing) {
    snap.pages.push({
      id: `sim:${bundle.page.slug}`, slug: bundle.page.slug, title: bundle.page.title, draftVersionId: `sim:v-${bundle.page.slug}`,
      fixture: false, collection: parsePageCollection(bundle.page.collection), hasUnpublishedChanges: true,
    });
  }
  return report;
}
