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

/* ── Khối "Form": ô nhập, nút gửi, sau khi gửi, xem trước hộp thoại ───────────────── */

async function newPage(request: APIRequestContext, tag: string) {
  const slug = `e2e-form-${tag}-${Date.now().toString(36)}`;
  const res = await request.post('/api/pages', { data: { title: `E2E form ${tag}`, slug } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).page.id as string;
}

async function dropPage(request: APIRequestContext, pageId: string) {
  await request.delete(`/api/pages/${pageId}`);
  await request.delete(`/api/pages/${pageId}?purge=1`);
}

/** Mở trang, chèn bản sao mẫu Form, chọn form qua cây lớp. Trả id node form. */
async function insertAndSelectForm(page: Page, request: APIRequestContext, pageId: string) {
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

  await page.locator('aside').first().getByRole('button', { name: /^Lớp|^Layers/ }).click().catch(() => undefined);
  await page.locator(`[data-layer-row="${formId}"]`).click();
  await expect(page.getByTitle(formId)).toBeVisible();
  await expect(page.locator('[data-form-panel]')).toBeVisible();
  return formId;
}

type FormNodeJson = {
  id: string;
  params: { fields: { name: string; kind: string; required?: boolean; options?: unknown[] }[]; submitLabel: string };
  slots: Record<string, string[]>;
  children: string[];
};

/** Node theo id trong kết quả `get_node`, bất kể kết quả bọc thế nào. */
function findNode(result: unknown, id: string): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const o = result as Record<string, unknown>;
  if (o.id === id && typeof o.type === 'string') return o;
  for (const v of Object.values(o)) {
    const hit = findNode(v, id);
    if (hit) return hit;
  }
  return null;
}

async function getNode(request: APIRequestContext, pageId: string, id: string) {
  const r = await tool(request, 'get_node', { pageId, nodeIds: [id] });
  const hit = findNode(r, id);
  expect(hit, `get_node không trả ${id}: ${JSON.stringify(r).slice(0, 300)}`).toBeTruthy();
  return hit!;
}

const formNode = async (request: APIRequestContext, pageId: string, id: string) =>
  (await getNode(request, pageId, id)) as unknown as FormNodeJson;

test('khối Form: thêm ô SĐT, bắt buộc, kéo lên đầu, đổi chữ nút → params khớp', async ({ page, request }) => {
  const pageId = await newPage(request, 'fields');
  try {
    const formId = await insertAndSelectForm(page, request, pageId);
    const panel = page.locator('[data-form-panel]');

    await panel.getByLabel('Thêm ô').selectOption({ label: 'Số điện thoại' });
    const tel = panel.locator('[data-form-field="tel"]');
    await expect(tel).toBeVisible();

    // Ô vừa thêm tự mở phần sửa. `click` chứ không `check`: ô được điều khiển bởi doc, nên
    // nó chỉ đổi khi lần lưu trả về — `check` đòi trạng thái đổi ngay sau cú bấm.
    const required = panel.locator('[data-form-field-editor="tel"]').getByLabel('Bắt buộc');
    await required.click();
    await expect(required).toBeChecked();
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.find((f) => f.name === 'tel')?.required)
      .toBe(true);

    // Gập phần sửa và đưa cả hai hàng vào tầm nhìn TRƯỚC khi kéo: `dragTo` cuộn tới đích
    // giữa lúc đang giữ chuột, và Chromium huỷ cú kéo khi nguồn trôi đi dưới con trỏ.
    await panel.getByTitle('Sửa ô "Số điện thoại"').click();
    await panel.locator('[data-form-field="email"]').scrollIntoViewIfNeeded();
    await panel.locator('[data-form-drag="tel"]').dragTo(panel.locator('[data-form-field="email"]'));
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name))
      .toEqual(['tel', 'email']);
    await expect(panel.locator('[data-form-field]').first()).toHaveAttribute('data-form-field', 'tel');

    const submit = panel.getByLabel('Chữ nút gửi');
    await submit.fill('Đăng ký ngay');
    await submit.press('Enter');

    await expect
      .poll(async () => {
        const n = await formNode(request, pageId, formId);
        return { first: n.params.fields[0], submit: n.params.submitLabel };
      })
      .toMatchObject({ first: { name: 'tel', kind: 'tel', required: true }, submit: 'Đăng ký ngay' });
  } finally {
    await dropPage(request, pageId);
  }
});

