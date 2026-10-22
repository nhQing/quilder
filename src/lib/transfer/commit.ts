import 'server-only';

/**
 * Ghi một lần nhập — spec §8. Thứ tự:
 *  1. Lập lại kế hoạch (không tin preview). Còn blocker / còn file chưa tải → 409.
 *  2. Trang mới: `createPage` (cùng luật slug, collection, hình dạng mẫu với nút "Trang mới"),
 *     rồi coi nó như trang có sẵn. Transaction sau hỏng → lưu trữ + xoá hẳn trang vừa tạo.
 *  3. Một transaction: tạo component + token còn thiếu, lấy ảnh ra khỏi thùng rác, thêm
 *     PageVersion mới và dời con trỏ CÓ ĐIỀU KIỆN, thay bản dịch, ghi AuditLog kèm bản sao lưu.
 *
 * Chỉ ghi BẢN NHÁP: không publish, không đụng Release.
 */

import { Prisma } from '@prisma/client';
import { revalidateTag } from 'next/cache';

import type { SessionPayload } from '@/lib/auth/session';
import { createPage } from '@/lib/builder/create-page';
import { archivePage, purgePage } from '@/lib/builder/delete-page';
import { parsePageCollection } from '@/lib/builder/page-collection';
import { prisma } from '@/lib/db';
import { CURRENT_SCHEMA_VERSION } from '@/lib/doc/types';
import { CUSTOM_TOKENS_TAG } from '@/lib/render/custom-tokens';
import { checkBundle } from './compat';
import { issue, type TransferIssue } from './guides';
import { buildImportPlan, uploadsNeeded, type ImportTarget } from './import-plan';
import type { PageBundle } from './manifest';
import { leftoverIds, remapTranslationValue, remapValue, type IdMaps } from './remap';
import { loadTargetSnapshot } from './target';

export function translationRowsFor(bundle: PageBundle, maps: IdMaps, locales: ReadonlySet<string>) {
  return bundle.translations
    .filter((t) => locales.has(t.locale))
    .map((t) => ({ locale: t.locale, nodeId: t.nodeId, field: t.field, value: remapTranslationValue(t.field, t.value, maps), sourceHash: t.sourceHash }));
}

export interface PageMetaUpdate {
  title?: string;
  description?: string | null;
  canonical?: string | null;
  noindex?: boolean;
  jsonLd?: unknown;
  ogImageId?: string | null;
}

/**
 * Phần meta SEO của trang sẽ bị ghi đè — THUẦN, để test được mà không cần DB.
 *
 * Trang mới luôn lấy meta của gói, nhưng `title` là chữ người dùng vừa gõ ở hộp thoại
 * nên bỏ trống (Prisma hiểu là "không đổi"). Trang có sẵn chỉ đổi khi người dùng
 * tick "lấy cả meta" — mặc định giữ nguyên SEO đang chạy.
 */
export function pageMetaUpdate(
  bundle: PageBundle,
  ogImageId: string | null,
  opts: { createdPage: boolean; takeMeta: boolean },
): PageMetaUpdate {
  if (!opts.createdPage && !opts.takeMeta) return {};
  return {
    title: opts.createdPage ? undefined : bundle.page.title,
    description: bundle.page.description,
    canonical: bundle.page.canonical,
    noindex: bundle.page.noindex,
    jsonLd: bundle.page.jsonLd,
    ogImageId,
  };
}

export interface ImportMeta {
  source: PageBundle['source'];
  sourceSlug: string;
  importedVersionId: string;
  previousDraftVersionId: string | null;
  createdPage: boolean;
  previousTranslations: { locale: string; nodeId: string; field: string; value: unknown; sourceHash: string; updatedBy: string }[];
  previousMeta: PageMetaSnapshot | null;
  /**
   * Tiêu đề/SEO ngay SAU lần nhập, và số bản dịch lần nhập để lại. Đổi tên, sửa SEO, sửa bản dịch
   * không dời `draftVersionId`, nên hoàn tác so hai thứ này để khỏi xoá lặng lẽ việc người khác
   * làm sau lần nhập (xem `undo.ts`).
   */
  importedMeta: PageMetaSnapshot;
  importedTranslations: number;
  /** `assets`: id ảnh ở ĐÍCH mà lần nhập đã đụng tới. Hoàn tác KHÔNG đảo phần này (không bao giờ xoá/đổi ảnh). */
  created: { presets: string[]; tokens: string[]; assets: { restored: string[]; altFilled: string[] } };
}

