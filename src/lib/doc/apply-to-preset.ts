import 'server-only';

/**
 * Áp một batch op lên cây node của một component.
 *
 * ## Vì sao dùng lại được nguyên hệ op
 *
 * `Preset.tree` là `{ rootId, nodes }` — đúng hình dạng `Doc` trừ
 * `schemaVersion`, và node gốc đã có `parentId: null`. Nên chỉ cần thêm/bỏ một
 * trường là toàn bộ 14 op, 4 lớp validator và `invert()` chạy trên component mà
 * không sửa dòng nào.
 *
 * Đó không phải may mắn: preset được sinh ra bằng cách cắt một cây node thật ra
 * khỏi trang, nên nó vẫn là cây node thật.
 *
 * ## Khác `applyOpsToPage`
 *
 * - **Không đụng release.** Component không publish; sửa nó không chạm trang nào
 *   đang chạy. Xem ghi chú model `Preset`: chèn là đóng dấu một bản sao.
 * - **Không có bản nháp riêng.** Trang có draft/live tách nhau vì trang được
 *   khách xem. Component thì chỉ builder xem, nên một dòng là đủ — và lịch sử
 *   nằm ở `PresetVersion` để lùi lại.
 * - **Không cho xoá node gốc.** Cùng lý do như trang: một component không có gốc
 *   thì không chèn được nữa, và cây node còn lại thành mồ côi.
 */

import { revalidateTag } from 'next/cache';

import { prisma } from '@/lib/db';
import { COMPONENTS_TAG } from '@/lib/render/components';
import type { SessionPayload } from '@/lib/auth/session';
import { presetTreeToDoc } from './migrate';
import { invert, type Op } from './ops';
import { validateOps, type Actor, type ValidationIssue } from './validate';
import type { Doc } from './types';
import type { PresetTree } from './preset';

export interface PresetApplyResult {
  ok: boolean;
  versionId?: string;
  tree?: PresetTree;
  undo?: Op[];
  ops?: Op[];
  issues?: ValidationIssue[];
  /** Điều đáng nói mà không chặn — xem `ApplyResult.warnings`. */
  warnings?: ValidationIssue[];
  status: number;
  error?: string;
  /** Có khi `dryRun`: đã kiểm xong và KHÔNG ghi gì. */
  dryRun?: true;
  /** `dryRun`: những node mà batch này sẽ chạm tới. */
  touched?: string[];
}

/**
 * Cây component → `Doc` để validator đọc được.
 *
 * ## Đính chính một lập luận cũ
 *
 * Bản trước gán `CURRENT_SCHEMA_VERSION` mà KHÔNG migrate, với lý do: "cây
 * component được sinh ra từ một `Doc` đã migrate, nên nếu nó lạc hậu thì đó là lỗi
 * của lần trích xuất". Lập luận đó đúng khi builder là **một bản deploy duy nhất**
 * — cây và code luôn cùng tuổi.
 *
 * Nó không còn đúng dưới mô hình "mỗi domain một bản builder, và các bản đó nâng
 * cấp được". Ở đó cây là DỮ LIỆU sống lâu hơn code, nên cây lạc hậu là trường hợp
 * THƯỜNG chứ không phải lỗi. Và gán nhãn thay vì migrate là khẳng định một điều
 * không được kiểm: ngày `Doc` lên 2, trang migrate còn component thì không, và
 * không có gì báo.
 */
export function treeToDoc(tree: PresetTree): Doc {
  // Luật thật nằm ở `presetTreeToDoc` — nó thuần, nên ba chỗ ở client dùng chung
  // được với đường ghi này thay vì tự dán nhãn schemaVersion.
  return presetTreeToDoc(tree);
}

/**
 * `Doc` → cây component.
 *
 * Ghi `schemaVersion` VÀO cây, không vào một cột riêng: `Release.components` chụp
 * lại chính JSON này, và ở đó không có cột nào để tra. Cây phải **tự mô tả** —
 * không thì ảnh chụp là một đống node không ai biết thuộc schema nào.
 */
export function docToTree(doc: Doc): PresetTree {
  return { schemaVersion: doc.schemaVersion, rootId: doc.rootId, nodes: doc.nodes };
}

