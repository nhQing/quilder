import { expect, test, type Page } from '@playwright/test';

/**
 * Canvas "Toàn trang" (16/10/2026): khung cao bằng nội dung, pane cuộn thay khung — như Figma.
 *
 * Thứ phải đúng, theo thứ tự người dùng sẽ thấy hỏng:
 *  - hero `100dvh` KHÔNG phình theo khung (đơn vị chiều cao màn bị đóng băng ở chiều cao
 *    thiết bị — xem `freeze-viewport.ts`);
 *  - khung không còn cuộn bên trong (không có thanh cuộn thứ hai);
 *  - chọn node từ cây Lớp vẫn đưa node vào tầm nhìn — giờ bằng cách cuộn PANE;
 *  - lựa chọn được nhớ qua lần tải lại, và tắt đi thì về đúng như cũ.
 */

const HOME = /^Trang chủ \/$/;
const SHOWN = '[data-stage-frame] iframe[data-canvas-frame="shown"]';

async function openHome(page: Page) {
  await page.goto('/builder');
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('link', { name: HOME }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await frameReady(page);
}

const frameReady = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate((sel) => {
          const d = document.querySelector<HTMLIFrameElement>(sel)?.contentDocument;
          return d?.readyState === 'complete' && d.querySelectorAll('[data-n]').length > 0;
        }, SHOWN),
      { timeout: 30_000 },
    )
    .toBe(true);

const measure = (page: Page) =>
  page.evaluate((sel) => {
    const d = document.querySelector<HTMLIFrameElement>(sel)!.contentDocument!;
    const pane = document.querySelector<HTMLElement>('[data-stage]')!;
    return {
      stage: Number(pane.dataset.stageHeight),
      hero: Math.round(d.querySelector('section')!.getBoundingClientRect().height),
      innerScroll: d.documentElement.scrollHeight - d.documentElement.clientHeight,
      paneScroll: pane.scrollTop,
    };
  }, SHOWN);

test.afterEach(async ({ page }) => {
  await page.evaluate(() => localStorage.clear()).catch(() => {});
});

test('bật Toàn trang: khung cao bằng trang, hero giữ chiều cao thiết bị, khung không cuộn', async ({ page }) => {
  await openHome(page);
  const before = await measure(page);
  expect(before.innerScroll, 'đối chứng: bình thường khung tự cuộn').toBeGreaterThan(0);

  const toggle = page.locator('[data-stage-full-page]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await expect.poll(async () => (await measure(page)).stage, { timeout: 15_000 }).toBeGreaterThan(before.stage * 3);
  const after = await measure(page);
  expect(after.hero, 'hero 100dvh phình theo khung').toBe(before.hero);
  expect(after.innerScroll).toBeLessThanOrEqual(1);

  // Nhớ qua lần tải lại.
  await page.reload();
  await frameReady(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await measure(page)).stage, { timeout: 15_000 }).toBeGreaterThan(before.stage * 3);

  // Tắt → về một màn thiết bị, khung tự cuộn lại.
  await toggle.click();
  await expect.poll(async () => (await measure(page)).stage, { timeout: 15_000 }).toBe(before.stage);
  await frameReady(page);
  await expect.poll(async () => (await measure(page)).innerScroll, { timeout: 15_000 }).toBeGreaterThan(0);
});

test('Toàn trang: chọn node ở sâu trong cây Lớp thì PANE cuộn tới nó', async ({ page }) => {
  await openHome(page);
  await page.locator('[data-stage-full-page]').click();
  await expect.poll(async () => (await measure(page)).innerScroll, { timeout: 15_000 }).toBeLessThanOrEqual(1);

  const ids = await page.locator('[data-layer-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-layer-row')!));
  const target = ids[Math.floor(ids.length * 0.8)]!;
  expect((await measure(page)).paneScroll).toBe(0);
  await page.locator(`[data-layer-row="${target}"]`).click();

  // Node nằm trong vùng nhìn của PANE (toạ độ trong khung × mức thu + vị trí khung).
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ sel, id }) => {
            const f = document.querySelector<HTMLIFrameElement>(sel)!;
            const el = f.contentDocument!.querySelector(`[data-n="${id}"]`);
            if (!el) return false;
            const pane = document.querySelector<HTMLElement>('[data-stage]')!.getBoundingClientRect();
            const scale = Number(document.querySelector<HTMLElement>('[data-stage]')!.dataset.stageScale);
            const fr = f.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            const top = fr.top + r.top * scale;
            return top < pane.bottom && top + r.height * scale > pane.top;
          },
          { sel: SHOWN, id: target },
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  expect((await measure(page)).paneScroll).toBeGreaterThan(0);
});
