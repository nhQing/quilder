/**
 * Bổ sung dữ liệu tối thiểu còn thiếu: site, trang chủ, trang 404, release đầu tiên.
 *
 * Không phá — mỗi bước kiểm rồi mới tạo (xem `src/lib/setup/defaults.ts`), nên
 * bootstrap chạy nó ở MỌI lần `up -d`. Thay cho "seed nếu chưa có Site": seed xoá
 * sạch site trước khi tạo, nên nó chỉ dành cho máy dev.
 *
 *   tsx scripts/ensure-defaults.ts
 */

import { PrismaClient } from '@prisma/client';

import { ensureSiteDefaults } from '../src/lib/setup/defaults';

const prisma = new PrismaClient();

async function main() {
  const { siteId, created } = await prisma.$transaction((tx) => ensureSiteDefaults(tx));
  console.log(
    created.length
      ? `site=${siteId} — đã tạo: ${created.join(', ')}`
      : `site=${siteId} — đủ dữ liệu tối thiểu, không tạo gì`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
