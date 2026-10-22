import { expect, test, type Page } from '@playwright/test';

/**
 * Control có kiểu trong inspector.
 *
 * Hợp đồng với người dùng, không phải chi tiết cài đặt:
 *  - gõ sai bị chặn NGAY tại ô, không phải đợi server từ chối rồi mới hiện lỗi
 *  - sửa ở màn nào chỉ ảnh hưởng màn đó
 *  - gỡ override quay về kế thừa, không để lại rác
 *
 * MỌI test sửa nội dung phải dọn trong `afterEach`: trong bộ e2e này một bản
 * nháp bẩn sẽ bị `users.spec.ts` publish thẳng lên site thật.
 */

const PAGE_SLUG = 'gioi-thieu';

/**
 * Trạng thái cần trả lại, đặt ở module để `afterEach` với tới được.
 *
 * `try/finally` KHÔNG đủ: khi test hết giờ, Playwright đóng context và phần
 * finally không chạy được nữa — đúng chuyện đã xảy ra khi làm bộ test này, và
 * bản nháp đọng lại override cho tới lần chạy sau. `afterEach` thì vẫn chạy sau
 * timeout, và fixture `request` vẫn dùng được ở đó.
 */
let pending: { pageId: string; ops: unknown[] } | null = null;

test.afterEach(async ({ request }) => {
  if (!pending) return;
  const { pageId, ops } = pending;
  pending = null;
  await request.post('/api/ops', {
    data: { pageId, label: 'e2e inspector — hoàn tác', ops },
  });
});

async function openEditor(page: Page): Promise<string> {
  await page.goto('/builder');
  await page.getByRole('link', { name: new RegExp(PAGE_SLUG) }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  return page.url().split('/').pop()!;
}

/**
 * Ô inspector, khớp nhãn CHÍNH XÁC.
 *
 * `getByLabel('padding-block-start')` mặc định khớp một PHẦN, nên nó bắt luôn nút gỡ
 * override mang aria-label "Gỡ đệm trên" — hai phần tử, strict mode violation.
 */
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });

/**
 * Nút chọn khổ màn trên thanh khung xem trước.
 *
 * Hook ổn định thay cho tên hiển thị: từ 19/08/2026 nút mang BỀ RỘNG (`1440`) và lớp
 * style (`lg`), không mang tên thiết bị — và bề rộng thì người dùng sửa được, nên tên
 * hiển thị không phải thứ test được phép dựa vào. Xem HANDOFF §3.40.
 */
const screenButton = (page: Page, id: string) =>
  page.locator(`[data-screen-button="${id}"]`);

/** Nhóm chỉ hiện ô khi được mở; nó tự mở khi đã có giá trị. */
async function ensureOpen(page: Page, section: RegExp, name: string) {
  if ((await field(page, name).count()) === 0) {
    await page.getByRole('button', { name: section }).click();
  }
  await expect(field(page, name)).toBeVisible();
}

async function selectHeading(page: Page) {
  await page.getByRole('button', { name: /Tiêu đề/ }).first().click();
  // Đợi ĐÚNG node xuất hiện trong inspector, không đợi chữ "Thuộc tính" — chuỗi
  // đó có ở nhiều chỗ, và nó cũng không chứng minh được node nào đang được chọn.
  await expect(page.getByTitle('ab000002')).toBeVisible();
}

