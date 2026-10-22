import { expect, test } from '@playwright/test';

/**
 * Trang 404 HỆ THỐNG (`Page.system = 'not-found'`, có từ 20/10/2026).
 *
 * Stack e2e chạy `scripts/ensure-defaults.ts` sau khi seed (cùng bước với bootstrap
 * prod), nên trang này luôn có — ở dạng NHÁP nếu DB nguồn chưa từng có nó. Spec này
 * KHÔNG publish: `/api/publish` đẩy mọi bản nháp lên cùng lúc và làm bẩn spec khác
 * (HANDOFF §3.1). Phần "sửa rồi publish thì 404 đổi theo" do `PublishedPageView` dùng
 * chung với catch-all, và đã được thử tay trên một DB trống.
 */

test.describe('trang 404 hệ thống', () => {
  test('đường dẫn không tồn tại và chính /404 đều trả status 404', async ({ request }) => {
    expect((await request.get('/khong-co-trang-nay-e2e')).status()).toBe(404);
    // Mở thẳng slug của trang hệ thống KHÔNG được ra 200 — đó là một trang lỗi mà
    // Google sẽ index như trang thật.
    expect((await request.get('/404')).status()).toBe(404);
  });

  test('thẻ trang có nhãn "Trang hệ thống" và menu không có Lưu trữ', async ({ page }) => {
    await page.goto('/builder');
    const card = page.locator('article').filter({ hasText: 'Trang hệ thống' });
    await expect(card).toHaveCount(1);

    await card.getByRole('button', { name: /^Tuỳ chọn cho / }).click();
    await expect(page.getByRole('menuitem', { name: 'Đổi tên' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Lưu trữ' })).toHaveCount(0);
  });

  test('API từ chối lưu trữ và đổi đường dẫn trang hệ thống', async ({ page, request }) => {
    await page.goto('/builder');
    const card = page.locator('article').filter({ hasText: 'Trang hệ thống' });
    const href = await card.locator('a[href^="/builder/"]').first().getAttribute('href');
    const id = href!.split('/').filter(Boolean).at(-1)!;

    const del = await request.delete(`/api/pages/${id}`);
    expect(del.status()).toBe(409);
    expect((await del.json()).error).toContain('trang hệ thống');

    const rename = await request.patch(`/api/pages/${id}`, { data: { slug: 'loi-404-moi' } });
    expect(rename.status()).toBe(409);
  });
});
