/**
 * Chứng minh tuyên bố: "mọi PageVersion nhận số tiếp theo của trang nó, kể cả khi
 * chỗ tạo không biết gì về bộ đếm".
 *
 * Có TÁM chỗ trong repo tạo `PageVersion` (spec §4.1), năm trong số đó là seed và
 * script. Bất biến này được đặt ở database bằng trigger chứ không ở TypeScript, nên
 * nó phải được ĐO ở đây — một unit test mock Prisma sẽ không bao giờ thấy trigger.
 *
 * Chạy: pnpm prove:seq
 */

import { PrismaClient } from '@prisma/client';
import { revertPageToVersion } from '../src/lib/builder/page-history';

const prisma = new PrismaClient();

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`THẤT BẠI: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const site = await prisma.site.findFirstOrThrow({ select: { id: true } });

  // Trang riêng cho script này, xoá ở cuối. Không đụng trang thật: `seq` của một
  // trang thật là con số người dùng đọc, và bơm 3 bản rác vào đó là làm nhiễu nó.
  const slug = `prove-seq-${Date.now()}`;
  const page = await prisma.page.create({
    data: { siteId: site.id, slug, title: 'prove-version-seq' },
    select: { id: true, versionSeq: true },
  });

  /*
   * `finally` chứ không phải một lệnh xoá ở cuối thân hàm.
   *
   * Mọi `assert` dưới đây đều NÉM khi sai — đó là cách script báo thất bại. Đặt lệnh dọn ở
   * cuối thân hàm nghĩa là lần chạy nào FAIL cũng để lại một trang `prove-seq-…` cùng các
   * version của nó trong database thật, và lần fail thứ mười để lại mười trang. Script chẩn
   * đoán không được phép làm bẩn thứ nó đang chẩn đoán.
   */
  try {
    assert(page.versionSeq === 0, 'trang mới có versionSeq = 0');

    const doc = { schemaVersion: 1, root: 'r', nodes: {} } as unknown as object;
    const mk = (label: string) =>
      prisma.pageVersion.create({
        data: { pageId: page.id, doc, schemaVer: 1, label, createdBy: 'prove-seq' },
        select: { id: true, seq: true },
      });

    // Ba lần tạo KHÔNG truyền `seq`. Đó là toàn bộ điểm: 8 chỗ trong repo đều như vậy.
    const v1 = await mk('một');
    const v2 = await mk('hai');
    const v3 = await mk('ba');
    assert(v1.seq === 1, `bản đầu nhận seq = 1 (thật: ${v1.seq})`);
    assert(v2.seq === 2, `bản hai nhận seq = 2 (thật: ${v2.seq})`);
    assert(v3.seq === 3, `bản ba nhận seq = 3 (thật: ${v3.seq})`);

    // Ghi song song: đây là chỗ `MAX(seq)+1` sẽ đụng khoá. Trigger lấy row lock trên
    // hàng `Page` nên Postgres tuần tự hoá chúng.
    const burst = await Promise.all([mk('p1'), mk('p2'), mk('p3'), mk('p4'), mk('p5')]);
    const seqs = burst.map((v) => v.seq).sort((a, b) => a - b);
    assert(
      JSON.stringify(seqs) === JSON.stringify([4, 5, 6, 7, 8]),
      `5 lần ghi song song nhận 4..8 không trùng (thật: ${seqs.join(',')})`,
    );

    await prisma.page.update({ where: { id: page.id }, data: { draftVersionId: v3.id } });

    const after = await prisma.page.findUniqueOrThrow({
      where: { id: page.id },
      select: { versionSeq: true },
    });
    assert(after.versionSeq === 8, `bộ đếm của trang theo kịp: 8 (thật: ${after.versionSeq})`);

    // Nhãn lùi bản phải nói `lùi về v2`, không phải `lùi về 3f9a2c`.
    //
    // Đây là chỗ `id.slice(-6)` thật sự lộ ra với người dùng: `label` ở đường ops
    // luôn được đặt ('sửa tay'/'AI') nên nhánh fallback gần như không chạy ở
    // `PageHistory`, nhưng nhãn lùi bản thì ghép thẳng nhãn của bản đích vào.
    const reverted = await revertPageToVersion({
      pageId: page.id,
      versionId: v2.id,
      session: { sub: 'prove', email: 'prove@seq', role: 'admin', kind: 'user' } as never,
    });
    assert(reverted.ok, 'lùi bản chạy được');
    const revertedRow = await prisma.pageVersion.findUniqueOrThrow({
      where: { id: reverted.versionId! },
      select: { label: true, seq: true },
    });
    assert(
      revertedRow.label === 'lùi về v2',
      `nhãn lùi bản dùng v<seq> (thật: ${revertedRow.label})`,
    );
    assert(revertedRow.seq === 9, `bản lùi cũng nhận seq tiếp theo: 9 (thật: ${revertedRow.seq})`);
  } finally {
    await prisma.page.delete({ where: { id: page.id } });
  }

  console.log('\nprove-version-seq: TẤT CẢ ĐẠT');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
