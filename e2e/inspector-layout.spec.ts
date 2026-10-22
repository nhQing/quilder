import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Tổ chức bảng thuộc tính theo quy ước Webflow/Framer.
 *
 * Ba mẫu UI được lấy về ngày 19/08/2026, và mỗi mẫu ở đây được kiểm bằng thứ nó
 * thay đổi cho người dùng, không phải bằng class CSS:
 *
 *  1. **Hộp box model** — đệm và lề bày theo bốn cạnh thật, thay cho tám hàng nhãn.
 *  2. **Dải nút** thay cho `<select>` ở những giá trị có hình dạng.
 *  3. **Ẩn ô không có tác dụng** — gap/align/justify chỉ hiện khi `display` là
 *     flex hoặc grid.
 *
 * Test này CÓ ghi style, nên nó dọn trong `afterEach`. Xem HANDOFF §3.35: một bản
 * nháp bẩn sẽ bị `users.spec.ts` publish lên site thật.
 */

const PAGE_SLUG = 'gioi-thieu';
const NODE = 'ab000002';

let pending: { pageId: string; ops: unknown[] } | null = null;

/**
 * Token màu CỦA DỰ ÁN cho một test. Bộ chọn không bày token mặc định của Quilder
 * (22/10/2026), nên test nào cần dòng token phải tự tạo. Xoá sau mỗi test.
 */
const madeTokens: string[] = [];

test.afterEach(async ({ request }) => {
  const job = pending;
  pending = null;
  if (job) {
    const res = await request.post('/api/ops', {
      data: { pageId: job.pageId, label: 'e2e inspector-layout — hoàn tác', ops: job.ops },
    });
    if (!res.ok()) console.error(`[dọn] THẤT BẠI ${res.status()}: ${await res.text()}`);
  }
  // SAU khi hoàn tác: token còn được bản nháp dùng thì API từ chối xoá (409).
  for (const id of madeTokens.splice(0)) {
    const res = await request.delete(`/api/design-tokens/${id}`);
    if (!res.ok()) console.error(`[dọn token] THẤT BẠI ${res.status()}: ${await res.text()}`);
  }
});

async function projectColorTokens(request: APIRequestContext, names: string[]) {
  for (const [i, name] of names.entries()) {
    const res = await request.post('/api/design-tokens', {
      data: { name, value: `#${(0x224466 + i * 0x111111).toString(16).slice(-6)}` },
    });
    expect(res.ok(), await res.text()).toBe(true);
    madeTokens.push((await res.json()).token.id);
  }
}

/**
 * Chọn đơn vị / từ khoá / token qua `TokenPicker` (từ 21/10/2026 — trước đó là `<select>`).
 * `code` cùng mã với bộ chọn cũ: `px`, `kw:auto`, `tk:space-m`, `''` = gỡ.
 */
async function pickUnit(page: Page, trigger: Locator, code: string) {
  await trigger.click();
  const picker = page.locator('[data-token-picker]');
  if (code.startsWith('tk:')) await picker.locator(`[data-token-row="${code.slice(3)}"]`).click();
  else await picker.locator(`[data-pick="${code}"]`).click();
  await expect(picker).toHaveCount(0);
}

