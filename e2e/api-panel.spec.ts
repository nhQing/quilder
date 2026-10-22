import { expect, test } from '@playwright/test';

/**
 * Khu "API công khai" dưới bảng entry.
 *
 * Thứ khu này bán là SỰ CHÍNH XÁC, nên phép kiểm chịu lực không phải "có hiện chữ
 * không" mà là: **URL hiện trên màn hình gọi được thật**, và **thứ vào bộ nhớ tạm
 * đúng bằng thứ hiển thị**. Một khu API mà in ra URL 404 còn tệ hơn không có khu nào
 * — người dùng sẽ đi tìm lỗi ở app của họ.
 *
 * Loại `news` là loại có sẵn từ seed, không phải loại spec này tạo ra: khu API đọc
 * danh mục và bài THẬT của loại, nên kiểm nó trên một loại rỗng do test dựng lên sẽ
 * bỏ qua đúng những nhánh đáng kiểm.
 */

const TYPE_KEY = 'news';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('URL hiện ra có scheme, đúng endpoint, và gọi được thật', async ({ page, request }) => {
  await page.goto(`/builder/content/${TYPE_KEY}`);

  const panel = page.locator('details', { hasText: 'API công khai' });
  await expect(panel).toBeVisible();
  await panel.locator('summary').click();

  const row = page.locator('[data-api-row="list"]');
  const shown = (await row.locator('code').innerText()).replace(/^GET\s+/, '').trim();

  // Có scheme: `Site.primaryDomain` lưu host trần, và dán một host trần vào client
  // thì nó thành đường dẫn tương đối.
  expect(shown).toMatch(/^https?:\/\//);
  expect(shown).toContain(`/api/public/v1/${TYPE_KEY}?pageSize=20`);

  /*
   * Gọi bằng PATH, không bằng cả URL tuyệt đối.
   *
   * Tên miền trong Cài đặt có thể trỏ tới cổng khác cổng dev đang chạy — đó là cấu
   * hình của site, không phải lỗi của URL. Phần spec này chịu trách nhiệm là đường
   * dẫn và tham số; phần scheme/host đã bị khoá bởi `api-urls.test.ts`.
   */
  const u = new URL(shown);
  const res = await request.get(u.pathname + u.search);
  expect(res.ok(), await res.text()).toBeTruthy();

  const json = (await res.json()) as { data?: unknown; meta?: { pageSize?: number } };
  expect(Array.isArray(json.data)).toBeTruthy();
  expect(json.meta?.pageSize).toBe(20);
});

test('Copy đặt vào bộ nhớ tạm ĐÚNG chuỗi đang hiển thị', async ({ page }) => {
  await page.goto(`/builder/content/${TYPE_KEY}`);
  await page.locator('details', { hasText: 'API công khai' }).locator('summary').click();

  const row = page.locator('[data-api-row="list"]');
  const shown = (await row.locator('code').innerText()).replace(/^GET\s+/, '').trim();

  await row.getByRole('button', { name: 'Copy' }).click();
  await expect(row.getByRole('button', { name: 'đã copy' })).toBeVisible();

  // Nếu hai thứ này lệch nhau thì người dùng dán ra một URL khác thứ họ vừa đọc — sai
  // lệch không có triệu chứng nào cho tới lúc gọi.
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(shown);
});
