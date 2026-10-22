/**
 * Bảng `Effect` ← manifest trong `src/lib/motion/effects/*`. Lõi của
 * `pnpm effects:sync`, tách ra ngày 20/10/2026 để màn cài đặt gọi được. Lý do
 * ĐỒNG BỘ chứ không SEED, và vì sao không xoá hàng lạ: xem `scripts/sync-effects.ts`.
 */

import type { PrismaClient } from '@prisma/client';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { EFFECT_REGISTRY, loadEffect, type Entry } from '@/lib/motion/effects/registry';

export interface EffectSyncResult {
  total: number;
  created: number;
  updated: number;
  /** Hàng trong DB không còn trong registry — báo ra, KHÔNG xoá. */
  orphans: string[];
}

export async function syncEffects(
  prisma: PrismaClient,
  log: (line: string) => void = () => {},
  /**
   * Effect của gói dự án khi gọi từ script tsx: ở đó `@project` luôn là gói rỗng (tsconfig),
   * nên `scripts/sync-effects.ts` tự nạp `projects/<gói>/effects.ts` rồi truyền vào. Trong
   * Next thì registry đã gộp sẵn effect của gói, không cần truyền.
   */
  extra: Record<string, Entry> = {},
): Promise<EffectSyncResult> {
  const keys = [...new Set([...Object.keys(EFFECT_REGISTRY), ...Object.keys(extra)])].sort();

  let created = 0;
  let updated = 0;

  for (const key of keys) {
    const mod = Object.hasOwn(extra, key) ? (await extra[key]!.load()).default : await loadEffect(key);
    if (!mod) {
      log(`  ! ${key}: loadEffect trả null — bỏ qua`);
      continue;
    }

    /*
     * `$refStrategy: 'root'` ở đây, KHÁC `json-schema.ts` dùng 'none'.
     *
     * Chuỗi này vào một cột JSONB rồi đi ra qua `list_effects`, không vào
     * `tools/list` — nên nó không nằm trong ngân sách prompt mỗi lượt, và $ref
     * giữ nó gọn. Params của effect đều nông nên thực tế gần như không có $ref
     * nào; đặt 'root' là để một schema lồng sâu về sau không phình lặng lẽ.
     */
    const paramsSchema = zodToJsonSchema(mod.paramsSchema, {
      target: 'jsonSchema7',
      $refStrategy: 'root',
    });

    /*
     * `defaults` lấy bằng cách parse `{}`.
     *
     * Đọc `._def` của Zod để moi default là chạm nội bộ thư viện — đổi minor là
     * vỡ. Parse `{}` thì dùng đúng API công khai, và với effect có
     * `requiredParams` thì nó thất bại, đúng như nó phải: một effect bắt buộc có
     * `to` thì "bộ mặc định" không tồn tại, và ghi `{}` vào đó là nói dối.
     */
    const parsed = mod.paramsSchema.safeParse({});
    const defaults = parsed.success ? (parsed.data as object) : {};

    const data = {
      name: mod.name,
      aiDescription: mod.aiDescription,
      appliesTo: mod.appliesTo ?? [],
      paramsSchema: paramsSchema as object,
      defaults,
      runtimeCost: mod.runtimeCost,
      conflicts: mod.conflicts ?? [],
      statesWritten: mod.statesWritten ?? [],
    };

    const existing = await prisma.effect.findUnique({ where: { key } });
    await prisma.effect.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });

    if (existing) updated += 1;
    else created += 1;

    const req = mod.requiredParams?.length ? ` · bắt buộc: ${mod.requiredParams.join(', ')}` : '';
    const st = data.statesWritten.length ? ` · state: ${data.statesWritten.join(', ')}` : '';
    log(`  ${existing ? '~' : '+'} ${key} — ${mod.name} (${mod.runtimeCost})${req}${st}`);
  }

  const orphans = await prisma.effect.findMany({
    where: { key: { notIn: keys } },
    select: { key: true },
  });

  return { total: keys.length, created, updated, orphans: orphans.map((o) => o.key) };
}

/** Cho màn cài đặt: chỉ đồng bộ khi bảng `Effect` còn RỖNG. */
export async function ensureEffects(prisma: PrismaClient): Promise<number> {
  if ((await prisma.effect.count()) > 0) return 0;
  return (await syncEffects(prisma)).created;
}
