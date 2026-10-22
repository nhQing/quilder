import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Chọn đích gửi của form và đặt tên node — ngay trong Inspector.
 *
 * Trước 13/10/2026 không có hai thứ này trên giao diện: mọi form tạo trong editor gửi
 * tới khoá mặc định `newsletter`, và tên node chỉ đổi được qua MCP. Nhiều form cần nhiều
 * URL thì không làm được nếu không nhờ AI.
 *
 * Dọn trong `afterEach`: trả bảng endpoint và trang về như cũ.
 */

let cleanup: Array<(r: APIRequestContext) => Promise<unknown>> = [];

test.afterEach(async ({ request }) => {
  const jobs = cleanup.reverse();
  cleanup = [];
  for (const job of jobs) await job(request).catch(() => undefined);
});

async function tool(request: APIRequestContext, name: string, input: unknown) {
  const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
  expect(res.ok(), `tool ${name}: ${await res.text()}`).toBe(true);
  return (await res.json()).result;
}

async function formNode(request: APIRequestContext, pageId: string) {
  const { nodes } = await tool(request, 'get_node', { pageId, nodeIds: ['e2epickerform'] });
  return nodes.e2epickerform as { name?: string | null; params: { endpointKey?: string } };
}

test('chọn khoá cho form và đặt tên form trong Inspector', async ({ page, request }) => {
  const original = (await (await request.get('/api/settings/endpoints')).json()).endpoints;
  cleanup.push((r) => r.patch('/api/settings/endpoints', { data: { endpoints: original, force: true } }));
  const saved = await request.patch('/api/settings/endpoints', {
    data: {
      endpoints: { ...original, 'e2e-mot': 'https://example.com/mot', 'e2e-hai': 'https://example.com/hai' },
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);

  const { pages } = await tool(request, 'list_pages', {});
  const pageId = (pages as { id: string; path: string }[]).find((p) => p.path === '/gioi-thieu')!.id;
  const { rootId } = await tool(request, 'get_page_outline', { pageId });
  const made = await request.post('/api/ops', {
    data: {
      pageId,
      label: 'e2e endpoint picker',
      ops: [
        {
          op: 'insertNode', parentId: rootId, index: 0,
          node: {
            id: 'e2epickerform', parentId: rootId, type: 'Composite', composite: 'Form',
            params: { endpointKey: 'e2e-mot' }, slots: {}, children: [], effects: [], style: { base: {} },
          },
        },
      ],
    },
  });
  expect(made.ok(), await made.text()).toBe(true);
  cleanup.push((r) =>
    r.post('/api/ops', {
      data: { pageId, label: 'e2e dọn', ops: [{ op: 'removeNode', nodeId: 'e2epickerform' }] },
    }),
  );

  // Mở thẳng tại form (link dạng "Copy link cho AI" / nút "Mở" ở Cài đặt).
  await page.goto(`/builder/${pageId}?node=e2epickerform`);
  const picker = page.locator('[data-endpoint-picker]');
  await expect(picker).toBeVisible();

  const select = picker.getByLabel('Gửi tới');
  await expect(select).toHaveValue('e2e-mot');
  await select.selectOption('e2e-hai');
  await expect.poll(async () => (await formNode(request, pageId)).params.endpointKey).toBe('e2e-hai');

  const name = page.locator('[data-node-name]');
  await name.fill('Form liên hệ E2E');
  await name.press('Enter');
  await expect.poll(async () => (await formNode(request, pageId)).name).toBe('Form liên hệ E2E');

  // Box của form ở Cài đặt mang đúng tên vừa đặt, URL và khoá vừa chọn.
  await page.goto('/builder/settings');
  const box = page.locator('section[aria-labelledby="settings-endpoints"] [data-form-box="e2epickerform"]');
  await expect(box.locator('h3')).toHaveText('Form liên hệ E2E');
  await expect(box.getByLabel('URL nhận dữ liệu')).toHaveValue('https://example.com/hai');
  await expect(box).toContainText('khoá: e2e-hai');
});
