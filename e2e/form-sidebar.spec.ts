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

/**
 * Chờ một lần lưu tới server. Mặc định 5 giây của `expect.poll` không đủ khi cả stack e2e
 * đang bận (lần lưu đầu sau khi chèn mẫu còn kéo theo biên dịch route của dev server) —
 * test từng đỏ chập chờn ở đúng chỗ này dù thao tác đã đúng.
 */
const SAVE_POLL = { timeout: 30_000 };

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
    // Lựa chọn đầu gọi đúng tên khối đang chọn — "Cả form", không phải "Cả khối" chung chung.
    await expect(page.getByLabel('Đang chỉnh', { exact: true }).locator('option').first()).toHaveText('Cả form');
    await expect(page.getByLabel('Trạng thái', { exact: true })).toBeVisible();

    await page.getByLabel('Đang chỉnh', { exact: true }).selectOption({ label: 'Nút gửi' });
    await setBackground(page, '#123456');

    await expect
      .poll(async () => {
        const n = JSON.stringify(await tool(request, 'get_node', { pageId, nodeIds: [formId] }));
        return /"parts":{"submit":{"[a-z]+":{"fill":{"color":{"hex":"#123456"/.test(n);
      }, SAVE_POLL)
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
      }, SAVE_POLL)
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

    // Gõ lại đúng giá trị đã lưu rồi rời ô: lỗi cũ hết nghĩa và biến mất.
    await options.fill('Lựa chọn 1\nLựa chọn 2');
    await options.blur();
    await expect(editor.getByText(/select phải có options/)).toBeHidden();
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

/* ── Bản dịch theo chỉ số ô (param:fields.N.*) ───────────────────────────────────── */

async function setTranslation(request: APIRequestContext, data: Record<string, unknown>) {
  const res = await request.post('/api/translations', { data });
  expect(res.ok(), await res.text()).toBe(true);
}

/** HTML khung xem trước ở ngôn ngữ `en` — chỗ bản dịch nháp được phủ lên doc. */
async function renderEn(request: APIRequestContext, pageId: string) {
  const res = await request.get(`/render/${pageId}?locale=en`);
  expect(res.ok()).toBe(true);
  return res.text();
}

test('khối Form trên trang: kéo ô thì bản dịch tiếng Anh đi theo ô', async ({ page, request }) => {
  // Nhiều lần lưu + dời bản dịch + nạp lại: vượt trần 30 giây mặc định khi stack bận.
  test.setTimeout(90_000);
  const pageId = await newPage(request, 'tr');
  try {
    const formId = await insertAndSelectForm(page, request, pageId);
    const panel = page.locator('[data-form-panel]');
    await panel.getByLabel('Thêm ô').selectOption({ label: 'Số điện thoại' });
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name), SAVE_POLL)
      .toEqual(['email', 'tel']);

    // Nhãn tiếng Anh cho ô email (đang ở chỉ số 0).
    await setTranslation(request, { pageId, locale: 'en', nodeId: formId, field: 'param:fields.0.label', value: 'Email EN' });
    expect(await renderEn(request, pageId)).toMatch(/for="[^"]*-email"[^>]*>Email EN/);

    // Nạp lại để Inspector có bản dịch vừa ghi, rồi đưa ô SĐT lên đầu.
    await page.reload();
    await page.locator(`[data-layer-row="${formId}"]`).click();
    await page.locator('[data-form-panel]').getByRole('button', { name: 'Đưa ô "Số điện thoại" lên' }).click();
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name), SAVE_POLL)
      .toEqual(['tel', 'email']);

    // Nhãn tiếng Anh vẫn nằm trên ô email (giờ ở chỉ số 1), ô SĐT không mang nó.
    await expect.poll(async () => {
      const html = await renderEn(request, pageId);
      return /for="[^"]*-email"[^>]*>Email EN/.test(html) && !/for="[^"]*-tel"[^>]*>Email EN/.test(html);
    }, SAVE_POLL).toBe(true);
    const rows = await tool(request, 'list_translations', { pageId, locale: 'en' });
    const fields = (rows.translations as { nodeId: string; field: string }[])
      .filter((t) => t.nodeId === formId)
      .map((t) => t.field);
    expect(fields).toEqual(['param:fields.1.label']);
  } finally {
    await dropPage(request, pageId);
  }
});

