/**
 * Chứng minh: ghi song song vào cùng một bản nháp không làm mất thay đổi nào.
 *
 *   pnpm prove:concurrent        (cần DATABASE_URL; chạy trong stack e2e là an toàn nhất)
 *
 * ## Lỗi mà script này khoá lại
 *
 * Trước 08/10/2026, `applyOpsToPage` đọc bản nháp, validate, rồi trỏ
 * `Page.draftVersionId` vào version mới VÔ ĐIỀU KIỆN. Hai batch cùng đọc v1 thì batch
 * ghi sau xoá thay đổi của batch ghi trước khỏi nhánh nháp — người sửa trong builder
 * và agent qua MCP là đúng cặp đó. Không có lỗi nào báo ra.
 *
 * ## Ba phép thử
 *
 *  1. 12 batch song song, KHÔNG khai `baseSeq`, mỗi batch đổi tên một node khác nhau.
 *     Batch nào báo `ok` thì thay đổi của nó PHẢI còn trong bản nháp cuối. Batch có
 *     thể bị từ chối (409 sau khi hết lượt thử lại) — đó là kết quả hợp lệ; mất im lặng
 *     thì không.
 *  2. 8 batch song song CÙNG khai `baseSeq` = bản hiện tại: đúng MỘT batch qua, bảy
 *     batch còn lại nhận 409 kèm `currentSeq`.
 *  3. `seq` của các version sống sót liên tục, không có version mồ côi: mọi version
 *     mới đều nằm trên chuỗi cha–con của bản nháp.
 */

import { PrismaClient } from '@prisma/client';

import { applyOpsToPage } from '../src/lib/doc/apply-to-page';
import { migrateDoc } from '../src/lib/doc/migrate';
import type { Doc } from '../src/lib/doc/types';

const prisma = new PrismaClient();
const session = { sub: 'prove-concurrent', email: 'prove@concurrent', role: 'admin', kind: 'user' } as never;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`THẤT BẠI: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const site = await prisma.site.findFirstOrThrow({ select: { id: true } });

  // Mượn doc của một trang có sẵn làm nền — validator cần một cây hợp lệ thật — rồi ghi
  // vào một TRANG RIÊNG, xoá ở cuối. Không đụng bản nháp của trang thật nào.
  const donor = await prisma.page.findFirstOrThrow({
    where: { draftVersionId: { not: null }, archivedAt: null },
    select: { draftVersion: { select: { doc: true } } },
  });
  const doc = migrateDoc(donor.draftVersion!.doc) as Doc;
  const targets = Object.values(doc.nodes)
    .filter((n) => n.type === 'Text' && !n.locked)
    .slice(0, 12)
    .map((n) => n.id);
  if (targets.length < 12) throw new Error('Trang mẫu có ít hơn 12 node Text — chọn trang khác.');

  const page = await prisma.page.create({
    data: { siteId: site.id, slug: `prove-concurrent-${Date.now()}`, title: 'prove-concurrent-ops' },
    select: { id: true },
  });

  try {
    const first = await prisma.pageVersion.create({
      data: { pageId: page.id, doc: doc as unknown as object, schemaVer: doc.schemaVersion, label: 'nền', createdBy: 'prove' },
      select: { id: true, seq: true },
    });
    await prisma.page.update({ where: { id: page.id }, data: { draftVersionId: first.id } });

    /* 1 ── song song, không baseSeq ─────────────────────────────────── */
    console.log('\n1. 12 batch song song, không khai baseSeq');
    const results = await Promise.all(
      targets.map((nodeId, i) =>
        applyOpsToPage({
          pageId: page.id,
          ops: [{ op: 'setName', nodeId, name: `prove-${i}` }],
          actor: 'human',
          session,
        }),
      ),
    );
    const okIdx = results.flatMap((r, i) => (r.ok ? [i] : []));
    const rejected = results.filter((r) => !r.ok);
    console.log(`    ${okIdx.length} qua, ${rejected.length} bị từ chối`);
    assert(rejected.every((r) => r.status === 409), 'batch bị từ chối đều là 409, không phải lỗi khác');
    assert(okIdx.length >= 1, 'ít nhất một batch qua');

    const after = await prisma.page.findUniqueOrThrow({
      where: { id: page.id },
      select: { draftVersion: { select: { doc: true, seq: true } } },
    });
    const finalDoc = migrateDoc(after.draftVersion!.doc) as Doc;
    const lost = okIdx.filter((i) => finalDoc.nodes[targets[i]!]?.name !== `prove-${i}`);
    assert(lost.length === 0, `mọi batch báo ok đều còn trong bản nháp (mất: ${lost.length})`);

    /* 2 ── song song, cùng baseSeq ──────────────────────────────────── */
    console.log('\n2. 8 batch song song cùng baseSeq');
    const base = after.draftVersion!.seq;
    const raced = await Promise.all(
      targets.slice(0, 8).map((nodeId, i) =>
        applyOpsToPage({
          pageId: page.id,
          ops: [{ op: 'setName', nodeId, name: `race-${i}` }],
          actor: 'ai',
          session,
          baseSeq: base,
        }),
      ),
    );
    const won = raced.filter((r) => r.ok);
    const conflicts = raced.filter((r) => !r.ok && r.conflict);
    assert(won.length === 1, `đúng một batch qua (thật: ${won.length})`);
    assert(conflicts.length === 7, `bảy batch nhận 409 conflict (thật: ${conflicts.length})`);
    assert(
      conflicts.every((r) => r.currentSeq === won[0]!.seq),
      'mọi 409 đều trả currentSeq là bản vừa thắng',
    );

    /* 3 ── lịch sử không có version mồ côi ──────────────────────────── */
    console.log('\n3. Lịch sử');
    const versions = await prisma.pageVersion.findMany({
      where: { pageId: page.id },
      select: { id: true, parentId: true, seq: true },
      orderBy: { seq: 'asc' },
    });
    const draft = await prisma.page.findUniqueOrThrow({ where: { id: page.id }, select: { draftVersionId: true } });
    const byId = new Map(versions.map((v) => [v.id, v]));
    let cursor = byId.get(draft.draftVersionId!);
    let chain = 0;
    while (cursor) {
      chain++;
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    assert(chain === versions.length, `mọi version nằm trên chuỗi của bản nháp (${chain}/${versions.length})`);
    const seqs = versions.map((v) => v.seq);
    assert(
      seqs.every((s, i) => s === i + 1),
      `seq liên tục 1..${versions.length}, không nhảy số (thật: ${seqs.join(',')})`,
    );
    assert(versions.length === 1 + okIdx.length + 1, 'số version = nền + batch qua ở phép 1 + batch thắng ở phép 2');
  } finally {
    await prisma.page.update({ where: { id: page.id }, data: { draftVersionId: null } });
    await prisma.pageVersion.deleteMany({ where: { pageId: page.id } });
    await prisma.auditLog.deleteMany({ where: { targetId: page.id } });
    await prisma.page.delete({ where: { id: page.id } });
  }
}

main()
  .then(async () => {
    console.log('\nKhông mất cập nhật nào.');
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
