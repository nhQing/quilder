import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Trang Nội dung và lớp đa ngôn ngữ.
 *
 * MỌI test ở đây sửa nội dung, và trong bộ e2e này một bản nháp bẩn sẽ bị
 * `users.spec.ts` publish thẳng lên site thật. Dọn trong `afterEach`, không phải
 * `finally`: khi test hết giờ, Playwright đóng context và `finally` không chạy.
 *
 * Hợp đồng đang kiểm:
 *  - sửa bản gốc đi qua hệ op (undo được, có PageVersion)
 *  - sửa bản dịch KHÔNG chạm site thật cho tới khi publish
 *  - xem trước bản dịch nháp được, không cần publish
 *  - thiếu bản dịch thì hiện bản gốc, không bao giờ hiện chuỗi rỗng
 */

const LOCALE = 'en';

/** Node đích: tiêu đề trang giới thiệu, một đoạn phẳng nên sửa được ở bảng. */
const NODE = 'ab000002';
const FIELD = 'content';

let cleanup: Array<(request: APIRequestContext) => Promise<unknown>> = [];

test.afterEach(async ({ request }) => {
  const jobs = cleanup;
  cleanup = [];
  // Chạy hết mọi job kể cả khi một job lỗi: bỏ dở nửa đường để lại đúng loại rác
  // mà afterEach tồn tại để ngăn.
  for (const job of jobs) {
    await job(request).catch(() => undefined);
  }
});

async function pageIds(request: APIRequestContext) {
  const res = await request.post('/api/ai/tool', { data: { tool: 'list_pages', input: {} } });
  const { result } = await res.json();
  // Tool trả `path` (`/gioi-thieu`), không phải `slug`. Chuẩn hoá ở đúng một chỗ
  // thay vì rải `.replace()` khắp file.
  return (result.pages as { id: string; path: string; title: string }[]).map((p) => ({
    ...p,
    slug: p.path.replace(/^\//, ''),
  }));
}

async function readText(request: APIRequestContext, pageId: string): Promise<unknown> {
  const res = await request.post('/api/ai/tool', {
    data: { tool: 'get_node', input: { pageId, nodeIds: [NODE] } },
  });
  const { result } = await res.json();
  return result.nodes[NODE].content;
}

async function openText(page: Page, pageId: string) {
  await page.goto(`/builder/text?page=${pageId}`);
  await expect(page.getByRole('heading', { name: 'Văn bản', exact: true })).toBeVisible();
}

test.describe('bảng Văn bản', () => {
  test('rút đúng đơn vị và lọc được', async ({ page, request }) => {
    const pages = await pageIds(request);
    const home = pages.find((p) => p.slug === '')!;
    await openText(page, home.id);

    // Bộ lọc là nút bấm được, và số trên nó là số thật của trang này.
    const all = page.getByRole('button', { name: /^tất cả/ });
    await expect(all).toHaveAttribute('aria-pressed', 'true');

    const structured = page.getByRole('button', { name: /^có cấu trúc/ });
    await structured.click();
    await expect(structured).toHaveAttribute('aria-pressed', 'true');

    // Ô có cấu trúc KHÔNG được có nút sửa — gõ phẳng ngược vào sẽ san phẳng cây
    // inline và giết hiệu ứng tách chữ.
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.first().getByRole('button', { name: /^Sửa bản gốc/ }).count()).toBe(0);

    // Bấm lại thì tắt lọc.
    await structured.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
  });

  test('tìm không dấu', async ({ page, request }) => {
    const pages = await pageIds(request);
    const home = pages.find((p) => p.slug === '')!;
    await openText(page, home.id);

    const before = await page.locator('tbody tr').count();
    await page.getByLabel('Tìm trong bảng chữ').fill('tien');
    await expect.poll(() => page.locator('tbody tr').count()).toBeLessThan(before);
    // "tien" phải bắt được "tiền" — nếu không thì ô tìm gần như vô dụng với
    // người gõ nhanh.
    await expect(page.locator('tbody')).toContainText(/[Tt]iền/);
  });
});