export type PageMetaSnapshot = { title: string; description: string | null; canonical: string | null; noindex: boolean; jsonLd: unknown; ogImageId: string | null };
export const PAGE_META_SELECT = { title: true, description: true, canonical: true, noindex: true, jsonLd: true, ogImageId: true } as const;

class TargetMoved extends Error {}
class Leftover extends Error {}
class NotUploaded extends Error {}

type Failure = { ok: false; status: number; error: string; issues?: TransferIssue[] };

/** Còn file chưa lên kho: người dùng chỉ cần bấm "Tiếp tục" (file đã lên không tải lại) — G7 nói đúng bước đó. */
const pendingIssue = (n: number) => issue('network', 'block', { detail: `Còn ${n} file chưa tải lên — bấm Tiếp tục.` });

/**
 * Lỗi của transaction → phản hồi cho người dùng, hoặc null nếu không phải lỗi ta hiểu (để ném lại).
 *
 * P2002 (trùng khoá unique của Preset.key / Token.name) nghĩa là giữa lúc lập kế hoạch và lúc ghi
 * có người — thường là chính ta bấm "Nhập" hai lần — đã tạo trước. Đó là "đích vừa đổi", không phải lỗi máy.
 * Kiểm theo `code` chứ không `instanceof`: lớp lỗi của Prisma có thể bị nạp hai bản.
 */
export function commitFailure(e: unknown): Failure | null {
  if (e instanceof TargetMoved) return { ok: false, status: 409, error: 'Trang đích vừa đổi', issues: [issue('target-changed', 'block')] };
  if (e instanceof NotUploaded) {
    return { ok: false, status: 409, error: 'Còn file chưa có trong kho ảnh. Tải đủ file rồi nhập lại.', issues: [pendingIssue(Number(e.message) || 1)] };
  }
  if (e instanceof Leftover) return { ok: false, status: 500, error: `Lỗi code: còn id nguồn chưa đổi ở ${e.message}` };
  if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
    return { ok: false, status: 409, error: 'Component hoặc token vừa được tạo ở đích. Bấm "Xem trước lại" rồi nhập.', issues: [issue('target-changed', 'block')] };
  }
  return null;
}

