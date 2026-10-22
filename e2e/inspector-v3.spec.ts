import { expect, test, type Page } from '@playwright/test';

/**
 * Inspector gọn, dễ nhìn (21/10/2026) — xem docs/superpowers/specs/2026-10-21-inspector-gon-de-nhin-design.md.
 *
 * Mỗi test XOÁ bề rộng đã lưu khi xong: nó nằm trong `localStorage` của context, và một
 * Inspector rộng 560px làm spec chạy sau đo canvas khác đi.
 */

async function openEditor(page: Page) {
  await page.goto('/builder');
  const href = await page.getByRole('link', { name: /^Mở editor/ }).first().getAttribute('href');
  await page.goto(href!);
  await expect(page.getByTestId('inspector-resizer')).toBeVisible();
}

const asideWidth = async (page: Page) =>
  (await page.getByTestId('inspector-resizer').locator('xpath=..').boundingBox())!.width;

test.describe('sidebar Inspector kéo giãn', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('mm.builder.right.width'));
  });

  test('kéo rộng ra, giữ qua tải lại, kẹp ở trần, bấm đúp về mặc định', async ({ page }) => {
    await openEditor(page);
    const w0 = await asideWidth(page);

    const h = (await page.getByTestId('inspector-resizer').boundingBox())!;
    const y = h.y + h.height / 2;
    await page.mouse.move(h.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(h.x - 117, y, { steps: 8 });
    await page.mouse.up();
    const w1 = await asideWidth(page);
    expect(Math.abs(w1 - (w0 + 120))).toBeLessThanOrEqual(2);

    await page.reload();
    await expect(page.getByTestId('inspector-resizer')).toBeVisible();
    await expect.poll(() => asideWidth(page)).toBeCloseTo(w1, -1);

    const h2 = (await page.getByTestId('inspector-resizer').boundingBox())!;
    await page.mouse.move(h2.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(h2.x - 1500, y, { steps: 8 });
    await page.mouse.up();
    expect(await asideWidth(page)).toBeLessThanOrEqual(560);

    await page.getByTestId('inspector-resizer').dblclick();
    await expect.poll(() => asideWidth(page)).toBeCloseTo(w0, -1);
  });

  test('phím mũi tên đổi bề rộng', async ({ page }) => {
    await openEditor(page);
    const w0 = await asideWidth(page);
    await page.getByTestId('inspector-resizer').focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => asideWidth(page)).toBeCloseTo(w0 + 16, -1);
  });
});
