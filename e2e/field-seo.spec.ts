import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Field `seo` — đường ghi qua HTTP, màn cấu trúc, và khối SEO trong form bài.
 *
 * Phần render (metadata, JSON-LD, sitemap) có test đơn vị ở `src/lib/render/entry-meta.test.ts`
 * và `src/lib/render/sitemap-entries.test.ts`: dựng trang chi tiết đã publish trong e2e là
 * publish một release, đúng thứ `collection-render.spec.ts` giải thích vì sao không làm.
 */

const KEY = 'seo-thu';

async function purgeType(request: APIRequestContext): Promise<void> {
  const list = await request.get(`/api/collections/${KEY}/entries`);
  if (list.ok()) {
    const { entries } = (await list.json()) as { entries?: { id: string }[] };
    for (const e of entries ?? []) {
      await request.delete(`/api/collections/entries/${e.id}`);
      await request.delete(`/api/collections/entries/${e.id}?purge=1`);
    }
  }
  await request.delete(`/api/collections/types/${KEY}`);
}

const SCHEMA = [
  { t: 'text', key: 'title', label: 'Tiêu đề' },
  { t: 'text', key: 'excerpt', label: 'Sapo', multiline: true },
  { t: 'seo', key: 'seo', label: 'SEO' },
];

let entryId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  await purgeType(request);
  const created = await request.post('/api/collections/types', {
    data: { key: KEY, name: 'SEO thử', namePlural: 'SEO thử' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const patched = await request.patch(`/api/collections/types/${KEY}`, { data: { schema: SCHEMA, titleField: 'title' } });
  expect(patched.ok(), await patched.text()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await purgeType(request);
});

test('đường ghi: một field SEO mỗi loại, trần độ dài và canonical khác domain bị từ chối bằng tiếng Việt', async ({ request }) => {
  const two = await request.patch(`/api/collections/types/${KEY}`, {
    data: { schema: [...SCHEMA, { t: 'seo', key: 'seo2', label: 'SEO 2' }] },
  });
  expect(two.status()).toBe(400);
  expect((await two.json()).error).toContain('Một loại nội dung chỉ có một field SEO');

  const long = await request.post(`/api/collections/${KEY}/entries`, {
    data: { data: { title: 'A', seo: { metaTitle: 'x'.repeat(121) } } },
  });
  expect(long.ok()).toBe(false);
  expect((await long.json()).error).toBe('seo.metaTitle: Tiêu đề SEO dài quá 120 ký tự (đang có 121)');

  const evil = await request.post(`/api/collections/${KEY}/entries`, {
    data: { data: { title: 'A', seo: { canonicalUrl: '//evil.com/x' } } },
  });
  expect(evil.ok()).toBe(false);
  expect((await evil.json()).error).toContain('seo.canonicalUrl: Đường dẫn chuẩn phải');

  const ok = await request.post(`/api/collections/${KEY}/entries`, {
    data: { data: { title: 'Lãi suất tháng 8', excerpt: 'Sapo của bài', seo: {} } },
  });
  expect(ok.ok(), await ok.text()).toBe(true);
  entryId = ((await ok.json()) as { entry: { id: string } }).entry.id;
});

test('màn cấu trúc: nút kiểu SEO mờ khi loại đã có field SEO', async ({ page }) => {
  await page.goto(`/builder/content/types/${KEY}`);
  await page.getByRole('button', { name: 'Thêm field' }).click();
  const picker = page.getByRole('group', { name: 'Chọn kiểu field' });
  await expect(picker.getByRole('button', { name: 'seo', exact: true })).toBeDisabled();
});

test('form bài: khối SEO thu gọn, placeholder là giá trị rơi về, đếm ký tự, lưu được', async ({ page }) => {
  test.slow();
  await page.goto(`/builder/content/${KEY}/${entryId}`);

  const summary = page.locator('summary', { hasText: 'SEO' }).first();
  await expect(summary).toContainText('Đang dùng giá trị tự động');
  await summary.click();

  const title = page.getByLabel('Tiêu đề trên Google');
  // Placeholder là đúng cái Google sẽ thấy nếu để trống: tiêu đề bài.
  await expect(title).toHaveAttribute('placeholder', 'Lãi suất tháng 8');
  await expect(page.getByLabel('Mô tả trên Google')).toHaveAttribute('placeholder', 'Sapo của bài');

  await title.fill('Lãi suất tiết kiệm tháng 8/2026 tại các ngân hàng lớn — cập nhật mới');
  await expect(page.getByText('Google thường cắt tiêu đề sau khoảng 60 ký tự.')).toBeVisible();
  await expect(page.getByLabel('Xem trước trên Google')).toContainText('Lãi suất tiết kiệm tháng 8/2026');

  // Chờ ĐÚNG lượt PATCH, không chờ nút tắt: nút cũng tắt trong lúc đang gửi, nên
  // `toBeDisabled` qua ngay và `reload()` cắt ngang request.
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/collections/entries/${entryId}`) && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Lưu nháp' }).click();
  const res = await saved;
  expect(res.ok(), await res.text()).toBe(true);

  await page.reload();
  const again = page.locator('summary', { hasText: 'SEO' }).first();
  await expect(again).toContainText('Đã đặt riêng: tiêu đề');
  await again.click();
  await expect(page.getByLabel('Tiêu đề trên Google')).toHaveValue(
    'Lãi suất tiết kiệm tháng 8/2026 tại các ngân hàng lớn — cập nhật mới',
  );
});

test('tab ngôn ngữ phụ: JSON-LD của bản gốc KHÔNG hiện (và không bị ghi) sang bản dịch', async ({ page, request }) => {
  test.slow();
  const created = await request.post(`/api/collections/${KEY}/entries`, {
    data: { data: { title: 'Có JSON-LD', seo: { structuredData: { '@type': 'FAQPage', name: 'VI' } } } },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { entry: { id: string } }).entry.id;

  await page.goto(`/builder/content/${KEY}/${id}`);
  const tabs = page.locator('[data-locale]:not([data-locale="base"])');
  test.skip((await tabs.count()) === 0, 'DB chưa bật ngôn ngữ nào ngoài ngôn ngữ mặc định');

  // Mở ô JSON-LD ở BẢN GỐC trước — đúng thứ tự làm cùng một ô bị giữ lại khi đổi tab.
  await page.locator('summary', { hasText: 'SEO' }).first().click();
  await page.locator('summary', { hasText: 'Nâng cao' }).click();
  await expect(page.getByLabel('Dữ liệu có cấu trúc (JSON-LD)')).toHaveValue(/FAQPage/);

  await tabs.first().click();
  await expect(page.getByLabel('Dữ liệu có cấu trúc (JSON-LD)')).toHaveValue('');
});
