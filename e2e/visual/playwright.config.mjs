import { defineConfig, devices } from '@playwright/test';

/**
 * Cấu hình RIÊNG cho visual regression — xem docblock của `visual.spec.ts`.
 *
 * Chạy qua `node scripts/e2e-stack.mjs visual [--update]`, không chạy thẳng: script
 * chép spec + config này vào container Playwright rồi chạy ở đó, và trỏ ảnh mẫu về
 * lại `e2e/visual/__screenshots__` trong repo qua `VISUAL_SNAPSHOTS`.
 */
const snapshots = process.env.VISUAL_SNAPSHOTS ?? './__screenshots__';

export default defineConfig({
  testDir: '.',
  testMatch: /visual\.spec\.ts$/,
  workers: 1,
  reporter: [['list']],
  outputDir: process.env.VISUAL_OUT ?? './test-results',
  // Không theo nền tảng: ảnh mẫu chỉ có MỘT bản, bản của container.
  snapshotPathTemplate: `${snapshots}/{arg}{ext}`,
  timeout: 90_000,
  expect: {
    toHaveScreenshot: {
      // Ngưỡng ban đầu theo lộ trình. Hạ dần khi đã thấy mức nhiễu thật.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
      // Nút "N" của `next dev` nằm đè góc trái dưới, và nó có hoạt ảnh riêng.
      stylePath: './hide-dev.css',
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.VISUAL_BASE_URL ?? 'http://localhost:3003',
    // Effect cuộn tôn trọng reduced motion: khối hiện ngay ở trạng thái cuối, nên ảnh
    // không phụ thuộc chụp vào giữa một hoạt ảnh.
    reducedMotion: 'reduce',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
});
