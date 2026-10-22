import 'server-only';

/**
 * Nhận kết quả clone (cây thô + asset) và ghi thành một TRANG NHÁP MỚI, noindex.
 *
 * ## Ba điều không bao giờ xảy ra ở đây
 *
 *  1. **Không publish.** Trang chỉ có `draftVersion`; lên site thật khi con người bấm Publish.
 *  2. **Không đè trang có sẵn.** Slug đã tồn tại là DỪNG — gõ nhầm slug không được phép chạm trang
 *     của người khác. (`scripts/migrate/draft-page.ts` có `--new-version` cho việc đó; công cụ AI thì không.)
 *  3. **Không tự đặt thư mục ảnh.** `folder` bắt buộc và do chủ site chọn — kho ảnh phẳng hay lẫn
 *     tên thư mục tự bịa đều là thứ người dùng phải dọn.
 *
 * `noindex: true` luôn bật: lỡ có người publish nhầm bản clone thì máy tìm kiếm cũng không lập chỉ
 * mục một bản sao nội dung của site khác.
 *
 * Dùng chung `uploadAsset` (cùng luật dò kiểu, khoá theo nội dung, tái dùng ảnh cũ, AuditLog) và
 * `validateNewPage` (cùng luật slug) với nút "Trang mới" — không có đường ghi thứ hai.
 */

import { normalizeFolder } from '@/lib/assets/folder';
import { createHash } from 'node:crypto';

import { validateNewPage } from '@/lib/builder/create-page';
import { MAX_ASSET_BYTES, uploadAsset } from '@/lib/builder/upload-asset';
import { prisma } from '@/lib/db';
import { getLocales } from '@/lib/i18n/queries';
import { CURRENT_SCHEMA_VERSION } from '@/lib/doc/types';
import { assembleCloneDoc, collectAssetRefs, CloneAssembleError } from './assemble';
import type { CloneAssetResult, CloneDraftInput, CloneReportItem } from './types';

/** Trần số asset server tự tải (phía còn lại do `mcp/server.mjs` tải tại chỗ). */
const MAX_SERVER_FETCH = 80;
const FETCH_TIMEOUT_MS = 25_000;
const FETCH_CONCURRENCY = 4;

export type CreateCloneDraftResult =
  | {
      ok: true;
      pageId: string;
      slug: string;
      title: string;
      nodeCount: number;
      editorUrl: string;
      previewUrl: string;
      folder: string;
      noindex: true;
      stats: { nodes: number; images: number; videos: number; imagesWired: number; videosWired: number };
      landmarks: { header: string | null; footer: string | null };
      report: CloneReportItem[];
    }
  | { ok: false; status: number; error: string; issues?: string[] };

/** Chỉ http/https tới máy công khai. Chặn đường vào mạng nội bộ qua `sourceUrl` do client gửi. */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return false;
    }
  }
  return true;
}

function fileNameOf(ref: string): string {
  try {
    const u = new URL(ref);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last) return last;
  } catch {
    /* data: URL — tên suy từ nội dung */
  }
  return `asset-${createHash('sha1').update(ref).digest('hex').slice(0, 8)}`;
}

async function fetchBytes(ref: string): Promise<{ bytes: Uint8Array } | { error: string; code: 'fetch' | 'too-large' | 'unsupported' }> {
  if (ref.startsWith('svg:')) {
    return { error: 'SVG nội dòng phải do mcp/server.mjs gửi kèm (không tải được từ URL)', code: 'unsupported' };
  }
  if (ref.startsWith('data:')) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(ref);
    if (!m) return { error: 'data: URL sai định dạng', code: 'fetch' };
    const buf = m[2] ? Buffer.from(m[3] as string, 'base64') : Buffer.from(decodeURIComponent(m[3] as string));
    if (buf.length > MAX_ASSET_BYTES) return { error: `vượt ${MAX_ASSET_BYTES / 1024 / 1024} MB`, code: 'too-large' };
    return { bytes: new Uint8Array(buf) };
  }
  if (!isPublicHttpUrl(ref)) return { error: 'URL không phải http(s) công khai', code: 'unsupported' };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ref, { signal: ctl.signal, redirect: 'follow', headers: { accept: '*/*' } });
    if (!res.ok) return { error: `HTTP ${res.status}`, code: 'fetch' };
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_ASSET_BYTES) {
      return { error: `vượt ${MAX_ASSET_BYTES / 1024 / 1024} MB (${Math.round(declared / 1024 / 1024)} MB)`, code: 'too-large' };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_ASSET_BYTES) return { error: `vượt ${MAX_ASSET_BYTES / 1024 / 1024} MB`, code: 'too-large' };
    return { bytes: buf };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), code: 'fetch' };
  } finally {
    clearTimeout(timer);
  }
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next] as T;
        next += 1;
        await work(item);
      }
    }),
  );
}

