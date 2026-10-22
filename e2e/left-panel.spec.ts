import { expect, test, type Page } from '@playwright/test';

/**
 * Pane trái — accordion dọc và thu gọn pane.
 *
 * Hợp đồng với người dùng:
 *  - bốn mục xếp dọc, mở một lúc MỘT, và đóng hết là trạng thái hợp lệ
 *  - mục đang mở được trọn chiều cao còn lại (lý do tồn tại của accordion này)
 *  - thu gọn pane thì canvas rộng thêm thật, và vẫn còn đường mở lại
 *  - lựa chọn sống qua F5
 *
 * Không test nào ở đây sửa nội dung, nên không cần `afterEach` dọn — nhưng chúng
 * ghi vào `localStorage`, nên mỗi test tự xoá trước khi bắt đầu. Bỏ bước đó thì
 * test sau kế thừa lựa chọn của test trước và thứ tự chạy thành một biến ẩn.
 */

const PAGE_SLUG = 'gioi-thieu';

async function openEditor(page: Page) {
  await page.goto('/builder');
  // Xoá lựa chọn đã lưu trước khi vào editor, để mỗi test bắt đầu từ mặc định.
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('link', { name: new RegExp(PAGE_SLUG) }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
}

const header = (page: Page, name: RegExp) =>
  page.locator('aside').first().getByRole('button', { name });

const paneWidth = (page: Page) =>
  page.locator('aside').first().evaluate((el) => Math.round(el.getBoundingClientRect().width));

test.describe('pane trái — accordion dọc', () => {
  test('bốn mục xếp dọc, mặc định mở Lớp', async ({ page }) => {
    await openEditor(page);

    // Cả bốn tiêu đề nhìn thấy CÙNG LÚC — đó là thứ tab ngang không cho.
    await expect(header(page, /Lớp/)).toBeVisible();
    await expect(header(page, /^Comp/)).toBeVisible();
    await expect(header(page, /^Ảnh/)).toBeVisible();
    await expect(header(page, /Trang/)).toBeVisible();

    await expect(header(page, /Lớp/)).toHaveAttribute('aria-expanded', 'true');
    await expect(header(page, /^Comp/)).toHaveAttribute('aria-expanded', 'false');
    await expect(header(page, /^Ảnh/)).toHaveAttribute('aria-expanded', 'false');
    await expect(header(page, /Trang/)).toHaveAttribute('aria-expanded', 'false');

    // Ô tìm của cây chỉ tồn tại khi mục Lớp đang mở.
    await expect(page.getByPlaceholder(/Tìm phần tử/)).toBeVisible();
  });

  test('mở một mục thì mục đang mở đóng lại', async ({ page }) => {
    await openEditor(page);

    await header(page, /^Comp/).click();
    await expect(header(page, /^Comp/)).toHaveAttribute('aria-expanded', 'true');
    await expect(header(page, /Lớp/)).toHaveAttribute('aria-expanded', 'false');
    // Nội dung của mục đã đóng phải rời khỏi DOM, không chỉ bị ẩn: để lại thì
    // ô tìm vẫn bắt được phím và Tab vẫn đi qua nó.
    await expect(page.getByPlaceholder(/Tìm phần tử/)).toHaveCount(0);
  });

  test('bấm lại mục đang mở thì đóng hết — và đó là trạng thái hợp lệ', async ({ page }) => {
    await openEditor(page);

    await header(page, /Lớp/).click();
    for (const name of [/Lớp/, /^Comp/, /^Ảnh/, /Trang/]) {
      await expect(header(page, name)).toHaveAttribute('aria-expanded', 'false');
    }
    // Bốn tiêu đề vẫn còn đó, pane thành một mục lục bốn dòng.
    await expect(header(page, /Trang/)).toBeVisible();
  });

  test('mục đang mở được trọn chiều cao còn lại', async ({ page }) => {
    await openEditor(page);

    // Đây là lý do accordion này mở một lúc một. Nếu mục mở KHÔNG co giãn thì
    // cây 4 node cũng như cây 158 node — và pane 240px lại thành "mỗi nửa 8 hàng".
    const openHeight = await page
      .locator('#left-section-layers')
      .evaluate((el) => el.getBoundingClientRect().height);
    const paneHeight = await page
      .locator('aside')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);

    // Trừ ra năm hàng chrome: nút thu gọn + bốn tiêu đề. Ngưỡng lỏng, vì con số
    // chính xác phụ thuộc thang cỡ chữ — thứ đang được test ở chỗ khác.
    expect(openHeight).toBeGreaterThan(paneHeight * 0.7);
  });
});

test.describe('pane trái — thu gọn', () => {
  test('thu gọn thì canvas rộng thêm, và vẫn mở lại được', async ({ page }) => {
    await openEditor(page);
    const wide = await paneWidth(page);

    await page.getByRole('button', { name: 'Thu gọn pane trái' }).click();
    const narrow = await paneWidth(page);
    expect(narrow).toBeLessThan(wide / 2);

    // KHÔNG được biến mất hẳn: mất pane là mất luôn chỗ bấm để mở lại.
    expect(narrow).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Mở lại pane trái' })).toBeVisible();

    await page.getByRole('button', { name: 'Mở lại pane trái' }).click();
    expect(await paneWidth(page)).toBe(wide);
  });

  test('bấm nhãn ở dải thì MỞ pane và mở đúng mục đó', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Thu gọn pane trái' }).click();

    await header(page, /^Comp/).click();

    // Một cú bấm, hai kết quả: pane mở ra và mục Component đang mở. Chọn mục mà
    // không mở pane là một cú bấm không có kết quả nhìn thấy được.
    await expect(page.getByRole('button', { name: 'Thu gọn pane trái' })).toBeVisible();
    await expect(header(page, /^Comp/)).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('pane trái — nhớ lựa chọn', () => {
  test('mục đang mở và trạng thái thu gọn sống qua F5', async ({ page }) => {
    await openEditor(page);

    await header(page, /Trang/).click();
    await page.reload();
    await expect(header(page, /Trang/)).toHaveAttribute('aria-expanded', 'true');
    await expect(header(page, /Lớp/)).toHaveAttribute('aria-expanded', 'false');

    await page.getByRole('button', { name: 'Thu gọn pane trái' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Mở lại pane trái' })).toBeVisible();
  });

  test('giá trị đã lưu không còn hợp lệ thì rơi về mặc định, không mở mục rỗng', async ({
    page,
  }) => {
    await openEditor(page);

    // Mô phỏng một giá trị cũ: mục đã bị đổi tên, hoặc ai đó ghi tay vào.
    await page.evaluate(() => localStorage.setItem('mm.builder.left.section', 'routes'));
    await page.reload();

    // Rơi về mặc định là Lớp, chứ không phải đóng hết cũng không phải pane trống.
    await expect(header(page, /Lớp/)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByPlaceholder(/Tìm phần tử/)).toBeVisible();
  });
});
