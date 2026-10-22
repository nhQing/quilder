import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Ô "Form" ở màn Cài đặt — mỗi form một box: tên, URL nhận dữ liệu, các nút của nó.
 *
 * Trước ô này, `Site.globals.endpoint` chỉ hiện dạng JSON khoá lại trong bảng biến:
 * builder tạo được form mà không có chỗ nào đặt URL nhận. Bản đầu của ô bày bảng KHOÁ →
 * URL và người dùng đọc không hiểu, nên ô lấy FORM làm gốc. Những điều phải giữ:
 *  - form chưa có URL thì box nói ra (form đang tắt);
 *  - lưu URL thì bản nháp (canvas, /preview) dùng ngay, không phải chờ Publish;
 *  - hai form dùng chung URL thì box nói rõ hậu quả, và tách riêng được;
 *  - đổi tên form ngay trong box;
 *  - lưu bảng biến bên cạnh KHÔNG được xoá mất URL của form.
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

test('form chưa có URL: box nói ra, nhập URL, lưu — bản nháp dùng ngay', async ({ page, request }) => {
  const { pageId } = await setup(request);
  expect(await (await request.get(`/render/${pageId}`)).text()).toContain(misconfig);

  await page.goto('/builder/settings');
  const section = page.locator('section[aria-labelledby="settings-endpoints"]');
  await expect(section.getByRole('heading', { name: /^Form/ }).first()).toBeVisible();

  const box = section.locator('[data-form-box="e2eendpointform"]');
  await expect(box).toContainText('form đang tắt');
  await expect(box).toContainText('trang /gioi-thieu');
  await expect(box.getByRole('link', { name: 'Mở' })).toHaveAttribute('href', `/builder/${pageId}?node=e2eendpointform`);
  await expect(box.getByRole('button', { name: 'Lưu URL' })).toBeDisabled();

  await box.getByLabel('URL nhận dữ liệu').fill('https://example.com/e2e-hook');
  await box.getByRole('button', { name: 'Lưu URL' }).click();
  await expect(section.locator('[data-form-box="e2eendpointform"]')).toContainText('đã lưu URL');
  await expect(section.locator('[data-form-box="e2eendpointform"]')).not.toContainText('form đang tắt');

  expect((await endpoints(request))['e2e-hook']).toBe('https://example.com/e2e-hook');

  // Canvas và /preview là bản NHÁP: đọc globals live, không chờ Publish.
  const canvas = await (await request.get(`/render/${pageId}`)).text();
  expect(canvas).not.toContain(misconfig);
  expect(canvas).toContain('https://example.com/e2e-hook');
});

test('nút "Mở" của một form đưa vào editor và chọn sẵn form đó', async ({ page, request }) => {
  const { pageId } = await setup(request);
  await page.goto('/builder/settings');
  const box = page.locator('[data-form-box="e2eendpointform"]');

  // Điều hướng PHÍA CLIENT (next/link), không tải lại trang. Lỗi 13/10/2026: đường này
  // ra editor trống — Strict Mode dọn effect một lượt, `reset()` xoá node vừa chọn, và
  // một chốt ref chặn lượt chọn lại. Tải thẳng URL thì không lộ ra.
  await box.getByRole('link', { name: 'Mở' }).click();
  await expect(page).toHaveURL(new RegExp(`/builder/${pageId}$`));
  await expect(page.locator('[data-node-name]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-endpoint-picker]')).toBeVisible();
});

test('URL sai bị từ chối, không lưu', async ({ page, request }) => {
  await setup(request);
  await page.goto('/builder/settings');
  const box = page.locator('[data-form-box="e2eendpointform"]');
  await box.getByLabel('URL nhận dữ liệu').fill('javascript:alert(1)');
  await box.getByRole('button', { name: 'Lưu URL' }).click();
  await expect(box.getByRole('alert')).toContainText('https://');
  expect((await endpoints(request))['e2e-hook']).toBeUndefined();
});

test('hai form dùng chung URL: box nói rõ, và tách riêng được', async ({ page, request }) => {
  const { pageId } = await setup(request, {
    table: { 'e2e-hook': 'https://example.com/chung' },
    extra: (rootId) => [formNode('e2eendpointform2', rootId, 'e2e-hook', 'E2E form hai')],
  });

  await page.goto('/builder/settings');
  const two = page.locator('[data-form-box="e2eendpointform2"]');
  await expect(two.locator('[data-form-shared]')).toContainText('Sửa URL ở đây là sửa cho cả 2 form');

  await two.getByRole('button', { name: 'Tách URL riêng cho form này' }).click();
  await expect(page.locator('[data-form-box="e2eendpointform2"]')).toContainText('đã tách URL riêng');
  await expect(page.locator('[data-form-box="e2eendpointform2"] [data-form-shared]')).toHaveCount(0);

  // Form hai có khoá RIÊNG đặt theo tên, cùng URL; form một giữ nguyên.
  const moved = await nodeOf(request, pageId, 'e2eendpointform2');
  expect(moved.params.endpointKey).toBe('e2e-form-hai');
  expect((await nodeOf(request, pageId, 'e2eendpointform')).params.endpointKey).toBe('e2e-hook');
  const table = await endpoints(request);
  expect(table['e2e-form-hai']).toBe('https://example.com/chung');
  expect(table['e2e-hook']).toBe('https://example.com/chung');
});

test('đổi tên form ngay trong box', async ({ page, request }) => {
  const { pageId } = await setup(request);
  await page.goto('/builder/settings');
  const box = page.locator('[data-form-box="e2eendpointform"]');
  await box.getByRole('button', { name: 'Đổi tên form' }).click();
  await box.getByLabel('Tên form').fill('Form E2E mới');
  await box.getByRole('button', { name: 'Lưu tên' }).click();

  await expect(page.locator('[data-form-box="e2eendpointform"] h3')).toHaveText('Form E2E mới');
  expect((await nodeOf(request, pageId, 'e2eendpointform')).name).toBe('Form E2E mới');
});

test('URL không form nào dùng: liệt kê riêng và xoá được', async ({ page, request }) => {
  await setup(request, { table: { 'e2e-thua': 'https://example.com/thua' } });
  await page.goto('/builder/settings');
  const row = page.locator('[data-endpoint-orphan="e2e-thua"]');
  await row.getByRole('button', { name: 'Xoá URL e2e-thua' }).click();
  await row.getByRole('button', { name: 'Xoá thật' }).click();
  await expect(page.locator('[data-endpoint-orphan="e2e-thua"]')).toHaveCount(0);
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
