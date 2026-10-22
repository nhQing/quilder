import { expect, test, type Page } from '@playwright/test';

/**
 * Rào chắn của màn editor.
 *
 * Mỗi test ở đây khoá lại một lỗi ĐÃ TỪNG tồn tại và tốn thời gian thật của
 * người dùng — không phải một tính chất giả định. Chúng đều thuộc loại hỏng im
 * lặng: giao diện nói một đằng, hệ thống làm một nẻo.
 *
 * KHÔNG test nào ở đây được phép publish thật. Test nào bấm Publish đều chặn
 * route `/api/publish` trước, hoặc huỷ ở hộp xác nhận.
 */

async function openEditor(page: Page): Promise<string> {
  await page.goto('/builder');
  await page.getByRole('link', { name: /gioi-thieu/ }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  return page.url().split('/').pop()!;
}

test.describe('publish — thao tác duy nhất khách thấy ngay', () => {
  test('hỏi xác nhận, huỷ thì KHÔNG gọi API', async ({ page }) => {
    await openEditor(page);

    let called = false;
    await page.route('**/api/publish', async (route) => {
      called = true;
      await route.abort();
    });

    let asked = '';
    page.once('dialog', (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });

    await page.getByRole('button', { name: 'Publish' }).click();

    // Hai nhánh thông điệp tuỳ có trang nào đổi hay không; điều phải đúng là
    // CÓ hỏi lại, và hộp thoại nói rõ đang làm gì.
    expect(asked, 'Publish phải hỏi lại trước khi đẩy lên site thật').toMatch(/publish/i);
    // Đợi đủ lâu để một request lỡ bị bắn ra kịp lộ diện.
    await page.waitForTimeout(500);
    expect(called, 'huỷ ở hộp xác nhận mà vẫn gọi /api/publish').toBe(false);
  });

  test('nút trong trang chỉ publish ĐÚNG trang đó, không phải cả site', async ({ page }) => {
    // Nút này từng gửi `{ action: 'publish' }` trần: người dùng sửa một trang,
    // bấm Publish trên chính trang đó, và mọi trang nháp dở khác lên site theo —
    // không có gì trên màn hình nói ra điều đó. Đây là phép kiểm giữ cho nó không
    // lặng lẽ quay về hành vi cũ; một lần "đơn giản hoá" body request là đủ.
    const pageId = await openEditor(page);

    let sent: unknown = null;
    await page.route('**/api/publish', async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, pageCount: 2, publishedPageCount: 1, ms: 12 }),
      });
    });

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Publish' }).click();

    await expect.poll(() => sent).not.toBeNull();
    expect(sent, 'body publish phải nêu đích danh trang đang mở').toMatchObject({
      action: 'publish',
      pageIds: [pageId],
    });
  });

  test('publish thất bại hiện màu LỖI, không phải màu thành công', async ({ page }) => {
    await openEditor(page);

    // Bản trước dùng chung một state cho cả hai nhánh rồi luôn render bằng
    // `text-shell-ok` — publish hỏng vẫn ra chữ xanh lá và người dùng tưởng xong.
    await page.route('**/api/publish', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Máy chủ từ chối' }),
      }),
    );

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Publish' }).click();

    const message = page.getByRole('status').filter({ hasText: 'Máy chủ từ chối' });
    await expect(message).toBeVisible();
    await expect(message).toHaveClass(/text-shell-danger/);
    await expect(message).not.toHaveClass(/text-shell-ok/);
  });
});

