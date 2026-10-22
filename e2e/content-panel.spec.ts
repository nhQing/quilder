import { expect, test, type Page } from '@playwright/test';

/**
 * Sửa chữ ngay trong bảng thuộc tính.
 *
 * Điều được kiểm ở đây KHÔNG phải "có ô textarea": mà là ba tính chất khiến ô đó
 * đúng đắn thay vì chỉ tồn tại.
 *
 *  1. **Mốc liên kết là khoá của bảng Văn bản.** Ô hiện đúng `nodeId:field` —
 *     `unitKey`. Nếu panel tự sinh một khoá riêng thì sửa ở đây và sửa ở bảng Nội
 *     dung là hai nguồn sự thật, và chúng sẽ lệch.
 *  2. **Ghi đi qua op, nên undo được.** Đây là hợp đồng của cả builder: không có
 *     đường ghi tắt nào tồn tại song song với op.
 *  3. **Chữ CÓ CẤU TRÚC thì chỉ đọc.** Ghi một chuỗi vào `RichText` có link sẽ san
 *     phẳng cây và làm mất `href` — im lặng. Cấm là đúng, và phải nói rõ vì sao.
 *
 * Test này CÓ ghi vào doc, nên nó hoàn nguyên trong `afterEach`. Xem HANDOFF §3.35:
 * một bản nháp bẩn sẽ bị `users.spec.ts` publish lên site thật.
 */

const PAGE_SLUG = 'gioi-thieu';

let pending: { pageId: string; ops: unknown[] } | null = null;

test.afterEach(async ({ request }) => {
  const job = pending;
  pending = null;
  if (!job) return;
  const res = await request.post('/api/ops', {
    data: { pageId: job.pageId, label: 'e2e content-panel — hoàn tác', ops: job.ops },
  });
  if (!res.ok()) console.error(`[dọn] THẤT BẠI ${res.status()}: ${await res.text()}`);
});