test('khối Form trên trang: kéo ô rồi Hoàn tác / Làm lại thì bản dịch đi theo ô cả hai chiều', async ({ page, request }) => {
  // Nhiều lần lưu + dời bản dịch + nạp lại: vượt trần 30 giây mặc định khi stack bận.
  test.setTimeout(120_000);
  const pageId = await newPage(request, 'trundo');
  try {
    const formId = await insertAndSelectForm(page, request, pageId);
    const panel = page.locator('[data-form-panel]');
    await panel.getByLabel('Thêm ô').selectOption({ label: 'Số điện thoại' });
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name), SAVE_POLL)
      .toEqual(['email', 'tel']);

    await setTranslation(request, { pageId, locale: 'en', nodeId: formId, field: 'param:fields.0.label', value: 'Email EN' });
    await setTranslation(request, { pageId, locale: 'en', nodeId: formId, field: 'param:fields.1.label', value: 'Phone EN' });

    /** Nhãn tiếng Anh theo TÊN ô (đọc từ khung xem trước `en`), không theo chỉ số. */
    const enLabels = async () => {
      const html = await renderEn(request, pageId);
      return {
        email: /for="[^"]*-email"[^>]*>Email EN/.test(html),
        tel: /for="[^"]*-tel"[^>]*>Phone EN/.test(html),
        swapped: /for="[^"]*-email"[^>]*>Phone EN/.test(html) || /for="[^"]*-tel"[^>]*>Email EN/.test(html),
      };
    };
    const RIGHT = { email: true, tel: true, swapped: false };
    expect(await enLabels()).toEqual(RIGHT);

    // Nạp lại để Inspector có bản dịch vừa ghi (và lịch sử hoàn tác rỗng), rồi đưa SĐT lên đầu.
    await page.reload();
    await page.locator(`[data-layer-row="${formId}"]`).click();
    await page.locator('[data-form-panel]').getByRole('button', { name: 'Đưa ô "Số điện thoại" lên' }).click();
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name), SAVE_POLL)
      .toEqual(['tel', 'email']);
    await expect.poll(enLabels, SAVE_POLL).toEqual(RIGHT);

    const undo = page.getByRole('button', { name: 'Hoàn tác', exact: true });
    const redo = page.getByRole('button', { name: 'Làm lại', exact: true });

    // Hoàn tác: ô về thứ tự cũ, và nhãn tiếng Anh vẫn nằm đúng ô (không đổi chỗ cho nhau).
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name), SAVE_POLL)
      .toEqual(['email', 'tel']);
    await expect.poll(enLabels, SAVE_POLL).toEqual(RIGHT);

    // Làm lại: thứ tự mới, nhãn vẫn đúng ô.
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name), SAVE_POLL)
      .toEqual(['tel', 'email']);
    await expect.poll(enLabels, SAVE_POLL).toEqual(RIGHT);

    const rows = await tool(request, 'list_translations', { pageId, locale: 'en' });
    // Đúng hai hàng, không hàng thừa nào sót lại sau ba lần dời.
    const fields = (rows.translations as { nodeId: string; field: string }[])
      .filter((t) => t.nodeId === formId)
      .map((t) => t.field)
      .sort();
    expect(fields).toEqual(['param:fields.0.label', 'param:fields.1.label']);
  } finally {
    await dropPage(request, pageId);
  }
});