test('khối Form: chọn Hộp thoại dựng hai slot; Xem trước: Thành công → chọn được chữ trong slot trên canvas', async ({ page, request }) => {
  const pageId = await newPage(request, 'dialog');
  try {
    const formId = await insertAndSelectForm(page, request, pageId);
    const panel = page.locator('[data-form-panel]');

    await panel.getByLabel('Sau khi gửi').selectOption({ label: 'Hộp thoại' });
    let node!: FormNodeJson;
    await expect
      .poll(async () => {
        node = await formNode(request, pageId, formId);
        return [node.slots.success?.length ?? 0, node.slots.error?.length ?? 0];
      })
      .toEqual([1, 1]);
    expect(node.children).toEqual(expect.arrayContaining([...node.slots.success!, ...node.slots.error!]));

    const box = await getNode(request, pageId, node.slots.success![0]!);
    const titleId = (box.children as string[])[0]!;
    expect(titleId).toBeTruthy();

    const frame = page.frameLocator('iframe[data-canvas-frame="shown"]');
    // Chưa bật xem trước: slot có trong khung nhưng ẩn.
    await expect(frame.locator(`[data-n="${titleId}"]`)).toBeHidden();

    const success = panel.getByRole('button', { name: 'Thành công', exact: true });
    await success.click();
    await expect(success).toHaveAttribute('aria-pressed', 'true');
    const title = frame.locator(`[data-n="${titleId}"]`);
    await expect(title).toBeVisible();
    await expect(title).toHaveText('Đã gửi thành công');
    await title.click();
    await expect(page.getByTitle(titleId)).toBeVisible();

    // Quay về Form: slot ẩn lại.
    await page.locator(`[data-layer-row="${formId}"]`).click();
    await page.locator('[data-form-panel]').getByRole('button', { name: 'Form', exact: true }).click();
    await expect(frame.locator(`[data-n="${titleId}"]`)).toBeHidden();
  } finally {
    await dropPage(request, pageId);
  }
});

test('khối Form: danh sách chọn bỏ hết lựa chọn → lỗi cạnh ô, params không đổi', async ({ page, request }) => {
  const pageId = await newPage(request, 'select');
  try {
    const formId = await insertAndSelectForm(page, request, pageId);
    const panel = page.locator('[data-form-panel]');

    await panel.getByLabel('Thêm ô').selectOption({ label: 'Danh sách chọn' });
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.find((f) => f.name === 'select')?.options?.length)
      .toBe(2);

    const editor = panel.locator('[data-form-field-editor="select"]');
    const options = editor.getByLabel('Lựa chọn');
    await options.fill('');
    await options.blur();
    await expect(editor.getByText(/select phải có options/)).toBeVisible();

    // Không ghi: params vẫn hai lựa chọn.
    await page.waitForTimeout(500);
    expect((await formNode(request, pageId, formId)).params.fields.find((f) => f.name === 'select')?.options).toHaveLength(2);
  } finally {
    await dropPage(request, pageId);
  }
});

test('khối Form trong component: nói rõ sửa đổi mọi trang dùng component', async ({ page, request }) => {
  const { presets } = await (await request.get('/api/presets')).json();
  const system = presets.find((x: { system: string | null }) => x.system === 'form');
  expect(system, 'chưa có mẫu hệ thống form').toBeTruthy();
  const res = await request.post('/api/presets', { data: { from: system.id, name: `E2E form comp ${Date.now().toString(36)}` } });
  expect(res.ok(), await res.text()).toBe(true);
  const copyId = (await res.json()).preset.id as string;
  try {
    await page.goto(`/builder/components/${copyId}/edit`);
    // Gốc của mẫu Form là chính node Composite.
    const row = page.locator('[data-layer-row]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.locator('[data-form-panel]')).toBeVisible();
    await expect(page.getByText('Sửa ở đây đổi mọi trang dùng component này.')).toBeVisible();
  } finally {
    await request.delete(`/api/presets/${copyId}`);
  }
});
