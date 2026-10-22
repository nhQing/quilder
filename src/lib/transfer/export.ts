import 'server-only';

/**
 * Dựng gói xuất cho MỘT trang: bản nháp, bản dịch, component, token tự tạo, file ảnh.
 *
 * Hai lượt: `export/check` dựng gói và kiểm mọi file có thật (chưa tải gì), rồi `export` dựng
 * lại và stream zip. Lỗi phải hiện thành CHỮ ở lượt đầu — một lượt tải bị ngắt giữa chừng chỉ
 * cho người dùng thấy "tải xuống thất bại" của trình duyệt (spec §5.1).
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getObject } from '@/lib/assets/s3';
import { labelOf } from '@/lib/builder/node-label';
import { prisma } from '@/lib/db';
import { migrateDoc, migratePresetTree } from '@/lib/doc/migrate';
import { zDoc } from '@/lib/doc/schema';
import { CURRENT_SCHEMA_VERSION, type Doc, type Node } from '@/lib/doc/types';
import {
  assetUses, componentIdsOf, needsOf, tokenNamesOf, useLink as linkOf, type AssetUse, type TreeShape,
} from './collect';
import { IMPORT_FILE_LIMIT } from './compat';
import { issue, type IssueItem, type TransferIssue } from './guides';
import {
  BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION, MAX_BUNDLE_ASSETS, MAX_MANIFEST_BYTES,
  fileEntryName, uploadNameOf, type PageBundle,
} from './manifest';
import { configuredSiteOrigin } from '@/lib/site/origin';

/** Host của site nguồn ghi vào gói; `'localhost'` khi chưa đặt domain (như trước). */
async function exportOriginHost(): Promise<string> {
  const origin = await configuredSiteOrigin();
  return origin ? new URL(origin).host : 'localhost';
}

export interface ExportFile {
  entry: string;
  /** `id` chỉ để lỗi nói được "ảnh nào, ở đâu" (tra `uses`); không đi vào gói. */
  asset: { id?: string; key: string; url: string };
}

function where(use: AssetUse, labels: Record<string, string>): string {
  if (use.kind === 'og') return 'ảnh chia sẻ của trang';
  if (use.kind === 'component') return `component ${use.componentId} › node ${use.nodeId}`;
  if (use.kind === 'translation') return `bản dịch ${use.locale} của node ${labels[use.nodeId!] ?? use.nodeId}`;
  return `trang › ${labels[use.nodeId!] ?? `node ${use.nodeId}`}`;
}

export function exportIssues(input: {
  pageId: string;
  uses: Map<string, AssetUse[]>;
  rows: Map<string, { name: string; bytes: number }>;
  missingComponents: { nodeId: string }[];
  nodeLabels: Record<string, string>;
  collection: boolean;
}): TransferIssue[] {
  const out: TransferIssue[] = [];
  const gone: IssueItem[] = [];
  const big: IssueItem[] = [];
  for (const [id, list] of input.uses) {
    const row = input.rows.get(id);
    for (const use of list) {
      if (!row) gone.push({ label: `Ảnh ${id} — ${where(use, input.nodeLabels)}`, href: linkOf(input.pageId, use) });
      else if (row.bytes > IMPORT_FILE_LIMIT) {
        big.push({ label: `${row.name} (${(row.bytes / 1024 / 1024).toFixed(1)} MB) — ${where(use, input.nodeLabels)}`, href: linkOf(input.pageId, use) });
      }
    }
  }
  if (gone.length) out.push(issue('asset-row-missing', 'block', { items: gone }));
  if (input.missingComponents.length) {
    out.push(issue('component-missing', 'block', {
      items: input.missingComponents.map((m) => ({ label: `Instance ${input.nodeLabels[m.nodeId] ?? m.nodeId}`, href: `/builder/${input.pageId}?node=${m.nodeId}` })),
    }));
  }
  if (big.length) out.push(issue('file-over-import-limit', 'warn', { items: big }));
  if (input.collection) out.push(issue('entries-not-included', 'warn'));
  return out;
}

/**
 * X6 — gói vượt giới hạn mà schema nhập sẽ từ chối. Báo ngay khi xuất, thay vì để xuất xong
 * mới bị chặn ở đích. Liệt kê 3 chỗ dùng nhiều ảnh nhất (đếm theo node).
 */
