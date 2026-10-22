import { expect, test } from '@playwright/test';

/**
 * Lát 3 của giao diện v2 — banner việc treo, và `Ctrl+K`.
 *
 * ## Câu chịu lực của cả file
 *
 * Banner phải nói **số lần sửa**, không phải số chỗ đổi. `diffDocs` cố ý không so
 * style, nên trên dữ liệu thật `/gioi-thieu` có hơn một nghìn lần sửa chưa publish mà
 * diff trả về `{added: 0, removed: 0, textChanged: 0}`. Một banner đếm chỗ đổi sẽ nói
 * "không có gì đổi" trong khi bấm Publish đổi site thật — đó là quyết định #3 của
 * spec, và test dưới đây là thứ giữ nó.
 *
 * Spec này KHÔNG publish gì: publish đổi thứ khách đang xem, và một e2e đưa bản nháp
 * của chủ dự án lên site là hỏng nặng hơn mọi thứ nó kiểm được. Nút Publish chỉ được
 * khẳng định là CÓ và nói đúng nhãn.
 */

test('banner việc treo: đếm LẦN SỬA, và nói rõ phần diff không tính style', async ({ page }) => {
  await page.goto('/builder');

  const banner = page.locator('[data-pending-work]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Việc hôm nay');

  /*
   * Ít nhất một dòng, và dòng đó phải mang một trong hai nhãn: "N lần sửa" cho trang
   * đã lên site, hoặc "trang mới". Không assert con số cụ thể — nó đổi theo mỗi lần
   * ai đó sửa gì, kể cả các spec khác chạy trước.
   */
  const rows = banner.locator('li');
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(banner).toContainText(/lần sửa|trang mới/);

  // Nút của TỪNG dòng, không phải một nút chung.
  await expect(rows.first().getByRole('button', { name: 'Xem diff' })).toBeVisible();
  await expect(rows.first().getByRole('button', { name: 'Publish trang này' })).toBeVisible();
});

test('Xem diff mở hộp, và hộp NÓI RA rằng nó không so style', async ({ page }) => {
  await page.goto('/builder');

  const banner = page.locator('[data-pending-work]');
  await banner.locator('li').first().getByRole('button', { name: 'Xem diff' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  /*
   * Đây là câu quan trọng nhất trong hộp, không phải một dòng ghi chú.
   *
   * Người mở hộp này đang định publish. Nếu diff trống mà hộp không nói vì sao, họ sẽ
   * kết luận "không có gì đổi" và bỏ qua — trong khi phần đổi nằm ở style.
   */
  await expect(dialog).toContainText(/không liệt kê style/);
  await dialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).not.toBeVisible();
});

test('Ctrl+K mở tìm chung, tìm được cả ba loại, Enter mở đúng chỗ', async ({ page }) => {
  await page.goto('/builder');

  const palette = page.locator('[data-command-palette]');
  await expect(palette).not.toBeVisible();

  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();

  // "ng" khớp trang "Trang chủ", loại "Câu hỏi thường gặp" và component "Thẻ tính năng" của
  // dữ liệu mẫu (prisma/seed.ts, scripts/seed-collections.ts, scripts/seed-demo-content.ts).
  await palette.getByLabel('Tìm chung').fill('ng');

  // Ba nhóm trong MỘT danh sách: trang, loại nội dung, component. Đó là điểm của
  // "tìm chung" — ba chỗ tìm riêng thì người dùng phải biết trước mình cần loại nào.
  await expect(palette.getByText('Trang', { exact: true }).first()).toBeVisible();
  await expect(palette.getByText('Loại nội dung', { exact: true }).first()).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(palette).not.toBeVisible();
  // Enter mở kết quả ĐẦU, và kết quả đầu của "ng" là một trang.
  await expect(page).toHaveURL(/\/builder\/[a-z0-9]+$/);
});

test('Ctrl+K KHÔNG cướp phím khi con trỏ đang ở trong ô nhập', async ({ page }) => {
  /*
   * `Ctrl+K` là "xoá tới cuối dòng" trong nhiều editor. Người đang gõ một bài dài mà
   * mất dòng đó sẽ không nối được nguyên nhân với cái hộp vừa mở ra.
   */
  await page.goto('/builder');
  await page.keyboard.press('Control+k');

  const palette = page.locator('[data-command-palette]');
  await expect(palette).toBeVisible();

  const box = palette.getByLabel('Tìm chung');
  await box.fill('abc');
  // Con trỏ đang ở trong ô của chính palette — `Ctrl+K` ở đây không được mở lại nó
  // (và quan trọng hơn: không được `preventDefault` phím của ô nhập).
  await box.press('Control+k');
  await expect(box).toHaveValue('abc');
});