test.describe('control có kiểu', () => {
  test('chặn giá trị sai ngay tại ô, không gửi lên server', async ({ page }) => {
    await openEditor(page);
    await selectHeading(page);
    await ensureOpen(page, /khoảng cách/i, 'padding-block-start');

    const input = field(page, 'padding-block-start');

    // Đơn vị CSS có thật nhưng site không nhận — bắt tại ô, không phải đợi
    // server. (Số trần như "16" nay HỢP LỆ: nó kế thừa đơn vị của ô. Vì thế nó
    // không kiểm được ở đây — gõ vào là ghi thật, mà test này cố ý không ghi gì.
    // Hành vi đó có test đơn vị riêng trong `value-io.test.ts`.)
    await input.fill('10pt');
    await input.press('Enter');
    await expect(page.getByText(/Không hiểu "10pt"/)).toBeVisible();

    // Token bịa: validator ở server cũng chặn, nhưng bắt sớm thì người dùng
    // biết ngay tên nào có thật.
    await input.fill('token-khong-ton-tai');
    await input.press('Enter');
    await expect(page.getByText(/token có thật/)).toBeVisible();
  });

  test('ghi vào đúng lớp đang xem, và gỡ được override', async ({ page, request }) => {
    // Mỗi lần dispatch nạp lại cả 5 khung iframe trên canvas, nên một test đi
    // qua bốn lượt ghi vượt xa mặc định 30s. Nới hạn thay vì bỏ bớt bước — mỗi
    // bước ở đây kiểm một tính chất khác nhau.
    test.setTimeout(120_000);

    const pageId = await openEditor(page);
    await selectHeading(page);

    const read = async () => {
      const tool = await request.post('/api/ai/tool', {
        data: { tool: 'get_node', input: { pageId, nodeIds: ['ab000002'] } },
      });
      const { result } = await tool.json();
      return result.nodes.ab000002.style as Record<string, { spacing?: { pt?: unknown } }>;
    };

    /**
     * Đọc LẶP LẠI cho tới khi khớp.
     *
     * Ô nhập hiện giá trị mới ngay từ state cục bộ, trước khi POST /api/ops
     * xong — nên `toHaveValue` đúng mà database chưa kịp đổi. Đọc một lần là một
     * cuộc đua, và nó sẽ đỏ ngẫu nhiên trên máy chậm.
     */
    const expectLayer = async (layer: string, expected: unknown) => {
      await expect
        .poll(async () => (await read())[layer]?.spacing?.pt, { timeout: 15_000 })
        .toEqual(expected);
    };

    const before = await read();

    // Đăng ký hoàn tác TRƯỚC khi sửa gì. Đăng ký sau lượt ghi đầu tiên là để hở
    // đúng khoảng mà một timeout có thể rơi vào.
    pending = {
      pageId,
      ops: [
        { op: 'setStyle', nodeId: 'ab000002', target: 'lg', patch: { spacing: { pt: before.lg?.spacing?.pt ?? null } } },
        { op: 'setStyle', nodeId: 'ab000002', target: 'md', patch: { spacing: { pt: before.md?.spacing?.pt ?? null } } },
        // Dọn cả xl: một selector chọn nhầm màn đã từng ghi vào đó, và residue
        // trong nháp sẽ bị test publish đẩy lên site thật.
        { op: 'setStyle', nodeId: 'ab000002', target: 'xl', patch: { spacing: { pt: before.xl?.spacing?.pt ?? null } } },
      ],
    };

    {
      // Khổ 1440 → lớp `lg`.
      //
      // Bản trước dò theo chữ và phải viết `/^Desktop\s+1200/`, vì `/^Desktop/` khớp
      // cả "Desktop lớn 1560" (lớp xl) và khớp TRƯỚC — chọn nhầm màn rồi mọi assertion
      // bên dưới đo sai lớp. Hook `data-screen-button` bỏ hẳn cả lớp vấn đề đó.
      await screenButton(page, 'w1440').click();
      await ensureOpen(page, /khoảng cách/i, 'padding-block-start');
      await field(page, 'padding-block-start').fill('space-xl');
      await field(page, 'padding-block-start').press('Enter');
      await expect(field(page, 'padding-block-start')).toHaveValue('space-xl');

      await expectLayer('lg', { $token: 'space-xl' });

      // Tablet (md) nằm DƯỚI lg trong thứ tự mobile-first, nên KHÔNG kế thừa
      // từ lg — ô phải trống. Đây là chỗ dễ hiểu nhầm nhất của cả panel.
      await screenButton(page, 'w1024').click();
      await ensureOpen(page, /khoảng cách/i, 'padding-block-start');
      await expect(field(page, 'padding-block-start')).toHaveValue('');

      await field(page, 'padding-block-start').fill('space-2xs');
      await field(page, 'padding-block-start').press('Enter');
      await expect(field(page, 'padding-block-start')).toHaveValue('space-2xs');

      await expectLayer('md', { $token: 'space-2xs' });
      // Sửa Tablet KHÔNG được đụng Desktop.
      await expectLayer('lg', { $token: 'space-xl' });

      /*
       * GỠ override bằng cách XOÁ TRẮNG ô. Không có đường gỡ thì override chỉ thêm
       * được, không bớt — và một giá trị đặt nhầm ở màn hẹp sẽ nằm đó mãi.
       *
       * Trước 19/08/2026 đường gỡ là nút ×. Ô đệm/lề giờ nằm trong hộp box model
       * kiểu Webflow, tức không còn hàng nhãn nên không còn nút — nhãn đi vào
       * `aria-label`, và xoá trắng là thao tác gỡ. Các ô KHÔNG nằm trong hộp (cỡ chữ,
       * bo góc…) vẫn có nút ×; test bên dưới trong file này vẫn dùng nó.
       */
      await field(page, 'padding-block-start').fill('');
      await field(page, 'padding-block-start').press('Enter');
      await expect(field(page, 'padding-block-start')).toHaveValue('');

      await expectLayer('md', undefined);
      await expectLayer('lg', { $token: 'space-xl' });
    }
  });

  test('số trần kế thừa đơn vị, và mũi tên tăng giảm', async ({ page, request }) => {
    test.setTimeout(120_000);

    const pageId = await openEditor(page);
    await selectHeading(page);

    const read = async () => {
      const tool = await request.post('/api/ai/tool', {
        data: { tool: 'get_node', input: { pageId, nodeIds: ['ab000002'] } },
      });
      const { result } = await tool.json();
      return result.nodes.ab000002.style as Record<string, { spacing?: { pt?: unknown } }>;
    };
    const expectLg = async (expected: unknown) => {
      await expect
        .poll(async () => (await read()).lg?.spacing?.pt, { timeout: 15_000 })
        .toEqual(expected);
    };

    const before = await read();
    pending = {
      pageId,
      ops: [
        {
          op: 'setStyle', nodeId: 'ab000002', target: 'lg',
          patch: { spacing: { pt: before.lg?.spacing?.pt ?? null } },
        },
      ],
    };

    await screenButton(page, 'w1440').click();
    await ensureOpen(page, /khoảng cách/i, 'padding-block-start');
    const input = field(page, 'padding-block-start');

    // Đặt nền một đơn vị KHÔNG phải px, để chứng minh số trần kế thừa đơn vị
    // đang có chứ không phải luôn luôn rơi về px.
    await input.fill('2rem');
    await input.press('Enter');
    await expectLg({ v: 2, u: 'rem' });

    // Thao tác thường gặp nhất của cả panel: bôi đen, gõ số, xong. Trước đây nó
    // trả về lỗi đỏ "Thiếu đơn vị".
    await input.fill('3');
    await input.press('Enter');
    await expect(input).toHaveValue('3rem');
    await expectLg({ v: 3, u: 'rem' });

    // Mũi tên ghi ngay, không đợi blur — giữ phím để dò một con số mà canvas
    // đứng im thì không thấy được mình đang dò tới đâu.
    await input.press('ArrowUp');
    await expectLg({ v: 4, u: 'rem' });
    await input.press('Shift+ArrowUp');
    await expectLg({ v: 14, u: 'rem' });
  });

  test('mũi tên KHÔNG được nuốt mất token', async ({ page }) => {
    // Cộng 1 vào `space-xl` không có nghĩa gì. Nếu phím mũi tên tự bịa ra một số
    // để cộng, một giá trị có chủ đích biến mất chỉ vì bấm nhầm phím.
    await openEditor(page);
    await selectHeading(page);
    await screenButton(page, 'w1440').click();
    await ensureOpen(page, /khoảng cách/i, 'padding-block-start');

    const input = field(page, 'padding-block-start');
    await input.fill('space-xl');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('space-xl');
  });
});

