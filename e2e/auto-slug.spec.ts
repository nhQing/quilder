import { expect, test } from '@playwright/test';

/**
 * Đường dẫn tự sinh từ tiêu đề.
 *
 * Bốn form có ô slug và tất cả dùng chung `autoSlugState`. Luật thuần đã khoá
 * bằng unit test; ở đây khoá phần mà unit test không với tới được: ô nào ghi vào
 * ô nào, và nút "Tạo lại" có hiện đúng lúc không.
 *
 * Test KHÔNG tạo trang thật: `NewPageForm` submit là ghi vào database và test
 * phải đi dọn một trang. Thứ đáng kiểm nằm hết ở phía trước nút Tạo.
 */
test.describe('slug tự sinh', () => {
  test('trang mới: gõ tiêu đề là đường dẫn chạy theo', async ({ page }) => {
    await page.goto('/builder');
    await page.getByRole('button', { name: /Trang mới/ }).first().click();

    const title = page.getByPlaceholder('Về chúng tôi');
    const slug = page.getByPlaceholder('ve-chung-toi');

    await title.fill('Lãi suất tháng 8');
    // Bỏ dấu, bỏ đ, gạch nối — đúng `toSlug`, không phải một bản chép gần đúng.
    await expect(slug).toHaveValue('lai-suat-thang-8');

    await title.fill('Điều khoản sử dụng');
    await expect(slug).toHaveValue('dieu-khoan-su-dung');
  });

  test('gõ tay vào ô đường dẫn thì tiêu đề thôi giành ô đó', async ({ page }) => {
    await page.goto('/builder');
    await page.getByRole('button', { name: /Trang mới/ }).first().click();

    const title = page.getByPlaceholder('Về chúng tôi');
    const slug = page.getByPlaceholder('ve-chung-toi');

    await title.fill('Tin tức');
    await slug.fill('bang-tin');
    await title.fill('Thông báo mới');

    // Đây là điểm mấu chốt: slug là địa chỉ, và người dùng vừa tự đặt nó.
    await expect(slug).toHaveValue('bang-tin');

    // Lệch rồi thì ĐỀ NGHỊ, không tự đổi.
    const regen = page.getByRole('button', { name: /Tạo lại từ tiêu đề/ });
    await expect(regen).toBeVisible();
    await regen.click();
    await expect(slug).toHaveValue('thong-bao-moi');
  });

  test('đổi tên trang đã có: chỉ đề nghị khi tiêu đề đã lệch', async ({ page }) => {
    await page.goto('/builder');
    // "Đổi tên" nằm trong menu "…" của thẻ trang: mở menu của thẻ đầu tiên trước.
    await page.getByRole('button', { name: /^Tuỳ chọn cho / }).first().click();
    await page.getByRole('menuitem', { name: 'Đổi tên' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    /*
     * Trang đã tồn tại thì KHÔNG bao giờ ở chế độ auto: địa chỉ của nó có thể đang
     * nằm trong link người khác gửi nhau. Mở dialog ra mà chưa sửa gì thì không có
     * đề nghị nào cả.
     */
    await expect(dialog.getByRole('button', { name: /Tạo lại từ tiêu đề/ })).toHaveCount(0);

    await dialog.getByRole('textbox').first().fill('Một tiêu đề hoàn toàn khác');
    await expect(dialog.getByRole('button', { name: /Tạo lại từ tiêu đề/ })).toBeVisible();

    // Đóng bằng Esc: không lưu gì, không phải dọn gì.
    await page.keyboard.press('Escape');
  });
});
