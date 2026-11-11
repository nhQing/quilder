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
import { isSafeTokenValue } from '@/lib/design/token-value';
import { endpointFormsIn } from '@/lib/doc/endpoint-usage';
import { isReservedFamilyName } from '@/lib/fonts/builtin';
import { familyNameKey } from '@/lib/fonts/css';
import { fontTokenName, fontTokenValue } from '@/lib/fonts/token';
import type { CompatResult } from './compat';
import { assetUses, tokenRefsOf, type TreeShape } from './collect';
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
  /**
   * Họ font ở đích trùng `slug` hoặc trùng `cssName` (không phân biệt hoa thường) với một họ
   * trong gói. `key`: khoá file của face — khoá theo nội dung mang 8 hex đầu của sha256.
   */
  fontFamilies: { id: string; slug: string; cssName: string; faces: { weight: string; style: string; unicodeRange: string; key: string }[] }[];
}
export type ImportTarget = { kind: 'existing'; pageId: string } | { kind: 'new'; slug: string; title: string };
export interface AssetPlanRow { sourceId: string; name: string; sha256: string; bytes: number; mime: string; folder: string | null; alt: string | null; file: string; status: 'reuse' | 'restore' | 'upload'; targetId: string | null; targetKey: string }
export interface ComponentPlanRow { sourceId: string; key: string; name: string; action: 'create' | 'use-target'; targetId: string | null; differs: boolean; orphanOverrides: number }
export interface FontPlanRow { slug: string; cssName: string; action: 'create' | 'use-target'; targetId: string | null }
export interface ImportPlan {
  source: { siteName: string; origin: string; exportedBy: string; exportedAt: string; slug: string; title: string };
  choices: { id: string; slug: string; title: string }[];   // trang đích chọn được (đã lọc dạng)
  suggestedPageId: string | null;
  target: { pageId: string; draftVersionId: string | null; hasUnpublishedChanges: boolean } | null;
  assets: AssetPlanRow[];
  components: ComponentPlanRow[];
  tokens: { name: string; action: 'create' | 'keep'; differs: boolean }[];
  fonts: FontPlanRow[];
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

type FaceShape = { weight: string; style: string; unicodeRange: string };
const faceKey = (f: FaceShape) => `${f.weight}|${f.style}|${f.unicodeRange}`;
/** Tên họ CSS so không phân biệt hoa thường (spec §4) — cùng khoá với dịch vụ font. */
const nameKey = familyNameKey;
const faceLabel = (f: FaceShape) => `weight ${f.weight}${f.style === 'italic' ? ' italic' : ''}`;
/** 8 hex đầu của sha256 trong khoá theo nội dung (`…-1a2b3c4d.woff2`). */
const KEY_DIGEST_RE = /-([0-9a-f]{8})(?:\.[a-z0-9]+)?$/;

/**
 * Họ font của gói so với đích, theo `slug` (spec §13.2):
 *  - chưa có → tạo họ, face, token (file đi đường ảnh);
 *  - có → dùng bản ở đích; thiếu face hoặc file khác thì thành việc cần làm (C8), như component trùng khoá;
 *  - chưa có mà `cssName` trùng họ khác slug hoặc trùng họ có sẵn → chặn (G11, đổi tên);
 *    token `font-<slug>` đã bị một biến không thuộc họ nào chiếm → chặn (G12, gỡ biến).
 */
function planFonts(bundle: PageBundle, snap: TargetSnapshot): { rows: FontPlanRow[]; issues: TransferIssue[] } {
  const issues: TransferIssue[] = [];
  const shaOf = new Map(bundle.assets.map((a) => [a.id, a.sha256]));

  const rows: FontPlanRow[] = bundle.fonts.map((f) => {
    const there = snap.fontFamilies.find((x) => x.slug === f.slug);
    if (there) {
      const missing = new Set<string>();
      const changed = new Set<string>();
      for (const face of f.faces) {
        const hit = there.faces.find((x) => faceKey(x) === faceKey(face));
        if (!hit) {
          // Đích có cùng weight/style ở dải ký tự khác: nêu dải thiếu; không có gì thì chỉ nêu weight.
          const partial = there.faces.some((x) => x.weight === face.weight && x.style === face.style);
          missing.add(partial ? `${faceLabel(face)} (${face.subset || 'dải ký tự khác'})` : faceLabel(face));
        } else if (KEY_DIGEST_RE.exec(hit.key)?.[1] !== shaOf.get(face.assetRef)?.slice(0, 8)) {
          changed.add(faceLabel(face));
        }
      }
      const diff = [
        ...(missing.size ? [`thiếu ${[...missing].join(', ')}`] : []),
        ...(changed.size ? [`có file ${[...changed].join(', ')} khác bản trong gói`] : []),
      ];
      if (diff.length) {
        issues.push(issue('font-differs', 'todo', {
          vars: { name: there.cssName, diff: diff.join(' và ') },
          items: [{ label: 'Mở Cài đặt › Font', href: '/builder/settings/fonts' }],
        }));
      }
      return { slug: f.slug, cssName: f.cssName, action: 'use-target', targetId: there.id };
    }

    const clash = snap.fontFamilies.find((x) => nameKey(x.cssName) === nameKey(f.cssName));
    const reason = isReservedFamilyName(f.cssName) ? 'đó là tên một font có sẵn hoặc tên dự phòng của hệ thống'
      : clash ? `ở đây đã có họ "${clash.cssName}" (token font-${clash.slug})`
      : null;
    if (reason) issues.push(issue('font-name-taken', 'block', { vars: { name: f.cssName, slug: f.slug, reason } }));
    // Slug bất biến nên "đổi tên họ" không gỡ được chỗ này: biến cùng tên phải đi trước.
    else if (snap.tokens.has(fontTokenName(f.slug))) issues.push(issue('font-token-taken', 'block', { vars: { name: f.cssName, token: fontTokenName(f.slug) } }));
    return { slug: f.slug, cssName: f.cssName, action: 'create', targetId: null };
  });

  // Gói phải tự nhất quán (nguồn không thể có hai họ trùng slug, trùng tên không phân biệt hoa
  // thường, hay hai face trùng nhau): sửa tay mới ra thế, và tạo sẽ vỡ khoá unique giữa
  // transaction. Họ sẽ TẠO thì token đi thẳng vào stylesheet — cùng luật với màn Font.
  const bad = bundle.fonts.filter((f, i) =>
    bundle.fonts.filter((x) => x.slug === f.slug).length > 1
    || bundle.fonts.filter((x) => nameKey(x.cssName) === nameKey(f.cssName)).length > 1
    || new Set(f.faces.map(faceKey)).size !== f.faces.length
    || (rows[i]!.action === 'create'
      && (!TOKEN_NAME_RE.test(fontTokenName(f.slug)) || !isSafeTokenValue(fontTokenValue(f.cssName, f.fallback)))));
  if (bad.length) {
    issues.push(issue('file-corrupt', 'block', {
      detail: `${bad.length} họ font trong gói không hợp lệ.`,
      items: bad.map((f) => ({ label: `${f.cssName} (${fontTokenName(f.slug)})` })),
    }));
  }
  return { rows, issues };
}

/**
 * File font chỉ thuộc họ GIỮ bản ở đích thì không cần lên kho: không ai trỏ tới chúng. Bỏ khỏi
 * kế hoạch ảnh để không tải lên file mồ côi (trừ khi doc cũng dùng chính file đó).
 */
function unneededFontAssets(bundle: PageBundle, compat: CompatResult, rows: FontPlanRow[]): Set<string> {
  const refs = (action: FontPlanRow['action']) => new Set(bundle.fonts
    .filter((_, i) => rows[i]!.action === action)
    .flatMap((f) => f.faces.map((x) => x.assetRef)));
  const kept = refs('use-target');
  if (!kept.size || !compat.doc) return new Set();
  const created = refs('create');
  const used = assetUses({
    doc: compat.doc, trees: compat.trees,
    translations: bundle.translations.map((t) => ({ ...t, value: t.value })), ogImageId: bundle.page.ogImageId,
  });
  return new Set([...kept].filter((id) => !created.has(id) && !used.has(id)));
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

  const fontPlan = planFonts(bundle, snap);
  issues.push(...fontPlan.issues);
  const skipAssets = unneededFontAssets(bundle, compat, fontPlan.rows);

  const assets: AssetPlanRow[] = bundle.assets.filter((a) => !skipAssets.has(a.id)).map((a) => {
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

  // Token của họ font do phần font lo (tạo cùng họ, hoặc giữ bản ở đích) — gói sửa tay có nhét nó
  // vào `tokens[]` cũng không tạo hai lần.
  const fontTokenNames = new Set(bundle.fonts.map((f) => fontTokenName(f.slug)));
  const plainTokens = bundle.tokens.filter((t) => !fontTokenNames.has(t.name));
  const tokens = plainTokens.map((t) => {
    const there = snap.tokens.get(t.name);
    return { name: t.name, action: there === undefined ? ('create' as const) : ('keep' as const), differs: there !== undefined && there !== t.value };
  });
  // Token sẽ TẠO đi thẳng vào stylesheet (`:root { --tên: giá-trị }`): cùng luật với ô tạo token,
  // vì gói sửa tay có thể nhét chuỗi CSS bất kỳ.
  const badTokens = plainTokens.filter((t) =>
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
    const own = new Set([...bundle.tokens.map((t) => t.name), ...fontTokenNames]);
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
        items: [{ label: 'Xem các form đang chờ URL ở Cài đặt', href: '/builder/settings#settings-endpoints' }],
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
    choices, suggestedPageId, target: resolved, assets, components, tokens, fonts: fontPlan.rows, locales,
    folders: snap.folders, issues,
  };
}