/**
 * Biến màu tự tạo.
 *
 * Đường đi đầy đủ: tạo token → khai báo `:root` xuất hiện trong trang render →
 * xoá được. Chỉ kiểm hàng trong database là bỏ sót đúng chỗ dễ hỏng nhất —
 * `tokens.css` là file TĨNH, nên một token mới chỉ có tác dụng nếu
 * `custom-tokens.ts` phát nó ra lúc render.
 */
test.describe('biến màu', () => {
  const NAME = `e2e-mau-${Date.now().toString(36)}`;
  let createdId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (!createdId) return;
    const id = createdId;
    createdId = null;
    await request.delete(`/api/design-tokens/${id}`);
  });

  test('tạo xong là render được, xoá xong là hết', async ({ request }) => {
    const created = await request.post('/api/design-tokens', {
      data: { name: NAME, value: '#123456' },
    });
    expect(created.ok()).toBe(true);
    const { token } = await created.json();
    createdId = token.id;

    const pages = await request.post('/api/ai/tool', {
      data: { tool: 'list_pages', input: {} },
    });
    const pageId = (await pages.json()).result.pages[0].id as string;

    const html = await (await request.get(`/render/${pageId}`)).text();
    expect(html).toContain(`--${NAME}: #123456`);

    // Xoá rồi thì khai báo phải biến mất — nếu không, mỗi token từng tạo sẽ đọng
    // lại trong stylesheet của mọi trang mãi mãi.
    await request.delete(`/api/design-tokens/${createdId}`);
    createdId = null;
    const after = await (await request.get(`/render/${pageId}`)).text();
    expect(after).not.toContain(`--${NAME}`);
  });

  test('không cho đè token gốc của design system', async ({ request }) => {
    // Khai báo tự tạo phát SAU tokens.css nên nó thắng — trùng tên sẽ âm thầm
    // đổi màu ở mọi chỗ trong toàn site đang dùng token gốc.
    const res = await request.post('/api/design-tokens', {
      data: { name: 'color-accent', value: '#ff0000' },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('design system');
  });
});

