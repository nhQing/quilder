import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Mở một component ra sửa TỪ pane trái.
 *
 * Trước đây đường duy nhất là chọn một `Instance` trên trang rồi bấm "Sửa
 * component" ở pane phải — nghĩa là component chưa được chèn ở đâu thì không mở ra
 * được bằng giao diện.
 *
 * Không test nào ở đây sửa nội dung, nên không cần `afterEach` dọn: chúng chỉ MỞ
 * chế độ sửa rồi thoát. Nếu về sau có test ghi vào cây component, nhớ dọn — bộ e2e
 * này publish, và `Release.components` là ảnh chụp nên thay đổi component cũng lên
 * site thật.
 */

const HOME = /^Trang chủ \/$/;

async function openEditor(page: Page) {
  await page.goto('/builder');
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('link', { name: HOME }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
}

const left = (page: Page) => page.locator('aside').first();

const openComponentSection = async (page: Page) => {
  await left(page).getByRole('button', { name: /^Comp/ }).click();
};

test.describe('mở component ra sửa từ pane trái', () => {
  test('mỗi component có nút Sửa, cạnh Chèn và Bản sao', async ({ page }) => {
    await openEditor(page);
    await openComponentSection(page);

    // Ba lựa chọn của cùng một câu hỏi: dùng nó, tách nó ra, hay sửa chính nó.
    await expect(left(page).getByRole('button', { name: 'Chèn', exact: true }).first()).toBeVisible();
    await expect(left(page).getByRole('button', { name: 'Bản sao' }).first()).toBeVisible();
    await expect(left(page).getByRole('button', { name: /^Sửa/ }).first()).toBeVisible();

    // Component builtin phải CẢNH BÁO: chạy lại extract-presets là ghi đè. Dấu cảnh báo
    // là icon, nên tên trợ năng nói nó bằng chữ.
    const warn = left(page).getByRole('button', { name: /^Sửa \(trích tự động\)/ }).first();
    await expect(warn).toHaveAttribute('title', /GHI ĐÈ/);
  });

  test('bấm Sửa vào chế độ component, và cây node là cây CỦA component', async ({ page }) => {
    await openEditor(page);
    const pageRows = await page.locator('[data-layer-row]').count();

    await openComponentSection(page);
    await left(page).getByRole('button', { name: /^Sửa/ }).first().click();

    /*
     * 15s, không phải 5s mặc định.
     *
     * Đo được ngày 20/08/2026: từ lúc bấm tới lúc banner hiện mất ~2000ms — fetch preset,
     * đổi cả doc của store, rồi iframe nạp lại. 2s trên ngân sách 5s là 40%, nên hễ dev
     * server đang bận (chạy full-suite) là test đỏ. Nó đã đỏ 3 trong 5 lần chạy.
     *
     * Đây KHÔNG phải nới hạn để che một lỗi: chuyển chế độ là một thao tác nặng có thật,
     * và `role="status"` bên dưới là mốc xác định để chờ thay vì đoán bằng thời gian.
     */
    await expect(page.getByRole('status').filter({ hasText: /Đang mở component/ }))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Quay lại trang/ })).toBeVisible();

    // Cây phải nhỏ hơn cây trang — nếu vẫn bằng thì store chưa trỏ sang component
    // và mọi op sau đó sẽ ghi vào TRANG.
    await expect
      .poll(() => page.locator('[data-layer-row]').count(), { timeout: 15_000 })
      .toBeLessThan(pageRows);

    // Canvas phải trỏ vào route render của component.
    await expect(page.locator('iframe').first()).toHaveAttribute(
      'src',
      /\/render\/component\//,
    );
  });

  test('vào chế độ component thì mục Lớp tự mở, không để pane trống', async ({ page }) => {
    await openEditor(page);

    // Đi qua đúng đường người dùng đi: mở mục Component (việc này ĐÓNG mục Lớp),
    // rồi bấm Sửa. Ở chế độ component, mục Component không còn tồn tại — nếu pane
    // vẫn giữ nó làm "mục đang mở" thì không có gì mở ra cả và người dùng vào màn
    // sửa component mà không thấy cây node.
    await openComponentSection(page);
    await expect(left(page).getByRole('button', { name: /^Lớp/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await left(page).getByRole('button', { name: /^Sửa/ }).first().click();
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible();

    const layers = left(page).getByRole('button', { name: /^Lớp/ });
    await expect(layers).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-layer-row]').first()).toBeVisible();
  });

  test('khung co lại bằng component, không còn cao một màn thiết bị', async ({ page }) => {
    await openEditor(page);

    // `data-stage-height` là chiều cao ĐẶT vào khung, trong hệ chưa thu — không lẫn
    // với hiệu ứng của mức thu lên rect trên màn hình.
    const frameHeight = async () =>
      Number(await page.locator('[data-stage]').getAttribute('data-stage-height'));

    /*
     * Với TRANG, chiều cao khung là chiều cao một màn thiết bị (mặc định 1440×900) —
     * không phải chiều cao nội dung, và không phải con số 1400 cứng của bản cũ.
     */
    const pageFrame = await frameHeight();
    expect(pageFrame).toBe(900);

    await openComponentSection(page);
    await left(page).getByRole('button', { name: /^Sửa/ }).first().click();
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible();

    // Một cái nút 43px trong khung 900px thì nằm lọt góc trên–trái một vùng trắng
    // mênh mông. Khi sửa COMPONENT thì khung bám nội dung — đây là ngoại lệ duy nhất.
    await expect.poll(frameHeight, { timeout: 15_000 }).toBeLessThan(pageFrame / 2);
  });

  test('đang sửa component thì không bày đường mở component khác', async ({ page }) => {
    await openEditor(page);
    await openComponentSection(page);
    await left(page).getByRole('button', { name: /^Sửa/ }).first().click();
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible();

    // Component lồng component bị chặn ở đường ghi, nên cũng đừng bày lối vào nó.
    await expect(left(page).getByRole('button', { name: /^Comp/ })).toHaveCount(0);
    await expect(left(page).getByRole('button', { name: /^Sửa/ })).toHaveCount(0);
  });
});