async function openEditor(page: Page): Promise<string> {
  await page.goto('/builder');
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('link', { name: new RegExp(PAGE_SLUG) }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  return page.url().split('/').pop()!;
}

/** Chọn node chữ đầu tiên trong cây, và trả về khoá đơn vị của nó. */
async function selectFirstText(page: Page): Promise<string> {
  await page.getByRole('button', { name: /Tiêu đề/ }).first().click();
  const panel = page.locator('[data-content-panel]');
  await expect(panel).toBeVisible();
  const key = await panel.locator('code').first().textContent();
  expect(key, 'panel Nội dung không hiện khoá đơn vị').toBeTruthy();
  return key!.trim();
}

test('khoá hiện ra đúng dạng nodeId:field — cùng khoá bảng Văn bản dùng', async ({ page }) => {
  await openEditor(page);
  const key = await selectFirstText(page);

  // `unitKey` = `${nodeId}:${field}`. Bốn field hợp lệ, không phải chuỗi tuỳ ý.
  expect(key).toMatch(/^[\w-]+(\/[\w-]+)?:(content|label|alt|a11yLabel)$/);

  // Ô nhập được gán nhãn BẰNG khoá đó, nên test và screen reader trỏ tới cùng một chỗ.
  await expect(page.getByLabel(`Chữ ${key}`)).toBeVisible();
});

test('sửa chữ ghi qua op, và undo trả lại nguyên văn', async ({ page, request }) => {
  const pageId = await openEditor(page);
  const key = await selectFirstText(page);
  const [nodeId, field] = key.split(':') as [string, string];

  const box = page.getByLabel(`Chữ ${key}`);
  const before = await box.inputValue();
  expect(before.length, 'node chữ mà rỗng thì test này không nói được gì').toBeGreaterThan(0);

  // Hoàn nguyên bằng CHÍNH đường ghi của panel, không phải bằng nút Undo của UI:
  // nếu assert ở giữa mà đỏ, `afterEach` vẫn dọn.
  pending = {
    pageId,
    ops: [{ op: 'setText', nodeId, field, value: [{ t: 'text', v: before }] }],
  };

  const after = `${before} — e2e`;
  await box.fill(after);
  await box.press('Enter');

  /*
   * Ghi THẬT: đọc lại HTML render của bản nháp, không tin vào state của trang.
   *
   * `/render/:id` là thứ site thật dùng, nên nó chứng minh chữ đã vào doc VÀ đi hết
   * đường biên dịch — mạnh hơn việc đọc lại một endpoint JSON.
   */
  await expect(async () => {
    const html = await (await request.get(`/render/${pageId}`)).text();
    expect(html).toContain(after);
  }).toPass({ timeout: 8_000 });

  // Undo của builder phải trả lại đúng bản cũ — chứng minh ô này không có đường
  // ghi riêng nằm ngoài history stack.
  // Nút undo chỉ có ký hiệu ↶; `aria-label` là cái cho nó một cái tên (và cho screen
  // reader đọc được nó). KHÔNG trỏ bằng `title`: nút xoá của mỗi layer cũng có chữ
  // "Hoàn tác" trong title, nên `getByTitle` khớp ba phần tử.
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expect(page.getByLabel(`Chữ ${key}`)).toHaveValue(before);

  pending = null;
});

test('node bị khoá thì ô chữ CHỈ ĐỌC, và nói rõ vì sao', async ({ page, request }) => {
  const pageId = await openEditor(page);
  const key = await selectFirstText(page);
  const nodeId = key.split(':')[0]!;

  // Khoá node bằng op — không đợi bản nháp tình cờ có một node bị khoá. Test phụ
  // thuộc "trang hiện có gì" là test tự mục theo thời gian.
  const res = await request.post('/api/ops', {
    data: {
      pageId,
      label: 'e2e content-panel — khoá node',
      ops: [
        {
          op: 'setLocked',
          nodeId,
          // Schema đòi đủ ba field (`schema.ts:459`): thiếu `lockedBy`/`lockedAt` thì
          // validator từ chối cả batch — và đó là hành vi đúng, khoá phải nói ai khoá
          // và khoá lúc nào.
          locked: {
            reason: 'e2e: kiểm nhánh chỉ đọc',
            lockedBy: 'e2e',
            lockedAt: new Date().toISOString(),
          },
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  pending = { pageId, ops: [{ op: 'setLocked', nodeId, locked: null }] };

  await page.reload();
  await selectFirstText(page);

  const panel = page.locator('[data-content-panel]');
  // Không còn ô nhập, và có câu giải thích — cấm mà không nói vì sao thì người dùng
  // tưởng panel hỏng.
  await expect(panel.locator('textarea')).toHaveCount(0);
  await expect(panel.getByText(/Node đang bị khoá/)).toBeVisible();

  /*
   * MỞ KHOÁ NGAY TRONG THÂN TEST, không chỉ dựa vào `afterEach`.
   *
   * `ab000002` là node dùng chung: `text.spec.ts`, `inspector.spec.ts` và
   * `inspector-layout.spec.ts` đều ghi vào nó. Một node bị bỏ quên ở trạng thái KHOÁ
   * làm mọi spec sau đó đỏ — và đỏ với triệu chứng chẳng liên quan gì tới khoá
   * ("không thấy toast Đã lưu bản gốc"), nên người đọc log sẽ đi tìm bug ở chỗ khác.
   *
   * Mở khoá ở đây thu hẹp cửa sổ rủi ro từ "cả phần còn lại của suite" xuống "trong
   * một test". `afterEach` vẫn giữ nguyên làm lưới an toàn cho trường hợp assert ở
   * trên đỏ và thân test không chạy tới dòng này.
   */
  const unlock = await request.post('/api/ops', {
    data: {
      pageId,
      label: 'e2e content-panel — mở khoá node',
      ops: [{ op: 'setLocked', nodeId, locked: null }],
    },
  });
  expect(unlock.ok(), await unlock.text()).toBe(true);
  pending = null;

  // Và kiểm rằng nó mở khoá THẬT — "đã gửi op" không phải bằng chứng.
  await page.reload();
  await selectFirstText(page);
  await expect(page.locator('[data-content-panel] textarea')).toHaveCount(1);
});
