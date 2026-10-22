/**
 * Seed cho máy DEV: XOÁ site rồi dựng lại một site trung tính — trang chủ giới thiệu Quilder,
 * trang 404, một release đang chạy. Production KHÔNG chạy file này (bootstrap dùng
 * `scripts/ensure-defaults.ts`, không phá gì).
 *
 * Gói dự án (`QUILDER_PROJECT`) có `seed.ts` thì chạy thêm SAU phần lõi:
 *
 *   export default async function seed(prisma: PrismaClient, ctx: { siteId: string }): Promise<void>
 *
 * Nội dung mẫu riêng của một website (trang chủ thật, globals, token) sống ở đó, không ở đây.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PrismaClient } from '@prisma/client';

import { projectDir } from '../scripts/project-dir.mjs';
import { ensureSiteDefaults } from '../src/lib/setup/defaults';
import { ensureDesignTokens } from '../src/lib/setup/design-tokens';

const prisma = new PrismaClient();

async function main() {
  const { siteId, created } = await prisma.$transaction(async (tx) => {
    // Sạch sẽ để seed chạy lại được nhiều lần. Locale KHÔNG xoá: nó không thuộc Site, và
    // xoá nó sẽ cascade xoá mọi bản dịch.
    await tx.site.deleteMany({});
    return ensureSiteDefaults(tx, {
      name: 'Quilder Demo',
      siteUrl: 'http://localhost:3001',
      // Vài biến site mẫu cho binding `source: 'site'` — màn Cài đặt và AI có thứ để đọc.
      globals: { company: 'Công ty Quilder Demo', hotline: '1900 0000', email: 'hello@example.com' },
      // Hai ngôn ngữ, `en` bật sẵn: máy dev và stack e2e cần một ngôn ngữ thứ hai để bảng Văn
      // bản, `/en` và bản dịch có thứ để chạy. Site thật cài qua màn cài đặt chỉ có ngôn ngữ mặc định.
      locales: [
        { code: 'vi', label: 'Tiếng Việt', isDefault: true, enabled: true },
        { code: 'en', label: 'English', isDefault: false, enabled: true },
      ],
      actor: 'seed',
    });
  });
  console.log(`site=${siteId} tạo: ${created.join(', ')}`);

  // Bảng Token: bootstrap nạp nó ở production; máy dev mới và stack e2e chưa có gì. Trống thì
  // bộ chọn màu trống và validator từ chối mọi `{$token}`.
  const tokens = await ensureDesignTokens(prisma);
  if (tokens) console.log(`token: nạp ${tokens} từ tokens.css`);

  const project = projectDir();
  const seedFile = resolve(project.dir, 'seed.ts');
  if (project.name && existsSync(seedFile)) {
    const mod = (await import(pathToFileURL(seedFile).href)) as {
      default: (p: PrismaClient, ctx: { siteId: string }) => Promise<void>;
    };
    await mod.default(prisma, { siteId });
    console.log(`seed của gói "${project.name}": xong`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