test('khối Form trong component có bản dịch trên trang: chặn kéo/bỏ ô, nói lý do', async ({ page, request }) => {
  // Component dựng bằng op (không nhân bản mẫu): một Form hai ô làm con của gốc.
  const made = await request.post('/api/presets', { data: { name: `E2E form lock ${Date.now().toString(36)}` } });
  expect(made.ok(), await made.text()).toBe(true);
  const copyId = (await made.json()).preset.id as string;
  const pageId = await newPage(request, 'lock');
  try {
    const { rootId: compRoot } = await tool(request, 'get_component', { componentId: copyId });
    const formLocal = 'e2eformlock';
    const built = await request.post(`/api/presets/${copyId}/ops`, {
      data: {
        ops: [{
          op: 'insertNode', parentId: compRoot, index: 0,
          node: {
            id: formLocal, parentId: compRoot, type: 'Composite', composite: 'Form', name: 'Form',
            children: [], effects: [], style: { base: {} }, slots: {},
            params: {
              endpointKey: '',
              fields: [
                { name: 'email', kind: 'email', label: 'Email', required: true },
                { name: 'ten', kind: 'text', label: 'Tên', required: false },
              ],
              submitLabel: 'Gửi',
              successMessage: 'Đã nhận.',
              errorMessage: 'Chưa gửi được.',
            },
          },
        }],
      },
    });
    expect(built.ok(), await built.text()).toBe(true);

    const instId = 'e2einstform';
    const ops = await request.post('/api/ops', {
      data: {
        pageId,
        label: 'e2e chèn instance form',
        ops: [{
          op: 'insertNode', parentId: 'root', index: 0,
          node: {
            id: instId, type: 'Instance', componentId: copyId, parentId: 'root',
            children: [], effects: [], style: { base: {} }, overrides: {},
          },
        }],
      },
    });
    expect(ops.ok(), await ops.text()).toBe(true);
    await setTranslation(request, {
      pageId, locale: 'en', nodeId: `${instId}/${formLocal}`, field: 'param:fields.0.label', value: 'Email EN',
    });

    await page.goto(`/builder/components/${copyId}/edit`);
    await page.locator(`[data-layer-row="${formLocal}"]`).click();
    const panel = page.locator('[data-form-panel]');
    await expect(panel.locator('[data-form-index-lock]')).toContainText('Không sắp lại hay bỏ ô được');
    await expect(panel.locator('[data-form-index-lock]')).toContainText('/e2e-form-lock-');
    // Hai ô mà không nút sắp/bỏ nào bấm được.
    await expect(panel.getByRole('button', { name: 'Bỏ ô "Email"' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Đưa ô "Email" xuống' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Đưa ô "Tên" lên' })).toBeDisabled();

    // Thêm ô vào cuối vẫn được — nó không dời chỉ số nào.
    await panel.getByLabel('Thêm ô').selectOption({ label: 'Số điện thoại' });
    await expect(panel.locator('[data-form-field="tel"]')).toBeVisible({ timeout: 15_000 });
  } finally {
    await dropPage(request, pageId);
    await request.delete(`/api/presets/${copyId}`);
  }
});

test('khối Form trên trang: bỏ ô thì bản dịch của nó đi theo, ô thêm sau không thừa kế', async ({ page, request }) => {
  // Nhiều lần lưu + dời bản dịch + nạp lại: vượt trần 30 giây mặc định khi stack bận.
  test.setTimeout(90_000);
  const pageId = await newPage(request, 'trdel');
  try {
    const formId = await insertAndSelectForm(page, request, pageId);
    const panel = page.locator('[data-form-panel]');
    await panel.getByLabel('Thêm ô').selectOption({ label: 'Số điện thoại' });
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name), SAVE_POLL)
      .toEqual(['email', 'tel']);

    await setTranslation(request, { pageId, locale: 'en', nodeId: formId, field: 'param:fields.0.label', value: 'Email EN' });
    await setTranslation(request, { pageId, locale: 'en', nodeId: formId, field: 'param:fields.1.label', value: 'Phone EN' });

    const enFields = async () =>
      ((await tool(request, 'list_translations', { pageId, locale: 'en' })).translations as { nodeId: string; field: string }[])
        .filter((t) => t.nodeId === formId)
        .map((t) => t.field)
        .sort();

    await page.reload();
    await page.locator(`[data-layer-row="${formId}"]`).click();
    await page.locator('[data-form-panel]').getByRole('button', { name: 'Bỏ ô "Email"' }).click();
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name), SAVE_POLL)
      .toEqual(['tel']);

    // Nhãn tiếng Anh của ô SĐT dời về chỉ số 0; hàng ở chỉ số 1 (ô đã bỏ) bị xoá.
    await expect.poll(enFields, SAVE_POLL).toEqual(['param:fields.0.label']);
    expect(await renderEn(request, pageId)).toMatch(/for="[^"]*-tel"[^>]*>Phone EN/);
    await expect(panel.locator('[data-form-remap-error]')).toHaveCount(0);

    // Ô thêm sau vào chỉ số 1 không mang nhãn tiếng Anh của ô đã bỏ.
    await panel.getByLabel('Thêm ô').selectOption({ label: 'Chữ' });
    await expect
      .poll(async () => (await formNode(request, pageId, formId)).params.fields.map((f) => f.name), SAVE_POLL)
      .toEqual(['tel', 'text']);
    const html = await renderEn(request, pageId);
    expect(html).toMatch(/for="[^"]*-text"[^>]*>Họ và tên/);
    expect(html).not.toContain('Email EN');
    expect(await enFields()).toEqual(['param:fields.0.label']);
  } finally {
    await dropPage(request, pageId);
  }
});