async function openEditor(page: Page): Promise<string> {
  await page.goto('/builder');
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('link', { name: new RegExp(PAGE_SLUG) }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  return page.url().split('/').pop()!;
}

async function selectHeading(page: Page) {
  await page.getByRole('button', { name: /Tiêu đề/ }).first().click();
  await expect(page.getByTitle(NODE)).toBeVisible();
}

const seg = (page: Page, field: string, value: string) =>
  page.locator(`[data-seg="${field}=${value}"]`);

/**
 * Mở một nhóm thuộc tính. KHÔNG làm gì nếu nó đã mở.
 *
 * ## Vì sao phải có hàm này thay vì bấm thẳng vào nút
 *
 * Nút nhóm là một TOGGLE, và trạng thái ban đầu của nó phụ thuộc DỮ LIỆU: nhóm tự mở
 * khi node có giá trị trong nhóm đó, gập khi không. Bấm thẳng nên có nghĩa "mở" với
 * node trống và "đóng" với node đã có giá trị — tức cùng một dòng test cho hai kết
 * quả trái ngược, tuỳ bản nháp đang ở trạng thái nào.
 *
 * Đây không phải lo xa. Trước 09/09/2026 test "ô flex chỉ hiện khi display có trục
 * con" bấm thẳng vào `[data-seg]` mà không mở nhóm, và nó XANH — vì một lần chạy
 * trước đó chết giữa đường đã để lại `layout.display` trên `ab000002`, và chính giá
 * trị sót ấy làm nhóm Bố cục tự mở. Khi `afterEach` dọn được thật thì nhóm gập lại và
 * test đỏ với "waiting for locator" — một lỗi trông như UI hỏng, mà thật ra là test
 * đã dựa vào rác của chính nó. `openEditor` xoá `localStorage`, nên trạng thái gập là
 * mặc định tất định chứ không phải thứ nhớ từ lượt trước.
 */
async function openSection(page: Page, name: string) {
  const btn = page.getByRole('button', { name: new RegExp(`^[▸▾]\\s*${name}`) });
  await expect(btn).toBeVisible();
  if (((await btn.textContent()) ?? '').includes('▸')) await btn.click();
  // Khẳng định nó ĐANG MỞ, chứ không chỉ "đã bấm": nếu mũi tên đổi hình dạng thì
  // dòng này đỏ ngay ở đây, thay vì đỏ ở một locator cách đó mười dòng.
  await expect(btn).toContainText('▾');
}

test('nhóm thuộc tính theo đúng thứ tự Webflow/Framer', async ({ page }) => {
  await openEditor(page);
  await selectHeading(page);

  const titles = await page
    .locator('aside section[data-prop-group] > button')
    .evaluateAll((els) =>
      els
        .map((e) => e.textContent?.replace(/[▾▸]/g, '').replace(/\d+$/, '').trim() ?? '')
        .filter(Boolean),
    );

  /*
   * Bố cục ĐỨNG TRƯỚC, trang trí đứng SAU — cả Webflow lẫn Framer đều vậy, và lý do
   * thực dụng: bố cục quyết định mọi ô phía sau nghĩa là gì, còn màu và hiệu ứng là
   * thứ sửa cuối. Thứ tự này cũng là thứ tự người ta dựng.
   *
   * Danh sách này chỉ gồm nhóm THUỘC TÍNH CỦA NODE (`[data-prop-group]`). Khối
   * "Trang" ở đáy pane phải cố ý không nằm đây: nó nói về trang, hiện cả khi không
   * chọn node nào, và đứng ngoài thứ tự Webflow/Framer vì nó không phải style. Trộn
   * nó vào đây biến một khẳng định về THỨ TỰ NHÓM STYLE thành một phép đếm mọi thứ
   * có mặt trong pane.
   */
  expect(titles).toEqual([
    'Bố cục',
    'Kích thước',
    'Khoảng cách',
    'Vị trí',
    'Chữ',
    'Nền & viền',
    'Hiệu ứng',
  ]);
});

test('hộp box model có đủ TÁM cạnh, kể cả lề ngang từng bị thiếu', async ({ page }) => {
  await openEditor(page);
  await selectHeading(page);

  /*
   * Mở nhóm nếu nó đang gập.
   *
   * Nhóm tự mở khi node ĐÃ có giá trị trong nhóm đó, và node tiêu đề này không có
   * đệm/lề nào ở lớp `lg` — nên với nó nhóm gập lại, đúng như thiết kế. Test phải mở
   * chứ không được giả định.
   */
  if ((await page.locator('[data-box-model]').count()) === 0) {
    await page.getByRole('button', { name: /Khoảng cách/ }).click();
  }

  await expect(page.locator('[data-box-model]')).toHaveCount(1);
  await expect(page.locator('[data-box-model] input')).toHaveCount(8);

  /*
   * `ml`/`mr` là điểm quan trọng nhất của test này.
   *
   * Bảng thuộc tính bản trước có pt/pb/pl/pr và mt/mb — **thiếu hẳn lề ngang**, dù
   * schema và compiler đều hỗ trợ. Không có đường nào đặt `margin-inline` từ giao
   * diện. Bày theo hộp làm chỗ trống đó lộ ra ngay, và đó cũng là một lợi ích của
   * việc bày theo hình.
   */
  for (const label of [
    'padding-block-start', 'padding-block-end', 'padding-inline-start', 'padding-inline-end',
    'margin-block-start', 'margin-block-end', 'margin-inline-start', 'margin-inline-end',
  ]) {
    await expect(page.getByLabel(label, { exact: true }), `thiếu ô "${label}"`).toBeVisible();
  }
});

/**
 * Bốn cạnh phải THẲNG CỘT — đo bằng hình học, không bằng class.
 *
 * Bản flex trước đó canh hàng trên bằng `justify-between` (để nhét nhãn vào cùng
 * hàng) và hàng dưới bằng `justify-center`, nên ô trên và ô dưới lệch nhau vài
 * chục pixel. Với một UI mà toàn bộ nội dung của nó là quan hệ không gian, lệch
 * cột đọc như số liệu sai — và không có test nào phát hiện, vì cả 8 ô vẫn hiện đủ.
 *
 * Đo tâm hộp thay vì đo class: nếu ai đó xếp lại bằng flex, absolute hay bảng, test
 * vẫn đúng miễn là bốn cạnh còn thẳng.
 */
test('bốn cạnh của hộp box model thẳng cột với nhau', async ({ page }) => {
  await openEditor(page);
  await selectHeading(page);

  if ((await page.locator('[data-box-model]').count()) === 0) {
    await page.getByRole('button', { name: /Khoảng cách/ }).click();
  }
  await expect(page.locator('[data-box-model]')).toHaveCount(1);

  const centerOf = async (label: string) => {
    const box = await page.getByLabel(label, { exact: true }).boundingBox();
    expect(box, `không đo được ô "${label}"`).not.toBeNull();
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, w: box!.width };
  };

  // Gán theo TÊN chứ không destructure mảng: `noUncheckedIndexedAccess` biến mọi
  // phần tử thành `| undefined`, và tám dòng `!` chỉ để im lặng trình biên dịch.
  const [pt, pb, pl, pr] = [
    await centerOf('padding-block-start'), await centerOf('padding-block-end'),
    await centerOf('padding-inline-start'), await centerOf('padding-inline-end'),
  ] as const;
  const [mt, mb, ml, mr] = [
    await centerOf('margin-block-start'), await centerOf('margin-block-end'),
    await centerOf('margin-inline-start'), await centerOf('margin-inline-end'),
  ] as const;

  // 1px cho sai số làm tròn của subpixel; 2px là đã thấy được bằng mắt.
  const TOL = 1;

  // Trên/dưới cùng một trục dọc, ở CẢ HAI hộp — và hai hộp cùng một trục.
  expect(Math.abs(pt.x - pb.x), 'đệm trên/dưới lệch cột').toBeLessThanOrEqual(TOL);
  expect(Math.abs(mt.x - mb.x), 'lề trên/dưới lệch cột').toBeLessThanOrEqual(TOL);
  expect(Math.abs(mt.x - pt.x), 'tâm hộp lề lệch tâm hộp đệm').toBeLessThanOrEqual(TOL);

  // Trái/phải cùng một trục ngang.
  expect(Math.abs(pl.y - pr.y), 'đệm trái/phải lệch hàng').toBeLessThanOrEqual(TOL);
  expect(Math.abs(ml.y - mr.y), 'lề trái/phải lệch hàng').toBeLessThanOrEqual(TOL);

  /*
   * Và hàng ngang của HỘP NGOÀI trùng hàng ngang của HỘP TRONG.
   *
   * Đây là chỗ lệch còn sót lại sau lần sửa đầu: nhãn "đệm" chiếm một hàng riêng nên
   * nó đẩy nội dung hộp trong xuống, làm tâm hộp trong không còn là tâm hàng giữa của
   * nó. `lề trái/phải` canh theo tâm hộp trong, `đệm trái/phải` canh theo tâm hàng
   * giữa — lệch đúng nửa chiều cao nhãn. Nhãn `absolute` (không chiếm chỗ) sửa nó, và
   * dòng này là thứ giữ cho nó không quay lại: hễ ai cho nhãn chiếm chỗ trở lại, hoặc
   * đặt padding trên khác padding dưới, số đo lệch ngay.
   */
  expect(Math.abs(ml.y - pl.y), 'hàng lề ngang lệch hàng đệm ngang').toBeLessThanOrEqual(TOL);

  // Tám ô cùng một bề rộng — một ô rộng hơn đọc như một ô quan trọng hơn.
  const widths = [pt, pb, pl, pr, mt, mb, ml, mr].map((c) => c.w);
  expect(Math.max(...widths) - Math.min(...widths), 'tám ô không cùng bề rộng')
    .toBeLessThanOrEqual(TOL);

  // Hộp đệm nằm TRONG hộp lề: bốn cạnh lề phải bao ngoài bốn cạnh đệm.
  expect(mt.y).toBeLessThan(pt.y);
  expect(mb.y).toBeGreaterThan(pb.y);
  expect(ml.x).toBeLessThan(pl.x);
  expect(mr.x).toBeGreaterThan(pr.x);
});

