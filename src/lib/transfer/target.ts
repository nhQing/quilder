import 'server-only';

import { NextResponse } from 'next/server';

import { parsePageCollection } from '@/lib/builder/page-collection';
import { prisma } from '@/lib/db';
import { readEndpointTable } from '@/lib/doc/endpoint-table';
import { migratePresetTree } from '@/lib/doc/migrate';
import { allowedEmbedHostnames } from '@/lib/render/embed-origins';
import { tokenRefsOf } from './collect';
import { issue } from './guides';
import { candidateKeys, type ImportTarget, type TargetSnapshot } from './import-plan';
import { MAX_MANIFEST_BYTES, parseBundle, type PageBundle } from './manifest';

/** Cây hỏng ở đích không được làm sập cả bản xem trước: coi như cây rỗng (sẽ hiện "khác"). */
function safeTree(raw: unknown): ReturnType<typeof migratePresetTree> {
  try {
    return migratePresetTree(raw);
  } catch {
    return { rootId: '', nodes: {} };
  }
}

/** `target` từ trình duyệt là dữ liệu không tin cậy — chỉ nhận đúng hai dạng, còn lại coi như chưa chọn. */
export function parseImportTarget(raw: unknown): ImportTarget | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'existing' && typeof o.pageId === 'string') return { kind: 'existing', pageId: o.pageId };
  if (o.kind === 'new' && typeof o.slug === 'string' && typeof o.title === 'string') {
    return { kind: 'new', slug: o.slug, title: o.title };
  }
  return null;
}

export async function loadTargetSnapshot(bundle: PageBundle): Promise<TargetSnapshot> {
  const site = await prisma.site.findFirst({ select: { activeReleaseId: true, globals: true } });
  const pages = await prisma.page.findMany({
    where: { archivedAt: null },
    orderBy: { slug: 'asc' },
    select: { id: true, slug: true, title: true, draftVersionId: true, fixture: true, collection: true },
  });
  const live = site?.activeReleaseId
    ? new Map((await prisma.releaseEntry.findMany({ where: { releaseId: site.activeReleaseId }, select: { pageId: true, versionId: true } })).map((e) => [e.pageId, e.versionId]))
    : new Map<string, string>();

  // Không lọc trashedAt: ảnh trong thùng rác vẫn chiếm khoá, kế hoạch cần biết để "khôi phục".
  const keys = bundle.assets.flatMap(candidateKeys);
  const assets = await prisma.asset.findMany({ where: { key: { in: keys } }, select: { id: true, key: true, trashedAt: true, alt: true, bytes: true } });
  const presets = await prisma.preset.findMany({ where: { key: { in: bundle.components.map((c) => c.key) } }, select: { id: true, key: true, tree: true } });
  const tokens = await prisma.token.findMany({ where: { name: { in: bundle.tokens.map((t) => t.name) } }, select: { name: true, value: true } });
  // Đọc thẳng từ dữ liệu thô của gói: chỉ cần TÊN, và gói hỏng thì kế hoạch đã chặn ở chỗ khác.
  const refs = tokenRefsOf([bundle.doc, ...bundle.components.map((c) => c.tree)]);
  const known = refs.length
    ? await prisma.token.findMany({ where: { name: { in: refs } }, select: { name: true } })
    : [];
  const locales = await prisma.locale.findMany({ select: { code: true, enabled: true } });
  const types = await prisma.collectionType.findMany({ select: { key: true, schema: true } });
  const folders = await prisma.assetFolder.findMany({ select: { path: true }, orderBy: { path: 'asc' } });

  return {
    pages: pages.map((p) => ({
      id: p.id, slug: p.slug, title: p.title, draftVersionId: p.draftVersionId, fixture: p.fixture,
      collection: parsePageCollection(p.collection),
      hasUnpublishedChanges: Boolean(p.draftVersionId) && p.draftVersionId !== live.get(p.id),
    })),
    assetsByKey: new Map(assets.map((a) => [a.key, { id: a.id, key: a.key, trashed: Boolean(a.trashedAt), alt: a.alt, bytes: a.bytes }])),
    // Cùng đường chuẩn hoá với phía gói, vì kế hoạch so hình dạng cây bằng JSON.stringify.
    presetsByKey: new Map(presets.map((p) => [p.key, { id: p.id, tree: safeTree(p.tree) }])),
    tokens: new Map(tokens.map((t) => [t.name, t.value])),
    tokenNames: new Set(known.map((t) => t.name)),
    locales: new Map(locales.map((l) => [l.code, { enabled: l.enabled }])),
    endpointUrls: readEndpointTable(site?.globals as Record<string, unknown> | undefined),
    embedHosts: await allowedEmbedHostnames(),
    collectionTypes: new Map(types.map((t) => [t.key, {
      fields: Array.isArray(t.schema) ? (t.schema as { key?: unknown }[]).map((f) => String(f.key ?? '')).filter(Boolean) : [],
    }])),
    folders: folders.map((f) => f.path),
  };
}

/** Đọc body JSON có `bundle`, chặn body quá cỡ, kiểm schema gói. */
export async function readBundleBody(req: Request) {
  const text = await req.text();
  // Đếm BYTE UTF-8, không phải số ký tự: tiếng Việt có dấu chiếm 2-3 byte/ký tự.
  if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES + 64 * 1024) {
    return { ok: false as const, response: NextResponse.json({ error: 'Gói quá lớn', issues: [issue('too-large', 'block')] }, { status: 413 }) };
  }
  let body: Record<string, unknown>;
  try {
    const json: unknown = JSON.parse(text);
    if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('not object');
    body = json as Record<string, unknown>;
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: 'JSON không hợp lệ', issues: [issue('file-corrupt', 'block')] }, { status: 400 }) };
  }
  const parsed = parseBundle(body.bundle);
  if (!parsed.ok) {
    return { ok: false as const, response: NextResponse.json({ error: parsed.error, issues: [issue('file-corrupt', 'block', { detail: parsed.error })] }, { status: 400 }) };
  }
  return { ok: true as const, body, bundle: parsed.bundle };
}
