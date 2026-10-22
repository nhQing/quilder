import { expect, test } from '@playwright/test';

/**
 * Visual regression (D1): ảnh chụp toàn trang ở ba khổ, so với ảnh mẫu đã commit.
 *
 * ## Vì sao chỉ chạy trong container, và chỉ trên seed bằng script
 *
 * Ảnh mẫu chỉ có nghĩa khi hai lần chụp khác nhau ĐÚNG MỘT thứ: code. Font của Windows,
 * macOS và Ubuntu render khác nhau vài pixel ở mọi dòng chữ, nên ảnh luôn chụp trong
 * `mcr.microsoft.com/playwright` cùng phiên bản (`node scripts/e2e-stack.mjs visual`) —
 * máy dev và CI cùng một bộ font. Dữ liệu cũng phải đứng yên: bản sao DB dev đổi mỗi
 * lần ai đó sửa trang, nên ảnh mẫu dựng trên seed bằng script (`up --scripted`), thứ
 * chỉ đổi khi code seed đổi.
 *
 * Hệ quả cần nói thẳng: trang chủ ở đây là trang chủ CỦA SEED, không phải trang chủ
 * thật. Bắt được lỗi compiler CSS, renderer, effect làm lệch bố cục; không bắt được
 * lỗi chỉ lộ ra với nội dung thật. Muốn thế cần fixture dữ liệu đã làm sạch (HANDOFF).
 *
 * File này KHÔNG import gì từ repo: nó chạy từ một bản chép trong container, chỉ có
 * `@playwright/test`.
 */

const WIDTHS = [1440, 768, 320] as const;

const EMAIL = process.env.BUILDER_EMAIL ?? '';
const PASSWORD = process.env.BUILDER_PASSWORD ?? '';
const DRAFT_PAGE_ID = process.env.VISUAL_DRAFT_PAGE_ID ?? '';

async function settle(page: import('@playwright/test').Page) {
  await page.evaluate(() => document.fonts.ready);
  // Cuộn hết trang một lượt rồi về đầu: ảnh lazy và các khối chờ IntersectionObserver
  // phải ở trạng thái cuối trước khi chụp toàn trang.
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle');
}

for (const width of WIDTHS) {
  test(`trang chủ seed @ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await settle(page);
    await expect(page).toHaveScreenshot(`trang-chu-${width}.png`, { fullPage: true });
  });
}

test.describe('bản nháp qua preview', () => {
  test.skip(!EMAIL || !PASSWORD || !DRAFT_PAGE_ID, 'thiếu tài khoản e2e hoặc id trang nháp');

  test.beforeEach(async ({ page }) => {
    const res = await page.request.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } });
    expect(res.ok()).toBe(true);
  });

  for (const width of WIDTHS) {
    test(`gioi-thieu (nháp) @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/preview/${DRAFT_PAGE_ID}`, { waitUntil: 'networkidle' });
      await settle(page);
      await expect(page).toHaveScreenshot(`gioi-thieu-${width}.png`, { fullPage: true });
    });
  }
});