test.describe('bàn phím', () => {
  test('phím Space kích hoạt được nút', async ({ page }) => {
    await openEditor(page);

    // Canvas bắt Space trên `window` để kéo. Bản trước chỉ tha INPUT/TEXTAREA,
    // nên focus ở BẤT KỲ nút nào trong builder là Space bị nuốt — bàn phím mất
    // một trong hai phím kích hoạt chuẩn.
    await page.route('**/api/publish', (route) => route.abort());

    let asked = false;
    page.once('dialog', (dialog) => {
      asked = true;
      void dialog.dismiss();
    });

    await page.getByRole('button', { name: 'Publish' }).focus();
    await page.keyboard.press('Space');

    await expect
      .poll(() => asked, { timeout: 5_000 })
      .toBe(true);
  });

  test('Ctrl+Z trong ô CSS hoàn tác chữ, không hoàn tác op trên server', async ({
    page,
    request,
  }) => {
    /*
     * Đặt ô về TRẠNG THÁI BIẾT TRƯỚC, đừng giả định nó rỗng.
     *
     * Bản đầu gõ thẳng vào ô rồi so với đúng chuỗi vừa gõ. Nhưng ô này lưu thật qua
     * `setCustomCss`, và test không dọn — nên sau vài lượt chạy node `ab000002` tích
     * lại `padding-top: 40px; opacity: .5; &:hover { color: red }`, và test đỏ vĩnh
     * viễn vì rác của chính nó. Cùng hạng lỗi với §3.35 trong HANDOFF.
     */
    const pageId = await openEditor(page);
    const clear = () =>
      request.post('/api/ops', {
        data: {
          pageId,
          label: 'e2e editor-safety — dọn customCss',
          ops: [{ op: 'setCustomCss', nodeId: 'ab000002', css: null }],
        },
      });
    expect((await clear()).ok(), 'không dọn được customCss trước khi chạy').toBe(true);

    await page.reload();
    await page.getByRole('button', { name: /Tiêu đề/ }).first().click();
    await expect(page.getByTitle('ab000002')).toBeVisible();

    const box = page.getByPlaceholder('opacity');
    await expect(box).toHaveValue('');
    await box.click();
    await box.pressSequentially('opacity: .5;');
    await expect(box).toHaveValue('opacity: .5;');

    let opsCalled = false;
    await page.route('**/api/ops', async (route) => {
      opsCalled = true;
      await route.continue();
    });

    await page.keyboard.press('Control+z');

    // Chữ trong ô phải đổi (undo của trình duyệt), và KHÔNG có op nào bay đi.
    await expect(box).not.toHaveValue('opacity: .5;');
    expect(opsCalled, 'Ctrl+Z trong ô nhập không được hoàn tác PageVersion').toBe(false);

    // Dọn: ô này lưu THẬT, nên không dọn là để lại rác cho lượt sau.
    await page.unroute('**/api/ops');
    expect((await clear()).ok(), 'không dọn được customCss sau khi chạy').toBe(true);
  });
});

test.describe('khung xem trước', () => {
  test('mở ở MỘT khổ, và ở mức thu đọc được', async ({ page }) => {
    await openEditor(page);

    const stage = page.locator('[data-stage]');
    await expect(stage).toBeVisible();

    /*
     * Bản trước bày năm khung cùng lúc và `fitAll()` lúc mount nhét cả ≈4.69k px vào
     * pane ~1060px → 20%. Ở mức đó không đọc được chữ và không bấm chọn được gì.
     *
     * Bản này chỉ có MỘT khung, nên bất biến chuyển thành hai điều đo được: đúng một
     * iframe, và mức thu không phải mức vô dụng.
     */
    await expect(stage.locator('iframe')).toHaveCount(1);

    const scale = Number(await stage.getAttribute('data-stage-scale'));
    expect(
      scale,
      `mức thu ${(scale * 100).toFixed(0)}% — khung mở ra không đọc được`,
    ).toBeGreaterThan(0.3);
    // Và không bao giờ PHÓNG TO: khổ 320px giãn lên 3× thì chữ to bằng ngón tay.
    expect(scale).toBeLessThanOrEqual(1);
  });

  /*
   * KHÔNG còn test cho "Vừa khung" và cho mức phóng tuỳ ý, và đó là quyết định.
   *
   * Cả hai điều khiển đó đã bị bỏ ngày 19/08/2026 cùng với canvas kéo–phóng. Mức thu
   * giờ là một PHÉP TÍNH (vừa bề ngang pane), không phải một điều khiển — nên thứ
   * đáng khoá là kết quả của phép tính đó, và nó nằm ở test trên. Việc đổi khổ có
   * `e2e/canvas-view.spec.ts` lo.
   */
});

