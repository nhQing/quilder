import { expect, test } from '@playwright/test';

/**
 * Trang Cài đặt chung.
 *
 * Mục "Nền tảng" (sửa 12 token, có lịch sử và nút Khôi phục) và bảng tra "Toàn bộ
 * biến" đã gỡ ngày 13/10/2026 — lý do ở `src/lib/design/foundations.ts`. Các test
 * sửa màu và tra biến của chúng đi cùng.
 */
test.describe('cài đặt chung', () => {
  test('trả lời được ngôn ngữ mặc định', async ({ page }) => {
    await page.goto('/builder/settings');

    // Ngôn ngữ mặc định phải nêu rõ là mặc định — hai ngôn ngữ cùng "đang bật"
    // mà không nói cái nào không có tiền tố URL là không trả lời được gì.
    const vi = page.getByRole('listitem').filter({ hasText: 'Tiếng Việt' });
    await expect(vi).toContainText('mặc định');
  });

  test('không còn mục Nền tảng, và API sửa token đã đóng', async ({ page, request }) => {
    await page.goto('/builder/settings');
    await expect(page.getByRole('heading', { name: 'Cài đặt chung' })).toBeVisible();
    await expect(page.locator('#settings-foundations')).toHaveCount(0);
    await expect(page.locator('#settings-token-history')).toHaveCount(0);
    await expect(page.locator('#settings-all-tokens')).toHaveCount(0);
    await expect(page.getByLabel('Chọn Màu nhấn')).toHaveCount(0);

    // Không còn handler `PATCH`: Next trả 405 cho phương thức route không khai.
    // Id không cần có thật — route chưa từng đọc tới DB.
    const res = await request.patch('/api/design-tokens/khong-ton-tai', { data: { value: '#123456' } });
    expect(res.status()).toBe(405);
  });

  test('phân biệt được hai chế độ lưu trên cùng một trang', async ({ page }) => {
    await page.goto('/builder/settings');

    /*
     * Trang này có hai hợp đồng khác nhau đứng cạnh nhau, và đó là thứ dễ hiểu
     * nhầm nhất ở đây: favicon ăn ngay vào site thật, còn `globals` thì chờ Publish.
     * Banner phải nói CẢ HAI — nói một nửa còn tệ hơn không nói, vì người dùng sẽ
     * mang câu đó sang chỗ nó sai.
     */
    /*
     * `locator('p')` chứ không `getByText`: cụm "hai chế độ lưu" nằm trong một
     * `<strong>` bên trong đoạn văn, và `getByText` trả về phần tử NHỎ NHẤT khớp —
     * tức là đúng cái `<strong>` đó, rồi mọi assert về phần còn lại của câu đều
     * trượt. Cần cả câu thì phải bám vào cả câu.
     */
    const banner = page.locator('p').filter({ hasText: /hai chế độ lưu/ }).first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/ngay trên site thật/);
    await expect(banner).toContainText(/Publish/);
  });

  test('trang chủ có đường tới đây', async ({ page }) => {
    await page.goto('/builder');
    await page.getByRole('link', { name: /Xem tất cả cài đặt/ }).click();
    await expect(page.getByRole('heading', { name: 'Cài đặt chung' })).toBeVisible();
  });
});


/**
 * Favicon: dialog giữa màn, hai tab.
 *
 * Không chọn ảnh thật trong test — chọn là ghi vào `Site` và test phải tự dọn một
 * thứ chỉ đổi được ở một chỗ. Thứ đáng khoá ở đây là hình dạng của dialog và luật
 * lọc theo kiểu ảnh, vì đó là chỗ lỗi cũ nằm: chọn được JPEG rồi mới ăn từ chối.
 */
