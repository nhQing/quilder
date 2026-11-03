import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Mục "Nơi nhận dữ liệu" ở màn Cài đặt — bảng CHỈ XEM: URL, cảnh báo http, form/biểu đồ đang
 * dùng từng nơi nhận (link Mở vào editor, chọn sẵn node), và nút Xoá cho nơi nhận không ai dùng.
 *
 * Sửa URL / tách / đổi tên đã chuyển sang Inspector (xem endpoint-picker.spec.ts). Phần API
 * (xoá bị chặn khi còn form dùng, đổi tên khoá, lưu bảng biến không xoá URL) giữ nguyên.
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

async function endpoints(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.get('/api/settings/endpoints');
  expect(res.ok()).toBe(true);
  return (await res.json()).endpoints;
}

const formNode = (id: string, parentId: string, key: string, name?: string) => ({
  id, parentId, type: 'Composite', composite: 'Form', ...(name ? { name } : {}),
  params: { endpointKey: key }, slots: {}, children: [], effects: [], style: { base: {} },
});

/**
 * Form trỏ khoá `e2e-hook` trên /gioi-thieu (kèm form thêm nếu cần), và nhớ trả bảng
 * endpoint về bản cũ. `table` = các khoá đặt thêm vào bảng trước khi test chạy.
 */
