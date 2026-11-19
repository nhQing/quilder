import 'server-only';

/**
 * Việc đang treo: trang nào có bản nháp khác bản đang chạy, và khác thế nào.
 *
 * ## Hai con số, và vì sao không được gộp
 *
 * `editCount` đếm **lần sửa** — hiệu `seq` giữa bản nháp và bản đang chạy. `diff` đếm
 * **chỗ đổi** — node thêm, node mất, chữ đổi.
 *
 * Chúng khác nhau, và cái thứ hai NÓI SAI nếu dùng một mình: `diffDocs` cố ý không so
 * style (xem docblock của nó — "diff style ở mức thuộc tính là một dự án riêng"), nên
 * đổi một màu rồi hỏi nó thì nó trả về `0`. Một banner nói "0 thay đổi" trong khi
 * publish sẽ đổi màu trên site thật là banner tệ hơn không có banner.
 *
 * Nên: `editCount` là con số ĐỨNG ĐẦU, cùng nguồn với số trên nút Publish. `diff` là
 * chi tiết phụ, và chỗ hiện nó phải nói rõ nó không tính style. Đây là quyết định #3
 * của spec, không phải một lựa chọn ở tầng này.
 *
 * ## Vì sao một hàm riêng thay vì gọi `publishedSeq` cho từng trang
 *
 * `publishedSeq` tự tra `Site` mỗi lần gọi. Với 6 trang đó là 6 lượt đọc `Site` cho
 * một câu trả lời — và banner này nằm trên trang chủ builder, tức nó chạy ở mỗi lần
 * mở. Ở đây `Site` đọc một lần, `ReleaseEntry` đọc một lần.
 */

import { prisma } from '@/lib/db';
import { diffDocs } from './doc-diff';
import { migrateDoc } from '@/lib/doc/migrate';
import { getLocales } from '@/lib/i18n/queries';
import { componentIdsIn } from '@/lib/render/components';
import {
  countComponentDrift,
  countTranslationDrift,
  type DraftTranslationRow,
} from '@/lib/publish/pending-extra';

export interface PendingPage {
  pageId: string;
  slug: string;
  title: string;
  /** `moi` = chưa từng lên site. `da-sua` = đã lên và bản nháp khác. */
  status: 'moi' | 'da-sua';
  /**
   * Số lần sửa chưa publish — hiệu `seq`. `null` khi trang chưa từng publish (không có
   * mốc để trừ), và chỗ hiện phải nói "trang mới" thay vì một con số.
   */
  editCount: number | null;
  /** Chỗ đổi. KHÔNG tính style — xem docblock đầu file. */
  diff: { added: number; removed: number; textChanged: number };
  /**
   * Thay đổi NGOÀI cây node (bản dịch, component) — cùng phép đếm với nhãn nút Publish
   * trong editor (`pendingExtras`). Thiếu nó thì trang chỉ mới dịch xong ở /builder là
   * "không có việc gì" dù bấm Publish sẽ đổi site thật.
   */
  extra: { translations: number; components: number };
}

