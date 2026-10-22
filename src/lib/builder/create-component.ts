import 'server-only';

/**
 * Tạo component — dùng chung cho route HTTP và cho tool MCP.
 *
 * Cùng lý do tách như `create-page.ts`: tool MCP cần đúng luồng này, và hai cách
 * nối khác đều tệ (`fetch` chính mình mất session context; chép logic tạo hai bản
 * của một luật rồi chúng trôi khỏi nhau).
 *
 * ## Hai đường tạo, một đích
 *
 *   `from`  nhân bản một component đang có
 *   `name`  component trống, một node Section duy nhất
 *
 * Không có đường "tạo từ node trong trang" ở đây — đó là thao tác của builder và
 * nó cần biết node nào đang được chọn.
 */

import { prisma } from '@/lib/db';
import { copyName, uniqueKey } from '@/lib/builder/preset-key';
import type { PresetTree } from '@/lib/doc/preset';
import { zNode } from '@/lib/doc/schema';
import { CURRENT_SCHEMA_VERSION, type Node } from '@/lib/doc/types';

export type CreateComponentResult =
  | { ok: true; preset: { id: string; key: string; name: string; category: string } }
  | { ok: false; status: number; error: string };

/**
 * Component trống: một Section, không con. Đủ để chèn và bắt đầu dựng.
 *
 * Mang `schemaVersion` — cây phải TỰ MÔ TẢ, vì `Release.components` chụp lại đúng
 * JSON này và ở đó không có cột nào để tra. Xem `migratePresetTree` và HANDOFF
 * §3.23.
 *
 * Bản trước không có trường này. Vô hại hôm nay vì `migratePresetTree` coi thiếu
 * là v1 và `CURRENT_SCHEMA_VERSION` cũng là 1 — nhưng nó nghĩa là mọi component
 * tạo mới sinh ra đã lạc hậu một bậc ngay khi schema tăng.
 */
export function blankTree(): PresetTree {
  const id = 'p1';
  const node = {
    id,
    parentId: null,
    type: 'Section' as const,
    tag: 'section' as const,
    children: [],
    effects: [],
    style: { base: {} },
  };
  // Đi qua schema thật thay vì tin object viết tay: nếu `zNode` đổi thì chỗ này
  // vỡ ngay tại đây, chứ không vỡ ở lần đầu có người chèn component vào trang.
  //
  // Ép kiểu vì kiểu Zod suy ra cho `InlineNode` là đệ quy và không khớp cấu trúc
  // với `InlineNode` viết tay — hai bên mô tả cùng một thứ nhưng TypeScript không
  // chứng minh được điều đó. Giá trị đã qua `parse` nên nó ĐÚNG là hợp lệ; chỉ là
  // trình biên dịch không thấy.
  const parsed = zNode.parse(node) as unknown as Node;
  return { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: id, nodes: { [id]: parsed } };
}

export interface NewComponentInput {
  name?: string;
  category?: string;
  aiDescription?: string;
  /** Id của component nguồn. Có thì đây là thao tác nhân bản. */
  from?: string;
}

export async function createComponent(
  input: NewComponentInput & { actorEmail: string; actorSub: string },
): Promise<CreateComponentResult> {
  const existing = await prisma.preset.findMany({ select: { key: true, name: true } });
  const keys = new Set(existing.map((p) => p.key));
  const names = new Set(existing.map((p) => p.name));

  let tree: PresetTree;
  let name: string;
  let category: string;
  let aiDescription: string;

  if (input.from) {
    const source = await prisma.preset.findUnique({
      where: { id: input.from },
      select: { name: true, category: true, aiDescription: true, tree: true },
    });
    if (!source) {
      return { ok: false, status: 404, error: 'Không tìm thấy component nguồn' };
    }
    // Sao chép cây NGUYÊN VẸN, giữ nguyên id bên trong. Id chỉ cần duy nhất trong
    // một cây, và `presetToOps` thay hết chúng lúc chèn vào trang.
    tree = structuredClone(source.tree) as unknown as PresetTree;
    name = (input.name ?? '').trim() || copyName(source.name, names);
    category = (input.category ?? '').trim() || source.category;
    aiDescription = (input.aiDescription ?? '').trim() || source.aiDescription;
  } else {
    name = (input.name ?? '').trim();
    if (!name) {
      return {
        ok: false,
        status: 400,
        error:
          'Đặt tên cho component — danh sách toàn "Component mới" thì không chọn được cái nào.',
      };
    }
    if (names.has(name)) {
      return { ok: false, status: 409, error: `Đã có component tên "${name}"` };
    }
    tree = blankTree();
    category = (input.category ?? '').trim() || 'content';
    aiDescription = (input.aiDescription ?? '').trim() || name;
  }

  if (name.length > 80) {
    return { ok: false, status: 400, error: 'Tên tối đa 80 ký tự' };
  }

  const preset = await prisma.preset.create({
    data: {
      key: uniqueKey(name, keys),
      name,
      category,
      aiDescription,
      tree: tree as unknown as object,
      // Do người dùng tạo, nên `extract-presets.ts` KHÔNG được ghi đè nó.
      builtin: false,
      versions: {
        create: {
          tree: tree as unknown as object,
          label: input.from ? 'nhân bản' : 'tạo mới',
          createdBy: input.actorEmail,
        },
      },
    },
    select: { id: true, key: true, name: true, category: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: input.actorSub,
      action: input.from ? 'preset.duplicate' : 'preset.create',
      targetType: 'Preset',
      targetId: preset.id,
      meta: {
        key: preset.key,
        from: input.from ?? null,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      },
    },
  });

  return { ok: true, preset };
}
