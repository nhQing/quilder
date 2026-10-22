/**
 * Khởi tạo dữ liệu tối thiểu cho một site — KHÔNG PHÁ.
 *
 * ## Vì sao không gọi lại `prisma/seed.ts`
 *
 * Seed mở đầu bằng `site.deleteMany()`: đúng cho máy dev muốn làm lại từ đầu, và là
 * thảm hoạ nếu một nút bấm hay một lần bootstrap gọi nhầm nó trên site đang chạy.
 * Hàm này thì mỗi bước KIỂM rồi mới TẠO, nên gọi bao nhiêu lần cũng được — màn cài
 * đặt, `seed.ts` và `bootstrap.sh` cùng gọi nó.
 *
 * ## Những gì nó đảm bảo có
 *
 * | Thứ           | Tạo khi                                     |
 * |---------------|---------------------------------------------|
 * | Locale        | `upsert` — không bao giờ ghi đè hàng có sẵn |
 * | Site          | bảng `Site` rỗng                            |
 * | Trang chủ     | chưa có trang slug `''`                     |
 * | Trang 404     | chưa có trang `system = 'not-found'`        |
 * | Release đầu   | site chưa có `activeReleaseId`              |
 *
 * Release đầu chỉ tạo khi site CHƯA TỪNG publish. Site đang chạy được bổ sung trang
 * 404 ở dạng nháp; nó lên site thật ở lần Publish kế — tới lúc đó `not-found.tsx`
 * vẫn dùng bản trong code.
 */

import type { Prisma } from '@prisma/client';

import type { Doc } from '@/lib/doc/types';
import {
  DEFAULT_HOME,
  DEFAULT_NOT_FOUND,
  defaultHomeDoc,
  defaultNotFoundDoc,
} from './default-docs';

type Tx = Prisma.TransactionClient;

export const DEFAULT_SITE_NAME = 'Website';
const FALLBACK_DOMAIN = 'localhost:3001';
/** Người tạo ghi vào `PageVersion.createdBy` / `Release.createdBy`. */
const ACTOR = 'setup';

export interface LocaleSeed {
  code: string;
  label: string;
  isDefault: boolean;
  enabled: boolean;
}

/** Site mới chỉ có tiếng Việt. Thêm ngôn ngữ là việc của màn Ngôn ngữ. */
export const DEFAULT_LOCALES: LocaleSeed[] = [
  { code: 'vi', label: 'Tiếng Việt', isDefault: true, enabled: true },
];

export interface EnsureSiteOptions {
  /** Đặt khi tạo; với site đã có thì CẬP NHẬT. Bỏ trống = không đụng. */
  name?: string;
  /** Origin đã chuẩn hoá (`normalizeSiteUrl`). Cùng luật với `name`. */
  siteUrl?: string;
  /** Chỉ dùng khi TẠO site. */
  globals?: Prisma.InputJsonValue;
  locales?: LocaleSeed[];
  /** Doc + metadata trang chủ thay cho bản trung tính — `seed.ts` dùng. */
  home?: { doc: Doc; title: string; description?: string | null; jsonLd?: Prisma.InputJsonValue };
  actor?: string;
}

export interface EnsureSiteResult {
  siteId: string;
  /** Những thứ vừa tạo/cập nhật, để log. Rỗng = không có gì phải làm. */
  created: string[];
}

function hostOf(siteUrl: string | undefined): string | undefined {
  return siteUrl ? new URL(siteUrl).host : undefined;
}

async function createPageWithDraft(
  tx: Tx,
  data: {
    siteId: string;
    slug: string;
    title: string;
    description?: string | null;
    jsonLd?: Prisma.InputJsonValue;
    noindex?: boolean;
    system?: string;
    doc: Doc;
    actor: string;
  },
) {
  const page = await tx.page.create({
    data: {
      siteId: data.siteId,
      slug: data.slug,
      title: data.title,
      description: data.description ?? null,
      jsonLd: data.jsonLd,
      noindex: data.noindex ?? false,
      system: data.system ?? null,
    },
  });
  const version = await tx.pageVersion.create({
    data: {
      pageId: page.id,
      doc: data.doc as unknown as Prisma.InputJsonValue,
      schemaVer: data.doc.schemaVersion,
      label: 'Khởi tạo',
      createdBy: data.actor,
    },
  });
  await tx.page.update({ where: { id: page.id }, data: { draftVersionId: version.id } });
  return { id: page.id, slug: page.slug, draftVersionId: version.id };
}