test('dải nút ghi được, và bấm lại chính nó thì GỠ', async ({ page, request }) => {
  const pageId = await openEditor(page);
  await selectHeading(page);

  const read = async () => {
    const res = await request.post('/api/ai/tool', {
      data: { tool: 'get_node', input: { pageId, nodeIds: [NODE] } },
    });
    const { result } = await res.json();
    return result.nodes[NODE].style as Record<string, { typography?: { align?: unknown } }>;
  };

  const before = await read();
  pending = {
    pageId,
    ops: [
      {
        op: 'setStyle',
        nodeId: NODE,
        target: 'lg',
        patch: { typography: { align: before.lg?.typography?.align ?? null } },
      },
    ],
  };

  await page.locator('[data-screen-button="w1440"]').click();

  const center = seg(page, 'typography.align', 'center');
  await expect(center).toBeVisible();
  await center.click();
  await expect(center).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await read()).lg?.typography?.align, { timeout: 15_000 })
    .toBe('center');

  /*
   * Bấm lại nút ĐANG chọn thì gỡ giá trị.
   *
   * Không có hành vi này thì một giá trị đặt nhầm chỉ gỡ được bằng nút × ở hàng
   * nhãn — mà nút đó chỉ hiện khi đã đặt, nên người dùng phải đoán ra rằng thứ mình
   * cần nằm ở một chỗ khác. Đây cũng là lý do dùng `aria-pressed` chứ không phải
   * `role="radio"`: radio không có ngữ nghĩa "bấm lại để bỏ".
   */
  await center.click();
  await expect(center).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(async () => (await read()).lg?.typography?.align, { timeout: 15_000 })
    .toBeUndefined();
});