const json = (v: unknown) => (v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

export async function commitImport(args: {
  bundle: PageBundle;
  target: ImportTarget;
  expectDraftVersionId: string | null;
  takeMeta: boolean;
  session: SessionPayload;
}): Promise<
  | { ok: true; pageId: string; importId: string; issues: TransferIssue[] }
  | { ok: false; status: number; error: string; issues?: TransferIssue[] }
> {
  const { bundle, session } = args;
  const compat = checkBundle(bundle);

  // 1. Lập kế hoạch trước khi tạo trang mới — blocker của gói phải chặn trước mọi lần ghi.
  const snap0 = await loadTargetSnapshot(bundle);
  const plan0 = buildImportPlan(bundle, compat, snap0, null);
  const early = plan0.issues.filter((i) => i.level === 'block');
  if (early.length) return { ok: false, status: 409, error: 'Gói chưa nhập được', issues: early };
  const pending = uploadsNeeded(plan0.assets).length;
  if (pending) {
    return { ok: false, status: 409, error: `Còn ${pending} file chưa tải lên kho ảnh. Tải đủ file rồi nhập lại.`, issues: [pendingIssue(pending)] };
  }

  // 2. Trang mới → tạo, rồi đi đường "trang có sẵn".
  let pageId: string;
  let expect = args.expectDraftVersionId;
  let createdPage = false;
  if (args.target.kind === 'new') {
    const made = await createPage({
      title: args.target.title, slug: args.target.slug,
      collection: parsePageCollection(bundle.page.collection),
      actorEmail: session.email, actorSub: session.sub,
    });
    if (!made.ok) return { ok: false, status: made.status, error: made.error };
    pageId = made.page.id;
    createdPage = true;
    expect = (await prisma.page.findUnique({ where: { id: pageId }, select: { draftVersionId: true } }))?.draftVersionId ?? null;
  } else {
    pageId = args.target.pageId;
  }

  // Dọn trang vừa tạo. Lỗi dọn KHÔNG được che lỗi gốc nên nuốt lại — trang mồ côi vẫn thấy
  // được trong mục lưu trữ, còn lỗi gốc mà mất thì không ai biết vì sao nhập hỏng.
  const undoCreate = async () => {
    if (!createdPage) return;
    try {
      await archivePage({ pageId, actorSub: session.sub });
      await purgePage({ pageId, actorSub: session.sub });
    } catch (err) {
      console.error('[transfer] không dọn được trang vừa tạo', pageId, err);
    }
  };

  try {
    const snap = createdPage ? await loadTargetSnapshot(bundle) : snap0;
    const plan = buildImportPlan(bundle, compat, snap, { kind: 'existing', pageId });
    const blocks = plan.issues.filter((i) => i.level === 'block');
    if (blocks.length) { await undoCreate(); return { ok: false, status: 409, error: 'Trang đích chưa nhận được gói', issues: blocks }; }
    if (!plan.target || plan.target.draftVersionId !== expect) {
      await undoCreate();
      return { ok: false, status: 409, error: 'Trang đích vừa đổi', issues: [issue('target-changed', 'block')] };
    }

    const result = await prisma.$transaction(async (tx) => {
      const componentMap = new Map<string, string>();
      const createdPresets: string[] = [];
      const assetMap = new Map<string, string>();
      // Giữa hai lần lập kế hoạch có ảnh bị xoá hẳn: không tự bịa id.
      const notUploaded = uploadsNeeded(plan.assets).length;
      if (notUploaded) throw new NotUploaded(String(notUploaded));
      for (const a of plan.assets) assetMap.set(a.sourceId, a.targetId!);

      // Spec §8.3: ảnh và component ở đích phải CÒN, kiểm ngay trong transaction. Kế hoạch đọc
      // ngoài transaction; một lượt "xoá hoàn toàn" chen giữa sẽ để trang trỏ vào ảnh không có.
      // Ảnh 'reuse' mà vừa bị đưa vào thùng rác cũng tính là đích vừa đổi: xem trước lại sẽ thành 'restore'.
      const assetIds = [...new Set(assetMap.values())];
      const restoring = new Set(plan.assets.filter((a) => a.status === 'restore').map((a) => a.targetId!));
      const liveAssets = assetIds.length
        ? await tx.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, trashedAt: true } })
        : [];
      if (liveAssets.length !== assetIds.length || liveAssets.some((x) => x.trashedAt && !restoring.has(x.id))) throw new TargetMoved();
      const presetIds = [...new Set(plan.components.filter((c) => c.action === 'use-target').map((c) => c.targetId!))];
      if (presetIds.length && (await tx.preset.count({ where: { id: { in: presetIds } } })) !== presetIds.length) throw new TargetMoved();
      const assetOnly: IdMaps = { assets: assetMap, components: new Map() };
      const newTrees: Record<string, unknown> = {};

      for (const row of plan.components) {
        if (row.action === 'use-target') { componentMap.set(row.sourceId, row.targetId!); continue; }
        const src = bundle.components.find((c) => c.id === row.sourceId)!;
        const tree = { schemaVersion: CURRENT_SCHEMA_VERSION, ...remapValue(compat.trees.get(row.sourceId)!, assetOnly) };
        newTrees[src.key] = tree;
        const made = await tx.preset.create({
          data: {
            key: src.key, name: src.name, category: src.category, aiDescription: src.aiDescription,
            tree: json(tree), builtin: false,
            versions: { create: { tree: json(tree), label: `nhập từ ${bundle.source.origin}`, createdBy: session.email } },
          },
          select: { id: true },
        });
        componentMap.set(row.sourceId, made.id);
        createdPresets.push(made.id);
      }

      const createdTokens: string[] = [];
      for (const t of plan.tokens.filter((x) => x.action === 'create')) {
        const src = bundle.tokens.find((x) => x.name === t.name)!;
        await tx.token.create({ data: { name: src.name, value: src.value, category: src.category, group: src.group, aiDescription: src.aiDescription, custom: true } });
        createdTokens.push(src.name);
      }

      const restoredAssets = [...restoring];
      if (restoredAssets.length) {
        const r = await tx.asset.updateMany({ where: { id: { in: restoredAssets } }, data: { trashedAt: null, trashedBy: null } });
        if (r.count !== restoredAssets.length) throw new TargetMoved();
      }
      // Chỉ điền alt khi gói có alt và ảnh đích chưa có — không ghi đè chữ người ở đích đã viết.
      // Điều kiện nằm trong WHERE (không theo ảnh chụp lúc lập kế hoạch), và updateMany không ném
      // P2025 thô khi hàng vừa mất.
      const altFilled: string[] = [];
      const altDone = new Set<string>();
      for (const a of plan.assets) {
        if (!a.alt || altDone.has(a.targetId!)) continue;
        altDone.add(a.targetId!);
        const r = await tx.asset.updateMany({ where: { id: a.targetId!, OR: [{ alt: null }, { alt: '' }] }, data: { alt: a.alt } });
        if (r.count) altFilled.push(a.targetId!);
      }

      const maps: IdMaps = { assets: assetMap, components: componentMap };
      const doc = remapValue(compat.doc!, maps);
      const rows = translationRowsFor(bundle, maps, new Set(snap.locales.keys()));
      const og = bundle.page.ogImageId ? (assetMap.get(bundle.page.ogImageId) ?? null) : null;
      const stale = leftoverIds({ doc, rows, og, trees: newTrees }, maps);
      if (stale.length) throw new Leftover(stale.slice(0, 5).join(', '));

      const before = await tx.page.findUniqueOrThrow({ where: { id: pageId }, select: PAGE_META_SELECT });
      const previousTranslations = await tx.translation.findMany({
        where: { pageId },
        select: { locale: true, nodeId: true, field: true, value: true, sourceHash: true, updatedBy: true },
      });

      const version = await tx.pageVersion.create({
        data: {
          pageId, doc: json(doc), schemaVer: CURRENT_SCHEMA_VERSION,
          label: `nhập từ ${bundle.source.origin} /${bundle.page.slug}`,
          createdBy: session.email, parentId: expect,
        },
        select: { id: true },
      });
      const { jsonLd, ...scalars } = pageMetaUpdate(bundle, og, { createdPage, takeMeta: args.takeMeta });
      // Điều kiện `draftVersionId: expect` là khoá lạc quan: có người sửa nháp giữa chừng thì count = 0.
      const moved = await tx.page.updateMany({
        where: { id: pageId, draftVersionId: expect },
        data: { draftVersionId: version.id, ...scalars, ...(jsonLd !== undefined ? { jsonLd: json(jsonLd) } : {}) },
      });
      if (moved.count === 0) throw new TargetMoved();

      // Một mốc giờ chung cho bản dịch vừa chèn và AuditLog: hoàn tác coi bản dịch nào MỚI HƠN mốc
      // này là sửa sau lần nhập. Để mỗi bên tự lấy giờ (Prisma ở app, now() ở DB lúc bắt đầu
      // transaction) thì chính hàng vừa nhập đã "mới hơn" log.
      const at = new Date();
      await tx.translation.deleteMany({ where: { pageId } });
      if (rows.length) {
        await tx.translation.createMany({
          data: rows.map((r) => ({ ...r, pageId, value: json(r.value), updatedBy: session.email, updatedAt: at })),
        });
      }
      const after = await tx.page.findUniqueOrThrow({ where: { id: pageId }, select: PAGE_META_SELECT });

      const meta: ImportMeta = {
        source: bundle.source, sourceSlug: bundle.page.slug, importedVersionId: version.id,
        previousDraftVersionId: expect, createdPage,
        previousTranslations: previousTranslations as ImportMeta['previousTranslations'],
        previousMeta: args.takeMeta && !createdPage ? before : null,
        importedMeta: after,
        importedTranslations: rows.length,
        created: { presets: createdPresets, tokens: createdTokens, assets: { restored: restoredAssets, altFilled } },
      };
      const log = await tx.auditLog.create({
        data: { userId: session.sub, action: 'page.import', targetType: 'page', targetId: pageId, meta: json(meta), createdAt: at },
        select: { id: true },
      });
      return { importId: log.id, createdTokens };
    }, { timeout: 60_000, maxWait: 10_000 }); // mặc định 5 s không đủ cho gói tới 5000 ảnh

    if (result.createdTokens.length) revalidateTag(CUSTOM_TOKENS_TAG);
    return { ok: true, pageId, importId: result.importId, issues: plan.issues.filter((i) => i.level !== 'block') };
  } catch (e) {
    await undoCreate();
    const failure = commitFailure(e);
    if (failure) return failure;
    throw e;
  }
}
