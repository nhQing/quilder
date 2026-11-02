import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Xoá hẳn một trang từ tab Lưu trữ: thẻ phải biến mất NGAY, không cần tải lại trang.
 *
 * Lỗi 02/11/2026: bấm "Xoá hẳn", gõ đường dẫn, xác nhận — server đã xoá, nhưng thẻ vẫn
 * đứng đó tới khi F5.
 */

async function archivedPage(request: APIRequestContext, slug: string): Promise<string> {
  const res = await request.post('/api/pages', { data: { title: `E2E ${slug}`, slug } });
  expect(res.ok(), await res.text()).toBe(true);
  const id = (await res.json()).page.id as string;
  expect((await request.delete(`/api/pages/${id}`)).ok()).toBe(true);
  return id;
}

test('xoá hẳn trang lưu trữ thì thẻ biến mất không cần tải lại', async ({ page, request }) => {
  const run = Date.now().toString(36);
  // Hai trang: trang còn lại giữ tab Lưu trữ đứng nguyên, như khi lưu trữ có nhiều trang.
  const slug = `e2e-purge-${run}`;
  const ids = [await archivedPage(request, slug), await archivedPage(request, `e2e-purge-con-${run}`)];
  try {
    await page.goto('/builder');
    await page.getByRole('group', { name: 'Lọc theo trạng thái' }).getByRole('button', { name: /Lưu trữ/ }).click();
    const card = page.locator('article').filter({ hasText: `/${slug}` });
    const other = page.locator('article').filter({ hasText: `/e2e-purge-con-${run}` });
    await expect(card).toBeVisible();

    // Làm chậm lượt `router.refresh()` (request RSC) như trên server thật, nơi dựng lại cả
    // màn Trang mất vài giây. Dev local nhanh nên lỗi không lộ nếu thiếu dòng này.
    await page.route('**/builder**', async (route) => {
      if (route.request().headers()['rsc']) await new Promise((r) => setTimeout(r, 5000));
      await route.continue();
    });

    await card.getByRole('button', { name: 'Xoá hẳn' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill(slug);
    await dialog.getByRole('button', { name: 'Xoá hẳn' }).click();

    await expect(dialog).toBeHidden();
    // Ngắn hơn độ trễ ở trên: thẻ phải đi ngay khi server xoá xong, không chờ lượt nạp lại.
    await expect(card).toHaveCount(0, { timeout: 2000 });
    await expect(other).toBeVisible();
  } finally {
    for (const id of ids) await request.delete(`/api/pages/${id}?purge=1`).catch(() => undefined);
  }
});

test('lưu trữ một trang thì thẻ rời danh sách ngay, không chờ tải lại', async ({ page, request }) => {
  const slug = `e2e-archive-${Date.now().toString(36)}`;
  const res = await request.post('/api/pages', { data: { title: `E2E ${slug}`, slug } });
  expect(res.ok(), await res.text()).toBe(true);
  const id = (await res.json()).page.id as string;
  try {
    await page.goto('/builder');
    const card = page.locator('article').filter({ hasText: `/${slug}` });
    await expect(card).toBeVisible();

    await page.route('**/builder**', async (route) => {
      if (route.request().headers()['rsc']) await new Promise((r) => setTimeout(r, 5000));
      await route.continue();
    });

    await page.getByRole('button', { name: `Tuỳ chọn cho E2E ${slug}`, exact: true }).click();
    await page.getByRole('menuitem', { name: /Lưu trữ/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Lưu trữ trang' }).click();

    await expect(card).toHaveCount(0, { timeout: 2000 });
  } finally {
    await request.delete(`/api/pages/${id}`).catch(() => undefined);
    await request.delete(`/api/pages/${id}?purge=1`).catch(() => undefined);
  }
});