test('ô flex chỉ hiện khi display có trục con', async ({ page, request }) => {
  const pageId = await openEditor(page);
  await selectHeading(page);

  const read = async () => {
    const res = await request.post('/api/ai/tool', {
      data: { tool: 'get_node', input: { pageId, nodeIds: [NODE] } },
    });
    const { result } = await res.json();
    return result.nodes[NODE].style as Record<string, { layout?: { display?: unknown } }>;
  };

  const before = await read();
  pending = {
    pageId,
    ops: [
      {
        op: 'setStyle',
        nodeId: NODE,
        target: 'lg',
        patch: { layout: { display: before.lg?.layout?.display ?? null } },
      },
    ],
  };

  await page.locator('[data-screen-button="w1440"]').click();

  // `ab000002` là node Text và không có giá trị layout nào, nên nhóm Bố cục gập —
  // xem docblock `openSection`.
  await openSection(page, 'Bố cục');

  // `block` không có trục con: gap/align/justify không sinh ra hiệu ứng nào.
  await seg(page, 'layout.display', 'block').click();
  await expect
    .poll(async () => (await read()).lg?.layout?.display, { timeout: 15_000 })
    .toBe('block');
  await expect(seg(page, 'layout.align', 'center')).toHaveCount(0);
  await expect(seg(page, 'layout.justify', 'center')).toHaveCount(0);
  // Và nói RÕ vì sao chúng không có ở đây, thay vì im lặng biến mất.
  await expect(page.getByText(/không có trục con/)).toBeVisible();

  // Đổi sang flex thì chúng xuất hiện.
  await seg(page, 'layout.display', 'flex').click();
  await expect(seg(page, 'layout.align', 'center')).toBeVisible();
  await expect(seg(page, 'layout.justify', 'center')).toBeVisible();
  await expect(seg(page, 'layout.flexDirection', 'column')).toBeVisible();
});

test('ô top/right/bottom/left chỉ hiện khi position khác static', async ({ page, request }) => {
  const pageId = await openEditor(page);
  await selectHeading(page);

  const before = await (async () => {
    const res = await request.post('/api/ai/tool', {
      data: { tool: 'get_node', input: { pageId, nodeIds: [NODE] } },
    });
    const { result } = await res.json();
    return result.nodes[NODE].style as Record<string, { position?: { kind?: unknown } }>;
  })();
  pending = {
    pageId,
    ops: [
      {
        op: 'setStyle',
        nodeId: NODE,
        target: 'lg',
        patch: { position: { kind: before.lg?.position?.kind ?? null } },
      },
    ],
  };

  await page.locator('[data-screen-button="w1440"]').click();

  // Mở nhóm Vị trí nếu nó đang gập.
  const positionGroup = page.getByRole('button', { name: /Vị trí/ });
  if ((await page.getByLabel('position', { exact: true }).count()) === 0) {
    await positionGroup.click();
  }

  await expect(page.getByText(/bỏ qua top \/ right \/ bottom \/ left/)).toBeVisible();
  await expect(page.getByLabel('inset-block-start', { exact: true })).toHaveCount(0);

  await page.getByLabel('position', { exact: true }).selectOption('absolute');
  for (const side of [
    'inset-block-start', 'inset-inline-end', 'inset-block-end', 'inset-inline-start',
  ]) {
    await expect(page.getByLabel(side, { exact: true })).toBeVisible();
  }
});

/**
 * Ô tìm thuộc tính.
 *
 * Bảy nhóm, 34 ô, và cái cần sửa thường nằm trong một nhóm đang gập. Ô tìm chỉ có
 * giá trị nếu nó làm hai việc: LỌC bớt nhóm không liên quan, và MỞ nhóm khớp — lọc
 * xong mà vẫn phải bấm mở thì nó chỉ bớt tiếng ồn chứ không đưa người dùng tới ô.
 *
 * Điểm quan trọng nhất: gõ tên VẬT LÝ (`width`, `padding-top`) phải ra được nhóm dù
 * nhãn của ô là logical (`inline-size`, `padding-block-start`). Không có nó thì đổi
 * nhãn sang tên chuẩn CSS lại thành một rào cản mới.
 */
test('ô tìm lọc theo cả tên logical và tên vật lý', async ({ page }) => {
  await openEditor(page);
  await selectHeading(page);

  const search = page.getByLabel('Tìm thuộc tính');
  await expect(search).toBeVisible();

  const titles = () =>
    page.locator('aside section[data-prop-group] > button').evaluateAll((els) =>
      els.map((e) => e.textContent?.replace(/[▾▸]/g, '').replace(/\d+$/, '').trim() ?? ''),
    );

  /*
   * Tên VẬT LÝ: nhãn ô là `inline-size`, nhưng người dùng gõ `width`.
   *
   * "Nền & viền" cũng ra, và đó ĐÚNG chứ không phải nhiễu: nhóm đó có `border-width`,
   * và nó thật sự là một bề rộng. Khớp theo chuỗi con giữ được những cặp như thế; khớp
   * theo từ trọn vẹn sẽ bỏ mất chúng.
   */
  await search.fill('width');
  expect(await titles()).toEqual(['Kích thước', 'Nền & viền']);
  // Và nhóm khớp phải MỞ SẴN — ô đã ở ngay trước mắt.
  await expect(page.getByLabel('inline-size', { exact: true })).toBeVisible();

  // Tên LOGICAL thì hẹp hơn: chỉ đúng một nhóm.
  await search.fill('inline-size');
  expect(await titles()).toEqual(['Kích thước']);

  // `padding-top` → hộp box model, nơi ô thật tên `padding-block-start`.
  await search.fill('padding-top');
  expect(await titles()).toEqual(['Khoảng cách']);
  await expect(page.getByLabel('padding-block-start', { exact: true })).toBeVisible();

  // Không khớp gì thì KHÔNG còn nhóm nào — im lặng giữ nguyên bảy nhóm sẽ khiến
  // người dùng tưởng ô tìm bị hỏng.
  await search.fill('khong-co-thuoc-tinh-nao-ten-nhu-the');
  expect(await titles()).toEqual([]);

  /*
   * Ô "thêm khi cần" cũng phải tìm ra được, kể cả khi chưa ai bấm thêm nó.
   *
   * Nếu không thì 27 ô ẩn chỉ tới được bằng cách đoán đúng nhóm rồi mở danh sách —
   * tức ô tìm mù đúng ở chỗ nó cần thấy nhất.
   */
  await search.fill('row-gap');
  expect(await titles()).toEqual(['Bố cục']);

  // `container-type` xếp vào Bố cục (không có section riêng cho hai ô), nên nó phải
  // tìm ra ở đó chứ không ra con số không.
  await search.fill('container-type');
  expect(await titles()).toEqual(['Bố cục']);

  // Xoá trắng thì trả lại đủ bảy nhóm.
  await search.fill('');
  expect((await titles()).length).toBe(7);
});