test.describe('sửa bản gốc', () => {
  test('đi qua hệ op và ghi vào doc', async ({ page, request }) => {
    test.setTimeout(90_000);

    const pages = await pageIds(request);
    const target = pages.find((p) => p.slug === 'gioi-thieu')!;
    const before = await readText(request, target.id);

    /*
     * CHẶN rác của lần chạy trước, và chặn nó ồn ào.
     *
     * Sự cố 20/08/2026: một lần chạy đỏ SAU khi op đã ghi, cleanup không hoàn nguyên
     * kịp, và bản nháp nằm lại ở "E2E BẢN GỐC". Từ đó test đỏ VĨNH VIỄN và tự nuôi chính
     * nó: `before` đọc ra chính chuỗi rác, ô nhập fill lại đúng chuỗi đang có, nên
     * `finish()` trong TextTable thấy `draft === value` và KHÔNG lưu gì — không có op,
     * không có toast. Rồi cleanup "hoàn nguyên" về chuỗi rác, xi măng hoá nó.
     *
     * Triệu chứng ("không thấy toast") không chỉ về phía nguyên nhân chút nào, nên nó
     * ngốn cả một vòng điều tra. Chặn ở đây biến nó thành một câu nói thẳng.
     *
     * Còn tệ hơn cả test đỏ: bộ e2e này CÓ publish (`users.spec.ts`), nên chữ rác trong
     * nháp có thể lên site thật. Xem HANDOFF §3.35 — đã xảy ra một lần với hero trang chủ.
     */
    const beforeText = JSON.stringify(before);
    expect(
      beforeText.includes('E2E'),
      `Bản nháp còn rác e2e trong ${NODE}.${FIELD}: ${beforeText}. ` +
        'Hoàn nguyên bằng một op setText trước khi chạy lại — nếu không, test này đỏ mãi ' +
        'và rác có thể lên site thật ở lần publish tiếp theo.',
    ).toBe(false);

    cleanup.push((r) =>
      r.post('/api/ops', {
        data: {
          pageId: target.id,
          label: 'e2e chữ — hoàn nguyên bản gốc',
          ops: [{ op: 'setText', nodeId: NODE, field: FIELD, value: before }],
        },
      }),
    );

    await openText(page, target.id);
    const cell = page.getByRole('button', { name: /^Sửa bản gốc/ }).first();
    await cell.click();
    const box = page.getByLabel(/^Sửa bản gốc/).first();
    /*
     * Chuỗi ghi phải KHÁC chuỗi đang có.
     *
     * `finish()` trong TextTable chỉ gọi `onSave` khi `draft !== value` — đúng đắn (không
     * tạo PageVersion rỗng), nhưng nó nghĩa là fill một chuỗi cố định là đánh cược rằng
     * bản nháp chưa mang đúng chuỗi đó. Gắn thêm dấu thời gian thì cược đó không còn.
     */
    const after = `E2E BẢN GỐC ${Date.now()}`;
    await box.fill(after);
    await box.press('Enter');

    /*
     * 15s, không phải 5s mặc định.
     *
     * Toast này chỉ hiện SAU khi POST /api/ops trả về — tức nó chờ một lượt ghi vào DB
     * (tạo PageVersion mới) rồi `router.refresh()` dựng lại cả bảng. Trong một lần chạy
     * full-suite, lượt ghi đó đã đo được vượt 5s: ảnh chụp lúc đỏ cho thấy ô còn ở trạng
     * thái `[disabled]`, tức `busy` chưa nhả — POST vẫn đang bay, chưa có gì hỏng.
     *
     * Assertion NGAY DƯỚI đây, kiểm cùng một lượt ghi, đã cho 15s từ đầu. Để 5s ở đây là
     * một sự bất nhất, không phải một phép kiểm nghiêm hơn.
     *
     * Toast tự tắt sau 3.2s (`flash` trong TextTable), nhưng `toContainText` dò liên tục
     * nên nó vẫn bắt được ở bất kỳ thời điểm nào trong cửa sổ 15s.
     */
    await expect(page.getByRole('status')).toContainText(/Đã lưu bản gốc/, { timeout: 15_000 });
    await expect
      .poll(async () => JSON.stringify(await readText(request, target.id)), { timeout: 15_000 })
      .toContain(after);
  });
});

