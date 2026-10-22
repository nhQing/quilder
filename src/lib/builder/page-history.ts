import 'server-only';

/**
 * Lịch sử sửa một trang, và lùi về một bản cũ.
 *
 * ## Vì sao tính năng này đáng có hơn vẻ ngoài
 *
 * `apply_ops` là đường ghi duy nhất, và nó ghi được từ MCP — tức một Agent sửa
 * 80 op trong một lượt. Khi lượt đó sai ý, thứ người dùng cần không phải một
 * thông báo lỗi mà là **một nút quay lại**. Và họ cần nó lúc đang hoảng, nên nó
 * phải là thao tác không thể fail.
 *
 * Dữ liệu đã đủ từ trước, chỉ chưa ai đọc ra: mỗi lần `applyOpsToPage` chạy là
 * một `PageVersion` mới với `label`, `createdBy` (tiền tố `ai:` khi là Agent),
 * `parentId`, và — quan trọng nhất — **`prompt` đã sinh ra nó**.
 *
 * Cái `prompt` đó là thứ biến lịch sử từ "khi nào" thành "**đã yêu cầu gì**".
 * Với một builder mà AI ghi được, đó là cột đáng nhìn nhất trong bảng.
 *
 * ## Vì sao lùi bản là TẠO MỚI, không phải replay undo
 *
 * `applyOpsToPage` đã tính `invert(current, clean)` và trả về `undo`. Cách dễ
 * nghĩ là lưu mảng đó rồi áp lại. Nó sai ở đây:
 *
 * Undo op chỉ đúng khi được áp theo ĐÚNG thứ tự ngược và không có gì chen vào
 * giữa. Hai người sửa cùng trang, hoặc một Agent sửa trong lúc người khác đang
 * mở builder, là chuỗi đó vỡ — im lặng. Và "lùi về 5 bước trước" thành năm phép
 * áp phải thành công liên tiếp.
 *
 * Cách ở đây: tạo một `PageVersion` MỚI mang `doc` của bản cũ. Cùng hình dạng với
 * rollback release — *"lùi bản là đổi con trỏ, không phải dựng lại nội dung"*.
 * Hệ quả:
 *
 *  - **Không thể fail.** Bytes cũ đã nằm đó, chỉ copy.
 *  - **Lùi 1 bước và lùi 20 bước là cùng một thao tác.**
 *  - **Lịch sử chỉ thêm, không bao giờ xoá.** Một lần lùi hiện ra trong lịch sử,
 *    nên lùi-của-lùi cũng làm được. Không ai mất đường về.
 *
 * ## Vì sao chỉ chạm BẢN NHÁP
 *
 * Lùi ở đây không đổi thứ khách đang xem. `Release` mới là nguồn của site thật,
 * và nó chỉ đổi khi có người bấm Publish. Màn hình PHẢI nói câu đó — nếu không,
 * người ta lùi rồi tưởng đã xong, và bản lỗi vẫn đang chạy ngoài kia.
 */

import { prisma } from '@/lib/db';
import type { SessionPayload } from '@/lib/auth/session';
import { migrateDoc } from '@/lib/doc/migrate';
import type { Doc } from '@/lib/doc/types';
import { diffDocs } from './doc-diff';

/** Trần số bản đọc ra. Đủ để lùi khỏi một sai lầm, không đủ để thành báo cáo. */
const DEFAULT_LIMIT = 25;

export interface PageVersionEntry {
  id: string;
  /** Số phiên bản người dùng đọc được: `v41`. Danh tính của hàng. */
  seq: number;
  label: string | null;
  /** Prompt đã sinh ra bản này. Chỉ có khi là AI. */
  prompt: string | null;
  createdBy: string;
  createdAt: string;
  byAi: boolean;
  /** Bản nháp đang mở. Không lùi về chính nó được. */
  isCurrentDraft: boolean;
  /**
   * Có `Release` nào trỏ tới bản này.
   *
   * Hiện lên vì nó trả lời câu hỏi người dùng thật sự đang hỏi: "bản nào là bản
   * khách đã từng thấy?" Và vì bất biến 3 — bản có release trỏ tới thì bất biến.
   */
  isPublished: boolean;
  /** So với bản cha. `null` ở bản đầu tiên, vốn không có cha. */
  changes: { added: number; removed: number; textChanged: number } | null;
}

export async function listPageVersions(
  pageId: string,
  limit = DEFAULT_LIMIT,
): Promise<PageVersionEntry[]> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, draftVersionId: true },
  });
  if (!page) return [];

  const rows = await prisma.pageVersion.findMany({
    where: { pageId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, seq: true, label: true, prompt: true, createdBy: true,
      createdAt: true, parentId: true, doc: true, schemaVer: true,
    },
  });
  if (!rows.length) return [];

  const publishedIds = new Set(
    (
      await prisma.releaseEntry.findMany({
        where: { pageId },
        select: { versionId: true },
      })
    ).map((e) => e.versionId),
  );

  /*
   * Doc giữ trong Map để diff cặp liền kề mà không đọc lại database.
   *
   * `migrateDoc` áp lúc ĐỌC chứ không sửa tại chỗ — nên một bản lưu từ
   * schemaVersion cũ vẫn diff được với bản mới mà không ai phải migrate dữ liệu.
   */
  //
  // Khai `Map<string, Doc>` tường minh: không có nó, `rows.map` suy ra
  // `(string | Doc)[][]` — mảng của mảng, không phải mảng của tuple — và
  // `new Map()` từ chối. Generic ở đây cho ngữ cảnh để tuple được suy đúng.
  const docs = new Map<string, Doc>(rows.map((r) => [r.id, migrateDoc(r.doc)]));

  return rows.map((r) => {
    const parentDoc = r.parentId ? docs.get(r.parentId) : undefined;
    const own = docs.get(r.id)!;

    // Cha có thể nằm ngoài `limit` — lúc đó không diff được, và trả `null` đúng
    // hơn là trả số 0 (số 0 nghĩa là "không đổi gì", một câu khác hẳn).
    const d = parentDoc ? diffDocs(parentDoc, own) : null;

    return {
      id: r.id,
      seq: r.seq,
      label: r.label,
      prompt: r.prompt,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      byAi: r.createdBy.startsWith('ai:'),
      isCurrentDraft: r.id === page.draftVersionId,
      isPublished: publishedIds.has(r.id),
      changes: d
        ? {
            added: d.added.length,
            removed: d.removed.length,
            textChanged: d.textChanged.length,
          }
        : null,
    };
  });
}