/**
 * Bản đồ lớp override.
 *
 * Câu hỏi nó trả lời: "node này còn đặt riêng gì ở khổ tôi KHÔNG đang xem". Không có
 * nó, người ta sửa `font-size` ở Desktop, thấy Mobile không đổi, và kết luận builder
 * hỏng — trong khi Mobile có một override đặt từ trước.
 *
 * Chip là ĐỒNG HỒ chứ không phải công tắc: bấm để xem lớp đó đặt gì, KHÔNG nhảy sang
 * lớp đó. Chọn khổ màn nằm ở canvas và chỉ ở đó.
 */
test('bản đồ lớp đếm đúng, và gỡ được override của lớp không đang xem', async ({ page, request }) => {
  const pageId = await openEditor(page);
  await selectHeading(page);

  const before = await (await request.post('/api/ai/tool', {
    data: { tool: 'resolve_style', input: { pageId, nodeId: NODE, breakpoint: 'sm' } },
  })).json();
  const smCountBefore = before.result.layers.sm.count as number;

  // Đặt một override ở lớp `sm` — lớp mà khổ đang xem (1440 → lg) KHÔNG phải.
  const res = await request.post('/api/ops', {
    data: {
      pageId,
      label: 'e2e layer-map — đặt override sm',
      ops: [{ op: 'setStyle', nodeId: NODE, target: 'sm', patch: { size: { minHeight: { v: 12, u: 'px' } } } }],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  pending = {
    pageId,
    ops: [{ op: 'setStyle', nodeId: NODE, target: 'sm', patch: { size: { minHeight: null } } }],
  };

  await page.reload();
  await selectHeading(page);

  const chip = page.locator('[data-layer-chip="sm"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(String(smCountBefore + 1));

  // Bấm chip: hiện danh sách của lớp đó, KHÔNG đổi lớp đang ghi.
  const layerLabel = page.locator('aside').getByText(/Desktop/).first();
  await expect(layerLabel).toBeVisible();
  await chip.click();

  const remove = page.locator('[data-layer-map-remove="sm:size.minHeight"]');
  await expect(remove).toBeVisible();
  await expect(layerLabel, 'bấm chip KHÔNG được đổi lớp đang xem').toBeVisible();

  // Gỡ ngay tại đây, không phải sang lớp sm mới gỡ được.
  await remove.click();
  await expect(chip).toContainText(String(smCountBefore));
  pending = null;
});

/**
 * "Thêm khi cần" — 27 ô đúng-nhưng-hiếm không bày sẵn.
 *
 * Ba tính chất phải đúng, và tính chất thứ ba là cái dễ quên nhất:
 *
 *  1. Bấm tên field là nó thành một ô THẬT, ghi được, đi qua op.
 *  2. Nhãn của nó là tên property CSS, không phải tên field trong schema.
 *  3. Ô có giá trị thì hiện SẴN, kể cả khi chưa ai bấm thêm — nếu không, một
 *     `row-gap` do Agent đặt qua MCP sẽ vô hình, và người dùng thấy khoảng cách trên
 *     trang mà không tìm được ô nào giải thích.
 */
test('thêm field khi cần: bấm là ra ô thật, ghi được, và undo được', async ({ page, request }) => {
  const pageId = await openEditor(page);
  await selectHeading(page);

  // Nhóm Bố cục là nhóm có nhiều ô ẩn nhất (10, kể cả hai ô container).
  const addBtn = page.locator('[data-add-field="layout"]');
  if (!(await addBtn.count())) {
    await page.getByRole('button', { name: /Bố cục/ }).click();
  }
  await expect(addBtn).toBeVisible();

  // Con số trên nút = số ô còn ẩn. Không có nó thì nút chỉ là một lời mời mơ hồ.
  await expect(addBtn).toContainText(/\d+$/);

  await addBtn.click();
  const pick = page.locator('[data-add-field-pick="layout.rowGap"]');
  await expect(pick).toBeVisible();
  // Danh sách gọi tên bằng property CSS, không phải `rowGap`.
  await expect(pick).toContainText('row-gap');

  await pick.click();
  // Danh sách đóng lại sau khi chọn — để mở thì nó che mất ô vừa thêm.
  await expect(pick).toHaveCount(0);

  const field = page.getByLabel('row-gap', { exact: true });
  await expect(field).toBeVisible();

  pending = {
    pageId,
    ops: [{ op: 'setStyle', nodeId: NODE, target: 'lg', patch: { layout: { rowGap: null } } }],
  };

  await field.fill('space-s');
  await field.press('Enter');

  // Ghi THẬT, và ra đúng property mà bảng ánh xạ nói.
  await expect(async () => {
    const html = await (await request.get(`/render/${pageId}`)).text();
    expect(html).toContain('row-gap');
  }).toPass({ timeout: 8_000 });

  // Và nó hiện trong bản đồ lớp của lớp đang xem — hai khối nói cùng một chuyện.
  await page.locator('[data-layer-chip="lg"]').click();
  await expect(page.locator('[data-layer-map-remove="lg:layout.rowGap"]')).toBeVisible();
});

test('ô đã có giá trị thì hiện SẴN, không phải bấm thêm mới thấy', async ({ page, request }) => {
  const pageId = await openEditor(page);

  // Đặt bằng op — đúng đường mà Agent qua MCP đi.
  const res = await request.post('/api/ops', {
    data: {
      pageId,
      label: 'e2e extra-fields — đặt white-space',
      ops: [{ op: 'setStyle', nodeId: NODE, target: 'lg', patch: { typography: { whiteSpace: 'nowrap' } } }],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  pending = {
    pageId,
    ops: [{ op: 'setStyle', nodeId: NODE, target: 'lg', patch: { typography: { whiteSpace: null } } }],
  };

  await page.reload();
  await selectHeading(page);

  // Nhóm Chữ tự mở vì node có giá trị trong nhóm đó; ô hiện mà KHÔNG cần bấm thêm.
  await expect(page.getByLabel('white-space', { exact: true })).toHaveValue('nowrap');
});

/**
 * Ô độ dài = số + bộ chọn đơn vị.
 *
 * Trước đây là một ô text duy nhất kèm datalist gợi ý: gõ `16px`, `space-m`, hay
 * `1.5rem` vào cùng một chỗ. Nó gọn nhưng bắt người dùng biết trước cú pháp, và danh
 * sách gợi ý chỉ hiện lúc focus rồi biến mất.
 *
 * Bộ chọn nhận CẢ BA dạng giá trị mà `Len` diễn đạt được — đơn vị, từ khoá, token —
 * nên đổi sang "số + đơn vị" không làm mất đường tới token hay `auto`. Đó là điều test
 * này canh: mất token nghĩa là mất cả design system khỏi bảng thuộc tính.
 */
test('ô độ dài: gõ số rồi chọn đơn vị, và bộ chọn có cả từ khoá lẫn token', async ({ page, request }) => {
  const pageId = await openEditor(page);
  await selectHeading(page);

  if ((await page.getByLabel('inline-size', { exact: true }).count()) === 0) {
    await page.getByRole('button', { name: /Kích thước/ }).click();
  }

  const num = page.getByLabel('inline-size', { exact: true });
  const unit = page.locator('[data-unit-select="size.width"]');
  await expect(num).toBeVisible();
  await expect(unit).toBeVisible();

  pending = {
    pageId,
    ops: [{ op: 'setStyle', nodeId: NODE, target: 'lg', patch: { size: { width: null } } }],
  };

  // 1. Gõ số, chọn đơn vị → ghi ra đúng { v, u }.
  await num.fill('240');
  await pickUnit(page, unit, 'px');
  await expect(async () => {
    const res = await request.post('/api/ai/tool', {
      data: { tool: 'resolve_style', input: { pageId, nodeId: NODE, breakpoint: 'lg' } },
    });
    const { result } = await res.json();
    const row = (result.fields as { field: string; value: unknown }[]).find(
      (f) => f.field === 'size.width',
    );
    expect(row?.value).toEqual({ v: 240, u: 'px' });
  }).toPass({ timeout: 8_000 });

  // 2. Đổi đơn vị thì GIỮ NGUYÊN con số — đó là cả điểm của việc tách hai phần.
  await pickUnit(page, unit, 'rem');
  await expect(async () => {
    const res = await request.post('/api/ai/tool', {
      data: { tool: 'resolve_style', input: { pageId, nodeId: NODE, breakpoint: 'lg' } },
    });
    const { result } = await res.json();
    const row = (result.fields as { field: string; value: unknown }[]).find(
      (f) => f.field === 'size.width',
    );
    expect(row?.value).toEqual({ v: 240, u: 'rem' });
  }).toPass({ timeout: 8_000 });

  /*
   * 3. Bộ chọn có chip đơn vị và chip từ khoá (`width` có `auto`/`full` trong schema). Thiếu
   * một nhóm nào cũng nghĩa là có một dạng giá trị hợp lệ mà giao diện không đặt được —
   * và người dùng sẽ phải xuống ô CSS tuỳ chỉnh, mất validate lẫn dấu override.
   *
   * Token MẶC ĐỊNH của Quilder (`space-*`, `gutter`…) KHÔNG bày từ 22/10/2026 — người dùng
   * không hiểu chúng ("chả hiểu gì"). Chỉ token của dự án được bày; site e2e trung tính
   * không có token độ dài nào của dự án, nên ở đây không có dòng token nào là đúng.
   */
  await unit.click();
  const picker = page.locator('[data-token-picker]');
  await expect(picker.locator('[data-pick="px"]')).toBeVisible();
  await expect(picker.locator('[data-pick="kw:auto"]')).toBeVisible();
  expect(await picker.locator('[data-token-row^="space-"], [data-token-row="gutter"]').count()).toBe(0);
  // Và không token khác loại: ô kích thước không bao giờ liệt kê màu hay thời lượng.
  expect(await picker.locator('[data-token-row^="color-"], [data-token-row^="dur-"]').count()).toBe(0);
  await page.keyboard.press('Escape');

  // 4. Chọn một từ khoá: ô số bị vô hiệu (không có số nào để gõ) và giá trị là chuỗi.
  await pickUnit(page, unit, 'kw:auto');
  await expect(num).toBeDisabled();
  await expect(async () => {
    const res = await request.post('/api/ai/tool', {
      data: { tool: 'resolve_style', input: { pageId, nodeId: NODE, breakpoint: 'lg' } },
    });
    const { result } = await res.json();
    const row = (result.fields as { field: string; value: unknown }[]).find(
      (f) => f.field === 'size.width',
    );
    expect(row?.value).toBe('auto');
  }).toPass({ timeout: 8_000 });

  // 5. Về "—" là GỠ hẳn khỏi lớp này.
  await pickUnit(page, unit, '');
  await expect(num).toBeEnabled();
});

test('ô compact vẫn sửa được khi đang mang token — nó không có bộ chọn để thoát', async ({ page }) => {
  /*
   * Hộp box model không có bộ chọn đơn vị riêng cho từng ô (tám ô × 3rem thì không
   * vừa panel 300px), nên ô ở đó KHÔNG được vô hiệu khi mang token: vô hiệu là biến
   * nó thành ô không bao giờ sửa hay gỡ được nữa.
   *
   * Đây là lỗi thật đã xảy ra trong lúc làm tính năng này, và test bắt được nó.
   */
  await openEditor(page);
  await selectHeading(page);

  if ((await page.locator('[data-box-model]').count()) === 0) {
    await page.getByRole('button', { name: /Khoảng cách/ }).click();
  }

  for (const label of ['padding-block-start', 'margin-block-start']) {
    await expect(page.getByLabel(label, { exact: true })).toBeEnabled();
  }

  // Và cụm compact có MỘT bộ chọn dùng chung, cho ô đang trống.
  await expect(page.locator('[data-unit-picker="spacing"]')).toBeVisible();
});

/**
 * Lát 2 của giao diện v2 — đầu panel Inspector.
 *
 * Ba thứ được kiểm ở đây, và mỗi thứ là một câu hỏi người dùng không trả lời được
 * trước lát này: node nào đang chọn, nó nằm ở đâu trong cây, và sửa ở đây ghi vào lớp
 * nào. Hai câu đầu trước đây phải đi tìm ở cây bên trái; câu thứ ba chỉ có tên lớp trần
 * không nói rõ là "đang ghi".
 */
/**
 * Lát 2 của giao diện v2 — đầu panel Inspector.
 *
 * Ba câu hỏi mà trước lát này panel không trả lời: node nào đang chọn, nó nằm đâu
 * trong cây, và sửa ở đây ghi vào lớp nào. Hai câu đầu phải đi tìm ở cây bên trái;
 * câu thứ ba chỉ có tên lớp trần, không nói rõ đó là lớp ĐANG GHI.
 *
 * Lớp mặc định của store là `lg` (`store.ts:178`), không phải `base` — mọi test dưới
 * đây đặt khổ màn tường minh thay vì dựa vào mặc định.
 */
test.describe('lát 2 — đầu panel Inspector', () => {
  test('nói rõ ĐANG GHI vào lớp nào, và đổi theo khổ màn', async ({ page }) => {
    await openEditor(page);
    await selectHeading(page);

    const layer = page.locator('[data-writing-layer]');
    // Chữ, không chỉ móc: móc là cho test, người dùng đọc chữ. Móc đúng mà chữ trống
    // thì test vẫn xanh và panel vẫn không nói gì.
    await expect(layer).toContainText('đang ghi');

    await page.locator('[data-screen-button="w320"]').click();
    await expect(layer).toHaveAttribute('data-writing-layer', 'base');

    await page.locator('[data-screen-button="w1440"]').click();
    await expect(layer).toHaveAttribute('data-writing-layer', 'lg');
  });

  test('đường dẫn tổ tiên bấm được, và bấm là lên đúng một bậc', async ({ page }) => {
    await openEditor(page);
    await selectHeading(page);

    const crumbs = page.getByRole('navigation', { name: 'Đường dẫn tổ tiên' });
    await expect(crumbs).toBeVisible();

    /*
     * `ab000002` nằm ngay dưới gốc, nên đường dẫn có đúng một bậc bấm được — chính
     * gốc. Node đang chọn KHÔNG phải nút (bấm nó không đổi gì, và một nút vô tác dụng
     * làm người dùng nghi cả hàng còn lại), nên số nút = số tổ tiên.
     */
    await expect(crumbs.getByRole('button')).toHaveCount(1);
    await crumbs.getByRole('button').click();

    // Lên tới gốc thì không còn tổ tiên nào: đường dẫn còn một bậc và không nút nào.
    await expect(crumbs.getByRole('button')).toHaveCount(0);
    await expect(crumbs).toBeVisible();
  });

  test('ô kế thừa nói TỪ LỚP NÀO thành chữ, và chip đó ghi đè được', async ({ page, request }) => {
    const pageId = await openEditor(page);
    await selectHeading(page);

    const read = async () => {
      const res = await request.post('/api/ai/tool', {
        data: { tool: 'get_node', input: { pageId, nodeIds: [NODE] } },
      });
      const { result } = await res.json();
      return result.nodes[NODE].style as Record<string, { layout?: { display?: unknown } }>;
    };

    const before = await read();
    pending = {
      pageId,
      ops: [
        {
          op: 'setStyle', nodeId: NODE, target: 'base',
          patch: { layout: { display: before.base?.layout?.display ?? null } },
        },
        {
          op: 'setStyle', nodeId: NODE, target: 'lg',
          patch: { layout: { display: before.lg?.layout?.display ?? null } },
        },
      ],
    };

    // Đặt giá trị ở lớp GỐC để ba lớp trên nó có gì mà kế thừa.
    await page.locator('[data-screen-button="w320"]').click();
    await openSection(page, 'Bố cục');
    await seg(page, 'layout.display', 'flex').click();
    await expect.poll(async () => (await read()).base?.layout?.display, { timeout: 15_000 }).toBe('flex');

    // Sang lớp `lg`: ô phải nói nó đang kế thừa từ `base`, bằng CHỮ chứ không phải
    // chỉ trong tooltip — đó là toàn bộ điểm của lát này.
    await page.locator('[data-screen-button="w1440"]').click();
    await openSection(page, 'Bố cục');
    const chip = page.locator('[data-inherit-from="base"]').first();
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('base');

    // Và chip LÀ nút ghi đè: bấm là hạ giá trị đang kế thừa xuống lớp đang xem.
    await chip.click();
    await expect.poll(async () => (await read()).lg?.layout?.display, { timeout: 15_000 }).toBe('flex');
  });
});

/*
 * Ô màu (21/10/2026): danh sách token có Ô MÀU ở từng dòng — trước đó là `<datalist>` gốc,
 * chỉ có tên và mã, nên chọn màu là chọn mù. Ô màu phải vẽ đúng giá trị của token (giải
 * từ bảng Token, không phải `var()` — vỏ builder không nạp tokens.css).
 */
test('ô màu: danh sách token có ô màu thật, chọn là ghi token', async ({ page, request }) => {
  const pageId = await openEditor(page);
  await selectHeading(page);
  await openSection(page, 'Nền & viền');

  pending = {
    pageId,
    ops: [{ op: 'setStyle', nodeId: NODE, target: 'lg', patch: { fill: { color: null } } }],
  };

  // Bộ chọn chỉ bày token màu CỦA DỰ ÁN (22/10/2026) — tạo hai cái cho test này.
  await projectColorTokens(request, ['e2e-mau-a', 'e2e-mau-b']);
  await page.reload();
  await selectHeading(page);
  await openSection(page, 'Nền & viền');

  await page.locator('[aria-label^="Chọn token màu cho background"]').click();
  const picker = page.locator('[data-token-picker]');
  const rows = picker.locator('[data-token-row]');
  await expect(rows.first()).toBeVisible();

  // Mọi dòng có ô màu đã giải ra một màu thật — không dòng nào trống.
  const swatches = await rows.evaluateAll((els) =>
    els.map((e) => e.querySelector('[data-swatch]')?.getAttribute('data-swatch') ?? ''),
  );
  expect(swatches.length).toBeGreaterThan(0);
  expect(swatches.filter((s) => !s)).toEqual([]);
  // Không có token khác loại lọt vào (space, dur…), và không token màu MẶC ĐỊNH (`color-*`).
  expect(await picker.locator('[data-token-row^="space-"], [data-token-row^="dur-"]').count()).toBe(0);
  expect(await picker.locator('[data-token-row^="color-"]').count()).toBe(0);

  const name = await rows.first().getAttribute('data-token-row');
  await rows.first().click();
  await expect(picker).toHaveCount(0);

  await expect(async () => {
    const res = await request.post('/api/ai/tool', {
      data: { tool: 'resolve_style', input: { pageId, nodeId: NODE, breakpoint: 'lg' } },
    });
    const { result } = await res.json();
    const row = (result.fields as { field: string; value: unknown }[]).find((f) => f.field === 'fill.color');
    expect(row?.value).toEqual({ $token: name });
  }).toPass({ timeout: 8_000 });
});