test.describe('panel CSS', () => {
  test('cảnh báo sanitize hiện ngay khi gõ', async ({ page }) => {
    await openEditor(page);
    await selectHeading(page);

    const box = page.getByPlaceholder('opacity');
    await box.fill('position: fixed; @import url("//evil.example/x.css");');

    // Không có cảnh báo thì người dùng gõ `fixed`, thấy trang ra `absolute`, và
    // kết luận builder hỏng — chứ không đoán ra là có một luật đang áp.
    //
    // Tìm trong DANH SÁCH cảnh báo, không tìm trong cả trang: chuỗi "@import"
    // cũng nằm trong chính ô textarea vừa gõ.
    const warnings = page.locator('li', { hasText: /Đã gỡ|đã đổi/ });
    await expect(warnings.filter({ hasText: /fixed đã đổi thành absolute/ })).toBeVisible();
    await expect(warnings.filter({ hasText: /@import/ })).toBeVisible();
  });
});

/**
 * Thao tác cấu trúc.
 *
 * Đây là loại thay đổi nguy hiểm nhất để test: nó thêm/bớt node THẬT trong bản
 * nháp, và bản nháp bẩn sẽ bị `users.spec.ts` publish lên site thật.
 *
 * Nên phần dọn KHÔNG dựa vào việc test kết thúc ở trạng thái nào: nó chụp tập id
 * trước khi chạy, rồi xoá mọi id lạ. Bản đầu chỉ nhớ MỘT id vừa thêm, nhưng test
 * kết thúc bằng một lần undo khôi phục cả bản sao — nên dư đúng một node, và nó
 * ở lại tới lần chạy sau.
 */