export async function ensureSiteDefaults(
  tx: Tx,
  opts: EnsureSiteOptions = {},
): Promise<EnsureSiteResult> {
  const created: string[] = [];
  const actor = opts.actor ?? ACTOR;

  for (const loc of opts.locales ?? DEFAULT_LOCALES) {
    const had = await tx.locale.findUnique({ where: { code: loc.code }, select: { code: true } });
    if (!had) {
      await tx.locale.create({ data: loc });
      created.push(`locale:${loc.code}`);
    }
  }

  /* ── Site ─────────────────────────────────────────────────────────── */
  let site = await tx.site.findFirst({
    select: { id: true, name: true, activeReleaseId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!site) {
    site = await tx.site.create({
      data: {
        name: opts.name ?? DEFAULT_SITE_NAME,
        primaryDomain: hostOf(opts.siteUrl) ?? FALLBACK_DOMAIN,
        siteUrl: opts.siteUrl ?? null,
        globals: opts.globals ?? {},
      },
      select: { id: true, name: true, activeReleaseId: true },
    });
    created.push('site');
  } else if (opts.name !== undefined || opts.siteUrl !== undefined) {
    await tx.site.update({
      where: { id: site.id },
      data: {
        ...(opts.name !== undefined ? { name: opts.name } : {}),
        ...(opts.siteUrl !== undefined
          ? { siteUrl: opts.siteUrl, primaryDomain: hostOf(opts.siteUrl) }
          : {}),
      },
    });
    if (opts.name !== undefined) site = { ...site, name: opts.name };
    created.push('site:cập nhật');
  }

  /* ── Trang chủ ────────────────────────────────────────────────────── */
  let home = await tx.page.findFirst({
    where: { siteId: site.id, slug: '' },
    select: { id: true, slug: true, draftVersionId: true },
  });
  if (!home) {
    home = await createPageWithDraft(tx, {
      siteId: site.id,
      slug: '',
      title: opts.home?.title ?? DEFAULT_HOME.title,
      description: opts.home?.description ?? DEFAULT_HOME.description,
      jsonLd: opts.home?.jsonLd,
      doc: opts.home?.doc ?? defaultHomeDoc(site.name),
      actor,
    });
    created.push('page:home');
  }

  /* ── Trang 404 ────────────────────────────────────────────────────── */
  let notFound = await tx.page.findFirst({
    where: { siteId: site.id, system: 'not-found' },
    select: { id: true, slug: true, draftVersionId: true },
  });
  if (!notFound) {
    // Một trang THƯỜNG đã chiếm slug `404` (người dùng tự dựng trước tính năng này):
    // không cướp slug của nó — trang hệ thống không mở bằng URL, nên slug chỉ là nhãn.
    const taken = await tx.page.findFirst({
      where: { siteId: site.id, slug: DEFAULT_NOT_FOUND.slug },
      select: { id: true },
    });
    notFound = await createPageWithDraft(tx, {
      siteId: site.id,
      slug: taken ? `${DEFAULT_NOT_FOUND.slug}-he-thong` : DEFAULT_NOT_FOUND.slug,
      title: DEFAULT_NOT_FOUND.title,
      description: DEFAULT_NOT_FOUND.description,
      noindex: true,
      system: 'not-found',
      doc: defaultNotFoundDoc(),
      actor,
    });
    created.push('page:not-found');
  }

  /* ── Release đầu tiên ─────────────────────────────────────────────── */
  if (!site.activeReleaseId) {
    const entries = [home, notFound]
      .filter((p): p is typeof p & { draftVersionId: string } => Boolean(p.draftVersionId))
      .map((p) => ({ pageId: p.id, versionId: p.draftVersionId, slug: p.slug }));
    const release = await tx.release.create({
      data: {
        siteId: site.id,
        label: 'Bản đầu tiên',
        note: 'Tạo khi cài đặt site.',
        createdBy: actor,
        entries: { create: entries },
      },
    });
    await tx.site.update({ where: { id: site.id }, data: { activeReleaseId: release.id } });
    created.push('release');
  }

  return { siteId: site.id, created };
}