export function tooLargeIssue(input: {
  pageId: string;
  assetCount: number;
  manifestBytes: number;
  uses: Map<string, AssetUse[]>;
  nodeLabels: Record<string, string>;
}): TransferIssue | null {
  if (input.assetCount <= MAX_BUNDLE_ASSETS && input.manifestBytes <= MAX_MANIFEST_BYTES) return null;
  const counts = new Map<string, { use: AssetUse; n: number }>();
  for (const list of input.uses.values()) {
    for (const use of list) {
      const k = `${use.kind}|${use.componentId ?? ''}|${use.locale ?? ''}|${use.nodeId ?? ''}`;
      const cur = counts.get(k);
      if (cur) cur.n += 1;
      else counts.set(k, { use, n: 1 });
    }
  }
  const items = [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map(({ use, n }) => ({ label: `${where(use, input.nodeLabels)} — ${n} ảnh`, href: linkOf(input.pageId, use) }));
  return issue('too-large', 'block', { items });
}

const isRemote = (url: string) => /^https?:\/\//i.test(url);

export async function readExportFile(f: ExportFile): Promise<Uint8Array> {
  // 11 asset cũ nằm trong `public/` với url tương đối (HANDOFF §3.27) — đọc từ đĩa.
  if (!isRemote(f.asset.url)) {
    const publicDir = path.resolve(process.cwd(), 'public');
    const full = path.resolve(publicDir, f.asset.url.replace(/^\/+/, ''));
    // url lưu trong DB không đáng tin: `/../.env` không được đọc ra ngoài `public/`.
    if (!full.startsWith(publicDir + path.sep)) {
      throw Object.assign(new Error(`Đường dẫn ngoài public/: ${f.asset.url}`), { code: 'ENOENT' });
    }
    return new Uint8Array(await readFile(full));
  }
  return getObject(f.asset.key);
}

/** Lỗi đọc là "file mất" (X2) hay "kho không với tới" (X3)? Dựa vào CHÍNH lỗi đọc, không dò lại. */
export function isMissingError(e: unknown): boolean {
  const err = e as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
  const status = err?.$metadata?.httpStatusCode;
  return err?.code === 'ENOENT' || err?.name === 'NoSuchKey' || err?.name === 'NotFound' || status === 404 || status === 403;
}

/**
 * Mỗi file đọc lỗi PHẢI thành một mục trong issue block — nếu không, gói xuất thiếu ảnh mà
 * không ai biết. Mất → X2 (kèm chỗ dùng + link); lỗi khác → X3.
 */
export function unreadableIssues(
  failures: { file: ExportFile; error: unknown }[],
  uses: Map<string, AssetUse[]>,
  pageId: string,
  nodeLabels: Record<string, string>,
): TransferIssue[] {
  const missing: IssueItem[] = [];
  const other: string[] = [];
  for (const { file, error } of failures) {
    if (!isMissingError(error)) {
      other.push(String((error as Error)?.message ?? error));
      continue;
    }
    const first = file.asset.id ? uses.get(file.asset.id)?.[0] : undefined;
    missing.push(first
      ? { label: `${uploadNameOf(file.asset.key)} — ${where(first, nodeLabels)}`, href: linkOf(pageId, first) }
      : { label: file.asset.key, href: '/builder/assets' });
  }
  const out: TransferIssue[] = [];
  if (missing.length) out.push(issue('asset-file-missing', 'block', { items: missing }));
  if (other.length) out.push(issue('storage-unreachable', 'block', { detail: other[0]!.slice(0, 200) }));
  return out;
}

/** Instance trỏ component đã xoá — kể cả component của từng loại khối trong `repeat.blockComponents`. */
export function missingComponentRefs(
  nodes: Record<string, Node>,
  trees: { has(id: string): boolean },
): { nodeId: string }[] {
  const out: { nodeId: string }[] = [];
  for (const n of Object.values(nodes)) {
    if (n.type !== 'Instance') continue;
    const ids = [n.componentId, ...Object.values(n.repeat?.blockComponents ?? {})];
    for (const id of new Set(ids)) if (!trees.has(id)) out.push({ nodeId: n.id });
  }
  return out;
}

export async function buildExport(
  pageId: string,
  exportedBy: string,
): Promise<{ ok: true; bundle: PageBundle; files: ExportFile[]; issues: TransferIssue[] } | { ok: false; status: number; error: string }> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true, slug: true, title: true, description: true, canonical: true, noindex: true,
      jsonLd: true, ogImageId: true, collection: true,
      draftVersion: { select: { doc: true } },
      site: { select: { name: true } },
    },
  });
  if (!page?.draftVersion) return { ok: false, status: 404, error: 'Không có trang này, hoặc trang chưa có bản nháp' };

  const issues: TransferIssue[] = [];
  let doc: Doc;
  try {
    doc = migrateDoc(page.draftVersion.doc);
    const parsed = zDoc.safeParse(doc);
    if (!parsed.success) {
      return {
        ok: true, bundle: null as never, files: [],
        issues: [issue('doc-invalid', 'block', {
          items: parsed.error.issues.slice(0, 10).map((i) => {
            const nodeId = i.path[0] === 'nodes' ? String(i.path[1]) : null;
            return { label: `${i.path.join('.')} — ${i.message}`, href: nodeId ? `/builder/${pageId}?node=${nodeId}` : undefined };
          }),
        })],
      };
    }
  } catch (e) {
    return { ok: true, bundle: null as never, files: [], issues: [issue('doc-invalid', 'block', { detail: String((e as Error).message) })] };
  }

  const componentIds = componentIdsOf(doc.nodes);
  const presets = await prisma.preset.findMany({
    where: { id: { in: componentIds } },
    select: { id: true, key: true, name: true, category: true, aiDescription: true, tree: true },
  });
  const trees = new Map<string, TreeShape>(presets.map((p) => [p.id, migratePresetTree(p.tree)]));
  const missingComponents = missingComponentRefs(doc.nodes, trees);

  const translations = await prisma.translation.findMany({
    where: { pageId },
    select: { locale: true, nodeId: true, field: true, value: true, sourceHash: true },
  });
  const uses = assetUses({ doc, trees, translations, ogImageId: page.ogImageId });
  const assetRows = await prisma.asset.findMany({
    where: { id: { in: [...uses.keys()] } },
    select: { id: true, key: true, url: true, kind: true, mime: true, bytes: true, width: true, height: true, blurhash: true, alt: true, folder: true },
  });
  const rows = new Map(assetRows.map((a) => [a.id, { name: uploadNameOf(a.key), bytes: a.bytes }]));

  const nodeLabels = Object.fromEntries(Object.values(doc.nodes).map((n) => [n.id, labelOf(n)]));
  issues.push(...exportIssues({
    pageId, uses, rows, missingComponents, nodeLabels,
    collection: Boolean(page.collection) || needsOf(doc, trees, null).collectionTypes.length > 0,
  }));

  const customTokens = await prisma.token.findMany({
    where: { custom: true },
    select: { name: true, value: true, category: true, group: true, aiDescription: true },
  });
  const tokenNames = new Set(tokenNamesOf([doc.nodes, ...[...trees.values()].map((t) => t.nodes)], new Set(customTokens.map((t) => t.name))));

  const locales = await prisma.locale.findMany({
    where: { code: { in: [...new Set(translations.map((t) => t.locale))] } },
    select: { code: true, label: true },
  });

  // `sha256` phải là của đúng byte sẽ nén vào zip, nên đọc từng file một lần ở đây. File đọc
  // lỗi được gom lại và phân loại theo CHÍNH lỗi đọc (X2/X3) — không dò lại bằng HEAD, vì dò
  // lại có thể "thành công" và để gói xuất lặng lẽ thiếu ảnh.
  const files: ExportFile[] = [];
  const seen = new Set<string>();
  const unreadable: { file: ExportFile; error: unknown }[] = [];
  const bundleAssets: PageBundle['assets'] = [];
  for (const a of assetRows) {
    let sha: string;
    try {
      const bytes = await readExportFile({ entry: '', asset: { key: a.key, url: a.url } });
      sha = createHash('sha256').update(bytes).digest('hex');
    } catch (error) {
      unreadable.push({ file: { entry: '', asset: { id: a.id, key: a.key, url: a.url } }, error });
      continue;
    }
    const entry = fileEntryName(sha, a.key);
    // Cùng nội dung thì chỉ một entry trong zip; nhiều dòng asset cùng trỏ vào nó.
    if (!seen.has(entry)) {
      seen.add(entry);
      files.push({ entry, asset: { id: a.id, key: a.key, url: a.url } });
    }
    bundleAssets.push({
      id: a.id, key: a.key, name: uploadNameOf(a.key), kind: a.kind, mime: a.mime, bytes: a.bytes,
      width: a.width, height: a.height, blurhash: a.blurhash, alt: a.alt, folder: a.folder,
      sha256: sha, file: entry,
    });
  }
  if (unreadable.length) issues.push(...unreadableIssues(unreadable, uses, pageId, nodeLabels));

  const bundle: PageBundle = {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy,
    source: {
      siteName: page.site.name,
      origin: await exportOriginHost(),
      pageId,
    },
    schemaVersion: CURRENT_SCHEMA_VERSION,
    page: {
      slug: page.slug, title: page.title, description: page.description, canonical: page.canonical,
      noindex: page.noindex, jsonLd: page.jsonLd ?? null, ogImageId: page.ogImageId,
      collection: page.collection ?? null,
    },
    doc,
    translations,
    locales,
    components: presets.map((p) => ({ id: p.id, key: p.key, name: p.name, category: p.category, aiDescription: p.aiDescription, tree: trees.get(p.id)! })),
    tokens: customTokens.filter((t) => tokenNames.has(t.name)),
    assets: bundleAssets,
    needs: needsOf(doc, trees, page.collection),
  };

  const tooLarge = tooLargeIssue({
    pageId, assetCount: bundleAssets.length, manifestBytes: Buffer.byteLength(JSON.stringify(bundle), 'utf8'), uses, nodeLabels,
  });
  if (tooLarge) issues.push(tooLarge);
  return { ok: true, bundle, files, issues };
}
