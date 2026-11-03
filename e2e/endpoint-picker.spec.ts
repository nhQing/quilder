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

  // Bảng "Nơi nhận dữ liệu" ở Cài đặt: form hiện dưới khoá vừa chọn, với tên vừa đặt.
  await page.goto('/builder/settings');
  const row = page.locator('section[aria-labelledby="settings-endpoints"] [data-endpoint-row="e2e-hai"]');
  await expect(row).toContainText('Form liên hệ E2E');
  await expect(row.locator('[data-endpoint-url]')).toHaveText('https://example.com/hai');
});

/* ── Sửa URL ngay ở sidebar: dùng chung theo khoá, tách riêng, nơi nhận mới, phân quyền ── */

async function newPage(request: APIRequestContext, tag: string) {
  const slug = `e2e-ep-${tag}-${Date.now().toString(36)}`;
  const res = await request.post('/api/pages', { data: { title: `E2E endpoint ${tag}`, slug } });
  expect(res.ok(), await res.text()).toBe(true);
  return { id: (await res.json()).page.id as string, slug };
}

async function dropPage(request: APIRequestContext, pageId: string) {
  await request.delete(`/api/pages/${pageId}`);
  await request.delete(`/api/pages/${pageId}?purge=1`);
}

/** Chèn một Form với khoá cho trước (`''` = chưa có nơi nhận). */
async function addForm(request: APIRequestContext, pageId: string, id: string, endpointKey: string) {
  const { rootId } = await tool(request, 'get_page_outline', { pageId });
  const res = await request.post('/api/ops', {
    data: {
      pageId,
      label: 'e2e form nơi nhận',
      ops: [
        {
          op: 'insertNode', parentId: rootId, index: 0,
          node: {
            id, parentId: rootId, type: 'Composite', composite: 'Form',
            params: { endpointKey }, slots: {}, children: [], effects: [], style: { base: {} },
          },
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function endpointTable(request: APIRequestContext) {
  return (await (await request.get('/api/settings/endpoints')).json()).endpoints as Record<string, string>;
}

async function keyOf(request: APIRequestContext, pageId: string, id: string) {
  const { nodes } = await tool(request, 'get_node', { pageId, nodeIds: [id] });
  return (nodes[id] as { params: { endpointKey?: string } }).params.endpointKey;
}

test('admin: sửa URL cho cả khoá, Dùng URL riêng, Nơi nhận mới', async ({ page, request }) => {
  test.setTimeout(120_000);
  const original = await endpointTable(request);
  cleanup.push((r) => r.patch('/api/settings/endpoints', { data: { endpoints: original, force: true } }));
  const saved = await request.patch('/api/settings/endpoints', {
    data: { endpoints: { ...original, 'e2e-chung': 'https://example.com/chung' } },
  });
  expect(saved.ok(), await saved.text()).toBe(true);

  const a = await newPage(request, 'a');
  const b = await newPage(request, 'b');
  cleanup.push((r) => dropPage(r, a.id));
  cleanup.push((r) => dropPage(r, b.id));
  await addForm(request, a.id, 'e2eformA', 'e2e-chung');
  await addForm(request, b.id, 'e2eformB', 'e2e-chung');
  await addForm(request, a.id, 'e2enokey', '');

  // 1) Form A: thấy URL thật + "Dùng chung với 1 form: /b"; sửa URL → form B thấy URL mới.
  await page.goto(`/builder/${a.id}?node=e2eformA`);
  const picker = page.locator('[data-endpoint-picker]');
  await expect(picker).toBeVisible();
  const url = picker.getByLabel('URL nhận dữ liệu', { exact: true });
  await expect(url).toHaveValue('https://example.com/chung');
  await expect(picker.locator('[data-endpoint-shared]')).toContainText(`Dùng chung với 1 form: /${b.slug}`);
  await expect(picker).toContainText('Site thật đổi khi Publish.');

  await url.fill('http://example.com/moi');
  await expect(picker.locator('[data-endpoint-http]')).toBeVisible();
  await picker.getByRole('button', { name: 'Lưu URL' }).click();
  await expect.poll(async () => (await endpointTable(request))['e2e-chung']).toBe('http://example.com/moi');
  expect(await keyOf(request, b.id, 'e2eformB')).toBe('e2e-chung');

  // 2) Dùng URL riêng: A sang khoá mới (cùng URL), B giữ khoá cũ và URL cũ.
  await picker.getByRole('button', { name: 'Dùng URL riêng' }).click();
  await expect.poll(async () => await keyOf(request, a.id, 'e2eformA'), { timeout: 30_000 }).not.toBe('e2e-chung');
  const own = (await keyOf(request, a.id, 'e2eformA'))!;
  const table = await endpointTable(request);
  expect(table[own]).toBe('http://example.com/moi');
  expect(table['e2e-chung']).toBe('http://example.com/moi');
  expect(await keyOf(request, b.id, 'e2eformB')).toBe('e2e-chung');
  await expect(picker.locator('[data-endpoint-shared]')).toHaveCount(0);

  // 3) Form chưa có nơi nhận: "Nơi nhận mới" (tên + URL) gán khoá cho form.
  await page.goto(`/builder/${a.id}?node=e2enokey`);
  await expect(picker.getByLabel('Gửi tới', { exact: true })).toHaveValue('');
  await picker.getByRole('button', { name: 'Nơi nhận mới' }).click();
  await picker.getByLabel('Tên nơi nhận').fill('E2E nhận mới');
  await picker.getByLabel('URL nhận dữ liệu (nơi nhận mới)').fill('https://example.com/nhan-moi');
  await picker.getByRole('button', { name: 'Tạo nơi nhận' }).click();
  await expect.poll(async () => await keyOf(request, a.id, 'e2enokey'), { timeout: 30_000 }).toBe('e2e-nhan-moi');
  expect((await endpointTable(request))['e2e-nhan-moi']).toBe('https://example.com/nhan-moi');
  await expect(picker.getByLabel('URL nhận dữ liệu', { exact: true })).toHaveValue('https://example.com/nhan-moi');
});

test('editor: thấy URL chỉ đọc, vẫn chọn được nơi nhận có sẵn, API đặt URL trả 403', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const original = await endpointTable(request);
  cleanup.push((r) => r.patch('/api/settings/endpoints', { data: { endpoints: original, force: true } }));
  const saved = await request.patch('/api/settings/endpoints', {
    data: { endpoints: { ...original, 'e2e-ed-mot': 'https://example.com/ed-mot', 'e2e-ed-hai': 'https://example.com/ed-hai' } },
  });
  expect(saved.ok(), await saved.text()).toBe(true);

  const a = await newPage(request, 'ed');
  cleanup.push((r) => dropPage(r, a.id));
  await addForm(request, a.id, 'e2eformED', 'e2e-ed-mot');

  const email = `ep-editor-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'mat-khau-du-dai';
  const { user } = await (await request.post('/api/users', { data: { email, password, role: 'editor' } })).json();
  cleanup.push((r) => r.delete(`/api/users/${user.id}`));

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await ctx.newPage();
    await page.goto('/builder/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.waitForURL('**/builder');

    await page.goto(`/builder/${a.id}?node=e2eformED`);
    const picker = page.locator('[data-endpoint-picker]');
    await expect(picker).toBeVisible();
    await expect(picker.getByLabel('URL nhận dữ liệu', { exact: true })).toHaveCount(0);
    await expect(picker.locator('[data-endpoint-url]')).toHaveText('https://example.com/ed-mot');
    await expect(picker).toContainText('Chỉ admin đổi được URL nhận');
    await expect(picker.getByRole('button', { name: 'Nơi nhận mới' })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Lưu URL' })).toHaveCount(0);

    // Vẫn chọn được một nơi nhận ĐÃ CÓ.
    await picker.getByLabel('Gửi tới', { exact: true }).selectOption('e2e-ed-hai');
    await expect.poll(async () => await keyOf(request, a.id, 'e2eformED'), { timeout: 30_000 }).toBe('e2e-ed-hai');

    // Ẩn nút không phải là cổng — API tự từ chối.
    const denied = await page.request.post('/api/settings/endpoints', {
      data: { action: 'setUrl', key: 'e2e-ed-mot', url: 'https://example.com/hack' },
    });
    expect(denied.status()).toBe(403);
    expect((await endpointTable(request))['e2e-ed-mot']).toBe('https://example.com/ed-mot');
  } finally {
    await ctx.close();
  }
});