test.describe('bản dịch', () => {
  test('lưu được, xem trước được, và KHÔNG lên site thật', async ({ request }) => {
    test.setTimeout(90_000);

    const pages = await pageIds(request);
    const target = pages.find((p) => p.slug === 'gioi-thieu')!;

    cleanup.push((r) =>
      r.post('/api/translations', {
        data: { pageId: target.id, locale: LOCALE, nodeId: NODE, field: FIELD, value: null },
      }),
    );

    const res = await request.post('/api/translations', {
      data: {
        pageId: target.id, locale: LOCALE, nodeId: NODE, field: FIELD,
        value: [{ t: 'text', v: 'E2E ENGLISH HEADING' }],
      },
    });
    expect(res.ok()).toBe(true);

    // Xem trước bản NHÁP thấy bản dịch — đây là đường duy nhất để soát trước khi
    // publish, và không có nó thì phải dùng site thật làm bản nháp.
    const preview = await (await request.get(`/preview/${target.id}?locale=${LOCALE}`)).text();
    expect(preview).toContain('E2E ENGLISH HEADING');

    // Xem trước KHÔNG kèm locale thì vẫn là bản gốc.
    const previewVi = await (await request.get(`/preview/${target.id}`)).text();
    expect(previewVi).not.toContain('E2E ENGLISH HEADING');

    // Và site THẬT chưa thấy gì: bản dịch là nháp cho tới khi publish. Đây là
    // tính chất quan trọng nhất của cả lớp này — mất nó thì mọi ký tự vừa gõ lên
    // sóng ngay.
    const live = await (await request.get(`/${LOCALE}/gioi-thieu`)).text();
    expect(live).not.toContain('E2E ENGLISH HEADING');
  });

  test('thiếu bản dịch thì hiện bản gốc, không hiện chuỗi rỗng', async ({ request }) => {
    // Một nút trắng hỏng nặng hơn một nút còn tiếng Việt: chữ sai ngôn ngữ thì
    // người ta vẫn bấm được và vẫn báo lại được.
    const html = await (await request.get(`/${LOCALE}/gioi-thieu`)).text();
    expect(html).toContain('Về chúng tôi');
    expect(html).toContain('lang="en"');
  });

  test('sửa được bản dịch từ bảng Văn bản', async ({ page, request }) => {
    test.setTimeout(90_000);

    const pages = await pageIds(request);
    const target = pages.find((p) => p.slug === 'gioi-thieu')!;

    cleanup.push((r) =>
      r.post('/api/translations', {
        data: { pageId: target.id, locale: LOCALE, nodeId: NODE, field: FIELD, value: null },
      }),
    );

    await openText(page, target.id);
    const box = page.getByLabel(/^Sửa bản dịch/);
    await page.getByRole('button', { name: /^Sửa bản dịch/ }).first().click();
    await box.first().fill('E2E FROM TABLE');
    await box.first().press('Enter');

    // Cùng lý do như assertion ở test trên: nó chờ một lượt ghi qua mạng.
    await expect(page.getByRole('status')).toContainText(/Đã lưu bản dịch/, { timeout: 15_000 });

    const preview = await (await request.get(`/preview/${target.id}?locale=${LOCALE}`)).text();
    expect(preview).toContain('E2E FROM TABLE');
  });

  test('không cho dịch ngôn ngữ gốc', async ({ request }) => {
    // Ngôn ngữ gốc sống trong doc. Cho ghi vào bảng dịch sẽ tạo hai nguồn sự
    // thật cho cùng một chuỗi, và chúng sẽ lệch nhau.
    const pages = await pageIds(request);
    const target = pages.find((p) => p.slug === 'gioi-thieu')!;
    const res = await request.post('/api/translations', {
      data: {
        pageId: target.id, locale: 'vi', nodeId: NODE, field: FIELD,
        value: [{ t: 'text', v: 'x' }],
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('ngôn ngữ gốc');
  });

  test('chặn nodeId không có trong trang', async ({ request }) => {
    // Không chặn thì một nodeId gõ sai tạo một hàng vĩnh viễn không ai đọc tới
    // và không ai biết là rác.
    const pages = await pageIds(request);
    const target = pages.find((p) => p.slug === 'gioi-thieu')!;
    const res = await request.post('/api/translations', {
      data: {
        pageId: target.id, locale: LOCALE, nodeId: 'khong-ton-tai', field: FIELD,
        value: [{ t: 'text', v: 'x' }],
      },
    });
    expect(res.status()).toBe(404);
  });

  test('chặn giá trị sai hình dạng', async ({ request }) => {
    const pages = await pageIds(request);
    const target = pages.find((p) => p.slug === 'gioi-thieu')!;
    const res = await request.post('/api/translations', {
      data: {
        pageId: target.id, locale: LOCALE, nodeId: NODE, field: FIELD,
        value: 'chuỗi trần cho một trường RichText',
      },
    });
    expect(res.status()).toBe(400);
  });
});
