import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Lịch sử publish và lùi bản.
 *
 * Đây là mạng an toàn của cả hệ thống. Nó chỉ có giá trị nếu THẬT SỰ lùi được,
 * và cách duy nhất để biết là bấm thử.
 *
 * Test này đổi thứ khách đang xem, nên phải khôi phục trong `afterEach` —
 * `try/finally` không chạy khi test hết giờ.
 */

let restoreTo: string | null = null;

async function activeRelease(request: APIRequestContext): Promise<{ id: string; label: string }> {
  const res = await request.post('/api/ai/tool', {
    data: { tool: 'list_pages', input: {} },
  });
  const { result } = await res.json();
  return result.release;
}

test.afterEach(async ({ request }) => {
  if (!restoreTo) return;
  const id = restoreTo;
  restoreTo = null;
  await request.post('/api/publish', { data: { action: 'rollback', releaseId: id } });
});

test.describe('lịch sử publish', () => {
  test('hiện danh sách và đánh dấu đúng bản đang chạy', async ({ page, request }) => {
    const active = await activeRelease(request);

    await page.goto('/builder/releases');
    await expect(page.getByRole('heading', { name: 'Lịch sử publish' })).toBeVisible();

    /*
     * Đếm nhãn TRONG DANH SÁCH, không đếm cả trang.
     *
     * Điều cần giữ là "đúng MỘT bản được đánh dấu đang chạy" — một khẳng định về
     * số RELEASE, không phải về số lần cụm chữ xuất hiện. Đếm toàn trang lẫn lộn
     * hai thứ đó, và nó đã đỏ vì đúng lý do ấy: `getByText` khớp chuỗi con, nên
     * ngoài hai nhãn thật nó còn tính câu giải thích trong khối Chờ publish
     * ("So bản nháp với bản đang chạy…") — một thẻ `<p>` nằm trong `<dialog>`
     * đang đóng, người dùng không nhìn thấy, và chẳng đánh dấu release nào cả.
     *
     * Nó chỉ lộ ra sau vài giây vì khối đó nạp bằng client fetch — nghĩa là phép
     * đếm cũ còn phụ thuộc thời điểm chụp. Đếm trong `<ol>` cắt cả hai vấn đề.
     */
    await expect(page.locator('ol > li').getByText('đang chạy')).toHaveCount(1);

    // Thẻ đầu trang (lát 5) trỏ đúng bản mà API gọi là đang chạy. Nó lặp lại nhãn
    // trong danh sách một cách CỐ Ý — xem docblock của `ReleaseTimeline` — nên chỗ
    // này kiểm danh tính, không kiểm số lượng.
    await expect(page.locator('[data-active-release]')).toHaveAttribute(
      'data-active-release',
      active.id,
    );

    const activeCard = page.locator('ol > li').filter({ hasText: 'đang chạy' });
    await expect(activeCard).toContainText(active.label);

    // Bản đang chạy KHÔNG có nút lùi về chính nó.
    await expect(activeCard.getByRole('button', { name: /Đưa site về/ })).toHaveCount(0);
  });

  test('lùi bản đổi được bản đang chạy', async ({ page, request }) => {
    const before = await activeRelease(request);
    restoreTo = before.id;

    await page.goto('/builder/releases');
    const target = page.locator('li').filter({ hasText: /Đưa site về/ }).first();
    const targetLabel = (await target.locator('span').first().innerText()).trim();

    // Nút trên dòng chỉ MỞ hộp xác nhận (`ConfirmDialog`, nói hậu quả bằng số trang
    // thật); lùi bản chạy khi bấm nút xác nhận trong hộp.
    await target.getByRole('button', { name: /Đưa site về/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Đưa site về bản này' }).click();
    await expect(page.getByText(/Đã đưa site về/)).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(async () => (await activeRelease(request)).label, { timeout: 15_000 })
      .toBe(targetLabel);

    // Con trỏ đổi, và bản cũ vẫn còn nguyên trong danh sách — `PageVersion` bất
    // biến nên không có gì bị ghi đè, và lùi tiếp lên lại luôn làm được.
    await page.reload();
    await expect(page.locator('li').filter({ hasText: before.label })).toBeVisible();
  });

  test('Publish toàn site xong thì khối Việc hôm nay cập nhật, không cần tải lại trang', async ({ page, request }) => {
    const before = await activeRelease(request);
    restoreTo = before.id;

    /*
     * Một lần sửa nháp trên /gioi-thieu để chắc chắn có dòng chờ publish.
     *
     * Lỗi cũ: `PendingWork` tự tải danh sách một lần lúc gắn, còn nút ở dưới chỉ
     * `router.refresh()` — các trang đã lên site mà khối này vẫn liệt kê chúng.
     */
    const { pages } = (await (
      await request.post('/api/ai/tool', { data: { tool: 'list_pages', input: {} } })
    ).json()).result as { pages: { id: string; path: string }[] };
    const target = pages.find((p) => p.path === '/gioi-thieu')!;
    const { rootId } = (await (
      await request.post('/api/ai/tool', { data: { tool: 'get_page_outline', input: { pageId: target.id } } })
    ).json()).result;
    const added = await request.post('/api/ops', {
      data: {
        pageId: target.id,
        label: 'e2e việc hôm nay',
        ops: [
          {
            op: 'insertNode', parentId: rootId, index: 0,
            node: {
              id: 'e2ependingrefresh', parentId: rootId, type: 'Text', tag: 'p',
              children: [], effects: [], style: { base: {} },
              content: [{ t: 'text', v: 'E2E chờ publish' }],
            },
          },
        ],
      },
    });
    expect(added.ok(), await added.text()).toBe(true);

    try {
      await page.goto('/builder/releases');
      const row = page.locator('[data-pending-work] li').filter({ hasText: '/gioi-thieu' });
      await expect(row).toBeVisible();

      await page.getByRole('button', { name: 'Publish toàn site' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Publish mọi trang' }).click();
      await expect(page.getByText(/Đã publish \d+ trang/)).toBeVisible({ timeout: 30_000 });

      await expect(row).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await request.post('/api/ops', {
        data: { pageId: target.id, label: 'e2e dọn', ops: [{ op: 'removeNode', nodeId: 'e2ependingrefresh' }] },
      });
    }
  });
});

test.describe('phân quyền', () => {
  test('viewer xem được lịch sử nhưng không có nút lùi, và API từ chối', async ({ browser, request }) => {
    const email = `rel-viewer-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'mat-khau-du-dai';
    const { user } = await (
      await request.post('/api/users', { data: { email, password, role: 'viewer' } })
    ).json();

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto('/builder/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.waitForURL('**/builder');

    await page.goto('/builder/releases');
    await expect(page.getByRole('heading', { name: 'Lịch sử publish' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Đưa site về/ })).toHaveCount(0);

    // Ẩn nút không phải là cổng — API phải tự từ chối.
    const active = await activeRelease(request);
    const denied = await page.request.post('/api/publish', {
      data: { action: 'rollback', releaseId: active.id },
    });
    expect(denied.status()).toBe(403);

    await ctx.close();
    await request.delete(`/api/users/${user.id}`);
  });
});
