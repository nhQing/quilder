import 'server-only';

/**
 * Hoàn tác một lần nhập — spec §10. Chỉ khi chưa ai sửa trang sau lần nhập. Không xoá
 * component / token / ảnh đã tạo (kể cả ảnh lấy ra khỏi thùng rác hay alt đã điền): đó là dữ
 * liệu dùng chung, có thể đã được trang khác dùng.
 *
 * "Chưa ai sửa" là BA điều, vì chỉ sửa bố cục mới dời con trỏ nháp:
 *  1. `draftVersionId` vẫn là bản lần nhập tạo;
 *  2. không bản dịch nào mới hơn lần nhập, và số bản dịch vẫn bằng số lần nhập để lại
 *     (xoá một bản dịch không để lại `updatedAt` nào);
 *  3. tiêu đề/SEO vẫn đúng như lần nhập để lại (đổi tên, sửa SEO không tạo PageVersion).
 * Thiếu 2 hoặc 3 thì hoàn tác sẽ xoá lặng lẽ việc người khác vừa làm.
 */

import { Prisma } from '@prisma/client';

import type { SessionPayload } from '@/lib/auth/session';
import { archivePage, purgePage } from '@/lib/builder/delete-page';
import { prisma } from '@/lib/db';
import { PAGE_META_SELECT, type ImportMeta, type PageMetaSnapshot } from './commit';

const EDITED = 'Trang đã được sửa sau lần nhập, nên không hoàn tác tự động được. Lùi bố cục bằng Lịch sử của trang.';

export const EDITED_AFTER = 'Trang đã được sửa (bản dịch hoặc SEO) sau lần nhập, nên không hoàn tác tự động được. Lùi bố cục bằng Lịch sử.';

const PUBLISHED = 'Trang này đã được publish sau lần nhập, nên không xoá tự động được. Lưu trữ trang bằng tay nếu không cần nữa.';

/** Ném trong transaction khi trang vừa bị sửa giữa chừng — để cả transaction lùi lại. */
class Refused extends Error {}

/** Trạng thái hiện tại của trang, đủ để biết có ai sửa sau lần nhập không. */
export interface UndoProbe {
  draftVersionId: string | null;
  meta: PageMetaSnapshot;
  translations: { count: number; lastUpdatedAt: Date | null };
}

/** Phần của `ImportMeta` mà phép kiểm cần — log cũ có thể thiếu field, nên để `unknown`. */
export interface ImportStamp {
  createdAt: Date;
  importedVersionId: unknown;
  importedMeta: unknown;
  importedTranslations: unknown;
}

/** JSON có khoá sắp xếp: jsonLd đi qua JSONB hai lần (Page và AuditLog), thứ tự khoá không đáng tin. */
function canonical(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
}

function sameMeta(a: PageMetaSnapshot, b: unknown): boolean {
  if (!b || typeof b !== 'object') return false;
  const m = b as Record<string, unknown>;
  return a.title === m.title
    && (a.description ?? null) === (m.description ?? null)
    && (a.canonical ?? null) === (m.canonical ?? null)
    && a.noindex === m.noindex
    && (a.ogImageId ?? null) === (m.ogImageId ?? null)
    && canonical(a.jsonLd) === canonical(m.jsonLd);
}

/** Vì sao lần nhập này KHÔNG hoàn tác được, hoặc null nếu được. THUẦN. */
export function undoRefusal(stamp: ImportStamp, probe: UndoProbe): string | null {
  if (typeof stamp.importedVersionId !== 'string' || probe.draftVersionId !== stamp.importedVersionId) return EDITED;
  // Log ghi trước khi có hai field này: không kiểm được thì không đoán là "chưa ai sửa".
  if (typeof stamp.importedTranslations !== 'number' || !stamp.importedMeta) return EDITED_AFTER;
  if (probe.translations.count !== stamp.importedTranslations) return EDITED_AFTER;
  if (probe.translations.lastUpdatedAt && probe.translations.lastUpdatedAt.getTime() > stamp.createdAt.getTime()) return EDITED_AFTER;
  if (!sameMeta(probe.meta, stamp.importedMeta)) return EDITED_AFTER;
  return null;
}

/**
 * Trang nào có lần nhập hoàn tác được → id lần nhập. `logs`: lần nhập MỚI NHẤT trước (lần cũ hơn
 * của cùng trang không bao giờ hoàn tác được — lần mới hơn đã dời con trỏ nháp đi).
 */
export function pickUndoable(
  logs: ({ id: string; targetId: string } & ImportStamp)[],
  probes: ReadonlyMap<string, UndoProbe>,
): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const log of logs) {
    if (seen.has(log.targetId)) continue;
    seen.add(log.targetId);
    const probe = probes.get(log.targetId);
    if (probe && !undoRefusal(log, probe)) out.set(log.targetId, log.id);
  }
  return out;
}

type Db = Pick<typeof prisma, 'page' | 'translation'>;

async function probesOf(db: Db, pageIds: string[]): Promise<Map<string, UndoProbe>> {
  if (!pageIds.length) return new Map();
  const pages = await db.page.findMany({ where: { id: { in: pageIds } }, select: { id: true, draftVersionId: true, ...PAGE_META_SELECT } });
  const stats = await db.translation.groupBy({
    by: ['pageId'], where: { pageId: { in: pageIds } }, _count: { _all: true }, _max: { updatedAt: true },
  });
  const byPage = new Map(stats.map((s) => [s.pageId, { count: s._count._all, lastUpdatedAt: s._max.updatedAt }]));
  return new Map(pages.map(({ id, draftVersionId, ...meta }) => [id, {
    draftVersionId, meta, translations: byPage.get(id) ?? { count: 0, lastUpdatedAt: null },
  }]));
}