export async function pendingWork(): Promise<PendingPage[]> {
  const site = await prisma.site.findFirst({ select: { id: true, activeReleaseId: true } });
  if (!site) return [];

  const pages = await prisma.page.findMany({
    where: { siteId: site.id, archivedAt: null, draftVersionId: { not: null } },
    orderBy: { slug: 'asc' },
    select: {
      id: true, slug: true, title: true, draftVersionId: true,
      draftVersion: { select: { doc: true, seq: true } },
    },
  });
  if (!pages.length) return [];

  const live = new Map<string, { versionId: string; doc: unknown; seq: number }>();
  if (site.activeReleaseId) {
    const entries = await prisma.releaseEntry.findMany({
      where: { releaseId: site.activeReleaseId },
      select: { pageId: true, versionId: true, version: { select: { doc: true, seq: true } } },
    });
    for (const e of entries) {
      live.set(e.pageId, { versionId: e.versionId, doc: e.version.doc, seq: e.version.seq });
    }
  }

  // Bản dịch + component: đọc MỘT lần cho mọi trang rồi chia theo trang, thay vì
  // `pendingExtras` từng trang (N trang = 3N lượt đọc ở mỗi lần mở trang chủ builder).
  // Chưa có release nào thì không có mốc để so — giống `pendingExtras`, trả 0.
  const docs = new Map(pages.map((p) => [p.id, migrateDoc(p.draftVersion!.doc)]));
  const extras = new Map<string, { translations: number; components: number }>();
  if (site.activeReleaseId) {
    const localeCodes = (await getLocales()).filter((l) => !l.isDefault).map((l) => l.code);
    const compIds = [...new Set([...docs.values()].flatMap((d) => componentIdsIn(d)))];
    const [release, rows, presets] = await Promise.all([
      prisma.release.findUnique({
        where: { id: site.activeReleaseId },
        select: { translations: true, components: true },
      }),
      localeCodes.length
        ? prisma.translation.findMany({
            where: { pageId: { in: pages.map((p) => p.id) }, locale: { in: localeCodes } },
            select: { pageId: true, locale: true, nodeId: true, field: true, value: true },
          })
        : Promise.resolve([]),
      compIds.length
        ? prisma.preset.findMany({ where: { id: { in: compIds } }, select: { id: true, tree: true } })
        : Promise.resolve([]),
    ]);
    const byPage = new Map<string, DraftTranslationRow[]>();
    for (const r of rows) {
      const list = byPage.get(r.pageId) ?? [];
      list.push(r);
      byPage.set(r.pageId, list);
    }
    const presetById = new Map(presets.map((x) => [x.id, x]));
    for (const p of pages) {
      const doc = docs.get(p.id)!;
      extras.set(p.id, {
        translations: countTranslationDrift(
          byPage.get(p.id) ?? [], release?.translations, p.id, localeCodes, new Set(Object.keys(doc.nodes)),
        ),
        components: countComponentDrift(
          componentIdsIn(doc).flatMap((id) => presetById.get(id) ?? []),
          release?.components,
        ),
      });
    }
  }

  const out: PendingPage[] = [];

  for (const p of pages) {
    const draft = p.draftVersion!;
    const onSite = live.get(p.id);
    const extra = extras.get(p.id) ?? { translations: 0, components: 0 };
    const hasExtra = extra.translations > 0 || extra.components > 0;

    // Bản nháp ĐANG LÀ bản trên site → không có gì treo. Kiểm bằng `versionId` chứ
    // không bằng diff: hai doc giống nhau vẫn có thể là hai version khác nhau (ai đó
    // sửa rồi hoàn tác), và lúc đó vẫn có một lần publish đang chờ.
    // ... trừ khi bản dịch / component còn lệch: lúc đó vẫn còn một lần publish chờ.
    if (onSite && onSite.versionId === p.draftVersionId && !hasExtra) continue;

    const d = diffDocs(onSite ? migrateDoc(onSite.doc) : null, docs.get(p.id)!);

    out.push({
      pageId: p.id,
      slug: p.slug,
      title: p.title,
      status: onSite ? 'da-sua' : 'moi',
      /*
       * `Math.max(0, …)` chứ không hiệu trần: `seq` của bản nháp có thể NHỎ HƠN bản
       * trên site sau một lần lùi release — lúc đó "âm 3 lần sửa" là một câu vô nghĩa,
       * còn 0 thì đúng ("không có lần sửa nào MỚI"). Cùng phép kẹp mà `publishLook`
       * dùng, và cùng lý do.
       */
      editCount: onSite ? Math.max(0, draft.seq - onSite.seq) : null,
      diff: {
        added: d.added.length,
        removed: d.removed.length,
        textChanged: d.textChanged.length,
      },
      extra,
    });
  }

  return out;
}