export async function applyOpsToPreset(args: {
  presetId: string;
  ops: unknown;
  actor: Actor;
  session: SessionPayload;
  label?: string;
  prompt?: string;
  /** Chạy validator rồi DỪNG, không ghi gì. Xem `applyOpsToPage`. */
  dryRun?: boolean;
  /** Lượt thử lại nội bộ khi hai lần ghi chạy đua. Người gọi không đặt. */
  attempt?: number;
}): Promise<PresetApplyResult> {
  const { presetId, ops, actor, session, label, prompt } = args;
  const attempt = args.attempt ?? 0;

  const preset = await prisma.preset.findUnique({
    where: { id: presetId },
    select: { id: true, key: true, tree: true, updatedAt: true },
  });
  if (!preset) return { ok: false, status: 404, error: 'Không tìm thấy component' };

  const current = treeToDoc(preset.tree as unknown as PresetTree);

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

  /**
   * Component KHÔNG được chứa instance.
   *
   * Style của component scope bằng selector hậu duệ
   * `[data-c="…"] [data-cn="…"]` (xem `selIn` trong render/css.ts). Một instance
   * lồng bên trong sẽ khiến selector của component NGOÀI khớp xuyên qua và áp
   * nhầm style lên nội dung của component TRONG — sai một cách im lặng, và chỉ
   * lộ ra ở đúng những trang dùng cả hai.
   *
   * Chặn ở đường ghi thay vì vá lúc render: dữ liệu sai không nên vào được
   * database.
   */
  const nested = Object.values(result.doc.nodes).filter((n) => n.type === 'Instance');
  if (nested.length) {
    return {
      ok: false,
      status: 422,
      error: 'Component không chứa được instance của component khác',
      issues: nested.map((n) => ({
        index: 0,
        code: 'nested-instance',
        message:
          `Node ${n.id} là Instance. Style của component dùng selector hậu duệ, nên `
          + 'một instance lồng bên trong sẽ bị áp nhầm style. Chèn bản sao thay vì instance.',
      })),
    };
  }

  /*
   * Dừng ở ĐÂY khi dry-run: sau validator VÀ sau phép kiểm instance lồng ở trên,
   * trước mọi lần ghi. Kiểm instance lồng phải nằm trước để dry-run báo được cả
   * lỗi đó — nó là lỗi riêng của component, và bỏ qua nó nghĩa là dry-run nói
   * "được" cho một batch mà lần ghi thật sẽ từ chối.
   */
  if (args.dryRun) {
    return {
      ok: true,
      status: 200,
      dryRun: true,
      tree: docToTree(result.doc),
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

  // Nghịch đảo tính TRÊN cây trước khi mutate — điều kiện để undo chính xác.
  const undo = invert(current, clean);
  const tree = docToTree(result.doc);

  let version: { id: string };
  try {
    version = await prisma.$transaction(async (tx) => {
      /*
       * Khoá hàng rồi mới so: cây đã validate ở trên có còn là cây hiện tại không.
       *
       * Trước 08/10/2026 lệnh ghi `tree` bên dưới là vô điều kiện, nên hai lần sửa cùng
       * một component (người trong builder và agent qua apply_component_ops) cùng đọc
       * một cây, và lần ghi sau xoá thay đổi của lần trước. `FOR UPDATE` xếp hàng hai
       * transaction; `updatedAt` lệch nghĩa là đã có người ghi xen vào → đọc lại từ đầu.
       */
      const [locked] = await tx.$queryRaw<{ updatedAt: Date }[]>`
        SELECT "updatedAt" FROM "Preset" WHERE id = ${preset.id} FOR UPDATE`;
      if (!locked || locked.updatedAt.getTime() !== preset.updatedAt.getTime()) {
        throw new PresetMoved();
      }

      // Version TRƯỚC là cha; đọc trong transaction để hai lần ghi đồng thời không
      // cùng trỏ vào một cha và làm nhánh lịch sử tách đôi âm thầm.
      const parent = await tx.presetVersion.findFirst({
        where: { presetId: preset.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      const created = await tx.presetVersion.create({
        data: {
          presetId: preset.id,
          tree: tree as unknown as object,
          label: label ?? (actor === 'ai' ? 'AI' : 'sửa tay'),
          prompt: prompt ?? null,
          createdBy: actor === 'ai' ? `ai:${session.email}` : session.email,
          parentId: parent?.id ?? null,
        },
        select: { id: true },
      });

      await tx.preset.update({
        where: { id: preset.id },
        data: { tree: tree as unknown as object },
      });

      await tx.auditLog.create({
        data: {
          userId: session.sub,
          action: actor === 'ai' ? 'preset.ops.ai' : 'preset.ops',
          targetType: 'Preset',
          targetId: preset.id,
          meta: { key: preset.key, opCount: clean.length, versionId: created.id },
        },
      });

      return created;
    });
  } catch (error) {
    if (!(error instanceof PresetMoved)) throw error;
    if (attempt >= 2) {
      return {
        ok: false,
        status: 409,
        error: 'Component đang được sửa liên tục ở nơi khác. Thử lại sau vài giây.',
      };
    }
    // Op là ý định theo nodeId: đọc cây mới, validate lại, ghi lại.
    return applyOpsToPreset({ ...args, attempt: attempt + 1 });
  }

  // Cây component nằm trong `unstable_cache` của render — không revalidate thì
  // trang vẫn vẽ bản cũ tới khi cache hết hạn tự nhiên, và người dùng sẽ sửa
  // component rồi kết luận là không có tác dụng.
  revalidateTag(COMPONENTS_TAG);

  return {
    ok: true,
    status: 200,
    versionId: version.id,
    tree,
    undo,
    ops: clean,
    ...(result.warnings ? { warnings: result.warnings } : {}),
  };
}

/** Cây component đã đổi giữa lúc đọc và lúc ghi. Chỉ dùng bên trong file này. */
class PresetMoved extends Error {}
