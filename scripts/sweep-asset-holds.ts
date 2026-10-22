/**
 * Dọn object S3 của ảnh đã xoá hoàn toàn mà không còn release nào trong cửa sổ rollback
 * giữ nó (bảng `AssetHold`, xem `sweepAssetHolds`).
 *
 * Builder tự chạy việc này sau mỗi lần publish và mỗi lần xoá hoàn toàn. Script này cho
 * hai trường hợp còn lại: site lâu không publish (cửa sổ 90 ngày vẫn trôi theo lịch), và
 * chạy định kỳ bằng cron nếu muốn. Gọi thừa không sao — hàng chưa tới hạn để nguyên.
 *
 * Chạy: pnpm assets:sweep            (đọc .env)
 *       pnpm assets:sweep --dry-run  (chỉ liệt kê, không xoá)
 */

import { PrismaClient } from '@prisma/client';

import { sweepAssetHolds } from '../src/lib/builder/asset-trash';
import { loadRollbackWindow, ROLLBACK_WINDOW_TEXT } from '../src/lib/builder/rollback-window';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`Cửa sổ rollback: ${ROLLBACK_WINDOW_TEXT}\n`);

  if (dryRun) {
    const prisma = new PrismaClient();
    const [holds, window] = await Promise.all([
      prisma.assetHold.findMany({ select: { key: true, bytes: true, releaseIds: true } }),
      loadRollbackWindow(),
    ]);
    const due = holds.filter((h) => !h.releaseIds.some((id) => window.has(id)));
    console.log(`${holds.length} object đang giữ · ${due.length} tới hạn dọn`);
    for (const h of due) console.log(`  ${h.key} (${h.bytes} byte)`);
    await prisma.$disconnect();
    return;
  }

  const res = await sweepAssetHolds();
  console.log(`đã xoá ${res.deleted.length} object · gỡ giữ ${res.released.length} (đã có chủ lại)`);
  console.log(`còn giữ ${res.kept} · lỗi S3 ${res.failed.length}`);
  for (const k of res.failed) console.log(`  lỗi: ${k}`);
  if (res.failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
