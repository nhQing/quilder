import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Ba lỗi người dùng báo ngày 19/08/2026 khi dùng pane trái:
 *
 *  1. bấm một node không thấy nó ở đâu trên canvas
 *  2. không có nút xoá cạnh tên node
 *  3. xoá xong, hoàn tác báo `Unrecognized key(s) in object: '_src'`
 *
 * Lỗi 3 là nặng nhất: node biến mất và nút undo không lấy lại được. Nguyên nhân là
 * `html-to-doc.ts` nướng `_src` vào node làm giàn giáo, `zNode` là `.strict()`, nên
 * `invert()` sinh `insertNode` mang `_src` và bị từ chối.
 *
 * Cùng luồng đó còn một nguyên nhân THỨ HAI, tìm ra sau: xoá một node CÓ CON thì
 * `invert()` sinh nhiều `insertNode` phụ thuộc nhau, và validator tầng 2 vốn kiểm mọi
 * op với bản doc trước batch nên từ chối từ op thứ hai. Test cuối file kiểm nó.
 *
 * Test này CÓ sửa nội dung, nên nó dọn bằng op nghịch đảo trong `afterEach` — xem
 * HANDOFF §3.1 và §3.25.
 */

const TEST_PAGE = /gioi-thieu/;

let pending: { pageId: string; ops: unknown[] } | null = null;

test.afterEach(async ({ request }) => {
  const job = pending;
  pending = null;
  if (!job) return;
  const res = await request.post('/api/ops', {
    data: { pageId: job.pageId, label: 'e2e hàng cây — hoàn tác', ops: job.ops },
  });
  if (!res.ok()) console.error(`[dọn] THẤT BẠI ${res.status()}: ${await res.text()}`);
});

