import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

/**
 * Spec e2e của gói dự án đang bật (`QUILDER_PROJECT`, stack e2e đặt từ `E2E_PROJECT`) —
 * `projects/<gói>/e2e`. Không có gói thì chỉ chạy bộ lõi.
 */
const pack = process.env.QUILDER_PROJECT?.trim();
const packE2e = pack && /^[a-z0-9][a-z0-9-]{0,39}$/.test(pack) ? `./projects/${pack}/e2e` : null;

/**
 * Cấu hình e2e.
 *
 * Không dùng `webServer` để tự bật dev server: test R2 cần `__mm` vốn chỉ tồn
 * tại ở dev, và cần DB đã seed. Bật server thủ công giữ cho điều kiện chạy test
 * là hiển nhiên thay vì ẩn trong config.
 *
 *   pnpm db:up && pnpm dev
 *   pnpm exec tsx scripts/create-user.ts <email> <mật-khẩu>
 *   pnpm exec tsx scripts/seed-second-page.ts
 *   pnpm e2e
 *
 * Project `setup` chạy trước, đăng nhập qua form thật rồi lưu cookie. Mọi test
 * sau đó dùng chung phiên đó.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    /*
     * Mặc định là 3001 — CỔNG CỦA DỰ ÁN NÀY.
     *
     * Trước đây mặc định là 3000, và đó là cổng của một dự án Next KHÁC trên cùng
     * máy dev (lý do `next dev` ở đây tự nhảy sang 3001 ngay từ đầu). Hệ quả đo
     * ngày 24/08/2026: `pnpm e2e` trần gõ vào app kia, ô `email` của nó khớp
     * `getByLabel(/email/i)` nên bước đầu QUA, rồi treo 5 phút ở ô mật khẩu và
     * chết bằng một câu chỉ nói "không thấy /mật khẩu/i" — không một chữ nào về
     * cổng. 202 test còn lại không chạy.
     *
     * HANDOFF §3.24 đã ghi cái bẫy này thành một dòng cảnh báo. Một dòng cảnh báo
     * trong tài liệu không ngăn được ai gõ `pnpm e2e`; một giá trị mặc định đúng
     * thì có.
     */
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/state.json' },
      // `e2e/visual` có config riêng và chỉ chạy trong container (`pnpm e2e:visual`).
      testIgnore: [/auth\.setup\.ts/, /[\\/]visual[\\/]/],
    },
    ...(packE2e && existsSync(packE2e)
      ? [
          {
            name: `pack-${pack}`,
            testDir: packE2e,
            dependencies: ['setup'],
            use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/state.json' },
          },
        ]
      : []),
  ],
});
