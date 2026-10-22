import { expect, test } from '@playwright/test';

/**
 * Cài đặt › Tên miền & SEO: robots.txt tự soạn, luật sitemap, template tiêu đề.
 *
 * Mỗi test TRẢ LẠI trạng thái cũ trong `finally` — đây là cấu hình live của site
 * (không qua Publish), nên để sót là mọi spec chạy sau đọc một robots.txt hay một
 * `<title>` khác.
 */

const reset = (request: import('@playwright/test').APIRequestContext) =>
  request.patch('/api/settings/seo', {
    data: { robotsTxt: null, seoTitleTemplate: '', seoDescription: '', sitemapRules: { include: [], exclude: [] } },
  });

test.describe('Tên miền & SEO', () => {
  test.afterEach(async ({ request }) => {
    expect((await reset(request)).ok()).toBeTruthy();
  });

  test('robots tự soạn ra site ngay, Về mặc định trả lại nội dung tự sinh', async ({ page, request }) => {
    await page.goto('/builder/settings');
    await page.locator('#seo-robots-custom').check();
    const auto = await page.locator('#seo-robots').inputValue();
    expect(auto).toContain('Disallow: /builder');

    await page.locator('#seo-robots').fill(`${auto}\nUser-agent: GPTBot\nDisallow: /\n`);
    await page.getByRole('button', { name: 'Lưu', exact: true }).last().click();
    await expect(page.getByText('đã lưu')).toBeVisible();
    expect(await (await request.get('/robots.txt')).text()).toContain('User-agent: GPTBot');

    await page.getByRole('button', { name: 'Về mặc định' }).click();
    await expect(page.locator('#seo-robots')).toHaveValue(auto);
  });

  test('chặn cả site phải xác nhận', async ({ page, request }) => {
    await page.goto('/builder/settings');
    await page.locator('#seo-robots-custom').check();
    await page.locator('#seo-robots').fill('User-agent: *\nDisallow: /\n');
    await page.getByRole('button', { name: 'Lưu', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'robots.txt có cảnh báo' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('cả site');
    // Huỷ thì KHÔNG ghi gì.
    await dialog.getByRole('button', { name: 'Huỷ' }).click();
    expect(await (await request.get('/robots.txt')).text()).not.toContain('Disallow: /\n\n');
  });

  test('loại tiền tố khỏi sitemap', async ({ request }) => {
    const before = await (await request.get('/sitemap.xml')).text();
    const urls = [...before.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    const victim = urls.find((p) => p !== '/' && p.split('/').length === 2);
    test.skip(!victim, 'sitemap không có trang một đoạn nào để loại');

    const res = await request.patch('/api/settings/seo', { data: { sitemapRules: { include: ['/them-tay-e2e'], exclude: [victim] } } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const after = await (await request.get('/sitemap.xml')).text();
    expect(after).not.toMatch(new RegExp(`<loc>[^<]*${victim}</loc>`));
    expect(after).toContain('/them-tay-e2e</loc>');
  });

  test('template tiêu đề bọc <title> của trang', async ({ request }) => {
    const res = await request.patch('/api/settings/seo', { data: { seoTitleTemplate: '%s · E2E' } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const html = await (await request.get('/')).text();
    expect(html).toMatch(/<title>[^<]* · E2E<\/title>/);
  });
});
