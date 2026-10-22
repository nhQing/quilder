import 'server-only';

/**
 * Áp một batch op lên bản nháp của một trang.
 *
 * Tách khỏi route handler vì có HAI đường vào: `/api/ops` (inspector trong
 * builder) và tool `apply_ops` (MCP / lớp AI). Nếu mỗi đường tự viết transaction
 * của mình thì hai đường sẽ trôi khỏi nhau — và thứ trôi mất sẽ là một trong
 * những thứ ở đây: kiểm vùng khoá, ghi AuditLog, hay `parentId` của version.
 *
 * Không bao giờ chạm tới release đang chạy. Mọi thứ ở đây chỉ ảnh hưởng bản
 * nháp; site thật đổi khi và chỉ khi có người bấm publish.
 */

import { prisma } from '@/lib/db';
import { loadComponents } from '@/lib/render/components';
import { compileDoc } from '@/lib/render/css';
import type { SessionPayload } from '@/lib/auth/session';
import { fixtureRejection } from './fixture-guard';
import { migrateDoc } from './migrate';
import { invert, type Op } from './ops';
import { validateOps, type Actor, type ValidationIssue } from './validate';
import type { Doc } from './types';

export interface ApplyResult {
  ok: boolean;
  /** Có khi ok. */
  versionId?: string;
  /** Số phiên bản vừa tạo. Trigger điền — xem doc `PageVersion.seq`. */
  seq?: number;
  doc?: Doc;
  undo?: Op[];
  ops?: Op[];
  /** Có khi thất bại. */
  issues?: ValidationIssue[];
  /**
   * Điều đáng nói mà không chặn — op ĐÃ được áp.
   *
   * Có ở cả đường thành công và đường thất bại: một batch bị từ chối vì op thứ ba
   * vẫn đáng cho biết op thứ nhất sẽ bị sanitize gỡ mất `@keyframes`.
   */
  warnings?: ValidationIssue[];
  status: number;
  error?: string;
  /** Có khi `dryRun`: đã kiểm xong và KHÔNG ghi gì. */
  dryRun?: true;
  /** `dryRun`: những node mà batch này sẽ chạm tới. */
  touched?: string[];
  /**
   * 409: bản nháp không còn là bản người gọi đã thấy (`baseSeq`). `currentSeq` là bản
   * hiện tại — gửi lại cùng batch với `baseSeq = currentSeq` là áp lên bản mới nhất.
   */
  conflict?: true;
  currentSeq?: number;
  /**
   * CSS của bản nháp mới, khi người gọi xin (`withCss`) VÀ batch có đổi style.
   *
   * Builder thay CSS này vào khung canvas đang hiện ngay khi lưu xong, trước cả khi bản
   * render đầy đủ của server về: đổi padding là thấy ngay, không đợi ~1 giây dựng lại
   * cả trang. Bản render đầy đủ vẫn tới sau và thay khung (xem `Canvas.tsx`), nên đây
   * chỉ là đi tắt cho phần nhìn — nguồn sự thật vẫn là server.
   */
  css?: string;
}

/** Op làm đổi CSS sinh ra — chỉ những batch này mới đáng biên dịch CSS sớm. */
const STYLE_OPS = new Set(['setStyle', 'setCustomCss']);

/** Con trỏ nháp đã đổi giữa lúc đọc và lúc ghi. Chỉ dùng bên trong file này. */
class DraftMoved extends Error {}

/**
 * Số lần tự đọc lại khi hai lần ghi chạy đua, CHỈ cho người gọi không khai `baseSeq`.
 *
 * Không khai `baseSeq` nghĩa là "áp lên bản hiện tại, bản nào cũng được" — nên đọc lại
 * rồi validate lại trên bản mới đúng là điều họ yêu cầu. Người gọi có khai thì đã nói
 * "tôi sửa dựa trên bản N", và lặng lẽ áp lên bản N+1 là đổi ý họ: trả 409.
 */
const RACE_RETRIES = 4;

/**
 * Chờ một khoảng NGẪU NHIÊN trước khi đọc lại: không có nó, mọi batch thua cùng đọc lại
 * cùng lúc và lại đâm nhau đúng như lượt trước. `prove:concurrent` đo: 12 batch đồng
 * thời: hai lượt thử lại không chờ thì 9/12 bị từ chối; bốn lượt có chờ còn 5–7/12 bị từ chối. Thực tế chỉ có
 * hai bên ghi cùng lúc (người và agent), và một lượt thử lại là đủ.
 */
