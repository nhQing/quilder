import { expect, test, type Page } from '@playwright/test';

/**
 * Lát 4 của giao diện v2 — rail 5 mục, dock đáy, `Ctrl+P`.
 *
 * Spec §8 ghi rằng wireframe chỉ vẽ happy path và để lát 4 tự quyết trạng thái rỗng.
 * Hai quyết định đó được kiểm ở đây, vì chúng là thứ dễ bị sửa "cho gọn" về sau:
 *
 *  - Nút cảnh báo VẪN Ở ĐÓ khi không có cảnh báo nào, mang số 0 và dấu ✓. Ẩn nó đi
 *    làm dải nhảy chỗ mỗi lần sửa xong lỗi cuối, và tệ hơn: "không thấy nút" trông
 *    hệt "chưa kiểm".
 *  - Ô `✦ AI` có mặt nhưng KHÔNG bấm được. Lớp AI nằm ngoài phạm vi; một nút bấm
 *    được rồi không làm gì dạy người dùng rằng nút của công cụ này không đáng tin.
 */

const PAGE_SLUG = 'gioi-thieu';

async function openEditor(page: Page): Promise<string> {
  await page.goto('/builder');
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('link', { name: new RegExp(PAGE_SLUG) }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  return page.url().split('/').pop()!;
}

test('dock đáy có ba mục, và nút cảnh báo luôn ở đó kể cả khi số là 0', async ({ page }) => {
  await openEditor(page);

  const dock = page.locator('[data-bottom-dock]');
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('Văn bản');
  await expect(dock).toContainText('Cảnh báo chất lượng');
  await expect(dock).toContainText('AI');

  // Nút có mặt bất kể số là bao nhiêu — đó là quyết định về trạng thái rỗng.
  await expect(dock.locator('[data-quality-toggle]')).toBeVisible();
});

test('mở cảnh báo thì nó nói rõ đây KHÔNG phải hàng rào publish', async ({ page }) => {
  await openEditor(page);

  const dock = page.locator('[data-bottom-dock]');
  await dock.locator('[data-quality-toggle]').click();

  /*
   * Câu chịu lực. Nhãn wireframe là "Cần sửa trước khi publish", tức nó hứa một cổng
   * mà `/api/publish` không có — nó nhận doc nháp nguyên trạng. Spec quyết định #4:
   * đổi nhãn, không dựng cổng. Nếu dock im lặng về điều đó, người dùng sẽ tin rằng
   * có ai đó đang chặn giúp họ.
   *
   * Trang đồ gá có thể sạch (0 cảnh báo), nên chỉ khẳng định câu này khi có danh
   * sách — và khẳng định trạng thái rỗng nói được điều gì đó khi không.
   */
  const panel = dock.locator('..');
  const text = (await panel.innerText()).toLowerCase();
  expect(text.includes('không phải hàng rào') || text.includes('không có cảnh báo nào')).toBe(true);
});

test('Ctrl+P đưa con trỏ vào ô tìm lớp, không mở hộp In', async ({ page }) => {
  await openEditor(page);

  const box = page.locator('#layer-search');
  await expect(box).toBeVisible();
  await expect(box).not.toBeFocused();

  await page.keyboard.press('Control+p');
  await expect(box).toBeFocused();
});

test('rail thu gọn có 5 ô, và ô AI KHÔNG bấm được', async ({ page }) => {
  await openEditor(page);

  await page.getByRole('button', { name: 'Thu gọn pane trái' }).click();

  // Bốn mục mở được pane, cộng một ô AI đã chừa chỗ.
  await expect(page.locator('[data-rail-item]')).toHaveCount(5);
  for (const id of ['layers', 'components', 'assets', 'pages', 'ai']) {
    await expect(page.locator(`[data-rail-item="${id}"]`)).toBeVisible();
  }

  // AI là `<span>`, không phải `<button>`: nó không nằm trong cây nút.
  await expect(page.locator('[data-rail-item="ai"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^AI$/ })).toHaveCount(0);
});

test('mục Ảnh nói rõ điều kiện TRƯỚC khi bấm, không để lưới bấm không ăn', async ({ page }) => {
  await openEditor(page);

  /*
   * Tên trợ năng của tiêu đề accordion là `"Ảnh 0"` — mũi tên `▸`/`▾` mang
   * `aria-hidden` nên nó KHÔNG vào tên, và số đếm thì có. Neo `^` để không khớp
   * nhãn nào khác chứa chữ "Ảnh".
   */
  await page.getByRole('button', { name: /^Ảnh/ }).click();

  /*
   * Luật 3 của `3e`: điều kiện thiếu phải hiện TRƯỚC khi bấm. Không có câu này thì
   * một lưới ảnh bấm không ăn là một lưới trông như hỏng.
   */
  await expect(page.getByText(/Chọn một node Ảnh hoặc Video/)).toBeVisible();
});