test.describe('thao tác cấu trúc', () => {
  let snapshot: { pageId: string; ids: string[] } | null = null;

  test.afterEach(async ({ request }) => {
    if (!snapshot) return;
    const { pageId, ids } = snapshot;
    snapshot = null;

    const res = await request.post('/api/ai/tool', {
      data: { tool: 'get_page_outline', input: { pageId } },
    });
    const { result } = await res.json();
    // `get_page_outline` trả `children`, không trả `parentId` — quan hệ cha-con
    // suy ra từ đó.
    const nodes = result.nodes as { id: string; children?: string[] }[];

    const known = new Set(ids);
    const extraSet = new Set(nodes.map((n) => n.id).filter((id) => !known.has(id)));
    if (!extraSet.size) return;

    /**
     * Chỉ xoá node thừa CAO NHẤT, không xoá con của chúng.
     *
     * `removeNode` cuốn theo cả cây con, nên một batch chứa cả cha lẫn con sẽ có
     * op thứ hai trỏ vào node đã biến mất — validator từ chối CẢ BATCH, và không
     * có gì được dọn.
     *
     * Đó chính là chuyện đã xảy ra: một Section thừa cùng Section con của nó ở
     * lại trong nháp `/gioi-thieu`, rồi bị publish lên site thật.
     */
    const childOfExtra = new Set(
      nodes.filter((n) => extraSet.has(n.id)).flatMap((n) => n.children ?? []),
    );
    const topmost = [...extraSet].filter((id) => !childOfExtra.has(id));

    const cleanup = await request.post('/api/ops', {
      data: {
        pageId,
        label: 'e2e cấu trúc — dọn',
        ops: topmost.map((id) => ({ op: 'removeNode', nodeId: id })),
      },
    });

    // Kiểm kết quả, không bỏ qua.
    //
    // Bản đầu bắn request rồi đi tiếp. Khi batch bị từ chối thì không có gì cho
    // biết cả — rác ở lại nháp, lần chạy sau chụp nó vào ảnh chụp và coi nó là
    // nội dung thật, nên nó tự duy trì mãi mãi. Vỡ ở đây ồn ào hơn nhiều so với
    // một trang thật bị bẩn.
    expect(
      cleanup.ok(),
      `Dọn rác e2e THẤT BẠI (${cleanup.status()}). Nháp còn node thừa: ${topmost.join(', ')}`,
    ).toBe(true);
  });

  test('thêm, nhân bản, xoá — mỗi bước undo được', async ({ page, request }) => {
    test.setTimeout(120_000);
    const pageId = await openEditor(page);
    await selectHeading(page);

    const outline = async () => {
      const res = await request.post('/api/ai/tool', {
        data: { tool: 'get_page_outline', input: { pageId } },
      });
      return (await res.json()).result as { nodeCount: number; nodes: { id: string }[] };
    };

    const before = await outline();

    /**
     * Trang phải bắt đầu SẠCH.
     *
     * Ảnh chụp bên dưới neo vào "những gì đang có", nên rác từ một lần chạy hỏng
     * trước đó sẽ được coi là nội dung thật và không bao giờ bị dọn — nó tự duy
     * trì mãi mãi, rồi bị `users.spec.ts` publish lên site thật. Đã xảy ra hai
     * lần.
     *
     * Node thật của `/gioi-thieu` đều do seed tạo và mang tiền tố `ab`; mọi id
     * sinh lúc chạy là chuỗi ngẫu nhiên. Vỡ ở đây, ồn ào, tốt hơn nhiều so với
     * việc âm thầm hấp thụ rác.
     */
    const dirty = before.nodes.map((n) => n.id).filter((id) => !id.startsWith('ab'));
    expect(
      dirty,
      `Nháp /${PAGE_SLUG} còn rác từ lần chạy trước: ${dirty.join(', ')}. `
      + 'Dọn trước khi chạy lại, nếu không test sẽ coi chúng là nội dung thật.',
    ).toEqual([]);

    snapshot = { pageId, ids: before.nodes.map((n) => n.id) };
    const start = before.nodeCount;
    const count = async () => (await outline()).nodeCount;

    page.on('dialog', (dialog) => void dialog.accept());

    // Menu "Thêm" nằm trong cùng một container với nút mở nó. Không giới hạn
    // phạm vi thì "Văn bản" còn khớp cả một hàng trong cây node cùng tên. Bắt nút
    // bằng hook `data-node-action`: dấu "+" giờ là icon, không còn trong tên nút.
    const addButton = page.locator('[data-node-action="add"]');
    const menu = addButton.locator('xpath=..');

    await addButton.click();
    await menu.getByRole('button', { name: /Văn bản/ }).click();
    await expect.poll(count, { timeout: 20_000 }).toBe(start + 1);

    await page.getByRole('button', { name: 'Nhân bản (Ctrl+D)' }).click();
    await expect.poll(count, { timeout: 20_000 }).toBe(start + 2);

    // `[data-node-action]`, không phải tên hiển thị: nút này đổi nhãn khi node bị khoá,
    // và từ khi mỗi hàng cây có nút xoá riêng thì `/^Xoá/` khớp ba phần tử.
    await page.locator('[data-node-action="remove"]').click();
    await expect.poll(count, { timeout: 20_000 }).toBe(start + 1);

    // Undo trả lại thứ vừa xoá — thao tác cấu trúc hoàn tác được như mọi op khác.
    await page.keyboard.press('Control+z');
    await expect.poll(count, { timeout: 20_000 }).toBe(start + 2);
  });

  test('node gốc không xoá và không đổi thứ tự được', async ({ page }) => {
    await openEditor(page);
    // Hàng đầu tiên trong CÂY là node gốc.
    //
    // `[data-layer-row]` là hook riêng của hàng cây. Đường vòng theo vị trí —
    // `aside >> button >> first` — đã sai hai lần: nút thu gọn pane đứng trước
    // cây, rồi chevron gập nhánh đứng trước nhãn của chính hàng đầu tiên.
    await page.locator('[data-layer-row]').first().click();

    for (const hook of ['remove', 'duplicate', 'up', 'down']) {
      await expect(page.locator(`[data-node-action="${hook}"]`)).toBeDisabled();
    }
  });
});