export interface RevertResult {
  ok: boolean;
  status: number;
  error?: string;
  versionId?: string;
}

export async function revertPageToVersion(args: {
  pageId: string;
  versionId: string;
  session: SessionPayload;
  /**
   * Bản nháp mà người bấm đang NHÌN lúc chọn lùi (C3). Lùi bản bỏ mọi thay đổi sau bản
   * đích khỏi nhánh nháp, nên người bấm phải đang thấy đúng bản nháp sẽ bị thay. Khác
   * bản nháp hiện tại — agent hay người khác vừa sửa trong lúc lịch sử đang mở — thì
   * 409, giống hệt khi batch ghi xen vào giữa transaction.
   *
   * Không cần token ký như xoá hoàn toàn ảnh: thứ cần khoá ở đây là MỘT id, và chính
   * id đó đã là "đúng thứ tôi đã xem". Không bắt buộc, để MCP và script cũ vẫn gọi được.
   */
  expectDraftId?: string;
}): Promise<RevertResult> {
  const { pageId, versionId, session, expectDraftId } = args;

  /*
   * Bản phải THUỘC trang này.
   *
   * Không phải phép kiểm hình thức: `versionId` đến từ client, và không kiểm
   * nghĩa là ai gọi được API này cũng nạp được `doc` của một trang khác vào bản
   * nháp trang này. Lọc bằng cả hai khoá thay vì tìm theo id rồi so — một điều
   * kiện thay vì hai bước.
   */
  const target = await prisma.pageVersion.findFirst({
    where: { id: versionId, pageId },
    select: { id: true, doc: true, schemaVer: true, label: true, seq: true },
  });
  if (!target) {
    return { ok: false, status: 404, error: 'Không tìm thấy bản này trong lịch sử của trang' };
  }

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { draftVersionId: true, fixture: true, slug: true },
  });
  if (!page?.draftVersionId) {
    return { ok: false, status: 404, error: 'Trang chưa có bản nháp' };
  }
  if (page.draftVersionId === versionId) {
    return { ok: false, status: 400, error: 'Đây đã là bản nháp đang mở' };
  }
  if (expectDraftId && expectDraftId !== page.draftVersionId) {
    return { ok: false, status: 409, error: DRAFT_MOVED };
  }

  const fromDraft = page.draftVersionId;
  let created: { id: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const v = await tx.pageVersion.create({
        data: {
          pageId,
          // Copy `doc` NGUYÊN TRẠNG, không migrate.
          //
          // `migrateDoc` áp lúc đọc, nên ghi bản đã migrate vào đây sẽ làm bản mới
          // khác bytes so với bản cũ — và lúc đó "lùi về bản X" không còn đúng
          // nghĩa là "trang y như bản X".
          doc: target.doc as object,
          schemaVer: target.schemaVer,
          // `v${seq}` chứ không `label ?? id.slice(-6)`: `label` của bản đích là
          // 'sửa tay' ở gần như mọi bản, nên nhãn cũ đọc ra "lùi về sửa tay" — không
          // trỏ tới bản nào cả. `seq` là danh tính, và nó khớp với chip trạng thái lưu.
          label: `lùi về v${target.seq}`,
          prompt: null,
          createdBy: session.email,
          // Cha là bản nháp HIỆN TẠI, không phải bản được lùi về. Lịch sử là một
          // cây thời gian: lần lùi này xảy ra SAU bản đang mở, và ghi cha là bản
          // cũ sẽ làm cây kể sai chuyện.
          parentId: page.draftVersionId,
        },
        select: { id: true },
      });

      // Có điều kiện, cùng lý do với `applyOpsToPage`: một batch ghi xen vào giữa lúc đọc
      // ở trên và lúc này thì lùi bản sẽ âm thầm xoá nó khỏi nhánh nháp. Trigger `seq`
      // đã khoá hàng Page ở lệnh create ngay trên, nên phép so này không còn khe hở.
      const moved = await tx.page.updateMany({
        where: { id: pageId, draftVersionId: fromDraft },
        data: { draftVersionId: v.id },
      });
      if (moved.count === 0) throw new DraftMovedDuringRevert();

      await tx.auditLog.create({
        data: {
          userId: session.sub,
          action: 'page.revert',
          targetType: 'Page',
          targetId: pageId,
          meta: {
            revertedTo: versionId,
            newVersionId: v.id,
            slug: page.slug,
            via: session.kind === 'service' ? 'mcp' : 'builder',
          },
        },
      });

      return v;
    });
  } catch (error) {
    if (!(error instanceof DraftMovedDuringRevert)) throw error;
    return { ok: false, status: 409, error: DRAFT_MOVED };
  }

  return { ok: true, status: 200, versionId: created.id };
}

class DraftMovedDuringRevert extends Error {}

const DRAFT_MOVED =
  'Bản nháp vừa được sửa ở nơi khác. Mở lại lịch sử để thấy bản mới rồi chọn lại.';