test.describe('favicon', () => {
  test('mở dialog, có hai tab, và lưới chỉ hiện PNG/SVG', async ({ page }) => {
    await page.goto('/builder/settings');

    /*
     * Nhãn là "Chọn favicon", không phải "Chọn ảnh".
     *
     * `AssetPickerBox` dựng chữ trên nút từ chính prop `label` (`Chọn ${label}` /
     * `Đổi ${label}`), và chỗ gọi ở đây truyền `label="favicon"`. Selector cũ nhắm
     * "ảnh" — chữ mặc định của component — nên nó đỏ từ khi màn Cài đặt chuyển sang
     * dùng chung bộ chọn asset (`c1ac69e`).
     *
     * Vẫn neo cả hai đầu: nút này phải nói rõ nó chọn CÁI GÌ. Một regex lỏng như
     * /Chọn/ sẽ khớp cả "Chọn tệp" trong tab Tải lên của dialog.
     */
    // `.first()`: ô favicon của SITE; ô thứ hai (Nhận diện builder) cùng tên nút.
    await page.getByRole('button', { name: /^(Chọn|Đổi) favicon$/ }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Kho ảnh' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Tải lên' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Tải lên' }).click();
    await expect(dialog.getByText(/Chỉ nhận PNG hoặc SVG/)).toBeVisible();

    // Esc phải đóng được: đó là hành vi có sẵn của `<dialog>` và là lý do dùng thẻ
    // thật thay vì một div fixed.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});

/**
 * Khối "Biến của site".
 *
 * Bản trước hỏng layout vì `w-full` trong class dùng chung thắng `w-40`: ô giá trị
 * bị ép còn vài pixel và nút ✕ trào ra ngoài viền. Khoá bằng hình học thật, không
 * khoá bằng tên class — class đổi là chuyện thường, còn ô giá trị bị bóp thì không.
 */
test.describe('biến của site', () => {
  test('ô giá trị đủ rộng và nút xoá nằm trong viền', async ({ page }) => {
    await page.goto('/builder/settings');

    const row = page.getByRole('listitem').filter({ has: page.getByLabel('Khoá 1') });
    const value = row.getByLabel(/^Giá trị 1/);
    const del = row.getByRole('button', { name: /^Xoá khoá/ });

    const vBox = (await value.boundingBox())!;
    const dBox = (await del.boundingBox())!;
    const rBox = (await row.boundingBox())!;

    expect(vBox.width).toBeGreaterThan(120);
    expect(dBox.x + dBox.width).toBeLessThanOrEqual(rBox.x + rBox.width + 1);
  });
});

test.describe('cài đặt — ngôn ngữ', () => {
  test('thêm ngôn ngữ ở trạng thái tắt, bật, tắt, rồi xoá', async ({ page, request }) => {
    // Dọn lượt chạy trước bị ngắt giữa chừng.
    await request.delete('/api/settings/locales/ja');

    await page.goto('/builder/settings');
    await page.getByRole('button', { name: 'Thêm ngôn ngữ' }).click();
    await page.getByLabel('Mã', { exact: true }).fill('ja');
    // Chọn mã có trong gợi ý thì tên tự điền.
    await expect(page.getByLabel('Tên hiển thị')).toHaveValue('日本語');
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();

    const row = page.locator('[data-locale="ja"]');
    const toggle = row.getByRole('switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect(page.getByRole('dialog')).toContainText('Publish');
    await page.getByRole('button', { name: 'Bật', exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect((await request.get('/ja')).status()).toBe(200);

    await toggle.click();
    await page.getByRole('button', { name: 'Tắt', exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await row.getByRole('button', { name: 'Xoá 日本語' }).click();
    await page.getByRole('button', { name: 'Xoá', exact: true }).click();
    await expect(row).toHaveCount(0);
  });

  test('mã sai và ngôn ngữ mặc định bị từ chối ở API', async ({ request }) => {
    expect((await request.post('/api/settings/locales', { data: { code: 'API', label: 'x' } })).status()).toBe(400);
    expect((await request.post('/api/settings/locales', { data: { code: 'api', label: 'x' } })).status()).toBe(400);
    expect((await request.delete('/api/settings/locales/vi')).status()).toBe(400);
    expect((await request.patch('/api/settings/locales/vi', { data: { enabled: false } })).status()).toBe(400);
  });
});

test.describe('cài đặt — nút Lưu', () => {
  test('nút Lưu khối SEO chỉ sáng khi có thay đổi, và nút chọn giao diện không xuống dòng', async ({ page }) => {
    await page.goto('/builder/settings');
    const section = page.getByRole('region', { name: 'Giao diện, tên miền & SEO' });
    const save = section.getByRole('button', { name: 'Lưu', exact: true });
    await expect(save).toBeDisabled();

    const desc = section.getByLabel('Mô tả mặc định');
    const before = await desc.inputValue();
    await desc.fill(`${before} x`);
    await expect(save).toBeEnabled();
    await desc.fill(before);
    await expect(save).toBeDisabled();

    // Một dòng = đúng chiều cao h-7 (28px).
    const box = await section.locator('[data-site-theme="system"]').boundingBox();
    expect(box?.height).toBeLessThanOrEqual(28);
  });
});