/**
 * Hai thứ giải quyết nợ UI lớn nhất mà chính đặc tả đã tự nhận.
 */
test.describe('cảnh báo customCss che thuộc tính', () => {
  let cleanup: { pageId: string } | null = null;

  test.afterEach(async ({ request }) => {
    if (!cleanup) return;
    const { pageId } = cleanup;
    cleanup = null;
    await request.post('/api/ops', {
      data: {
        pageId,
        label: 'e2e — dọn customCss',
        ops: [{ op: 'setCustomCss', nodeId: 'ab000002', css: null }],
      },
    });
  });

  test('ô bị đè có dấu ⚠, ô không bị đè thì im lặng', async ({ page }) => {
    test.setTimeout(120_000);
    const pageId = await openEditor(page);
    await selectHeading(page);
    cleanup = { pageId };

    // Tóm tắt hiện NGAY khi gõ, trước cả khi bấm Áp dụng — nó chạy cùng hàm
    // sanitize mà server dùng lúc render.
    const box = page.getByPlaceholder('opacity');
    await box.fill('padding-top: 40px; opacity: .5; &:hover { color: red }');

    const summary = page.locator('p', { hasText: 'Đang vô hiệu hoá ô' });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('padding-top');
    await expect(summary).toContainText('opacity');
    // `color` chỉ nằm trong &:hover — nó không đè vô điều kiện, và cảnh báo cho
    // nó sẽ là tiếng ồn.
    await expect(summary).not.toContainText('color');

    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect.poll(async () => (await summary.count()) > 0, { timeout: 15_000 }).toBe(true);

    // Mở mọi nhóm để thấy dấu ⚠ trên từng ô.
    const aside = page.locator('aside').last();
    const sections = aside.getByRole('button').filter({ hasText: /^[▸▾]/ });
    for (let i = 0; i < (await sections.count()); i++) {
      if ((await sections.nth(i).innerText()).startsWith('▸')) {
        await sections.nth(i).click();
      }
    }

    await expect(page.getByLabel('Bị CSS tuỳ chỉnh đè bằng padding-top')).toBeVisible();
    await expect(page.getByLabel('Bị CSS tuỳ chỉnh đè bằng opacity')).toBeVisible();
    await expect(page.getByLabel('Bị CSS tuỳ chỉnh đè bằng color')).toHaveCount(0);
  });
});

