import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * `/builder/components/<id>/edit` — canvas riêng cho một component.
 *
 * Hợp đồng với người dùng:
 *  - mở được KHÔNG cần trang nào đang dùng component (đó là lý do route này tồn tại)
 *  - URL chia sẻ được và F5 không mất chỗ
 *  - op ghi vào CÂY COMPONENT, không phải vào trang — đây là điều quan trọng nhất
 *  - không có Publish: `publish()` là site-wide, rộng hơn nhiều việc vừa làm ở đây
 *
 * Test có ghi thì dọn trong `afterEach`: `Release.components` là ảnh chụp, nên một
 * cây component bẩn cũng lên site thật khi bộ e2e này publish.
 */

/** "Tiêu đề + mô tả" — chọn nó vì có nhiều hơn một node nên nhân bản được. */
let componentId = '';

let cleanup: (() => Promise<unknown>) | null = null;

test.afterEach(async () => {
  const job = cleanup;
  cleanup = null;
  if (!job) return;

  /*
   * Lỗi dọn phải NÓI RA, không được nuốt.
   *
   * Bản trước là `.catch(() => undefined)`. Ngày 19/08/2026 test này đỏ trong
   * full-suite và để lại node "Tiêu đề (bản sao)" trong cây preset — mà log không
   * có một dòng nào về việc dọn, nên tôi không biết cleanup đã chạy và thất bại hay
   * chưa chạy lần nào. Mất cả buổi đoán.
   *
   * Vẫn không `throw`: ném ở đây sẽ che mất lỗi THẬT của test. Nhưng phải in ra.
   */
  try {
    await job();
  } catch (e) {
    console.error(`[dọn] THẤT BẠI, cây preset có thể còn bẩn: ${String(e)}`);
  }
});

async function login(page: Page) {
  await page.goto('/builder');
  await expect(page.getByRole('heading', { name: 'Trang' })).toBeVisible();
}

/** Lấy id component qua API, không hardcode: seed có thể cấp id khác. */
async function pickComponent(request: APIRequestContext): Promise<string> {
  if (componentId) return componentId;
  const res = await request.post('/api/ai/tool', {
    data: { tool: 'list_components', input: {} },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { result } = await res.json();
  const list = (result.components ?? result) as Array<{ id: string; nodeCount?: number }>;
  // Cần component có ≥2 node để nhân bản được một node con.
  const found = list.find((c) => (c.nodeCount ?? 0) > 1) ?? list[0]!;
  componentId = found.id;
  return componentId;
}

const nodeIds = async (request: APIRequestContext, id: string): Promise<string[]> => {
  const res = await request.post('/api/ai/tool', {
    data: { tool: 'get_component', input: { componentId: id } },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { result } = await res.json();
  return Object.keys(result.nodes);
};

const nodeCount = async (request: APIRequestContext, id: string) =>
  (await nodeIds(request, id)).length;

/**
 * Xoá những node xuất hiện SAU `known` — dọn thật, không chỉ báo lỗi.
 *
 * Bản trước của `cleanup` trong test dưới đây chỉ **ném** kèm câu "dọn tay". Điều
 * đó biến một lần flake thành rác đi vào production: `Release.components` chụp MỌI
 * preset, nên cây bẩn sẽ lên site ở lần publish tiếp theo — và bộ e2e này có năm
 * spec gọi `/api/publish` (xem docs/HANDOFF.md §3.1).
 *
 * Đã xảy ra thật ngày 18/08/2026: test này đỏ trong full-suite (xanh khi chạy
 * riêng), và để lại node "Tiêu đề (bản sao)" trong cây. Phải dọn tay bằng SQL.
 *
 * So theo TẬP ID thay vì theo số lượng: id do server sinh nên không đoán được, mà
 * hiệu của hai tập thì chính xác.
 */
async function removeExtraNodes(
  request: APIRequestContext,
  presetId: string,
  known: string[],
): Promise<void> {
  const extra = (await nodeIds(request, presetId)).filter((n) => !known.includes(n));
  if (!extra.length) return;

  const res = await request.post(`/api/presets/${presetId}/ops`, {
    data: {
      label: 'e2e dọn — xoá node còn sót',
      ops: extra.map((nodeId) => ({ op: 'removeNode', nodeId })),
    },
  });
  // Không `expect` ở đây: `afterEach` đã bọc `.catch()`, và một lần dọn thất bại
  // không nên che mất lỗi thật của chính test.
  if (!res.ok()) console.warn(`dọn không thành: ${res.status()} ${await res.text()}`);
}

test.describe('route riêng cho component', () => {
  test('mở trực tiếp bằng URL, không cần trang nào', async ({ page, request }) => {
    const id = await pickComponent(request);
    await login(page);

    await page.goto(`/builder/components/${id}/edit`);

    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible();
    await expect(page.locator('[data-layer-row]').first()).toBeVisible();
    await expect(page.locator('iframe').first()).toHaveAttribute(
      'src',
      new RegExp(`/render/component/${id}`),
    );

    // F5 phải giữ nguyên chỗ — đó là thứ chế độ `?component=` trong trang không có.
    await page.reload();
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible();
    expect(page.url()).toContain(`/builder/components/${id}/edit`);
  });

  test('KHÔNG có nút Publish, và nói rõ thay đổi lên site khi nào', async ({ page, request }) => {
    const id = await pickComponent(request);
    await login(page);
    await page.goto(`/builder/components/${id}/edit`);
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible();

    // `publish()` đẩy bản nháp của MỌI trang lên site. Một nút như vậy ở đây là
    // hệ quả rộng hơn nhiều so với việc người dùng vừa làm.
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
    // Nhưng phải nói ra, vì `Release.components` là ảnh chụp: sửa component KHÔNG
    // tự lên site.
    await expect(page.getByText(/Lên site khi bạn publish/i)).toBeVisible();
  });

  test('không bày dock của trang, và không cho chèn component vào component', async ({
    page,
    request,
  }) => {
    const id = await pickComponent(request);
    await login(page);
    await page.goto(`/builder/components/${id}/edit`);
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible();

    await expect(page.getByRole('button', { name: /Thêm trang/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Thêm component/ })).toHaveCount(0);
  });

  test('op ghi vào CÂY COMPONENT, không phải vào trang', async ({ page, request }) => {
    const id = await pickComponent(request);
    await login(page);

    const known = await nodeIds(request, id);
    const before = known.length;

    await page.goto(`/builder/components/${id}/edit`);
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible();
    await page.locator('[data-layer-row]').nth(1).click();
    await page.getByRole('button', { name: 'Nhân bản (Ctrl+D)' }).click();

    // Đăng ký dọn NGAY sau khi ghi, trước mọi assertion: assertion đỏ cũng không
    // được để lại cây component bẩn — nó sẽ lên site ở lần publish tiếp theo.
    cleanup = () => removeExtraNodes(request, id, known);

    await expect.poll(() => nodeCount(request, id), { timeout: 20_000 }).toBe(before + 1);

    // Undo là đường dọn thật, và nó cũng là một phần hợp đồng.
    await page.keyboard.press('Control+z');
    await expect.poll(() => nodeCount(request, id), { timeout: 20_000 }).toBe(before);
    cleanup = null;
  });

  test('trang quản lý có đường tới canvas riêng', async ({ page, request }) => {
    const id = await pickComponent(request);
    await login(page);
    await page.goto(`/builder/components/${id}`);

    const open = page.getByRole('link', { name: /Mở canvas/ });
    await expect(open).toBeVisible();
    await open.click();
    await page.waitForURL(/\/edit$/);
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible();
  });
});
