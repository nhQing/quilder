import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Thư viện component: xem, đổi thông tin, nhân bản, xoá, và sửa cây node.
 *
 * Mọi test tạo component phải dọn trong `afterEach`. Component KHÔNG bị publish
 * lên site (khác trang), nhưng rác vẫn tích lại trong thư viện và làm test sau
 * đếm sai.
 *
 * Hợp đồng đang kiểm:
 *  - thẻ ở bảng điều khiển bấm vào được
 *  - component builtin KHÔNG xoá được, và thông điệp nói rõ vì sao
 *  - nhân bản là bản sao ĐỘC LẬP
 *  - sửa cây node đi qua đúng validator của trang
 *  - AI thấy và sửa được qua tool
 */

const created: string[] = [];

test.afterEach(async ({ request }) => {
  const ids = created.splice(0);
  for (const id of ids) {
    await request.delete(`/api/presets/${id}`).catch(() => undefined);
  }
});

async function createComponent(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/presets', { data: { name } });
  expect(res.ok(), `tạo component "${name}" thất bại: ${await res.text()}`).toBe(true);
  const { preset } = await res.json();
  created.push(preset.id);
  return preset.id;
}

async function tool(request: APIRequestContext, name: string, input: unknown) {
  const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
  expect(res.ok(), `tool ${name} lỗi: ${await res.text()}`).toBe(true);
  return (await res.json()).result;
}

test.describe('thư viện component', () => {
  test('thẻ ở bảng điều khiển bấm vào được', async ({ page }) => {
    await page.goto('/builder');
    // Chính là yêu cầu: trước đây thẻ là <div>, nhìn như bấm được nhưng không.
    const card = page.getByRole('link', { name: /Header/ }).first();
    await card.click();
    await page.waitForURL(/\/builder\/components\/[a-z0-9]+$/);
    await expect(page.getByRole('heading', { name: 'Header' })).toBeVisible();
  });

  test('trang chi tiết hiện cây node và cảnh báo builtin', async ({ page, request }) => {
    const { components } = await tool(request, 'list_components', {});
    const header = components.find((c: { key: string }) => c.key === 'header');

    await page.goto(`/builder/components/${header.id}`);
    await expect(page.getByRole('heading', { name: 'Header' })).toBeVisible();

    // Cây node phải hiện — không có nó thì "component" chỉ là một cái tên.
    // Trỏ theo NHÃN, không theo `main ul li`: danh sách lịch sử cũng là một <ul>,
    // nên selector rộng đếm cả nó và test xanh/đỏ vì lý do sai.
    const rows = page.getByRole('list', { name: 'Cây node' }).getByRole('listitem');
    expect(await rows.count()).toBeGreaterThan(10);

    // Builtin: cảnh báo phải nói rõ hậu quả, không chỉ dán nhãn.
    await expect(page.getByText(/trích tự động/)).toBeVisible();
    await expect(page.getByText(/sẽ ghi đè/)).toBeVisible();
  });

  test('xem trước dựng đúng component, không phải một khung rỗng', async ({ page, request }) => {
    const { components } = await tool(request, 'list_components', {});
    const header = components.find((c: { key: string }) => c.key === 'header');

    await page.goto(`/builder/components/${header.id}`);

    // Kiểm `[data-n]` chứ không kiểm iframe tồn tại: iframe hỏng vẫn là một
    // iframe, và một khung trắng trông y hệt một component không có nội dung.
    const frame = page.frameLocator('iframe[title="Xem trước component"]');
    await expect(frame.locator('[data-n]').first()).toBeVisible();

    // Chiều cao phải bám nội dung. Bản đầu đo `body.scrollHeight`, mà `site.css`
    // đặt `min-height:100vh` nên body luôn đo lại đúng chiều cao vừa đặt — khung
    // kẹt ở 360px và mọi component kéo theo một mảng trống bên dưới.
    const el = page.locator('iframe[title="Xem trước component"]');
    await expect.poll(async () => (await el.boundingBox())?.height ?? 0).toBeLessThan(300);

    await page.getByRole('button', { name: /Mobile 390/ }).click();
    await expect.poll(async () => (await el.boundingBox())?.width ?? 0).toBe(390);
  });

  test('nói rõ trang cha ghi đè được gì, và chỉ nội dung', async ({ page, request }) => {
    const { components } = await tool(request, 'list_components', {});
    const header = components.find((c: { key: string }) => c.key === 'header');

    await page.goto(`/builder/components/${header.id}`);

    // Hợp đồng instance: chỉ `ContentOverride`. Bày nhầm một trường style ở đây
    // là hứa một thứ mà `schema.ts` từ chối bằng `.strict()`.
    const table = page.locator('table').first();
    await expect(table).toContainText('label');
    await expect(table).toContainText('content');
    await expect(table).not.toContainText('padding');
    await expect(table).not.toContainText('fontSize');

    // Giá trị mặc định phải hiện: đó là thứ trang cha thấy khi để rỗng.
    await expect(table).toContainText('Dùng thử');
  });

  test('“Sửa trong trang” mở đúng component, thoát ra thì sạch URL', async ({ page, request }) => {
    const { components } = await tool(request, 'list_components', {});
    const header = components.find((c: { key: string }) => c.key === 'header');

    await page.goto(`/builder/components/${header.id}`);
    // Đây là đường TRONG TRANG (`?component=`), không phải canvas riêng. Trang chi
    // tiết có cả hai: "Mở canvas" đi tới `/builder/components/<id>/edit` (xem
    // `component-route.spec.ts`), "Sửa trong trang" giữ hợp đồng đang test ở đây —
    // sửa component ngay trong bối cảnh một trang đang dùng nó.
    await page.getByRole('link', { name: /Sửa trong trang/ }).click();

    // 15s, không 5s: bước này là điều hướng sang màn editor (nặng nhất builder) RỒI một
    // lượt `GET /api/presets/<id>` — đo 09/10/2026: preset trả sau 2.5s vì chạy song song
    // với `/render` 3.3s, và cả bước vượt 5s dù không có gì sai. Cùng mốc 15s mà repo
    // dùng cho các lượt chờ điều hướng + fetch khác.
    await expect(page.getByText('ĐANG SỬA COMPONENT')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`component=${header.id}`));

    // Canvas phải trỏ vào cây COMPONENT, không phải cây trang. Kiểm ở đây chứ
    // không kiểm tên node trong pane trái: trang này đã CHÈN header (bản sao),
    // nên `header__bar` xuất hiện ở cả hai chế độ và không phân biệt được gì.
    await expect(
      page.locator(`iframe[src="/render/component/${header.id}"]`).first(),
    ).toBeAttached();

    // Thoát phải bỏ `?component=`: để nguyên thì F5 quay lại chế độ sửa
    // component, và nút thoát trở thành nút không có tác dụng.
    await page.getByRole('button', { name: /Quay lại trang/ }).click();
    await expect(page).not.toHaveURL(/component=/);
    await expect(page.getByText('ĐANG SỬA COMPONENT')).toBeHidden();
  });

  test('builtin KHÔNG xoá được, và server nói rõ vì sao', async ({ request }) => {
    // Xoá được thì lần chạy extract-presets.ts sau sẽ tạo lại y nguyên — tức là
    // một thao tác không có tác dụng lâu dài, và im lặng làm thế tệ hơn từ chối.
    const { components } = await tool(request, 'list_components', {});
    const builtin = components.find((c: { builtin: boolean }) => c.builtin);

    const res = await request.delete(`/api/presets/${builtin.id}`);
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/Nhân bản/);
  });
});

