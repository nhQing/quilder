/**
 * Soát effect đã nằm trong dữ liệu: params, appliesTo, conflicts. CHỈ ĐỌC.
 *
 *   pnpm effects:audit
 *
 * ## Vì sao
 *
 * Từ 08/10/2026 `validateOps` kiểm ba thứ này khi GHI. Dữ liệu ghi trước ngày đó chưa
 * từng qua phép kiểm nào: một effect sai params vẫn nằm trong bản nháp, và
 * `EffectRuntime` lặng lẽ bỏ nó trên trình duyệt. Script này tìm chúng ra.
 *
 * Nó soát bản NHÁP của mọi trang, cây của mọi component, và bản ĐANG CHẠY của mọi
 * trang trong release hiện tại. Sửa thì dùng op (`updateEffect` / `detachEffect`) qua
 * builder hoặc MCP — không sửa thẳng hàng `PageVersion`: version là bất biến.
 *
 * Hệ quả cần biết: hoàn tác (undo) một lần GỠ effect sai params sẽ bị từ chối, vì
 * nghịch đảo của nó là gắn lại đúng params sai đó. Gắn lại với params đúng thay vì undo.
 */

import { PrismaClient } from '@prisma/client';

import { migrateDoc, presetTreeToDoc } from '../src/lib/doc/migrate';
import type { Doc } from '../src/lib/doc/types';
import { loadEffect } from '../src/lib/motion/effects/registry';
import type { AnyEffectModule } from '../src/lib/motion/effects/types';

const prisma = new PrismaClient();
const modules = new Map<string, AnyEffectModule | null>();

async function mod(key: string) {
  if (!modules.has(key)) modules.set(key, (await loadEffect(key)) ?? null);
  return modules.get(key)!;
}

interface Finding {
  where: string;
  nodeId: string;
  effect: string;
  problem: string;
}

async function audit(where: string, doc: Doc, out: Finding[]) {
  for (const node of Object.values(doc.nodes)) {
    const keys = (node.effects ?? []).map((e) => e.effect);
    for (const e of node.effects ?? []) {
      const m = await mod(e.effect);
      if (!m) {
        out.push({ where, nodeId: node.id, effect: e.effect, problem: 'không có trong registry' });
        continue;
      }
      const parsed = m.paramsSchema.safeParse(e.params ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(gốc)'}: ${i.message}`).join('; ');
        out.push({ where, nodeId: node.id, effect: e.effect, problem: `params — ${detail}` });
      }
      if (m.appliesTo?.length && !m.appliesTo.includes(node.type)) {
        out.push({ where, nodeId: node.id, effect: e.effect, problem: `gắn vào ${node.type}, chỉ nhận ${m.appliesTo.join(', ')}` });
      }
      const clash = keys.filter((k) => k !== e.effect && m.conflicts?.includes(k));
      if (clash.length) {
        out.push({ where, nodeId: node.id, effect: e.effect, problem: `xung đột với ${clash.join(', ')}` });
      }
    }
  }
}

async function main() {
  const findings: Finding[] = [];

  const pages = await prisma.page.findMany({
    where: { archivedAt: null, draftVersionId: { not: null } },
    select: { slug: true, draftVersion: { select: { doc: true, seq: true } } },
    orderBy: { slug: 'asc' },
  });
  for (const p of pages) {
    await audit(`nháp /${p.slug} (v${p.draftVersion!.seq})`, migrateDoc(p.draftVersion!.doc) as Doc, findings);
  }

  const presets = await prisma.preset.findMany({ select: { key: true, tree: true } });
  for (const c of presets) await audit(`component ${c.key}`, presetTreeToDoc(c.tree) as Doc, findings);

  const site = await prisma.site.findFirst({ select: { activeReleaseId: true } });
  if (site?.activeReleaseId) {
    const entries = await prisma.releaseEntry.findMany({
      where: { releaseId: site.activeReleaseId },
      select: { slug: true, version: { select: { doc: true, seq: true } } },
    });
    for (const e of entries) {
      await audit(`đang chạy /${e.slug} (v${e.version.seq})`, migrateDoc(e.version.doc) as Doc, findings);
    }
  }

  console.log(
    `Đã soát ${pages.length} bản nháp, ${presets.length} component` +
      (site?.activeReleaseId ? ', và release đang chạy.' : '. Chưa có release nào.'),
  );
  if (!findings.length) {
    console.log('Không có effect nào sai params, sai loại node hay xung đột.');
    return;
  }
  console.log(`\n${findings.length} vấn đề:\n`);
  for (const f of findings) console.log(`  ${f.where.padEnd(34)} ${f.nodeId.padEnd(12)} ${f.effect.padEnd(18)} ${f.problem}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
