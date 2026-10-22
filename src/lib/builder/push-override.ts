import 'server-only';

/**
 * Đẩy ghi đè của một instance NGƯỢC vào cây component.
 *
 * ## Quy trình nó phục vụ
 *
 * "Sửa thử trên một instance, thấy đúng thì nâng thành mặc định cho mọi chỗ."
 * Không có nó, người dùng phải sửa lại lần thứ hai trong component rồi xoá ghi đè
 * bằng tay — hai lần làm cùng một việc, và lần thứ hai dễ gõ khác lần đầu.
 *
 * Figma có đúng tính năng này ("Push overrides to main component"), và ta chép cả
 * hai giới hạn của họ ngay từ đầu thay vì phát hiện sau (docs/BENCHMARK.md §1.1).
 *
 * ## Vì sao KHÔNG phải một op
 *
 * Nó ghi vào HAI tài liệu: cây component (`Preset.tree`) và doc của trang. Op chỉ
 * biết một doc, nên gói việc này thành op sẽ buộc op phải biết về database — tức
 * phá đúng tính chất làm hệ op kiểm được và undo được.
 *
 * Thay vào đó: hai batch op qua hai đường ghi đã có, theo thứ tự bắt buộc dưới đây.
 *
 * ## Thứ tự: component TRƯỚC, gỡ ghi đè SAU
 *
 * Gỡ ghi đè trước rồi ghi component lỗi thì nội dung riêng của trang **mất hẳn** —
 * nó chỉ tồn tại trong ghi đè vừa xoá. Ngược lại, ghi component xong mà gỡ ghi đè
 * lỗi thì trang vẫn hiện đúng chữ đó (ghi đè trùng với giá trị component), và người
 * dùng gỡ lại được. Hai trạng thái hỏng, chọn cái không mất dữ liệu.
 *
 * KHÔNG có transaction chung: hai đường ghi thuộc hai bảng và hai lịch sử version.
 * Gộp chúng lại là viết một đường ghi thứ ba, và đường thứ ba bao giờ cũng là đường
 * quên cập nhật.
 */

import { applyOpsToPage } from '@/lib/doc/apply-to-page';
import { applyOpsToPreset, treeToDoc } from '@/lib/doc/apply-to-preset';
import { clearOverrideOps } from '@/lib/builder/orphan-overrides';
import { prisma } from '@/lib/db';
import { migrateDoc } from '@/lib/doc/migrate';
import type { Op } from '@/lib/doc/ops';
import type { PresetTree } from '@/lib/doc/preset';
import type { SessionPayload } from '@/lib/auth/session';
import type { ContentOverride, Doc, Node } from '@/lib/doc/types';

export type PushOverrideResult =
  | { ok: true; pushed: number; componentVersionId: string; pageVersionId: string }
  | { ok: false; status: number; error: string };

/**
 * Ghi đè nội dung → op trên cây component.
 *
 * `content`/`label` là RichText nên đi qua `setText`; số còn lại đi qua
 * `setProps`. Dùng đúng op chuyên biệt thay vì `setProps` cho tất cả: AuditLog
 * phân biệt được, và `setText` có kiểm riêng cho RichText.
 *
 * ## Vì sao hàm này cần NODE của cây component
 *
 * Khoá của `ContentOverride` KHÔNG phải đường dẫn field của node. Bản trước đẩy
 * thẳng `props.href` và `props.a11yLabel`, và không node type nào có hai field
 * đó: `href` nằm trong `action.href`, `a11yLabel` nằm trong `a11y.label`. Hai
 * khoá lạ được ghi vào node rồi nằm im — không renderer nào đọc, không lỗi nào
 * báo, và người dùng bấm "đẩy lên component" rồi tưởng đã xong. (Hợp đồng
 * `setProps` mới từ chối chúng, nên từ nay ca này báo lỗi thay vì im.)
 *
 * Và cả hai field đó nằm trong object LỒNG, trong khi `setProps` THAY nguyên
 * giá trị chứ không merge (`applyOne` làm `target[key] = value`). Nên gửi
 * `action` hay `a11y` thì phải gửi ĐỦ — tức phải đọc object đang có trên node.
 *
 * ## Luật ánh xạ: đúng bằng luật của renderer
 *
 * Mỗi nhánh dưới đây là một nhánh của `applyOverride` (`render/instance.ts`).
 * Push là phép NÂNG chính những giá trị đang hiện thành mặc định, nên hai bên
 * lệch nhau ở đâu thì ở đó người dùng thấy một đằng và component nhận một nẻo.
 * Hệ quả: override lạc loài với node type (một `alt` trên Button, dữ liệu cũ
 * hoặc rác) bị BỎ ở cả hai — nếu không nó sinh một op mà hợp đồng `setProps` từ
 * chối, và cả batch hỏng theo, kể cả những ghi đè đúng.
 */
