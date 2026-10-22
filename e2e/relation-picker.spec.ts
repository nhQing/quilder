import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Bộ chọn field `relation` ("Tin liên quan") không bày hết entry nữa: chỉ vài gợi ý, gõ để
 * tìm, bài đã chọn hiện tên kể cả khi nằm ngoài gợi ý. Lỗi gốc 21/10/2026: loại có hàng
 * nghìn bài thì ô này kéo dài vô tận.
 */

const TYPE_KEY = 'e2e-lien-quan';

async function purge(request: APIRequestContext): Promise<void> {
  const list = await request.get(`/api/collections/${TYPE_KEY}/entries`);
  if (list.ok()) {
    const { entries } = (await list.json()) as { entries?: { id: string }[] };
    for (const e of entries ?? []) {
      await request.delete(`/api/collections/entries/${e.id}`);
      await request.delete(`/api/collections/entries/${e.id}?purge=1`);
    }
  }
  await request.delete(`/api/collections/types/${TYPE_KEY}`);
}

const ids: Record<string, string> = {};

test.beforeAll(async ({ request }) => {
  await purge(request);
  expect((await request.post('/api/collections/types', { data: { key: TYPE_KEY, name: 'Bài liên quan', namePlural: 'Bài liên quan' } })).ok()).toBe(true);
  const patched = await request.patch(`/api/collections/types/${TYPE_KEY}`, {
    data: {
      titleField: 'title',
      schema: [
        { t: 'text', key: 'title', label: 'Tiêu đề', required: true, maxLength: 200 },
        { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
        { t: 'relation', key: 'lienquan', label: 'Liên quan', typeKey: TYPE_KEY, cardinality: 'many' },
      ],
    },
  });
  expect(patched.ok(), await patched.text()).toBe(true);
  // Tạo "Bài cũ nhất" TRƯỚC: nó là bài sửa xa nhất, nên không nằm trong gợi ý mặc định.
  for (const title of ['Bài cũ nhất', ...Array.from({ length: 12 }, (_, i) => `Bài số ${i + 1}`), 'Bài chính']) {
    const r = await request.post(`/api/collections/${TYPE_KEY}/entries`, { data: { data: { title } } });
    expect(r.ok(), await r.text()).toBe(true);
    ids[title] = ((await r.json()) as { entry: { id: string } }).entry.id;
  }
});

test.afterAll(async ({ request }) => {
  await purge(request);
});

test('chỉ vài gợi ý, gõ để tìm, chọn rồi bỏ được', async ({ page }) => {
  await page.goto(`/builder/content/${TYPE_KEY}/${ids['Bài chính']}`);
  const picker = page.locator(`[data-relation-field="${TYPE_KEY}"]`).first();
  const suggestions = picker.getByRole('list', { name: 'Gợi ý' }).getByRole('button');

  await expect(suggestions.first()).toBeVisible();
  expect(await suggestions.count()).toBeLessThanOrEqual(8);
  await expect(picker.getByRole('button', { name: 'Bài cũ nhất' })).toHaveCount(0);

  await picker.getByRole('searchbox').fill('Bài cũ nhất');
  await picker.getByRole('button', { name: 'Bài cũ nhất' }).click();
  const chosen = picker.getByRole('list', { name: 'Đã chọn' });
  await expect(chosen).toContainText('Bài cũ nhất');

  await chosen.getByRole('button', { name: 'Bỏ Bài cũ nhất' }).click();
  await expect(picker.getByRole('list', { name: 'Đã chọn' })).toHaveCount(0);
});

test('bài đã chọn nằm ngoài gợi ý vẫn hiện tên', async ({ page, request }) => {
  const saved = await request.patch(`/api/collections/entries/${ids['Bài chính']}`, {
    data: { data: { title: 'Bài chính', lienquan: [ids['Bài cũ nhất']] } },
  });
  expect(saved.ok(), await saved.text()).toBe(true);

  await page.goto(`/builder/content/${TYPE_KEY}/${ids['Bài chính']}`);
  const picker = page.locator(`[data-relation-field="${TYPE_KEY}"]`).first();
  await expect(picker.getByRole('list', { name: 'Đã chọn' })).toContainText('Bài cũ nhất');
});