export async function createCloneDraft(
  input: CloneDraftInput,
  ctx: { actorEmail: string; actorSub: string; origin: string },
): Promise<CreateCloneDraftResult> {
  /* 1. Thư mục ảnh — bắt buộc, do chủ site chọn. */
  const folder = normalizeFolder(input.folder);
  if (!folder.ok) return { ok: false, status: 400, error: folder.error };
  if (!folder.value) {
    return {
      ok: false,
      status: 400,
      error:
        'Thiếu thư mục ảnh. HỎI chủ site muốn đặt ảnh clone vào thư mục nào (ví dụ "clone/ten-site") ' +
        'rồi gọi lại — không tự đặt tên.',
    };
  }

  /* 2. Slug: không phải trang chủ, không phải mẫu động, và CHƯA TỒN TẠI. */
  const localeCodes = (await getLocales()).map((l) => l.code);
  const checked = validateNewPage({ title: input.title, slug: input.slug, localeCodes });
  if (!checked.ok) return checked;
  if (!checked.slug) {
    return { ok: false, status: 400, error: 'Không clone vào trang chủ. Chọn một đường dẫn riêng (ví dụ "clone-demo").' };
  }
  if (checked.slug.includes('[')) {
    return { ok: false, status: 400, error: 'Đường dẫn của trang clone không được chứa đoạn động [..].' };
  }
  const site = await prisma.site.findFirst({ select: { id: true } });
  if (!site) return { ok: false, status: 404, error: 'Chưa có site' };
  const existing = await prisma.page.findUnique({
    where: { siteId_slug: { siteId: site.id, slug: checked.slug } },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: `Đường dẫn /${checked.slug} đã tồn tại. Clone chỉ tạo trang MỚI, không ghi đè — chọn slug khác.`,
    };
  }

  /* 3. Asset còn thiếu: server tự tải bằng URL (đường phụ — đường chính là mcp/server.mjs tải tại chỗ). */
  const assets: Record<string, CloneAssetResult> = { ...input.assets };
  const missing = collectAssetRefs(input.doc).filter((r) => !assets[r.ref]);
  const toFetch = missing.slice(0, MAX_SERVER_FETCH);
  for (const r of missing.slice(MAX_SERVER_FETCH)) {
    assets[r.ref] = { error: `vượt ${MAX_SERVER_FETCH} asset server tự tải`, code: 'unsupported' };
  }
  await pool(toFetch, FETCH_CONCURRENCY, async ({ ref }) => {
    const got = await fetchBytes(ref);
    if ('error' in got) {
      assets[ref] = { error: got.error, code: got.code };
      return;
    }
    const up = await uploadAsset({
      bytes: got.bytes,
      fileName: fileNameOf(ref),
      actorEmail: ctx.actorEmail,
      actorSub: ctx.actorSub,
      folder: folder.value,
    });
    assets[ref] = up.ok ? { assetId: up.asset.id, reused: up.asset.reused } : { error: up.error, code: 'upload' };
  });

  /* 4. Lắp ráp và kiểm schema. */
  let assembled;
  try {
    assembled = assembleCloneDoc(input.doc, { assets, notes: input.notes });
  } catch (e) {
    if (e instanceof CloneAssembleError) return { ok: false, status: 422, error: e.message, issues: e.issues };
    throw e;
  }

  /* 5. Ghi trang nháp mới. */
  const host = (() => {
    try {
      return new URL(input.url).host;
    } catch {
      return input.url.slice(0, 60);
    }
  })();
  const description = (input.page.description ?? '').trim().slice(0, 300) || null;

  const page = await prisma.$transaction(async (tx) => {
    const created = await tx.page.create({
      data: { siteId: site.id, slug: checked.slug, title: checked.title, noindex: true, ...(description ? { description } : {}) },
      select: { id: true },
    });
    const version = await tx.pageVersion.create({
      data: {
        pageId: created.id,
        doc: assembled.doc as unknown as object,
        schemaVer: CURRENT_SCHEMA_VERSION,
        label: `clone từ ${host}`.slice(0, 120),
        createdBy: ctx.actorEmail,
      },
      select: { id: true },
    });
    await tx.page.update({ where: { id: created.id }, data: { draftVersionId: version.id } });
    await tx.auditLog.create({
      data: {
        userId: ctx.actorSub,
        action: 'page.create',
        targetType: 'Page',
        targetId: created.id,
        meta: { slug: checked.slug, title: checked.title, clonedFrom: input.url, nodes: assembled.stats.nodes },
      },
    });
    return created;
  });

  return {
    ok: true,
    pageId: page.id,
    slug: checked.slug,
    title: checked.title,
    nodeCount: assembled.stats.nodes,
    editorUrl: `${ctx.origin}/builder/${page.id}`,
    previewUrl: `${ctx.origin}/preview/${page.id}`,
    folder: folder.value,
    noindex: true,
    stats: assembled.stats,
    landmarks: assembled.landmarks,
    report: assembled.report,
  };
}
