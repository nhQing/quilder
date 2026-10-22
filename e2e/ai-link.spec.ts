import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * "Copy link cho AI": bấm một element → chép một dòng + link → dán vào chat với Claude →
 * `open_builder_link` (MCP) trả đúng node và cách sửa.
 *
 * Ba khâu phải khớp nhau, và mỗi khâu tự nó đều có thể "xanh" một mình mà chuỗi vẫn gãy:
 * nút chép đúng link, editor mở link chọn đúng node, tool đọc link trả đúng node. Nên
 * mỗi test đi trọn vòng: chép từ giao diện → mở lại link → hỏi tool.
 *
 * Dọn trong `afterEach` — `try/finally` không chạy khi test hết giờ.
 */

let cleanup: Array<(r: APIRequestContext) => Promise<unknown>> = [];

test.afterEach(async ({ request }) => {
  const jobs = cleanup;
  cleanup = [];
  for (const job of jobs) await job(request).catch(() => undefined);
});

async function tool(request: APIRequestContext, name: string, input: unknown) {
  const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
  expect(res.ok(), `tool ${name}: ${await res.text()}`).toBe(true);
  return (await res.json()).result;
}

async function aboutPage(request: APIRequestContext) {
  const { pages } = await tool(request, 'list_pages', {});
  const page = (pages as { id: string; path: string }[]).find((p) => p.path === '/gioi-thieu')!;
  const { rootId } = await tool(request, 'get_page_outline', { pageId: page.id });
  return { pageId: page.id as string, rootId: rootId as string };
}

async function insert(request: APIRequestContext, pageId: string, node: Record<string, unknown>) {
  const res = await request.post('/api/ops', {
    data: { pageId, label: 'e2e ai link', ops: [{ op: 'insertNode', parentId: node.parentId, index: 0, node }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  cleanup.push((r) =>
    r.post('/api/ops', {
      data: { pageId, label: 'e2e dọn', ops: [{ op: 'removeNode', nodeId: node.id }] },
    }),
  );
}

async function copyLink(page: Page): Promise<string> {
  const button = page.locator('[data-ai-link="copy"]').first();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('status')).toContainText(/Đã copy/);
  return page.evaluate(() => navigator.clipboard.readText());
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('node của trang: chép → mở lại link chọn đúng node → tool trả đúng node', async ({ page, request }) => {
  const { pageId, rootId } = await aboutPage(request);
  await insert(request, pageId, {
    id: 'e2eailink', parentId: rootId, type: 'Text', tag: 'p', name: 'Chữ link AI',
    children: [], effects: [], style: { base: {} },
    content: [{ t: 'text', v: 'CHỮ CHO LINK AI' }],
  });

  // Mở bằng link: editor chọn node rồi xoá tham số khỏi thanh địa chỉ.
  await page.goto(`/builder/${pageId}?node=e2eailink`);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/builder/${pageId}$`));

  const line = await copyLink(page);
  expect(line).toMatch(/^\[Quilder\] /);
  expect(line).toContain('Chữ link AI');
  expect(line).toContain(`/builder/${pageId}?node=e2eailink`);

  const result = await tool(request, 'open_builder_link', { url: line });
  expect(result.kind).toBe('page-node');
  expect(result.target.id).toBe('e2eailink');
  expect(JSON.stringify(result.target.node)).toContain('CHỮ CHO LINK AI');
  expect(JSON.stringify(result.howToEdit)).toContain('apply_ops');
});

test('phần tử trong instance: bấm trong canvas → link mang cn → tool nói rõ sửa riêng hay sửa mọi trang', async ({ page, request }) => {
  const made = await request.post('/api/presets', { data: { name: 'E2E Link AI' } });
  expect(made.ok()).toBe(true);
  const { preset } = await made.json();
  cleanup.push((r) => r.delete(`/api/presets/${preset.id}`));

  const { rootId: compRoot } = await tool(request, 'get_component', { componentId: preset.id });
  await request.post(`/api/presets/${preset.id}/ops`, {
    data: {
      ops: [
        {
          op: 'insertNode', parentId: compRoot, index: 0,
          node: {
            id: 'ai-title', parentId: compRoot, type: 'Text', tag: 'h2', name: 'tiêu đề link',
            children: [], effects: [], style: { base: {} },
            content: [{ t: 'text', v: 'CHỮ TRONG COMPONENT LINK' }],
          },
        },
      ],
    },
  });

  const { pageId, rootId } = await aboutPage(request);
  await insert(request, pageId, {
    id: 'e2eailinkinst', parentId: rootId, type: 'Instance', componentId: preset.id,
    name: 'Thẻ link AI', overrides: {}, children: [], effects: [], style: { base: {} },
  });

  await page.goto(`/builder/${pageId}`);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();

  // Bấm đúng chữ BÊN TRONG instance trên canvas.
  const frame = page.frameLocator('iframe').first();
  await frame.getByText('CHỮ TRONG COMPONENT LINK').click();
  await expect(page.locator('[data-ai-link="inner"]')).toContainText('tiêu đề link');

  const line = await copyLink(page);
  expect(line).toContain(`/builder/${pageId}?node=e2eailinkinst&cn=ai-title`);

  const result = await tool(request, 'open_builder_link', { url: line });
  expect(result.kind).toBe('instance-child');
  expect(result.target.id).toBe('ai-title');
  const how = JSON.stringify(result.howToEdit);
  expect(how).toContain('setOverride');
  expect(how).toContain('apply_component_ops');

  // Mở lại link: editor chọn instance VÀ nhớ phần tử bên trong.
  await page.goto(`/builder/${pageId}?node=e2eailinkinst&cn=ai-title`);
  await expect(page.locator('[data-ai-link="inner"]')).toContainText('tiêu đề link');
  await expect(page).toHaveURL(new RegExp(`/builder/${pageId}$`));
});

test('link tới node không còn: editor báo, không vỡ', async ({ page, request }) => {
  const { pageId } = await aboutPage(request);
  await page.goto(`/builder/${pageId}?node=khong-co-node-nay`);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await expect(page.getByText(/Không thấy element/)).toBeVisible();
});