export function overrideToComponentOps(
  localId: string,
  ov: ContentOverride,
  /** Node LOCAL trong cây component. Vắng mặt = ghi đè mồ côi. */
  node: Node | undefined,
): Op[] {
  // Không có node thì mọi op đều ném `OpError` ở `applyOne`, và một op hỏng làm
  // cả batch hỏng — kể cả những ghi đè đúng của các node khác.
  if (!node) return [];

  const ops: Op[] = [];

  if (node.type === 'Text' && ov.content !== undefined) {
    ops.push({ op: 'setText', nodeId: localId, field: 'content', value: ov.content });
  }
  if (node.type === 'Button' && ov.label !== undefined) {
    ops.push({ op: 'setText', nodeId: localId, field: 'label', value: ov.label });
  }

  const props: Record<string, unknown> = {};

  if (node.type === 'Image') {
    if (ov.alt !== undefined) props.alt = ov.alt;
    if (ov.assetId !== undefined) props.assetId = ov.assetId;
  }
  if (node.type === 'Video') {
    if (ov.assetId !== undefined) props.assetId = ov.assetId;
    if (ov.posterAssetId !== undefined) props.posterAssetId = ov.posterAssetId;
  }

  // `href` chỉ có nghĩa với action dạng link; ghi đè lên `anchor`/`submit` sẽ tạo
  // một action lai mà `zNode` từ chối.
  if (node.type === 'Button' && ov.href !== undefined && node.action.kind === 'link') {
    props.action = { ...node.action, href: ov.href };
  }

  if (ov.a11yLabel !== undefined && ov.a11yLabel !== null) {
    props.a11y = { ...node.a11y, label: ov.a11yLabel };
  }

  if (Object.keys(props).length) ops.push({ op: 'setProps', nodeId: localId, props });

  return ops;
}

export async function pushOverrides(args: {
  pageId: string;
  instanceId: string;
  session: SessionPayload;
}): Promise<PushOverrideResult> {
  const page = await prisma.page.findUnique({
    where: { id: args.pageId },
    select: { draftVersion: { select: { doc: true } } },
  });
  if (!page?.draftVersion) return { ok: false, status: 404, error: 'Không tìm thấy bản nháp' };

  const doc: Doc = migrateDoc(page.draftVersion.doc);
  const inst = doc.nodes[args.instanceId];
  if (!inst) return { ok: false, status: 404, error: `Không có node ${args.instanceId}` };
  if (inst.type !== 'Instance') {
    return { ok: false, status: 400, error: `Node ${args.instanceId} không phải Instance` };
  }

  /*
   * Giới hạn chép từ Figma: KHÔNG push từ instance nằm trong một component khác.
   *
   * Ở ta trường hợp đó không tồn tại — `apply-to-preset.ts` chặn instance lồng
   * trong component ở đường ghi. Vẫn kiểm ở đây, vì phép chặn kia là bất biến của
   * một file khác, và một ngày ai nới nó thì chỗ này phải vẫn đúng.
   */
  if (inst.parentId && doc.nodes[inst.parentId]?.type === 'Instance') {
    return {
      ok: false,
      status: 400,
      error: 'Không push được từ instance nằm trong một instance khác.',
    };
  }

  const entries = Object.entries(inst.overrides ?? {}) as [string, ContentOverride][];
  if (!entries.length) {
    return { ok: false, status: 400, error: 'Instance này không có ghi đè nào để push.' };
  }

  /*
   * Đọc cây component TRƯỚC khi dựng op.
   *
   * `overrideToComponentOps` cần node để biết đường dẫn field (`action.href`,
   * `a11y.label`) và để gửi ĐỦ object lồng — `setProps` thay chứ không merge.
   * Không đọc được thì dừng ở đây: dựng op mò sẽ ghi vào component những khoá mà
   * không gì đọc, và component là thứ mọi trang dùng chung.
   */
  const preset = await prisma.preset.findUnique({
    where: { id: inst.componentId },
    select: { tree: true },
  });
  if (!preset) {
    return { ok: false, status: 404, error: `Không tìm thấy component ${inst.componentId}` };
  }
  const compNodes = treeToDoc(preset.tree as unknown as PresetTree).nodes;

  const componentOps = entries.flatMap(([localId, ov]) =>
    overrideToComponentOps(localId, ov, compNodes[localId]),
  );
  if (!componentOps.length) {
    return { ok: false, status: 400, error: 'Ghi đè không chứa trường nào push được.' };
  }

  // BƯỚC 1 — ghi vào component.
  const compResult = await applyOpsToPreset({
    presetId: inst.componentId,
    ops: componentOps,
    actor: 'human',
    session: args.session,
    label: `nâng ${entries.length} ghi đè thành mặc định`,
  });
  if (!compResult.ok) {
    return {
      ok: false,
      status: compResult.status,
      error: `Ghi vào component thất bại: ${compResult.error ?? 'không rõ'}`,
    };
  }

  // BƯỚC 2 — gỡ ghi đè khỏi trang. Nếu bước này lỗi, trang vẫn hiện ĐÚNG chữ đó
  // (ghi đè giờ trùng giá trị component), nên không mất gì và gỡ lại được.
  const pageResult = await applyOpsToPage({
    pageId: args.pageId,
    ops: clearOverrideOps(entries.map(([localId]) => ({ nodeId: args.instanceId, localId }))),
    actor: 'human',
    session: args.session,
    label: `gỡ ${entries.length} ghi đè sau khi push`,
  });
  if (!pageResult.ok) {
    return {
      ok: false,
      status: pageResult.status,
      error:
        `Đã ghi vào component nhưng chưa gỡ được ghi đè: ${pageResult.error ?? 'không rõ'}. ` +
        'Trang vẫn hiện đúng nội dung; gỡ ghi đè bằng nút "Gỡ tất cả".',
    };
  }

  return {
    ok: true,
    pushed: entries.length,
    componentVersionId: compResult.versionId!,
    pageVersionId: pageResult.versionId!,
  };
}