test.describe('đăng xuất', () => {
  test('thất bại thì báo lỗi và Ở LẠI, không giả vờ đã thoát', async ({ page }) => {
    await page.goto('/builder');
    await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 500, body: '{}' }));

    await page.getByRole('button', { name: /Đăng xuất/ }).click();

    // Bản trước luôn `router.replace('/builder/login')`, rồi middleware đá ngược
    // về `/builder` vì cookie còn nguyên — trông như builder tự nhảy lung tung,
    // và người dùng rời máy mà tưởng đã đăng xuất.
    // Giới hạn trong cụm chứa nút: trang có thể có role=alert khác (overlay dev).
    const logout = page.getByRole('button', { name: /Đăng xuất|Đang thoát/ });
    await expect(logout.locator('xpath=..').getByRole('alert')).toContainText(/Chưa đăng xuất được/);
    await expect(page).toHaveURL(/\/builder$/);
  });
});

test.describe('trạng thái lưu — ba trạng thái, không dùng chung một biến', () => {
  /*
   * Test ở đây GHI vào bản nháp thật, nên chúng phải tự dọn.
   *
   * Hoàn nguyên bằng CHÍNH đường ops (`POST /api/ops`), không bằng nút Hoàn tác của UI: nếu một
   * assert ở giữa đỏ, `afterEach` vẫn phải trả chữ về nguyên trạng. Cùng mẫu với
   * `content-panel.spec.ts`.
   *
   * (R11: bản gốc dùng Ctrl+Z làm "một thao tác ghi" — nhưng `undo` thoát sớm khi
   * `undoStack` rỗng, và lúc vừa tải trang thì stack RỖNG, nên Ctrl+Z là no-op. Ở
   * đây dùng đúng đường ghi thật mà `content-panel.spec.ts` đã dùng: chọn node chữ
   * → `fill()` → `press('Enter')`.)
   */

  let pending: { pageId: string; ops: unknown[] } | null = null;

  test.afterEach(async ({ request }) => {
    const job = pending;
    pending = null;
    if (!job) return;
    const res = await request.post('/api/ops', {
      data: { pageId: job.pageId, label: 'e2e editor-safety — hoàn tác', ops: job.ops },
    });
    if (!res.ok()) console.error(`[dọn] THẤT BẠI ${res.status()}: ${await res.text()}`);
  });

  /** Chọn node chữ đầu tiên trong cây, và trả về khoá đơn vị của nó (mẫu `content-panel.spec.ts`). */
  async function selectFirstText(page: Page): Promise<string> {
    await page.getByRole('button', { name: /Tiêu đề/ }).first().click();
    const panel = page.locator('[data-content-panel]');
    await expect(panel).toBeVisible();
    const key = await panel.locator('code').first().textContent();
    expect(key, 'panel Nội dung không hiện khoá đơn vị').toBeTruthy();
    return key!.trim();
  }

  test('lưu xong hiện "đã lưu · v<số>" với số TĂNG, và nút Publish tăng theo', async ({
    page,
    request,
  }) => {
    const pageId = await openEditor(page);

    // 1. Đọc số v hiện tại của chip, và số hiện tại trên nút Publish (nếu có).
    const chip = page.getByText(/^đã lưu(?: · v\d+)?$/);
    await expect(chip).toBeVisible();
    const chipTextBefore = (await chip.textContent())!;
    const chipMatch = chipTextBefore.match(/v(\d+)/);
    expect(chipMatch, 'chip phải hiện số v trước khi ghi để so sánh sau').not.toBeNull();
    const seqBefore = Number(chipMatch![1]);

    const publishButton = page.getByRole('button', { name: 'Publish' });
    const publishBefore = (await publishButton.textContent())!;
    const publishMatchBefore = publishBefore.match(/(\d+) lần sửa chưa publish/);
    const unpublishedBefore = publishMatchBefore ? Number(publishMatchBefore[1]) : 0;

    // 2. Ghi THẬT: chọn node chữ đầu tiên, sửa, Enter. Ghi lại `before` để hoàn nguyên.
    const key = await selectFirstText(page);
    const [nodeId, field] = key.split(':') as [string, string];
    const box = page.getByLabel(`Chữ ${key}`);
    const before = await box.inputValue();
    expect(before.length, 'node chữ mà rỗng thì test này không nói được gì').toBeGreaterThan(0);

    pending = {
      pageId,
      ops: [{ op: 'setText', nodeId, field, value: [{ t: 'text', v: before }] }],
    };

    const after = `${before} — e2e`;
    await box.fill(after);
    await box.press('Enter');

    // Ghi THẬT: đọc lại HTML render của bản nháp, không tin vào state của trang.
    await expect(async () => {
      const html = await (await request.get(`/render/${pageId}`)).text();
      expect(html).toContain(after);
    }).toPass({ timeout: 8_000 });

    // 3. Assert chip hiện đúng `v{trước + 1}` — KHÔNG chỉ assert "có chữ đã lưu".
    await expect(chip).toHaveText(`đã lưu · v${seqBefore + 1}`, { timeout: 8_000 });

    // 4. Assert số trên nút Publish tăng đúng 1.
    await expect(publishButton).toContainText(
      `${unpublishedBefore + 1} lần sửa chưa publish`,
    );
  });

  test('lưu TRƯỢT hiện "lỗi lưu" kèm nút thử lại, và KHÔNG hiện "đã lưu"', async ({ page }) => {
    // 1. Mở editor, xác nhận chip đang hiện "đã lưu".
    await openEditor(page);
    await expect(page.getByText(/^đã lưu(?: · v\d+)?$/)).toBeVisible();

    // 2. Chặn `**/api/ops` TRƯỚC khi ghi, nên không có gì vào DB → test này KHÔNG cần
    // hoàn nguyên: bản nháp chưa hề bị đổi.
    await page.route('**/api/ops', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Máy chủ từ chối' }),
      }),
    );

    // 3. Ghi thật (cùng đường như test trên) — request sẽ trượt vì route bị chặn.
    const key = await selectFirstText(page);
    const box = page.getByLabel(`Chữ ${key}`);
    const before = await box.inputValue();
    expect(before.length, 'node chữ mà rỗng thì test này không nói được gì').toBeGreaterThan(0);
    await box.fill(`${before} — e2e lỗi`);
    await box.press('Enter');

    // 4. Assert: thấy "lỗi lưu"; thấy nút có tên "thử lại".
    await expect(page.getByText('lỗi lưu')).toBeVisible();
    await expect(page.getByRole('button', { name: 'thử lại' })).toBeVisible();

    // 5. Câu CHỊU LỰC của cả file: hai trạng thái không được cùng lúc. Đây là lỗi đã
    // từng tồn tại (publish hỏng hiện chữ xanh), nên nó phải có rào chắn riêng.
    await expect(page.getByText(/đã lưu/)).toHaveCount(0);
  });

  test('nút Publish nói số lần sửa, và vẫn tìm được bằng tên "Publish"', async ({ page }) => {
    // Không ghi gì — chỉ assert trên trang vừa tải.
    await openEditor(page);

    // 1. `getByRole('button', { name: 'Publish' })` phải thấy được. Phép so tên là CHUỖI
    // CON, nên nhãn dài vẫn khớp — đây chính là ràng buộc mọi nhãn của `publishLook`
    // phải giữ.
    const publishButton = page.getByRole('button', { name: 'Publish' });
    await expect(publishButton).toBeVisible();

    // 2. Assert nhãn khớp `/Publish trang này( · .+)?/`.
    await expect(publishButton).toHaveText(/Publish trang này( · .+)?/);
  });
});
