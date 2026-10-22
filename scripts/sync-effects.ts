/**
 * Bảng `Effect` ← manifest trong `src/lib/motion/effects/*`.
 *
 * ## Vì sao ĐỒNG BỘ chứ không SEED
 *
 * Đo 25/08/2026: `list_effects` trả `{ effects: [], undocumented: [11 key] }` —
 * 11 effect chạy được, 0 hàng mô tả. Hậu quả không phải bất tiện: `statesWritten`
 * rỗng nghĩa là validator ngữ nghĩa **từ chối mọi tên state tuỳ chỉnh**, nên
 * `nav-collapse` ghi ra state mà không ai viết được CSS cho nó. Và không có
 * `paramsSchema` thì gắn effect là đoán.
 *
 * Cách sai là gõ tay 11 hàng seed. `types.ts` đã nói rõ manifest là nguồn sự thật
 * ("AI không bao giờ đọc code effect. Nó đọc manifest"), nên một bộ hàng gõ tay là
 * nguồn thứ hai, và nó sẽ trôi khỏi nguồn thứ nhất trong vài tuần. Script này
 * ĐỌC manifest thật rồi ghi xuống — cùng khuôn với `import-tokens.ts` đọc
 * `tokens.css`.
 *
 * ## Vì sao import được module effect trong Node
 *
 * Chúng là module client, nhưng phần manifest thuần dữ liệu; mọi chỗ chạm
 * `document` đều nằm trong `init()`. `registry.test.ts` đã load cả 11 trong vitest
 * từ trước, nên đường này đã được chứng minh chứ không phải giả định.
 *
 * ## Vì sao KHÔNG xoá hàng lạ
 *
 * Cùng lý do `import-tokens.ts` chỉ đánh `deprecated`: một `PageVersion` cũ có thể
 * đang gắn effect đó, và xoá hàng mô tả làm màn xem lịch sử mất chú thích. Hàng
 * không còn trong registry được báo ra để người quyết định.
 *
 * Lõi nằm ở `src/lib/setup/effects.ts` (dùng chung với màn cài đặt).
 *
 *   pnpm effects:sync
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PrismaClient } from '@prisma/client';

import { projectDir } from './project-dir.mjs';
import type { Entry } from '../src/lib/motion/effects/registry';
import { syncEffects } from '../src/lib/setup/effects';

const prisma = new PrismaClient();

/** Effect của gói dự án (`QUILDER_PROJECT`) — tsx không đi qua alias `@project` của webpack. */
async function projectEffects(): Promise<Record<string, Entry>> {
  const project = projectDir();
  const file = resolve(project.dir, 'effects.ts');
  if (!project.name || !existsSync(file)) return {};
  return ((await import(pathToFileURL(file).href)) as { default: Record<string, Entry> }).default;
}

async function main() {
  const { total, created, updated, orphans } = await syncEffects(
    prisma,
    (l) => console.log(l),
    await projectEffects(),
  );
  console.log(`Registry có ${total} effect.`);

  console.log(`\nthêm ${created} · cập nhật ${updated}`);
  if (orphans.length) {
    console.log(
      `\nCÓ ${orphans.length} hàng không còn trong registry: ${orphans.join(', ')}\n` +
        'KHÔNG xoá tự động — PageVersion cũ có thể đang gắn chúng. Tự quyết định.',
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
