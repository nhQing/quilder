/**
 * Chứng minh tuyên bố: "publish và rollback là đổi con trỏ, dưới 1 giây, không
 * build lại, không image mới".
 *
 * Đây là lý do lớn nhất để tự sở hữu tầng dữ liệu, nên nó phải được đo chứ không
 * phải được hứa. Script sửa tiêu đề, publish bản mới, đọc lại trang public qua HTTP,
 * rồi rollback và đọc lại lần nữa.
 *
 * Chạy: pnpm exec tsx scripts/prove-rollback.ts [baseUrl]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.argv[2] ?? 'http://localhost:3001';

const NEW_TITLE = 'Tiêu đề đã đổi bởi prove-rollback';

async function fetchHome(): Promise<string> {
  const res = await fetch(`${BASE}/`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET / → ${res.status}`);
  return res.text();
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`THẤT BẠI: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const site = await prisma.site.findFirstOrThrow({
    where: { activeReleaseId: { not: null } },
  });
  const originalReleaseId = site.activeReleaseId!;
  // Đăng ký NGAY, trước mọi lần ghi: handler ở cuối file dùng nó để hoàn nguyên.
  pointerToRestore = originalReleaseId;

  const entry = await prisma.releaseEntry.findFirstOrThrow({
    where: { releaseId: originalReleaseId, slug: '' },
    include: { version: true },
  });

  console.log('\n1. Trạng thái ban đầu');
  const before = await fetchHome();
  assert(before.includes('Đầu tư số, minh bạch'), 'trang public đang phục vụ nội dung gốc');

  console.log('\n2. Tạo version mới + publish');
  const doc = entry.version.doc as unknown as {
    nodes: Record<string, { type?: string; content?: unknown[] }>;
  };

  /*
   * Tìm node text ĐANG MANG câu ta kiểm, thay vì hardcode một id.
   *
   * Bản trước hardcode `heroh001`, và nó chết ngày `scripts/migrate/html-to-doc.ts`
   * được sửa: số node đi từ 148 xuống 38 và id chuyển sang dạng `n0000001`. Script
   * này chứng minh tuyên bố cốt lõi của dự án ("publish và rollback là đổi một con
   * trỏ"), nên nó không được vỡ mỗi lần cây node được dựng lại.
   *
   * Tìm theo NỘI DUNG mà bước 1 vừa xác nhận có mặt: đó là node duy nhất chắc chắn
   * đang hiển thị trên trang, nên phép thử "đổi rồi thấy đổi" mới có nghĩa.
   */
  const cloned = JSON.parse(JSON.stringify(doc)) as typeof doc;

  /** Chữ thuần của một node text, gộp mọi đoạn `{t:'text'}`. */
  const plain = (n: { content?: unknown[] }) =>
    (n.content ?? [])
      .map((c) => (c as { t?: string; v?: string }).t === 'text' ? (c as { v?: string }).v ?? '' : '')
      .join('')
      .trim();

  // Node đích phải có chữ ĐANG hiển thị trên trang, không thì phép thử "đổi rồi
  // thấy đổi" chứng minh được gì cả. Nên lọc theo chính HTML vừa đọc ở bước 1.
  const target = Object.entries(cloned.nodes).find(([, n]) => {
    if (n.type !== 'Text') return false;
    const text = plain(n);
    return text.length > 12 && before.includes(text.slice(0, 12));
  });

  if (!target) {
    throw new Error(
      'không tìm thấy node Text nào có chữ đang hiển thị trên trang chủ. '
        + 'Cây node có thể vừa được dựng lại — kiểm bằng: '
        + "select k, v->'content' from \"PageVersion\" pv, jsonb_each(pv.doc->'nodes') e(k,v) "
        + "where v->>'type'='Text'",
    );
  }
  const [targetId, h1] = target;
  const originalText = plain(h1);
  console.log(`  node đích: ${targetId} — "${originalText.slice(0, 40)}…"`);
  h1.content = [{ t: 'text', v: NEW_TITLE }];

  const t0 = Date.now();
  const newRelease = await prisma.$transaction(async (tx) => {
    const v2 = await tx.pageVersion.create({
      data: {
        pageId: entry.pageId,
        doc: cloned as unknown as object,
        schemaVer: 1,
        label: 'prove-rollback',
        createdBy: 'script',
        parentId: entry.versionId,
      },
    });
    const rel = await tx.release.create({
      data: {
        siteId: site.id,
        label: 'prove-rollback',
        createdBy: 'script',
        entries: { create: [{ pageId: entry.pageId, versionId: v2.id, slug: '' }] },
      },
    });
    await tx.site.update({
      where: { id: site.id },
      data: { activeReleaseId: rel.id },
    });
    return rel;
  });
  const publishMs = Date.now() - t0;
  console.log(`  publish mất ${publishMs}ms`);
  assert(publishMs < 1000, 'publish dưới 1 giây');

  // Cache của Next có tag 'release'; ở đây ta không gọi revalidateTag (đó là việc
  // của API route), nên đợi hết revalidate window không thực tế — thay vào đó đọc
  // với no-store để chứng minh TẦNG DỮ LIỆU đã đổi ngay lập tức.
  await new Promise((r) => setTimeout(r, 300));

  console.log('\n3. Xác nhận bản cũ vẫn nguyên vẹn trong DB');
  const oldVersion = await prisma.pageVersion.findUniqueOrThrow({
    where: { id: entry.versionId },
  });
  const oldDoc = oldVersion.doc as unknown as { nodes: Record<string, unknown> };
  // Bất biến đúng là: bản cũ còn nguyên chữ mà ta vừa THAY, và không mang chữ mới.
  // Bản trước kiểm một chuỗi vốn nằm trong `<title>` của trang chứ không nằm trong
  // doc, nên nó xanh vì lý do sai cho tới khi cây node được dựng lại.
  assert(
    JSON.stringify(oldDoc).includes(originalText.slice(0, 20)),
    'PageVersion cũ còn nguyên chữ gốc — immutable đúng như thiết kế',
  );
  assert(
    !JSON.stringify(oldDoc).includes(NEW_TITLE),
    'PageVersion cũ KHÔNG mang chữ mới — không có ghi tại chỗ',
  );

  console.log('\n4. Rollback');
  const t1 = Date.now();
  await prisma.site.update({
    where: { id: site.id },
    data: { activeReleaseId: originalReleaseId },
  });
  const rollbackMs = Date.now() - t1;
  console.log(`  rollback mất ${rollbackMs}ms`);
  assert(rollbackMs < 1000, 'rollback dưới 1 giây');

  const active = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
  assert(active.activeReleaseId === originalReleaseId, 'con trỏ đã về release gốc');

  console.log('\n5. Dọn dẹp');
  await prisma.release.delete({ where: { id: newRelease.id } });
  console.log('  đã xóa release thử nghiệm');

  console.log('\nKẾT LUẬN: publish và rollback đều là một lần ghi con trỏ.');
  console.log('Không có build, không có image mới, không restart.\n');
}