const backoff = (attempt: number) =>
  new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 40));

export async function applyOpsToPage(args: {
  pageId: string;
  ops: unknown;
  actor: Actor;
  session: SessionPayload;
  label?: string;
  prompt?: string;
  /**
   * Chạy validator rồi DỪNG, không ghi gì.
   *
   * Vì sao đáng có: không có nó, cách duy nhất để biết một batch có hợp lệ không
   * là ghi thử. Batch sai bị từ chối sạch (validator chạy trước khi ghi), nhưng
   * batch *hợp lệ mà sai ý* thì đã vào `PageVersion` và phải undo — và mỗi lần
   * undo là thêm một version nữa trong lịch sử mà người đọc sau phải hiểu.
   *
   * Nó KHÔNG thay được việc nghĩ: dry-run tránh vòng ghi, không tránh vòng sai ý.
   */
  dryRun?: boolean;
  /**
   * `seq` của bản nháp mà người gọi đã thấy khi soạn batch này.
   *
   * ## Vì sao có trường này (08/10/2026)
   *
   * Trước đây hàm này đọc bản nháp, validate, rồi ghi version mới và trỏ
   * `Page.draftVersionId` vào nó VÔ ĐIỀU KIỆN. Người sửa trong inspector và agent qua
   * MCP cùng đọc v1: batch A tạo v2, batch B tạo v3 từ v1, và nháp trỏ v3 — thay đổi
   * của A biến khỏi nhánh nháp. Nó vẫn nằm trong lịch sử, nhưng không ai biết để lấy
   * lại. Webstudio chặn đúng chỗ này bằng ghi có điều kiện theo version
   * (`build-patch.ts`, lỗi `version_mismatched`).
   *
   * Giờ có hai lớp:
   *  - lệnh ghi con trỏ LUÔN có điều kiện (`updateMany where draftVersionId = bản đã
   *    đọc`), nên khe giữa lúc đọc và lúc ghi không còn — kể cả khi không có trường này;
   *  - có `baseSeq` mà bản nháp đã khác thì trả 409 trước cả khi validate.
   *
   * `seq` chứ không phải version id: builder vốn đã giữ `seq` (chip "đã lưu · v12"), và
   * mỗi version có một `seq` riêng trong trang — so `seq` là so đúng version.
   */
  baseSeq?: number | null;
  /** Lượt thử lại nội bộ khi chạy đua. Người gọi không đặt. */
  attempt?: number;
  /** Trả kèm CSS của bản mới nếu batch có đổi style. Xem `ApplyResult.css`. */
  withCss?: boolean;
}): Promise<ApplyResult> {
  const { pageId, ops, actor, session, label, prompt } = args;
  const attempt = args.attempt ?? 0;
  const hasBase = typeof args.baseSeq === 'number';

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      slug: true,
      fixture: true,
      draftVersion: { select: { id: true, doc: true, seq: true } },
    },
  });
  if (!page?.draftVersion) {
    return { ok: false, status: 404, error: 'Không tìm thấy bản nháp' };
  }

  const conflict = (currentSeq: number): ApplyResult => ({
    ok: false,
    status: 409,
    conflict: true,
    currentSeq,
    error:
      `Bản nháp đã đổi từ khi bạn đọc (bạn sửa dựa trên v${args.baseSeq}, giờ là v${currentSeq}). ` +
      'Đọc lại trang rồi áp lại.',
  });

  if (hasBase && args.baseSeq !== page.draftVersion.seq) {
    return conflict(page.draftVersion.seq);
  }

  const blocked = fixtureRejection(page, actor);
  if (blocked) return { ok: false, ...blocked };

  const current = migrateDoc(page.draftVersion.doc);

  const result = await validateOps(current, ops, actor);
  if (!result.ok || !result.doc || !result.ops) {
    return {
      ok: false,
      status: 422,
      error: 'Op không hợp lệ',
      issues: result.issues,
      ...(result.warnings ? { warnings: result.warnings } : {}),
    };
  }
  const clean = result.ops;

  /*
   * Dừng ở ĐÂY khi dry-run: sau validator, trước mọi lần ghi.
   *
   * Đặt sớm hơn thì không kiểm được gì; đặt muộn hơn — kể cả chỉ sau `$transaction`
   * mở ra — là đã tạo một version rồi rollback, tức vẫn tốn một id và vẫn có thể để
   * lại dấu vết nếu ai đó thêm một lần ghi ngoài transaction.
   */
  if (args.dryRun) {
    return {
      ok: true,
      status: 200,
      dryRun: true,
      doc: result.doc,
      ops: clean,
      ...(result.warnings ? { warnings: result.warnings } : {}),
      touched: [
        ...new Set(
          clean
            .map((o) => ('nodeId' in o ? (o as { nodeId?: string }).nodeId : undefined))
            .filter((v): v is string => Boolean(v)),
        ),
      ].sort(),
    };
  }

  // Nghịch đảo tính TRÊN doc trước khi mutate — điều kiện để undo chính xác.
  const undo = invert(current, clean);

  const base = page.draftVersion;
  let version: { id: string; seq: number };
  try {
    version = await prisma.$transaction(async (tx) => {
      const created = await tx.pageVersion.create({
        data: {
          pageId: page.id,
          doc: result.doc as unknown as object,
          schemaVer: result.doc!.schemaVersion,
          label: label ?? (actor === 'ai' ? 'AI' : 'sửa tay'),
          prompt: prompt ?? null,
          createdBy: actor === 'ai' ? `ai:${session.email}` : session.email,
          parentId: base.id,
        },
        select: { id: true, seq: true },
      });

      /*
       * Dời con trỏ CÓ ĐIỀU KIỆN: chỉ khi nháp vẫn là bản đã đọc ở đầu hàm.
       *
       * Trigger `page_version_next_seq` ở lệnh create ngay trên đã khoá hàng `Page`, nên
       * batch thứ hai của cùng trang chờ ở đó tới khi batch này commit, rồi tới đây thấy
       * `draftVersionId` đã khác và nhận count 0. Ném để rollback CẢ version vừa tạo lẫn
       * bộ đếm `seq` — lịch sử không còn một version mồ côi, `seq` không nhảy số.
       */
      const moved = await tx.page.updateMany({
        where: { id: page.id, draftVersionId: base.id },
        data: { draftVersionId: created.id },
      });
      if (moved.count === 0) throw new DraftMoved();

      await tx.auditLog.create({
        data: {
          userId: session.sub,
          action: 'ops.apply',
          targetType: 'Page',
          targetId: page.id,
          meta: {
            versionId: created.id,
            opCount: clean.length,
            kinds: clean.map((o) => o.op),
            actor,
            // Cùng một người, hai đường vào khác nhau. Khi một thay đổi lạ xuất
            // hiện trong lịch sử, "sửa trong builder" và "AI sửa qua MCP" là hai
            // câu chuyện rất khác nhau.
            via: session.kind === 'service' ? 'mcp' : 'builder',
          },
        },
      });

      return created;
    });
  } catch (error) {
    if (!(error instanceof DraftMoved)) throw error;
    // Có `baseSeq`: người gọi đã nói "dựa trên bản N" — không áp lên bản khác thay họ.
    if (hasBase) {
      const now = await prisma.page.findUnique({
        where: { id: page.id },
        select: { draftVersion: { select: { seq: true } } },
      });
      return conflict(now?.draftVersion?.seq ?? base.seq);
    }
    if (attempt >= RACE_RETRIES) {
      return {
        ok: false,
        status: 409,
        conflict: true,
        error: 'Bản nháp đang được sửa liên tục ở nơi khác. Thử lại sau vài giây.',
      };
    }
    // Không có `baseSeq` = "áp lên bản hiện tại": đọc lại, validate lại trên bản mới.
    await backoff(attempt);
    return applyOpsToPage({ ...args, attempt: attempt + 1 });
  }

  let css: string | undefined;
  if (args.withCss && clean.some((o) => STYLE_OPS.has(o.op))) {
    // Cùng hai lời gọi với /render/[pageId] — CSS khớp đúng thứ khung canvas sẽ nhận.
    // Lỗi ở đây không được làm hỏng một lần lưu đã thành công: thiếu CSS sớm thì
    // canvas chỉ đợi bản render đầy đủ như trước.
    try {
      css = compileDoc(result.doc!, await loadComponents(result.doc!)).css;
    } catch {
      css = undefined;
    }
  }

  return {
    ok: true,
    status: 200,
    versionId: version.id,
    seq: version.seq,
    doc: result.doc,
    undo,
    ops: clean,
    ...(result.warnings ? { warnings: result.warnings } : {}),
    ...(css !== undefined ? { css } : {}),
  };
}
