import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inspector chỉnh theo PHẦN và TRẠNG THÁI: ô "Đang chỉnh" (Form → Nút gửi) và ô "Trạng thái"
 * (Thường / Di chuột / Focus). Hợp đồng: ô style bình thường ghi vào `style.parts.<phần>.<lớp>`
 * hoặc `style.hover` / `style.focusVisible`, không đụng style của chính node.
 */

async function tool(request: APIRequestContext, name: string, input: unknown) {
  const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
  expect(res.ok(), `tool ${name} lỗi: ${await res.text()}`).toBe(true);
  return (await res.json()).result;
}

const color = (page: Page) => page.locator('[data-color-field="fill.color"] input');

async function setBackground(page: Page, hex: string) {
  if ((await color(page).count()) === 0) await page.getByRole('button', { name: /Nền/ }).first().click();
  await expect(color(page)).toBeVisible();
  await color(page).fill(hex);
  await color(page).press('Enter');
}

test('chọn phần Nút gửi rồi đổi màu nền chỉ đổi nút gửi', async ({ page, request }) => {
  const slug = `e2e-form-sb-${Date.now().toString(36)}`;
  const res = await request.post('/api/pages', { data: { title: 'E2E form sidebar', slug } });
  expect(res.ok(), await res.text()).toBe(true);
  const pageId = (await res.json()).page.id as string;
  try {
    await page.goto(`/builder/${pageId}`);
    await page.locator('aside').first().getByRole('button', { name: /^Comp/ }).click();
    const item = page.locator('[data-component-item]').filter({ hasText: /^\s*Form/ }).first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.getByRole('button', { name: 'Chèn bản sao' }).click();

    let formId = '';
    await expect
      .poll(async () => {
        const r = await tool(request, 'find_nodes', { pageId, type: 'Composite' });
        formId = /"id":"([a-z0-9]+)"/i.exec(JSON.stringify(r))?.[1] ?? '';
        return formId;
      }, { timeout: 30_000 })
      .not.toBe('');

    // Chọn form qua cây lớp.
    await page.locator('aside').first().getByRole('button', { name: /^Lớp|^Layers/ }).click().catch(() => undefined);
    await page.locator(`[data-layer-row="${formId}"]`).click();
    await expect(page.getByTitle(formId)).toBeVisible();

    // Form có phần con → có cả hai ô.
    await expect(page.getByLabel('Đang chỉnh', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Trạng thái', { exact: true })).toBeVisible();

    await page.getByLabel('Đang chỉnh', { exact: true }).selectOption({ label: 'Nút gửi' });
    await setBackground(page, '#123456');

    await expect
      .poll(async () => {
        const n = JSON.stringify(await tool(request, 'get_node', { pageId, nodeIds: [formId] }));
        return /"parts":{"submit":{"[a-z]+":{"fill":{"color":{"hex":"#123456"/.test(n);
      })
      .toBe(true);
    let node = JSON.stringify(await tool(request, 'get_node', { pageId, nodeIds: [formId] }));
    // Style của chính form không bị chạm.
    expect(node).toContain('"style":{"base":{},"parts":');

    // Di chuột → style.parts.submit.hover.
    await page.getByLabel('Trạng thái', { exact: true }).selectOption({ label: 'Di chuột' });
    await setBackground(page, '#abcdef');
    await expect
      .poll(async () => {
        const n = JSON.stringify(await tool(request, 'get_node', { pageId, nodeIds: [formId] }));
        return /"submit":{[^]*"hover":{"fill":{"color":{"hex":"#abcdef"/.test(n);
      })
      .toBe(true);
    node = JSON.stringify(await tool(request, 'get_node', { pageId, nodeIds: [formId] }));
    expect(node).toContain('"hex":"#123456"');
  } finally {
    await request.delete(`/api/pages/${pageId}`);
    await request.delete(`/api/pages/${pageId}?purge=1`);
  }
});

test('node không có phần: ẩn ô Đang chỉnh, vẫn có Trạng thái ghi vào style.hover', async ({ page, request }) => {
  const slug = `e2e-form-sb2-${Date.now().toString(36)}`;
  const res = await request.post('/api/pages', { data: { title: 'E2E form sidebar 2', slug } });
  expect(res.ok(), await res.text()).toBe(true);
  const pageId = (await res.json()).page.id as string;
  try {
    const rootId = 'root';
    const textId = 'e2etext1';
    const ops = await request.post('/api/ops', {
      data: {
        pageId,
        label: 'e2e chèn chữ',
        ops: [{
          op: 'insertNode',
          parentId: rootId,
          index: 0,
          node: {
            id: textId, type: 'Text', tag: 'p', parentId: rootId, children: [], effects: [],
            style: { base: {} }, content: [{ t: 'text', v: 'Xin chào' }],
          },
        }],
      },
    });
    expect(ops.ok(), await ops.text()).toBe(true);

    await page.goto(`/builder/${pageId}`);
    await page.locator(`[data-layer-row="${textId}"]`).click();
    await expect(page.getByTitle(textId)).toBeVisible();

    await expect(page.getByLabel('Đang chỉnh', { exact: true })).toHaveCount(0);
    const state = page.getByLabel('Trạng thái', { exact: true });
    await expect(state).toBeVisible();
    expect(await state.locator('option').allTextContents()).toEqual(['Thường', 'Di chuột', 'Focus']);

    await state.selectOption({ label: 'Di chuột' });
    await setBackground(page, '#112233');
    await expect
      .poll(async () => JSON.stringify(await tool(request, 'get_node', { pageId, nodeIds: [textId] })))
      .toMatch(/"hover":\{"fill":\{"color":{"hex":"#112233"/);

    await state.selectOption({ label: 'Focus' });
    await setBackground(page, '#445566');
    await expect
      .poll(async () => JSON.stringify(await tool(request, 'get_node', { pageId, nodeIds: [textId] })))
      .toMatch(/"focusVisible":\{"fill":\{"color":{"hex":"#445566"/);
  } finally {
    await request.delete(`/api/pages/${pageId}`);
    await request.delete(`/api/pages/${pageId}?purge=1`);
  }
});
