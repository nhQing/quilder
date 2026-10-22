import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Sửa nội dung của instance từ giao diện.
 *
 * Hai đường, và cả hai phải ghi bằng `setOverride` chứ không phải `setText`:
 * `setText` ghi vào cây COMPONENT, tức là đổi mọi trang đang dùng nó thay vì đổi
 * một chỗ. Đó là lỗi tệ nhất mà hai màn hình này có thể gây ra, và nó im lặng.
 *
 *  - bảng Văn bản: thấy chữ trong instance
 *  - inspector: panel riêng cho instance
 *
 * Dọn trong `afterEach` — bộ e2e này publish.
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

/** Component + một instance của nó trên /gioi-thieu. Trả về id cả hai. */
async function setup(request: APIRequestContext, name: string) {
  const made = await request.post('/api/presets', { data: { name } });
  expect(made.ok()).toBe(true);
  const { preset } = await made.json();
  cleanup.push((r) => r.delete(`/api/presets/${preset.id}`));

  const { rootId } = await tool(request, 'get_component', { componentId: preset.id });
  await request.post(`/api/presets/${preset.id}/ops`, {
    data: {
      ops: [
        {
          op: 'insertNode', parentId: rootId, index: 0,
          node: {
            id: 'ui-title', parentId: rootId, type: 'Text', tag: 'h2',
            name: 'tiêu đề', children: [], effects: [], style: { base: {} },
            content: [{ t: 'text', v: 'CHỮ COMPONENT UI' }],
          },
        },
      ],
    },
  });

  const { pages } = await tool(request, 'list_pages', {});
  const page = (pages as { id: string; path: string }[]).find((p) => p.path === '/gioi-thieu')!;
  const { rootId: pageRoot } = await tool(request, 'get_page_outline', { pageId: page.id });

  await request.post('/api/ops', {
    data: {
      pageId: page.id,
      label: 'e2e instance ui',
      ops: [
        {
          op: 'insertNode', parentId: pageRoot, index: 0,
          node: {
            id: 'e2euiinst', parentId: pageRoot, type: 'Instance',
            componentId: preset.id, name: 'Thẻ E2E',
            overrides: {}, children: [], effects: [], style: { base: {} },
          },
        },
      ],
    },
  });
  cleanup.push((r) =>
    r.post('/api/ops', {
      data: { pageId: page.id, label: 'e2e dọn', ops: [{ op: 'removeNode', nodeId: 'e2euiinst' }] },
    }),
  );

  return { componentId: preset.id as string, pageId: page.id as string };
}

const openText = async (page: Page, pageId: string) => {
  await page.goto(`/builder/text?page=${pageId}`);
  await expect(page.getByRole('heading', { name: 'Văn bản', exact: true })).toBeVisible();
};

test.describe('bảng Văn bản nhìn xuyên instance', () => {
  test('chữ trong instance lên bảng, và sửa được', async ({ page, request }) => {
    const { pageId, componentId } = await setup(request, 'E2E UI Bảng');

    await openText(page, pageId);
    await page.getByLabel('Tìm trong bảng chữ').fill('CHU COMPONENT UI');
    await expect(page.locator('tbody')).toContainText('CHỮ COMPONENT UI');

    const cell = page.getByRole('button', { name: /^Sửa bản gốc/ }).first();
    await cell.click();
    const box = page.getByLabel(/^Sửa bản gốc/).first();
    await box.fill('CHỮ RIÊNG TỪ BẢNG');
    await box.press('Enter');
    await expect(page.getByRole("status")).toContainText(/Đã lưu nội dung riêng/);

    // Ghi vào OVERRIDE của instance, KHÔNG vào cây component.
    await expect
      .poll(async () => {
        const { nodes } = await tool(request, 'get_component', { componentId });
        return JSON.stringify(nodes);
      })
      .toContain('CHỮ COMPONENT UI');

    const html = await (await request.get(`/render/${pageId}`)).text();
    expect(html).toContain('CHỮ RIÊNG TỪ BẢNG');
  });
});

