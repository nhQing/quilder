/**
 * DB đã áp ĐỦ migration chưa — bản cho màn cài đặt.
 *
 * Cùng truy vấn với `scripts/check-schema.mjs` (entrypoint của container). Không
 * import lại được file `.mjs` đó vì nó tự chạy và `process.exit` ngay khi load. Đọc
 * docblock của nó để biết vì sao phép kiểm so DANH SÁCH migration chứ không chỉ hỏi
 * bảng "Site" có tồn tại không — sửa một bên thì sửa cả hai.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';

export type SchemaState =
  | { db: 'ok' }
  | { db: 'unreachable'; detail: string }
  | { db: 'needs-migration'; missing: string[] };

function migrationsOnDisk(): string[] {
  return readdirSync(join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function checkSchema(prisma: PrismaClient): Promise<SchemaState> {
  let applied: Set<string>;
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    applied = new Set(rows.map((r) => r.migration_name));
  } catch (err) {
    const text = String(err);
    // Bảng chưa có = DB nối được nhưng chưa migrate lần nào.
    if (/_prisma_migrations/.test(text) && /does not exist|không tồn tại/i.test(text)) {
      return { db: 'needs-migration', missing: migrationsOnDisk() };
    }
    return { db: 'unreachable', detail: text.split('\n')[0] ?? text };
  }

  const missing = migrationsOnDisk().filter((m) => !applied.has(m));
  return missing.length ? { db: 'needs-migration', missing } : { db: 'ok' };
}