/**
 * Trang chủ admin gọi mỗi lượt render: chỉ đọc lần nhập MỚI NHẤT của mỗi trang và chỉ các field
 * cần (không kéo bản sao lưu bản dịch — có thể hàng nghìn dòng — trong `meta`).
 */
export async function undoableImports(pages: { id: string; draftVersionId: string | null }[]) {
  if (!pages.length) return new Map<string, string>();
  const logs = await prisma.$queryRaw<({ id: string; targetId: string } & ImportStamp)[]>`
    SELECT DISTINCT ON ("targetId") id, "targetId", "createdAt",
      meta->>'importedVersionId' AS "importedVersionId",
      meta->'importedMeta' AS "importedMeta",
      meta->'importedTranslations' AS "importedTranslations"
    FROM "AuditLog"
    WHERE action = 'page.import' AND "targetId" = ANY(${pages.map((p) => p.id)})
    ORDER BY "targetId", "createdAt" DESC`;
  // Lọc rẻ trước: con trỏ nháp đã dời thì khỏi đọc meta và bản dịch của trang đó.
  const draft = new Map(pages.map((p) => [p.id, p.draftVersionId]));
  const candidates = logs.filter((l) => l.importedVersionId === draft.get(l.targetId));
  return pickUndoable(candidates, await probesOf(prisma, candidates.map((l) => l.targetId)));
}

export async function undoImport(args: { importId: string; session: SessionPayload }): Promise<
  { ok: true; pageId: string; purged: boolean } | { ok: false; status: number; error: string }
> {
  const log = await prisma.auditLog.findUnique({ where: { id: args.importId } });
  if (!log || log.action !== 'page.import' || !log.targetId) return { ok: false, status: 404, error: 'Không có lần nhập này' };
  const meta = log.meta as unknown as ImportMeta;
  const pageId = log.targetId;
  const stamp: ImportStamp = {
    createdAt: log.createdAt, importedVersionId: meta.importedVersionId,
    importedMeta: meta.importedMeta, importedTranslations: meta.importedTranslations,
  };

  const probe = (await probesOf(prisma, [pageId])).get(pageId);
  if (!probe) return { ok: false, status: 404, error: 'Trang không còn' };
  const why = undoRefusal(stamp, probe);
  if (why) return { ok: false, status: 409, error: why };

  if (meta.createdPage) {
    // Có người publish trang sau lần nhập thì purge sẽ từ chối; chặn từ đầu để khỏi
    // để trang nằm lại trong lưu trữ cùng một thông báo khó hiểu.
    if ((await prisma.releaseEntry.count({ where: { pageId } })) > 0) return { ok: false, status: 409, error: PUBLISHED };
    const a = await archivePage({ pageId, actorSub: args.session.sub });
    if (!a.ok) return a;
    const p = await purgePage({ pageId, actorSub: args.session.sub });
    if (!p.ok) return { ok: false, status: p.status, error: 'Đã đưa trang vào lưu trữ nhưng chưa xoá hẳn được: ' + p.error };
    return { ok: true, pageId, purged: true };
  }

  const previous = meta.previousDraftVersionId
    ? await prisma.pageVersion.findFirst({ where: { id: meta.previousDraftVersionId, pageId }, select: { doc: true, schemaVer: true, seq: true } })
    : null;
  if (!previous) return { ok: false, status: 404, error: 'Không còn bản nháp cũ để trả về' };

  try {
    await prisma.$transaction(async (tx) => {
      // Kiểm lại trong transaction: hẹp cửa sổ giữa lúc kiểm ở trên và lúc ghi đè.
      const again = (await probesOf(tx, [pageId])).get(pageId);
      const late = again ? undoRefusal(stamp, again) : EDITED;
      if (late) throw new Refused(late);

      const v = await tx.pageVersion.create({
        data: {
          pageId, doc: previous.doc as Prisma.InputJsonValue, schemaVer: previous.schemaVer,
          label: `hoàn tác lần nhập (về v${previous.seq})`, createdBy: args.session.email,
          parentId: meta.importedVersionId,
        },
        select: { id: true },
      });
      // Khoá lạc quan: có người sửa nháp (hoặc hoàn tác lần thứ hai) giữa chừng thì count = 0.
      const moved = await tx.page.updateMany({
        where: { id: pageId, draftVersionId: meta.importedVersionId },
        data: {
          draftVersionId: v.id,
          ...(meta.previousMeta
            ? {
                title: meta.previousMeta.title, description: meta.previousMeta.description,
                canonical: meta.previousMeta.canonical, noindex: meta.previousMeta.noindex,
                jsonLd: (meta.previousMeta.jsonLd ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                ogImageId: meta.previousMeta.ogImageId,
              }
            : {}),
        },
      });
      if (moved.count === 0) throw new Refused(EDITED);
      await tx.translation.deleteMany({ where: { pageId } });
      if (meta.previousTranslations.length) {
        await tx.translation.createMany({
          data: meta.previousTranslations.map((t) => ({ ...t, pageId, value: t.value as Prisma.InputJsonValue })),
        });
      }
      await tx.auditLog.create({
        data: { userId: args.session.sub, action: 'page.import.undo', targetType: 'page', targetId: pageId, meta: { importId: args.importId } },
      });
    }, { timeout: 60_000, maxWait: 10_000 }); // bản dịch của trang lớn có thể nhiều dòng
  } catch (e) {
    if (e instanceof Refused) return { ok: false, status: 409, error: e.message };
    throw e;
  }
  return { ok: true, pageId, purged: false };
}