async function setup(
  request: APIRequestContext,
  opts: { extra?: (rootId: string) => object[]; table?: Record<string, string> } = {},
) {
  const original = await endpoints(request);
  cleanup.push((r) => r.patch('/api/settings/endpoints', { data: { endpoints: original, force: true } }));
  if (opts.table) {
    const res = await request.patch('/api/settings/endpoints', { data: { endpoints: { ...original, ...opts.table } } });
    expect(res.ok(), await res.text()).toBe(true);
  }

  const { pages } = await tool(request, 'list_pages', {});
  const page = (pages as { id: string; path: string }[]).find((p) => p.path === '/gioi-thieu')!;
  const { rootId } = await tool(request, 'get_page_outline', { pageId: page.id });
  const nodes = [formNode('e2eendpointform', rootId, 'e2e-hook'), ...(opts.extra?.(rootId) ?? [])];
  const res = await request.post('/api/ops', {
    data: {
      pageId: page.id,
      label: 'e2e endpoint form',
      ops: nodes.map((node) => ({ op: 'insertNode', parentId: rootId, index: 0, node })),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  cleanup.push((r) =>
    r.post('/api/ops', {
      data: {
        pageId: page.id,
        label: 'e2e dọn',
        ops: nodes.map((n) => ({ op: 'removeNode', nodeId: (n as { id: string }).id })),
      },
    }),
  );
  return { pageId: page.id as string, original };
}

async function nodeOf(request: APIRequestContext, pageId: string, id: string) {
  const { nodes } = await tool(request, 'get_node', { pageId, nodeIds: [id] });
  return nodes[id] as { name?: string | null; params: { endpointKey: string } };
}

const misconfig = '<code>e2e-hook</code>';

const sectionOf = (page: Page) => page.locator('section[aria-labelledby="settings-endpoints"]');

test('form dùng khoá chưa có URL: dòng hiện "chưa có URL", link Mở chọn sẵn node', async ({ page, request }) => {
  const { pageId } = await setup(request);
  expect(await (await request.get(`/render/${pageId}`)).text()).toContain(misconfig);

  await page.goto('/builder/settings');
  const section = sectionOf(page);
  await expect(section.getByRole('heading', { name: /^Nơi nhận dữ liệu/ }).first()).toBeVisible();

  const row = section.locator('[data-endpoint-row="e2e-hook"]');
  await expect(row).toContainText('chưa có URL');
  await expect(row).toContainText('trang /gioi-thieu');
  await expect(row.getByRole('link', { name: 'Mở' })).toHaveAttribute('href', `/builder/${pageId}?node=e2eendpointform`);
  // Nơi nhận có form dùng: không xoá được.
  await expect(row.getByRole('button', { name: /^Xoá/ })).toHaveCount(0);
});

test('chỉ xem: không còn ô nhập URL, nút Đổi tên hay Tách URL; URL và cảnh báo http hiện ra', async ({ page, request }) => {
  await setup(request, { table: { 'e2e-hook': 'http://example.com/e2e-hook' } });
  await page.goto('/builder/settings');
  const section = sectionOf(page);
  const row = section.locator('[data-endpoint-row="e2e-hook"]');

  await expect(row.locator('[data-endpoint-url]')).toHaveText('http://example.com/e2e-hook');
  await expect(row).toContainText('http — trình duyệt sẽ chặn');
  await expect(row).not.toContainText('chưa có URL');

  await expect(section.locator('input')).toHaveCount(0);
  await expect(section.getByRole('button', { name: /Đổi tên|Tách URL|Lưu URL/ })).toHaveCount(0);
});

test('hai form dùng chung một nơi nhận: cùng một dòng, mỗi form một link Mở', async ({ page, request }) => {
  const { pageId } = await setup(request, {
    table: { 'e2e-hook': 'https://example.com/chung' },
    extra: (rootId) => [formNode('e2eendpointform2', rootId, 'e2e-hook', 'E2E form hai')],
  });
  await page.goto('/builder/settings');
  const row = sectionOf(page).locator('[data-endpoint-row="e2e-hook"]');
  await expect(row.locator('[data-endpoint-forms] > li')).toHaveCount(2);
  await expect(row).toContainText('E2E form hai');
  await expect(row.locator('a[href$="?node=e2eendpointform2"]')).toHaveAttribute('href', `/builder/${pageId}?node=e2eendpointform2`);
});

test('nút "Mở" đưa vào editor và chọn sẵn form đó', async ({ page, request }) => {
  const { pageId } = await setup(request);
  await page.goto('/builder/settings');
  const row = sectionOf(page).locator('[data-endpoint-row="e2e-hook"]');

  // Điều hướng PHÍA CLIENT (next/link), không tải lại trang. Lỗi 13/10/2026: đường này
  // ra editor trống — Strict Mode dọn effect một lượt, `reset()` xoá node vừa chọn, và
  // một chốt ref chặn lượt chọn lại. Tải thẳng URL thì không lộ ra.
  await row.getByRole('link', { name: 'Mở' }).click();
  await expect(page).toHaveURL(new RegExp(`/builder/${pageId}$`));
  await expect(page.locator('[data-node-name]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-endpoint-picker]')).toBeVisible();
});

test('nơi nhận không ai dùng: vẫn liệt kê, có nút Xoá (admin), xoá xong mất khỏi bảng', async ({ page, request }) => {
  await setup(request, { table: { 'e2e-thua': 'https://example.com/thua' } });
  await page.goto('/builder/settings');
  const row = sectionOf(page).locator('[data-endpoint-row="e2e-thua"]');
  await expect(row).toContainText('https://example.com/thua');
  await row.getByRole('button', { name: 'Xoá nơi nhận e2e-thua' }).click();
  await row.getByRole('button', { name: 'Xoá thật' }).click();
  await expect(sectionOf(page).locator('[data-endpoint-row="e2e-thua"]')).toHaveCount(0);
  expect((await endpoints(request))['e2e-thua']).toBeUndefined();
});

test('API: xoá URL đang có form dùng bị chặn nếu không ép', async ({ request }) => {
  await setup(request, { table: { 'e2e-hook': 'https://example.com/e2e-hook' } });
  const res = await request.post('/api/settings/endpoints', { data: { action: 'removeKey', key: 'e2e-hook' } });
  expect(res.status()).toBe(409);
  expect((await endpoints(request))['e2e-hook']).toBe('https://example.com/e2e-hook');
});

test('API: đổi tên khoá chuyển mọi form dùng nó sang khoá mới', async ({ request }) => {
  const { pageId, original } = await setup(request, { table: { 'e2e-hook': 'https://example.com/e2e-hook' } });
  const res = await request.patch('/api/settings/endpoints', {
    data: { endpoints: { ...original, 'e2e-hook-moi': 'https://example.com/e2e-hook' }, renames: { 'e2e-hook': 'e2e-hook-moi' } },
  });
  expect(res.ok(), await res.text()).toBe(true);
  expect((await res.json()).moved).toBe(1);
  expect((await nodeOf(request, pageId, 'e2eendpointform')).params.endpointKey).toBe('e2e-hook-moi');
  expect((await endpoints(request))['e2e-hook']).toBeUndefined();
});

test('lưu bảng biến KHÔNG xoá URL của form', async ({ request }) => {
  await setup(request, { table: { 'e2e-hook': 'https://example.com/giu-lai' } });

  // Đúng thứ bảng biến gửi: `globals` KHÔNG có khoá `endpoint`.
  const site = await tool(request, 'list_site_globals', {});
  const plain = Object.fromEntries(
    (site.globals as { key: string; value: unknown }[])
      .filter((g) => g.key !== 'endpoint')
      .map((g) => [g.key, g.value]),
  );
  const saved = await request.patch('/api/settings', { data: { globals: plain } });
  expect(saved.ok(), await saved.text()).toBe(true);

  expect((await endpoints(request))['e2e-hook']).toBe('https://example.com/giu-lai');
});