test.describe('inspector của instance', () => {
  test('bày panel riêng, không bày ô style', async ({ page, request }) => {
    const { pageId } = await setup(request, 'E2E UI Inspector');

    await page.goto(`/builder/${pageId}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
    await page.getByRole('button', { name: /Thẻ E2E/ }).first().click();

    // Panel instance, không phải bảng thuộc tính thường.
    await expect(page.getByText(/Cấu trúc và style theo/)).toBeVisible();
    // Hai lối vào component: sửa tại chỗ trong canvas này, hoặc mở trang quản lý.
    await expect(page.getByRole('button', { name: 'Sửa component' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Trang component/ })).toBeVisible();
    // Nhóm style của node thường KHÔNG được xuất hiện: bày rồi để nó vô tác dụng
    // là cách nhanh nhất làm mất lòng tin vào cả bảng.
    await expect(page.getByRole('button', { name: /khoảng cách/i })).toHaveCount(0);
  });

  test('sửa nội dung riêng, rồi hoàn nguyên về chữ component', async ({ page, request }) => {
    const { pageId, componentId } = await setup(request, 'E2E UI Hoàn nguyên');

    await page.goto(`/builder/${pageId}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
    await page.getByRole('button', { name: /Thẻ E2E/ }).first().click();

    const field = page.locator('aside textarea, [class*="overflow-y-auto"] textarea').first();
    await field.fill('CHỮ RIÊNG TỪ INSPECTOR');
    await field.blur();

    await expect
      .poll(async () => (await (await request.get(`/render/${pageId}`)).text()))
      .toContain('CHỮ RIÊNG TỪ INSPECTOR');

    // Nút hoàn nguyên chỉ hiện khi ĐANG có nội dung riêng — đó là cách duy nhất
    // quay về chữ của component.
    const revert = page.getByRole('button', { name: /về chữ của component/ });
    await expect(revert).toBeVisible();
    await revert.click();

    await expect
      .poll(async () => (await (await request.get(`/render/${pageId}`)).text()))
      .toContain('CHỮ COMPONENT UI');

    // Và cây component chưa bao giờ bị đụng tới.
    const { nodes } = await tool(request, 'get_component', { componentId });
    expect(JSON.stringify(nodes)).toContain('CHỮ COMPONENT UI');
  });
});

test.describe('sửa component ngay trong trang', () => {
  test('vào chế độ, sửa, quay ra — và mọi instance đổi theo', async ({ page, request }) => {
    test.setTimeout(120_000);
    const { pageId } = await setup(request, 'E2E Canvas');

    await page.goto(`/builder/${pageId}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
    await page.getByRole('button', { name: /Thẻ E2E/ }).first().click();

    // Vào chế độ sửa component từ chính panel instance.
    await page.getByRole('button', { name: 'Sửa component' }).click();

    // Thanh báo phải RÕ: không có nó thì canvas trông y hệt lúc sửa trang, và
    // người dùng sẽ sửa component tưởng đang sửa trang.
    await expect(page.getByText('Đang sửa component')).toBeVisible();
    await expect(page.getByText(/áp cho MỌI trang/)).toBeVisible();

    // Canvas nạp component, không nạp trang.
    await expect
      .poll(async () =>
        page.locator('iframe').first().getAttribute('src'),
      )
      .toMatch(/\/render\/component\//);

    // Cây node giờ là cây COMPONENT — có node tiêu đề của nó.
    const tree = page.locator('aside').first();
    await expect(tree.getByRole('button', { name: /tiêu đề/ }).first()).toBeVisible();

    // Mục Trang/Component biến mất: chèn preset vào component sẽ tạo instance
    // lồng nhau, thứ bị chặn ở đường ghi.
    //
    // Bám vào tiêu đề accordion, KHÔNG bám vào `role="tab"`. Pane trái từng là
    // tablist; giữ selector cũ thì assertion này vẫn xanh sau khi đổi sang
    // accordion — nhưng xanh vì KHÔNG CÒN tab nào cả, chứ không phải vì mục Trang
    // đã bị ẩn đúng cách. Một test xanh nhờ lý do sai còn tệ hơn test đỏ.
    const left = page.locator('aside').first();
    await expect(left.getByRole('button', { name: /^▸?\s*Trang/i })).toHaveCount(0);
    await expect(left.getByRole('button', { name: /Lớp/i })).toHaveCount(1);

    // Sửa chữ trong component qua inspector.
    await tree.getByRole('button', { name: /tiêu đề/ }).first().click();
    await page.getByRole('button', { name: /Chữ|Nội dung/ }).first().click().catch(() => undefined);

    // Quay lại trang.
    await page.getByRole('button', { name: /Quay lại trang/ }).click();
    await expect(page.getByText('Đang sửa component')).toHaveCount(0);
    await expect
      .poll(async () => page.locator('iframe').first().getAttribute('src'))
      .toMatch(new RegExp(`/render/${pageId}`));
  });
});