/**
 * Ba lỗi người dùng báo ngày 16/10/2026 ở pane Component:
 *  - bấm vào một mục không có gì xảy ra;
 *  - bấm Chèn / Bản sao "không thấy gì" — node vào cuối trang, ngoài khung nhìn;
 *  - vào "Sửa" rồi bấm quay lại thì về trang chủ builder, không về trang đang sửa.
 */
test.describe('pane Component dẫn tới đúng chỗ', () => {
  const SHOWN = '[data-stage-frame] iframe[data-canvas-frame="shown"]';

  async function canvasFrame(page: Page) {
    await expect
      .poll(
        () =>
          page.evaluate((sel) => {
            const d = document.querySelector<HTMLIFrameElement>(sel)?.contentDocument;
            return d?.readyState === 'complete' && d.querySelectorAll('[data-n]').length > 0;
          }, SHOWN),
        { timeout: 30_000 },
      )
      .toBe(true);
    return (await (await page.locator(SHOWN).elementHandle())!.contentFrame())!;
  }

  /**
   * Tìm khung đang hiện TỪ TRANG CHA mỗi lần đo, không giữ handle: lưu xong canvas hoán
   * sang iframe khác, và handle của khung cũ thành `null` giữa chừng.
   */
  const inView = (page: Page, id: string) =>
    page.evaluate(
      ({ sel, id }) => {
        const d = document.querySelector<HTMLIFrameElement>(sel)?.contentDocument;
        const el = d?.querySelector(`[data-n="${id}"]`);
        if (!d || !el) return false;
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < d.documentElement.clientHeight;
      },
      { sel: SHOWN, id },
    );

  const usesOf = async (page: Page, item: string) =>
    ((await left(page).locator(`[data-component-item="${item}"]`).getAttribute('data-uses')) ?? '')
      .split(' ')
      .filter(Boolean);

  test('bấm một mục đang dùng → chọn chỗ dùng và cuộn khung tới đó', async ({ page }) => {
    await openEditor(page);
    await openComponentSection(page);
    await canvasFrame(page);

    // Một component có chỗ dùng NGOÀI khung lúc mở — không thì "đã cuộn tới" xanh vô nghĩa.
    const items = await left(page).locator('[data-component-item]').evaluateAll((els) =>
      els.map((e) => ({ id: e.getAttribute('data-component-item')!, uses: (e.getAttribute('data-uses') ?? '').split(' ').filter(Boolean) })),
    );
    let pick: { id: string; first: string } | null = null;
    for (const it of items) {
      if (it.uses.length && !(await inView(page, it.uses[0]!))) {
        pick = { id: it.id, first: it.uses[0]! };
        break;
      }
    }
    expect(pick, 'trang chủ phải có component dùng ở dưới màn đầu').not.toBeNull();

    const item = left(page).locator(`[data-component-item="${pick!.id}"]`);
    await expect(item.getByText(/trên trang/)).toBeVisible();
    await item.getByRole('button').first().click();

    await expect.poll(() => inView(page, pick!.first), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('[data-stage-frame]').getByText(pick!.first, { exact: true })).toBeVisible();
  });

  test('component chưa dùng trên trang → nói rõ ngay tại mục', async ({ page, request }) => {
    // Seed trung tính dùng MỌI component trên trang chủ, nên tự tạo một cái chưa dùng.
    const made = await request.post('/api/presets', { data: { name: 'E2E chưa dùng' } });
    expect(made.ok(), await made.text()).toBe(true);
    const { preset } = (await made.json()) as { preset: { id: string } };
    try {
      await openEditor(page);
      await openComponentSection(page);
      const unused = left(page).locator(`[data-component-item="${preset.id}"]`);
      await expect(unused).toHaveAttribute('data-uses', '');
      await checkUnused(unused);
    } finally {
      await request.delete(`/api/presets/${preset.id}`);
    }
  });

  async function checkUnused(unused: Locator) {
    await unused.getByRole('button').first().click();
    const note = unused.getByRole('status');
    await expect(note).toContainText('Chưa dùng trên trang này');
    // 22/10/2026: lời báo cũ là chữ xám dưới đáy thẻ, user tưởng bấm không ăn. Giờ nó phải
    // nằm trong tầm nhìn và mang luôn nút Chèn.
    await expect(note).toBeInViewport();
    await expect(note.getByRole('button', { name: /^Chèn vào/ })).toBeVisible();
  }

  test('Chèn khi không chọn gì → node vào cuối trang VÀ khung cuộn tới nó', async ({ page }) => {
    await openEditor(page);
    await openComponentSection(page);
    await canvasFrame(page);

    const item = left(page).locator('[data-component-item]').first();
    const id = (await item.getAttribute('data-component-item'))!;
    const before = await usesOf(page, id);

    await item.getByRole('button', { name: 'Chèn', exact: true }).click();
    await expect.poll(() => usesOf(page, id).then((u) => u.length), { timeout: 15_000 }).toBe(before.length + 1);
    const added = (await usesOf(page, id)).find((u) => !before.includes(u))!;

    try {
      await expect.poll(() => inView(page, added), { timeout: 20_000 }).toBe(true);
    } finally {
      // Dọn: hoàn tác lần chèn, bản nháp về như cũ.
      await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
      await expect.poll(() => usesOf(page, id).then((u) => u.length), { timeout: 15_000 }).toBe(before.length);
    }
  });

  test('vào Sửa từ pane → Back của trình duyệt về lại TRANG đang sửa, không về trang chủ', async ({ page }) => {
    await openEditor(page);
    const editorUrl = page.url();
    await openComponentSection(page);

    await left(page).getByRole('button', { name: /^Sửa/ }).first().click();
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\?component=/);

    await page.goBack();
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toHaveCount(0, { timeout: 15_000 });
    expect(page.url()).toBe(editorUrl);
    await expect(page.locator('iframe').first()).not.toHaveAttribute('src', /\/render\/component\//, { timeout: 15_000 });
  });

  test('nút quay lại trên thanh trên cùng thoát component, không nhảy ra trang chủ', async ({ page }) => {
    await openEditor(page);
    const editorUrl = page.url();
    await openComponentSection(page);

    await left(page).getByRole('button', { name: /^Sửa/ }).first().click();
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Về trang', exact: true }).click();
    await expect(page.getByText(/ĐANG SỬA COMPONENT/i)).toHaveCount(0, { timeout: 15_000 });
    expect(page.url()).toBe(editorUrl);
    await expect(page.getByRole('link', { name: 'Trang', exact: true }).first()).toBeVisible();
  });
});
