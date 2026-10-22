import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Nút "Trang mới" trên danh sách trang.
 *
 * ## Vì sao đường này cần một spec riêng
 *
 * Tới 27/08/2026, đường tạo trang duy nhất nằm trong dock của trình sửa — tức chỉ
 * dùng được KHI ĐANG MỞ MỘT TRANG. Site chưa có trang nào thì không mở được gì, nên
 * giao diện không có đường tạo trang đầu tiên, và trạng thái rỗng chỉ người dùng
 * chạy `pnpm db:seed`: một lệnh cần mã nguồn, không chạy được trên bản đã deploy.
 *
 * Đây là màn hình một bản triển khai mới hiện ra ĐẦU TIÊN. Nó đáng có test.
 *
 * ## Vì sao KHÔNG test nhánh tạo thành công
 *
 * Không có đường xoá trang qua HTTP — chủ ý của Đợt 2, vì xoá là việc một chiều của
 * người. Nên một e2e tạo trang thật sẽ để lại một trang VĨNH VIỄN mà lần publish
 * tiếp theo đưa lên site thật, và `users.spec.ts` trong bộ này có publish. Một test
 * để lại dữ liệu vĩnh viễn tệ hơn là không có test — xem HANDOFF §3.25 và docblock
 * cùng chủ đề trong `agent-tools.spec.ts`.
 *
 * Nên spec này đi HẾT đường dây bằng một slug đã tồn tại: nút → dialog → form →
 * POST /api/pages → lỗi hiện trong dialog. Mọi mắt nối đều được chạm, và không ghi
 * một byte nào.
 */

async function tool(request: APIRequestContext, name: string, input: unknown) {
  const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
  const { result } = await res.json();
  return result;
}

test.describe('nút Trang mới', () => {
  test('mở dialog từ danh sách trang, và Tạo trang khoá khi chưa có tiêu đề', async ({ page }) => {
    await page.goto('/builder');

    const open = page.getByRole('button', { name: 'Trang mới' });
    await expect(open).toBeVisible();
    await open.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    /*
     * Nút khoá khi tiêu đề rỗng là hợp đồng, không phải trang trí: `validateNewPage`
     * từ chối tiêu đề rỗng ở server, và một nút bấm được để nhận về lỗi 400 là bắt
     * người dùng phát hiện luật bằng cách vi phạm nó.
     */
    const submit = dialog.getByRole('button', { name: 'Tạo trang' });
    await expect(submit).toBeDisabled();

    await dialog.getByPlaceholder('Về chúng tôi').fill('Trang thử');
    await expect(submit).toBeEnabled();

    // Đóng bằng Esc — `<dialog>` thật cho sẵn hành vi này, và spec khoá nó lại.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('slug đã tồn tại thì lỗi hiện trong dialog, và không tạo thêm trang', async ({
    page,
    request,
  }) => {
    // `list_pages` trả `path` ("/", "/gioi-thieu"), không phải `slug` — khác nhau một
    // dấu gạch chéo, và form nhận slug.
    const before = await tool(request, 'list_pages', {});
    const pages = before.pages as { path: string }[];
    const path = pages.find((p) => p.path !== '/')?.path;
    expect(path, 'cần ít nhất một trang không phải trang chủ để thử').toBeTruthy();
    const slug = path!.replace(/^\//, '');

    await page.goto('/builder');
    await page.getByRole('button', { name: 'Trang mới' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Về chúng tôi').fill('Trùng slug');
    await dialog.getByPlaceholder('ve-chung-toi').fill(slug);
    await dialog.getByRole('button', { name: 'Tạo trang' }).click();

    // Lỗi phải hiện TRONG dialog: người dùng đang nhìn vào đó, và một thông báo ở
    // chỗ khác là một thông báo không ai đọc.
    await expect(dialog).toContainText(/đã tồn tại/i);
    await expect(dialog).toBeVisible();

    // Và không có trang nào mọc thêm — đây là phần khiến spec này an toàn để chạy lại.
    const after = await tool(request, 'list_pages', {});
    expect((after.pages as unknown[]).length).toBe(pages.length);
  });
});
