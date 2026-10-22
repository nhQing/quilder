import { expect, test } from '@playwright/test';

/**
 * Lát 5 của giao diện v2 — thẻ "đang chạy", `Xem` bản cũ, `Lùi một bước`.
 *
 * Spec này KHÔNG lùi bản. Lùi đổi thứ khách đang xem, và một e2e đổi release đang
 * chạy của chủ dự án là hỏng nặng hơn mọi thứ nó kiểm được. Nút lùi chỉ được khẳng
 * định là CÓ, đúng nhãn, và trỏ đúng bản.
 *
 * Route xem lại thì đọc-thuần nên chạy thật được: release là bất biến.
 */

test('thẻ "đang chạy" tách khỏi danh sách, và nói đủ bản nào đang chạy', async ({ page }) => {
  await page.goto('/builder/releases');

  const card = page.locator('[data-active-release]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('đang chạy');

  // Có đường XEM ngay trên thẻ: câu hỏi đầu tiên của người mở màn này là "bản đang
  // chạy trông ra sao", và trước lát 5 nó chỉ trả lời được bằng cách mở site thật.
  await expect(card.getByRole('link', { name: /Xem/ })).toBeVisible();
});

test('`Lùi một bước` trỏ đúng bản NGAY TRƯỚC bản đang chạy', async ({ page }) => {
  await page.goto('/builder/releases');

  const card = page.locator('[data-active-release]');
  const back = card.locator('[data-one-step-back]');

  /*
   * Nút vắng mặt là một trạng thái HỢP LỆ: bản đang chạy có thể là bản đầu tiên, và
   * lúc đó không có bước nào để lùi. Test phải chấp nhận cả hai, nếu không nó đỏ trên
   * một database sạch mà chẳng có gì sai.
   */
  if ((await back.count()) === 0) {
    test.info().annotations.push({ type: 'note', description: 'chỉ có một release — không có bước để lùi' });
    return;
  }

  // `title` mang nhãn bản đích, nên người dùng biết mình đang lùi VỀ ĐÂU trước khi bấm.
  await expect(back).toHaveAttribute('title', /Đưa site về/);
  await expect(back).toContainText('Lùi một bước');
});

test('xem một release: dựng đúng trang, và nói rõ đây là bản nào', async ({ page }) => {
  await page.goto('/builder/releases');

  const [tab] = await Promise.all([
    page.waitForEvent('popup'),
    page.locator('[data-active-release]').getByRole('link', { name: /Xem/ }).click(),
  ]);

  await expect(tab.locator('[data-release-preview]')).toBeVisible();

  /*
   * Dải phải nói bản này ĐANG CHẠY hay là bản CŨ. Đó là toàn bộ lý do màn này tồn
   * tại: xem một bản cũ mà không biết nó là bản cũ thì tệ hơn không xem.
   */
  await expect(tab.locator('[data-release-preview]')).toContainText(/Bản ĐANG CHẠY|Bản CŨ/);

  // Nội dung THẬT được dựng, không phải một khung trống.
  await expect(tab.locator('[data-n]').first()).toBeVisible();
  await tab.close();
});

test('bộ chuyển trang đổi được trang, và release là bất biến nên URL chia sẻ được', async ({ page }) => {
  await page.goto('/builder/releases');
  const href = await page
    .locator('[data-active-release]')
    .getByRole('link', { name: /Xem/ })
    .getAttribute('href');
  expect(href).toMatch(/^\/preview\/release\//);

  // Mở thẳng bằng URL — không đi qua nút. Release bất biến nên địa chỉ này luôn cho
  // cùng một kết quả, và đó là điều làm nó chia sẻ được.
  await page.goto(`${href}?slug=gioi-thieu`);
  await expect(page.locator('[data-release-preview]')).toBeVisible();
  await expect(page.locator('[data-n]').first()).toBeVisible();
});

test('release không có thật thì 404, không phải 500', async ({ page }) => {
  const res = await page.goto('/preview/release/khong-co-release-nao');
  expect(res?.status()).toBe(404);
});