test.describe('tìm trong cây node', () => {
  test('lọc theo tên, giữ tổ tiên, gõ không dấu vẫn ra', async ({ page }) => {
    /**
     * Mở TRANG CHỦ, không phải `/gioi-thieu`.
     *
     * Test này cần một cây đủ lớn để việc lọc có nghĩa. Nó từng dùng
     * `/gioi-thieu` và xanh — nhưng xanh nhờ RÁC: trang thật chỉ có 4 node, và
     * hơn 10 hàng kia là node thừa do một lần chạy e2e hỏng để lại. Dọn rác đi là
     * test đỏ, và nó đúng phải đỏ.
     */
    await page.goto('/builder');
    await page.getByRole('link', { name: /^Trang chủ \/$/ }).first().click();
    await page.waitForURL(/\/builder\/[a-z0-9]+$/);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();

    // Đếm theo `[data-layer-row]`, KHÔNG theo `getByRole('button')`: mỗi hàng có
    // con nay đi kèm một nút chevron để gập nhánh, nên đếm button là đếm lẫn
    // chevron vào số hàng — con số vẫn "hoạt động" cho phép so sánh trước/sau,
    // nhưng nó không còn là số hàng, và lần sau ai đọc cũng tin là số hàng.
    const rows = () => page.locator('[data-layer-row]');

    const before = await rows().count();
    expect(before).toBeGreaterThan(10);

    const search = page.getByLabel('Tìm phần tử');
    // Gõ KHÔNG DẤU, node có dấu: đó là cả điểm của `fold()`. "Lưới thẻ 3" là tên một node
    // của khối mẫu trên trang chủ (scripts/seed-demo-content.ts).
    await search.fill('luoi the 3');
    await expect.poll(async () => rows().count(), { timeout: 5_000 }).toBeLessThan(before);

    // Kết quả phải kèm tổ tiên — danh sách phẳng thì không biết node nằm ở đâu.
    await expect(rows().filter({ hasText: /Lưới thẻ 3/ }).first()).toBeVisible();

    await search.fill('zzz-chac-chan-khong-co');
    await expect(page.getByText(/Không có phần tử nào khớp/)).toBeVisible();

    // Escape thoát bộ lọc bằng một phím, không phải xoá từng ký tự.
    await search.press('Escape');
    await expect.poll(async () => rows().count(), { timeout: 5_000 }).toBe(before);
  });
});

test.describe('khối class Tailwind', () => {
  test('chia theo nhóm thuộc tính, chỉ để đọc', async ({ page }) => {
    await openEditor(page);
    await selectHeading(page);

    const panel = page.locator('section').filter({ hasText: 'Class Tailwind' }).last();
    await expect(panel).toBeVisible();

    // Có ít nhất một class, và mỗi class nằm dưới một tiêu đề nhóm.
    await expect(panel.locator('code').first()).toBeVisible();
    await expect(panel).toContainText(/Kích thước|Chữ|Bố cục|Khoảng cách/);

    // Nói rõ nó chỉ để đọc — không có ô nhập nào trong khối này.
    await expect(panel).toContainText(/Chỉ để đọc/);
    await expect(panel.locator('input, textarea')).toHaveCount(0);
  });

  test('giá trị không map được vẫn HIỆN và bị đánh dấu', async ({ page }) => {
    await openEditor(page);
    await selectHeading(page);

    // `max-w-[var(--measure)]` là class Tailwind hợp lệ; token của site thì
    // không — cả hai đều phải xuất hiện, chứ không được ẩn bớt cho danh sách đẹp.
    const panel = page.locator('section').filter({ hasText: 'Class Tailwind' }).last();
    const codes = panel.locator('code');
    const count = await codes.count();
    expect(count).toBeGreaterThan(0);

    const texts = await codes.allInnerTexts();
    // Mọi class đều phải là chuỗi có nghĩa, không rỗng, không "undefined".
    for (const t of texts) {
      expect(t.trim().length).toBeGreaterThan(0);
      expect(t).not.toContain('undefined');
      expect(t).not.toContain('[object');
    }
  });
});