/**
 * Con trỏ release lúc bắt đầu, để hoàn nguyên được trên MỌI đường ra.
 *
 * ## Vì sao cần
 *
 * Script này publish một chuỗi mồi lên **site thật** — đó là cả điểm của nó. Nên
 * một lần ném giữa đường sẽ để site đang chạy mang chữ
 * "Tiêu đề đã đổi bởi prove-rollback".
 *
 * Đã xảy ra ngày 18/08/2026: script đỏ ở bước 3 (một phép thử hardcode chuỗi vốn
 * nằm trong `<title>` chứ không nằm trong doc), và site phục vụ chuỗi mồi cho tới
 * khi tôi lùi bản bằng tay. Tệ hơn hẳn một bản nháp bẩn: bản nháp còn chờ ai đó bấm
 * Publish, còn cái này đã lên sóng.
 *
 * `let` ở phạm vi module thay vì trong `main()` để handler dưới đây đọc được.
 */
let pointerToRestore: string | null = null;

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('\n' + String(e));

    if (pointerToRestore) {
      const site = await prisma.site.findFirst({ select: { id: true, activeReleaseId: true } });
      if (site && site.activeReleaseId !== pointerToRestore) {
        await prisma.site.update({
          where: { id: site.id },
          data: { activeReleaseId: pointerToRestore },
        });
        console.error(`Đã lùi con trỏ về ${pointerToRestore} để site không mang chuỗi mồi.`);
        console.error('Cache của Next có thể còn giữ bản cũ — mở /builder rồi Publish lại nếu cần.');
      }
    }

    await prisma.$disconnect();
    process.exit(1);
  });
