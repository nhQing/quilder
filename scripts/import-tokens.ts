/**
 * src/styles/tokens.css → bảng Token. Lõi nằm ở `src/lib/setup/design-tokens.ts`
 * (dùng chung với màn cài đặt); script này chỉ chạy nó và in báo cáo.
 *
 * Chạy: pnpm tokens:import
 */

import { PrismaClient } from '@prisma/client';

import { importDesignTokens } from '../src/lib/setup/design-tokens';

const prisma = new PrismaClient();

async function main() {
  const { found, created, updated, kept, deprecated, themeOnly, byCategory } =
    await importDesignTokens(prisma);

  if (themeOnly.length) {
    console.log(
      `Bỏ qua ${themeOnly.length} token chỉ có trong khối theme: ${themeOnly.join(', ')}`,
    );
  }
  console.log(`Đọc được ${found} biến từ tokens.css (lõi + gói dự án nếu có)`);

  console.log(
    `\ntạo mới ${created}, cập nhật ${updated}, giữ nguyên vì đã sửa trong builder ${kept}, ` +
      `đánh dấu deprecated ${deprecated}\n`,
  );
  console.log('Theo nhóm:');
  for (const [c, n] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${c}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