async function openEditor(page: Page): Promise<string> {
  await page.goto('/builder');
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('link', { name: TEST_PAGE }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  return page.url().split('/builder/')[1]!;
}

const rows = (page: Page) => page.locator('[data-layer-row]');

test('nút xoá có ngay trên hàng cây, và node gốc KHÔNG có', async ({ page }) => {
  await openEditor(page);

  const rootId = (await rows(page).first().getAttribute('data-layer-row'))!;
  await expect(page.locator(`[data-layer-remove="${rootId}"]`)).toHaveCount(0);

  // Nhưng hàng khác thì có — nếu không, assertion trên xanh vì lý do sai.
  await expect(page.locator('[data-layer-remove]').first()).toHaveCount(1);
});

test('xoá từ hàng cây rồi HOÀN TÁC được — đây là lỗi _src', async ({ page, request }) => {
  const pageId = await openEditor(page);
  const before = await rows(page).count();

  const target = rows(page).nth(2);
  const nodeId = (await target.getAttribute('data-layer-row'))!;
  await target.hover();
  await page.locator(`[data-layer-remove="${nodeId}"]`).click();

  await expect.poll(() => rows(page).count(), { timeout: 15_000 }).toBeLessThan(before);

  /*
   * Hoàn tác bằng ĐÚNG đường người dùng dùng: Ctrl+Z.
   *
   * Gọi API để dọn thì test xanh mà không chứng minh gì — lỗi `_src` nằm ở chỗ
   * `invert()` sinh op, tức ở chính đường undo.
   */
  await page.keyboard.press('Control+z');
  await expect.poll(() => rows(page).count(), { timeout: 15_000 }).toBe(before);

  // Không còn gì phải dọn nếu undo thành công; nếu đỏ ở trên thì dòng dưới cứu.
  const now = await rows(page).count();
  if (now !== before) {
    const res = await request.post('/api/ai/tool', {
      data: { tool: 'get_node', input: { pageId, nodeId } },
    });
    console.error(`[dọn] node ${nodeId} có thể còn thiếu: ${res.status()}`);
  }
});

/**
 * Tiền tố chung cho mọi node do test này dựng, để dọn được cả rác của lượt TRƯỚC.
 *
 * Id phải KHÁC nhau mỗi lượt: lượt suite ngày 19/08/2026 mất kết nối đúng lúc
 * `afterEach` gọi `/api/ops` (`read ECONNRESET`), nên node ở lại bản nháp và lượt sau
 * đỏ với `id đã tồn tại: e2eStack1` — một test đỏ vì rác của chính nó.
 */
const E2E_PREFIX = 'e2etree';
const RUN = Date.now().toString(36);
const STACK_ID = `${E2E_PREFIX}s${RUN}`;
const TEXT_ID = `${E2E_PREFIX}t${RUN}`;

/**
 * Xoá mọi node do các lượt trước của test này để lại.
 *
 * Không phải "cho gọn": rác tích lại trong bản nháp là rác đi vào bản publish. Trang
 * chủ đã mất section hero đúng theo đường đó (HANDOFF §3.35).
 */
async function sweepLeftovers(request: APIRequestContext, pageId: string) {
  const res = await request.post('/api/ai/tool', {
    data: { tool: 'get_page_outline', input: { pageId } },
  });
  if (!res.ok()) return;
  const { result } = (await res.json()) as { result: { nodes: { id: string }[] } };
  // Chỉ node GỐC của rác: xoá nó cuốn theo con, và xoá con trước rồi xoá cha sẽ báo
  // `missing-node` cho op sau.
  const junk = result.nodes.filter((n) => n.id.startsWith(`${E2E_PREFIX}s`));
  if (!junk.length) return;
  const del = await request.post('/api/ops', {
    data: {
      pageId,
      label: 'e2e hàng cây — dọn rác lượt trước',
      ops: junk.map((n) => ({ op: 'removeNode', nodeId: n.id })),
    },
  });
  console.warn(`[dọn] rác lượt trước: ${junk.map((n) => n.id).join(', ')} → ${del.status()}`);
}

test('xoá một node CÓ CON rồi hoàn tác — cả cây con phải về', async ({ page, request }) => {
  /*
   * Đây là lỗi thứ hai của cùng một luồng, và nặng hơn lỗi `_src`.
   *
   * `invert(removeNode)` sinh MỘT `insertNode` cho từng node trong cây con, cha trước
   * con. Validator tầng 2 lại kiểm mọi op với bản doc TRƯỚC batch, nên op thứ hai trở
   * đi báo `missing-parent` — hoàn tác một Stack có con là bất khả, và node biến mất
   * hẳn khỏi bản nháp.
   *
   * Việc này đã ăn mất thật: section hero của trang chủ (12 node, gồm `<h1>` duy nhất)
   * bị xoá lúc 06:38 ngày 19/08/2026 và không hoàn tác được; bản publish 08:21 đóng gói
   * bản nháp thiếu hero. Xem `scripts/restore-hero.ts`.
   */
  const pageId = await openEditor(page);
  await sweepLeftovers(request, pageId);

  /*
   * Test TỰ DỰNG cấu trúc thay vì xoá thử một node có sẵn.
   *
   * Hai lý do. Một: `gioi-thieu` nông, node duy nhất có con là node gốc — mà node gốc
   * không xoá được. Hai: nếu test đỏ giữa đường trên một node có sẵn thì nó để lại
   * đúng cái hỏng nó sinh ra để bắt — và đó chính là cách trang chủ mất hero.
   *
   * Batch dưới đây cũng chứng minh luôn nửa còn lại của bản sửa: op thứ hai trỏ tới
   * node do op thứ nhất tạo. Trước bản sửa, chính nó bị từ chối.
   */
  const seed = await request.post('/api/ops', {
    data: {
      pageId,
      label: 'e2e hàng cây — dựng cây con',
      ops: [
        {
          op: 'insertNode',
          parentId: (await rows(page).first().getAttribute('data-layer-row'))!,
          index: 0,
          node: {
            id: STACK_ID, type: 'Stack', parentId: null, children: [],
            name: 'e2e cha', style: { base: {} }, direction: { base: 'column' },
          },
        },
        {
          op: 'insertNode',
          parentId: STACK_ID,
          index: 0,
          node: {
            id: TEXT_ID, type: 'Text', tag: 'p', parentId: null, children: [],
            name: 'e2e con', style: { base: {} },
            content: [{ t: 'text', v: 'con của e2e' }],
          },
        },
      ],
    },
  });
  expect(
    seed.ok(),
    `dựng cây con thất bại (${seed.status()}): ${await seed.text()}`,
  ).toBe(true);
  pending = { pageId, ops: [{ op: 'removeNode', nodeId: STACK_ID }] };

  await page.reload();
  await expect(page.locator(`[data-layer-row="${TEXT_ID}"]`)).toBeVisible();
  const before = await rows(page).count();

  await page.locator(`[data-layer-row="${STACK_ID}"]`).hover();
  await page.locator(`[data-layer-remove="${STACK_ID}"]`).click();

  // Xoá phải cuốn theo hậu duệ: cả hai hàng đi. Nếu chỉ mất một thì op removeNode
  // không cuốn cây con, và phần undo bên dưới không kiểm được thứ nó nói là kiểm.
  await expect.poll(() => rows(page).count(), { timeout: 15_000 }).toBe(before - 2);

  // Hoàn tác bằng đúng đường người dùng dùng.
  await page.keyboard.press('Control+z');
  await expect.poll(() => rows(page).count(), { timeout: 20_000 }).toBe(before);
  await expect(page.locator(`[data-layer-row="${TEXT_ID}"]`)).toBeVisible();
});


/*
 * KHÔNG có e2e cho "chọn node ngoài tầm nhìn thì canvas kéo tới nó", và đó là quyết
 * định chứ không phải bỏ sót.
 *
 * Tính năng ĐÃ được xác nhận bằng tay ngày 19/08/2026: chọn một node ở y=3918 làm
 * transform của canvas đổi từ matrix(0.65,0,0,0.65,-1026,48) sang
 * matrix(0.65,0,0,0.65,-1026,-1976.88) — đúng phép kéo cần có.
 *
 * Bốn bản e2e đều đỏ vì TIỀN ĐỀ, không vì code, và mỗi lần một tiền đề khác:
 *
 *  1. dùng trang gioi-thieu — trang đó có 3 node, mọi thứ đang thấy nên không cần
 *     kéo, và "không kéo" là hành vi đúng;
 *  2. nth(40) — node ở chỉ số đó phụ thuộc trạng thái gập lưu trong localStorage;
 *  3. last() — hàng cuối cây không chắc render ra DOM (node ẩn, con của Composite);
 *  4. đo trong iframe ĐẦU TIÊN (1560px) trong khi measure() dùng khung đang chọn
 *     (1200px) — node thấp nhất ở khổ rộng có thể bị ẩn ở khổ hẹp hơn, và ở đó
 *     getBoundingClientRect() trả toàn số 0, tức "đang thấy".
 *
 * Một test đỏ vì tiền đề nằm lại trong suite thì tệ hơn không có test: nó dạy người
 * ta bỏ qua màu đỏ.
 *
 * Điều kiện để viết lại cho đúng ĐÃ có: `Canvas` phơi `data-canvas-pan` và
 * `data-canvas-zoom` ra DOM từ 19/08/2026, và `e2e/canvas-view.spec.ts` dùng chúng để
 * kiểm neo zoom. Viết lại test kéo-tới-node là việc còn nợ, không còn bị chặn.
 *
 * ## Cập nhật 09/10/2026: tính năng đã mất, rồi đã quay lại — và giờ CÓ e2e
 *
 * Phép kéo `pan` ở trên mất ngay chiều 19/08/2026, cùng canvas kéo–phóng (8561300):
 * khung mới cuộn bằng thanh cuộn thật trong iframe, nên không còn `pan` để kéo, và
 * không ai viết lại phép đó. Người dùng báo lại sau giao diện v2. Giờ là cuộn thật bên
 * trong khung, theo yêu cầu tường minh `select(id, { reveal: true })` — xem
 * `EditorState.reveal` — và e2e nằm ở `layer-tree.spec.ts`, khối "chọn từ ngoài khung
 * thì khung cuộn tới node", tránh đủ bốn tiền đề trên.
 */