test.describe('tạo, đổi tên, nhân bản', () => {
  test('tạo trống rồi đổi thông tin', async ({ page, request }) => {
    const id = await createComponent(request, 'E2E Thành phần');

    await page.goto(`/builder/components/${id}`);
    await expect(page.getByRole('heading', { name: 'E2E Thành phần' })).toBeVisible();

    // Component trống là MỘT node Section — đủ để chèn và bắt đầu dựng.
    await expect(
      page.getByRole('list', { name: 'Cây node' }).getByRole('listitem'),
    ).toHaveCount(1);

    const about = page.getByLabel(/Mô tả cho AI/);
    await about.fill('Khối E2E để kiểm chứng.');
    await page.getByRole('button', { name: 'Lưu' }).click();

    await expect.poll(async () => {
      const { component } = await tool(request, 'get_component', { componentId: id });
      return component.about;
    }).toBe('Khối E2E để kiểm chứng.');
  });

  test('mô tả rỗng bị từ chối — đó là thứ AI đọc', async ({ request }) => {
    const id = await createComponent(request, 'E2E Mô tả rỗng');
    const res = await request.patch(`/api/presets/${id}`, { data: { aiDescription: '  ' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/AI đọc/);
  });

  test('trùng tên bị chặn', async ({ request }) => {
    await createComponent(request, 'E2E Trùng tên');
    const res = await request.post('/api/presets', { data: { name: 'E2E Trùng tên' } });
    expect(res.status()).toBe(409);
  });

  test('nhân bản là bản sao ĐỘC LẬP', async ({ request }) => {
    const id = await createComponent(request, 'E2E Nguồn');

    const res = await request.post('/api/presets', { data: { from: id } });
    expect(res.ok()).toBe(true);
    const copy = (await res.json()).preset;
    created.push(copy.id);

    expect(copy.name).toBe('E2E Nguồn (bản sao)');
    expect(copy.id).not.toBe(id);

    // Sửa bản sao KHÔNG đụng bản gốc. Đây là cả điểm của "khuôn đóng dấu".
    await request.patch(`/api/presets/${copy.id}`, { data: { name: 'E2E Đã đổi' } });

    const source = await tool(request, 'get_component', { componentId: id });
    expect(source.component.name).toBe('E2E Nguồn');
  });
});

test.describe('sửa cây node', () => {
  test('op đi qua đúng validator của trang', async ({ request }) => {
    const id = await createComponent(request, 'E2E Cây node');
    const before = await tool(request, 'get_component', { componentId: id });
    const rootId = before.rootId;

    const res = await request.post(`/api/presets/${id}/ops`, {
      data: {
        label: 'e2e thêm tiêu đề',
        ops: [
          {
            op: 'insertNode',
            parentId: rootId,
            index: 0,
            node: {
              id: 'e2etitle',
              parentId: rootId,
              type: 'Text',
              tag: 'h2',
              children: [],
              effects: [],
              style: { base: {} },
              content: [{ t: 'text', v: 'Tiêu đề E2E' }],
            },
          },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);

    const after = await tool(request, 'get_component', { componentId: id });
    expect(after.nodeCount).toBe(before.nodeCount + 1);
    expect(JSON.stringify(after.nodes)).toContain('Tiêu đề E2E');
  });

  test('op sai bị TỪ CHỐI, cây không đổi', async ({ request }) => {
    // Cùng validator với trang, nên token bịa cũng bị chặn ở đây.
    const id = await createComponent(request, 'E2E Op sai');
    const before = await tool(request, 'get_component', { componentId: id });

    const res = await request.post(`/api/presets/${id}/ops`, {
      data: {
        ops: [
          {
            op: 'setStyle',
            nodeId: before.rootId,
            target: 'base',
            patch: { spacing: { pt: { $token: 'token-khong-ton-tai' } } },
          },
        ],
      },
    });
    expect(res.status()).toBe(422);

    const after = await tool(request, 'get_component', { componentId: id });
    expect(after.nodeCount).toBe(before.nodeCount);
  });

  test('mỗi lần sửa để lại một version', async ({ page, request }) => {
    const id = await createComponent(request, 'E2E Lịch sử');
    const { rootId } = await tool(request, 'get_component', { componentId: id });

    await request.post(`/api/presets/${id}/ops`, {
      data: {
        label: 'e2e đổi tên node',
        ops: [{ op: 'setName', nodeId: rootId, name: 'Khối E2E' }],
      },
    });

    await page.goto(`/builder/components/${id}`);
    // "tạo mới" + "e2e đổi tên node".
    await expect(page.getByText('e2e đổi tên node')).toBeVisible();
    await expect(page.getByText('tạo mới')).toBeVisible();
  });
});

test.describe('AI qua tool', () => {
  test('thấy component, và mọi mô tả nói rõ HAI cách dùng: liên kết và đóng dấu', async ({ request }) => {
    // Hai cách cho hai hậu quả ngược nhau: Instance là LIÊN KẾT (sửa component đổi
    // mọi trang cắm nó), chèn bằng `insertNode` là ĐÓNG DẤU (bản sao độc lập). Thiếu
    // một trong hai thì model hứa sai với người dùng về phạm vi của một lần sửa.
    const result = await tool(request, 'list_components', {});
    expect(result.count).toBeGreaterThan(0);
    expect(result.note).toMatch(/LIÊN KẾT/);
    expect(result.note).toMatch(/ĐÓNG DẤU/);
  });

  test('AI sửa được cây node, và ghi vào lịch sử kèm prompt', async ({ request }) => {
    const id = await createComponent(request, 'E2E AI sửa');
    const { rootId } = await tool(request, 'get_component', { componentId: id });

    const result = await tool(request, 'apply_component_ops', {
      componentId: id,
      prompt: 'đổi tên khối gốc thành Hero',
      ops: [{ op: 'setName', nodeId: rootId, name: 'Hero' }],
    });
    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/LIÊN KẾT/);
    expect(result.note).toMatch(/ĐÓNG DẤU/);

    const after = await tool(request, 'get_component', { componentId: id });
    expect(JSON.stringify(after.nodes)).toContain('Hero');
  });

  test('AI nhân bản được', async ({ request }) => {
    const id = await createComponent(request, 'E2E AI nhân bản');
    const result = await tool(request, 'duplicate_component', { componentId: id });
    expect(result.ok).toBe(true);
    created.push(result.component.id);
    expect(result.component.name).toBe('E2E AI nhân bản (bản sao)');
  });
});
