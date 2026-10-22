import { expect, test, type Page } from '@playwright/test';

/**
 * Khung xem trước: một khổ mỗi lúc, đổi bằng nút, và tương tác trong khung bị vô
 * hiệu hoá.
 *
 * Bốn yêu cầu người dùng nêu ngày 19/08/2026, sau khi dùng bản canvas kéo–phóng:
 *
 *  1. bỏ chiều cao tự do, quay lại khung cao cố định
 *  2. giả lập khổ theo bề rộng mặc định 1920 / 1440 / 1024 / 768 / 320, và cho tự
 *     thêm/sửa số lượng lẫn bề rộng
 *  3. bấm nút để đổi khổ, chỉ hiển thị MỘT khổ mỗi lúc
 *  4. nút/link trong khung bị vô hiệu hoá, bấm vào là ra thuộc tính
 *
 * File này không sửa nội dung trang nên không cần dọn. Nó CÓ ghi `localStorage`
 * (danh sách khổ), và mỗi test tự đặt lại về mặc định ở đầu.
 */

const PAGE_HREF = /^\/builder\/c[a-z0-9]{20,}$/;

const stage = (page: Page) => page.locator('[data-stage]');

async function openEditor(page: Page) {
  await page.goto('/builder');
  // Xoá cả lựa chọn khổ đã lưu: một lượt trước để lại khổ tự thêm sẽ làm test sau
  // đọc một danh sách không phải mặc định.
  await page.evaluate(() => localStorage.clear());

  const hrefs = await page
    .locator('a[href^="/builder/"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  const target = hrefs.find((h) => h && PAGE_HREF.test(h));
  expect(target, 'không tìm thấy link tới một trang nào').toBeTruthy();

  await page.goto(target!);
  await expect(stage(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  // HTML từ server đã có `data-stage` nhưng CHƯA có `data-stage-width`: thuộc tính đó do
  // layout effect của Canvas ghi sau khi hydrate. Đọc trước lúc đó ra `Number(null)` = 0 —
  // đỏ chập chờn khi máy bận (lần chạy cả suite ngày 08/10/2026).
  await expect(stage(page)).toHaveAttribute('data-stage-width', /^[0-9]+$/);
  return target!.split('/builder/')[1]!;
}

/** Trạng thái khung, đọc từ DOM. */
async function view(page: Page) {
  const el = stage(page);
  return {
    screen: await el.getAttribute('data-stage-screen'),
    width: Number(await el.getAttribute('data-stage-width')),
    height: Number(await el.getAttribute('data-stage-height')),
    scale: Number(await el.getAttribute('data-stage-scale')),
  };
}

/**
 * Chờ iframe nạp xong nội dung VÀ bố cục đã ổn định.
 *
 * "Có node" là chưa đủ: ảnh chưa về chiếm 0px, nên toạ độ đo lúc đó khác toạ độ lúc
 * bấm — và test dò một điểm rồi bấm vào điểm đó sẽ bấm ra chỗ khác. Đây đúng là lý do
 * `bấm vào LINK` xanh khi chạy riêng và đỏ khi chạy cả file.
 */
async function waitForFrame(page: Page) {
  const frame = page.frameLocator('[data-stage-frame] iframe[data-canvas-frame="shown"]');
  await expect
    .poll(() => frame.locator('[data-n]').count().catch(() => 0), { timeout: 30_000 })
    .toBeGreaterThan(0);

  /*
   * Chỉ chờ có node, rồi một nhịp ngắn. Hai điều kiện "chắc chắn hơn" đã thử và cả
   * hai đều treo:
   *
   *  - `[...document.images].every(i => i.complete)`: ảnh `loading="lazy"` nằm dưới
   *    màn hình KHÔNG BAO GIỜ tải trong một khung cao 900px, nên điều kiện này vĩnh
   *    viễn false. Treo 30 giây rồi đỏ.
   *  - `scrollHeight` đứng yên hai nhịp: trang chủ có section kể chuyện theo cuộn,
   *    chiều cao đổi liên tục theo `data-in-view`. Cũng treo 30 giây.
   *
   * Nên cách đúng không phải là chờ lâu hơn mà là ĐO LẠI ngay trước khi bấm — các
   * test dưới đây làm vậy.
   */
  await page.waitForTimeout(500);
}

test('đúng MỘT khung, và năm khổ mặc định là 1920/1440/1024/768/320', async ({ page }) => {
  await openEditor(page);

  // Một khung, không phải năm. Đây là thay đổi kiến trúc, không phải chi tiết giao
  // diện: năm iframe là năm lần render cùng một trang.
  await expect(stage(page).locator('iframe')).toHaveCount(1);

  const widths = await page
    .locator('[data-screen-button]')
    .evaluateAll((els) => els.map((e) => Number(e.querySelector('span')?.textContent)));
  expect(widths).toEqual([1920, 1440, 1024, 768, 320]);

  // Mở ở 1440, không phải khổ rộng nhất: 1920 phải thu nhỏ nhiều mới vừa pane.
  expect((await view(page)).width).toBe(1440);
});

test('bấm nút đổi khổ, và LỚP STYLE đi theo bề rộng', async ({ page }) => {
  await openEditor(page);

  /*
   * Cặp (bề rộng → lớp) là hợp đồng quan trọng nhất của thanh này: nó quyết định
   * thao tác sửa của người dùng rơi vào lớp nào. Sai ở đây nghĩa là sửa ở khổ 320
   * mà ghi vào `xl` — người dùng thấy khung không đổi gì và không có cách nào đoán ra.
   */
  for (const [id, width, layer] of [
    ['w1920', 1920, 'xl'],
    ['w1024', 1024, 'md'],
    ['w768', 768, 'sm'],
    ['w320', 320, 'base'],
  ] as const) {
    await page.locator(`[data-screen-button="${id}"]`).click();
    await expect.poll(async () => (await view(page)).width, { timeout: 5_000 }).toBe(width);
    await expect(page.getByText(`đang sửa lớp ${layer}`)).toBeVisible();
    // Nút đang chọn phải nói ra là nó đang được chọn.
    await expect(page.locator(`[data-screen-button="${id}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
});

test('chiều cao khung CỐ ĐỊNH theo khổ, không bám nội dung', async ({ page }) => {
  await openEditor(page);
  await waitForFrame(page);

  /*
   * Bản bám-nội-dung đã thử và bị loại: khung cao 9.728px làm `100svh` bên trong cũng
   * thành 9.728px, nên trang dùng đơn vị viewport tự phình lên 65.184px. Chiều cao
   * bằng một màn thiết bị thì `vh` đúng nghĩa.
   *
   * Trang chủ cao hàng nghìn pixel, nên nếu chiều cao bám nội dung thì con số dưới
   * đây sẽ không phải 900.
   */
  await page.locator('[data-screen-button="w1440"]').click();
  await expect.poll(async () => (await view(page)).height, { timeout: 5_000 }).toBe(900);

  await page.locator('[data-screen-button="w768"]').click();
  // 768 là iPad DỌC: cao hơn rộng.
  await expect.poll(async () => (await view(page)).height, { timeout: 5_000 }).toBe(1024);
});

test('thêm khổ tuỳ ý, còn sau khi tải lại, và đặt lại được', async ({ page }) => {
  await openEditor(page);

  await page.locator('[data-screen-manage]').click();
  await page.locator('[data-screen-new]').fill('1600');
  await page.locator('[data-screen-add]').click();

  // Thêm xong thì chuyển sang luôn khổ vừa thêm — nếu không, người dùng phải bấm
  // thêm một lần nữa để thấy thứ họ vừa tạo.
  await expect.poll(async () => (await view(page)).width, { timeout: 5_000 }).toBe(1600);
  // Và nó xếp đúng chỗ theo bề rộng, không nhét xuống cuối.
  await expect(page.locator('[data-screen-button]')).toHaveCount(6);
  const order = await page
    .locator('[data-screen-button]')
    .evaluateAll((els) => els.map((e) => Number(e.querySelector('span')?.textContent)));
  expect(order).toEqual([1920, 1600, 1440, 1024, 768, 320]);

  // Còn sau khi tải lại: danh sách là lựa chọn giao diện, lưu ở localStorage.
  await page.reload();
  await expect(stage(page)).toBeVisible();
  await expect.poll(() => page.locator('[data-screen-button]').count(), { timeout: 15_000 }).toBe(6);

  // Đặt lại về năm khổ mặc định.
  await page.locator('[data-screen-manage]').click();
  await page.locator('[data-screen-reset]').click();
  await expect(page.locator('[data-screen-button]')).toHaveCount(5);
  await expect.poll(async () => (await view(page)).width, { timeout: 5_000 }).toBe(1440);
});

test('không xoá được khổ CUỐI CÙNG', async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-screen-manage]').click();

  // Xoá bốn, còn một.
  for (const id of ['w1920', 'w1024', 'w768', 'w320']) {
    await page.locator(`[data-screen-remove="${id}"]`).click();
  }
  await expect(page.locator('[data-screen-button]')).toHaveCount(1);

  // Khổ cuối không xoá được: danh sách rỗng là một pane trắng, và lúc đó giao diện
  // không còn đường nào để thêm khổ lại.
  await expect(page.locator('[data-screen-remove="w1440"]')).toBeDisabled();
});

test('bấm vào LINK trong khung: chọn node, KHÔNG điều hướng', async ({ page }) => {
  await openEditor(page);
  await waitForFrame(page);

  const frame = page.frameLocator('[data-stage-frame] iframe[data-canvas-frame="shown"]');

  /*
   * Tìm một link mà một cú bấm THẬT SỰ rơi vào — bằng `elementFromPoint`, không bằng
   * selector.
   *
   * Ba cái bẫy đã gặp, mỗi cái làm một bản test đỏ oan:
   *
   *  - Link ĐẦU TIÊN của trang là "Chuyển đến nội dung chính", nằm ở `top: -65px`,
   *    tức ngoài khung nhìn. Playwright vẫn coi nó là visible.
   *  - Lọc theo `clip-path` không cứu được: ở trạng thái này nó là `none`.
   *  - Không phải link nào cũng có tổ tiên mang `data-n`: `Composite` là client island
   *    tự render markup của nó, và bấm vào đó không chọn được node nào — hành vi đúng,
   *    vì không có node nào để chọn.
   *
   * `elementFromPoint` gộp cả ba điều kiện thành một: nó trả về đúng phần tử mà
   * trình duyệt sẽ giao sự kiện cho, nên id lấy được LÀ id sẽ được chọn.
   */
  /*
   * `force: true` là CÓ CHỦ ĐÍCH ở đây.
   *
   * Câu hỏi của test này là "hành vi mặc định có bị chặn không", không phải "phần tử
   * có bấm tới được không". `force` bỏ qua phép kiểm che chắn nhưng vẫn phát sự kiện
   * chuột THẬT, nên `preventDefault` vẫn được thử đúng như thật.
   *
   * Ba bản trước không dùng `force` và đỏ ngẫu nhiên vì cùng một nguyên nhân: link duy
   * nhất trong màn đầu là CTA của hero, và hero chỉ cao đủ sau khi ảnh về; chờ lâu hơn
   * hay cuộn vào giữa đều không làm nó tin cậy được. Việc "bấm thì chọn đúng node" đã
   * có test riêng bên dưới, trên một phần tử không phụ thuộc thứ tự nạp.
   */
  const link = frame.locator('a[href]').first();
  const target = await link.getAttribute('href');
  expect(target, 'link không có href thì không kiểm được việc chặn điều hướng').toBeTruthy();

  const urlBefore = page.url();
  /** Địa chỉ BÊN TRONG khung — đây là thứ sẽ đổi nếu link điều hướng thật. */
  const frameUrl = () =>
    page.locator('[data-stage-frame] iframe').evaluate(
      (el) => (el as HTMLIFrameElement).contentWindow?.location.href ?? '',
    );
  const frameBefore = await frameUrl();

  await link.click({ force: true });
  await page.waitForTimeout(500);

  // Trang builder không đi đâu…
  expect(page.url()).toBe(urlBefore);
  // …và khung cũng không đi đâu, kể cả tới một anchor `#` trong cùng trang.
  expect(await frameUrl(), `link ${target} đã điều hướng khung`).toBe(frameBefore);
});

test('viền chọn nằm ĐÚNG chỗ node, không phải chỗ node cha', async ({ page }) => {
  await openEditor(page);
  await waitForFrame(page);

  const frame = page.frameLocator('[data-stage-frame] iframe[data-canvas-frame="shown"]');
  const h1 = frame.locator('h1').first();
  const wantId = await h1.evaluate(
    (el) => el.closest('[data-n]')?.getAttribute('data-n') ?? null,
  );
  expect(wantId, 'trang test không có h1 mang data-n').toBeTruthy();

  /*
   * So viền với node TRONG CÙNG MỘT lần đọc.
   *
   * Bản trước đo `h1` một lần rồi poll viền so với con số đã đo — và nó đỏ ngẫu nhiên
   * trong lượt chạy cả suite: bố cục trang chủ còn xê dịch theo `data-in-view`, nên
   * con số đo lúc đầu không còn là con số hiện tại và phép so không bao giờ khớp.
   *
   * Đọc cả hai bên trong một `page.evaluate` là tự nhất quán: iframe cùng origin nên
   * trang cha với tới `contentDocument` được.
   *
   * Đọc viền MANG NHÃN đúng id, không đọc "viền đầu tiên": khi con trỏ còn nằm trên
   * node, viền hover cũng có mặt và nó đứng TRƯỚC trong DOM.
   *
   * So cả RECT, không chỉ id: viền mang đúng id nhưng vẽ ở toạ độ node cha là một lỗi
   * thật và trông rất giống "đúng" — chỉ lệch khi node nhỏ nằm trong node lớn.
   */
  const compare = () =>
    page.evaluate((id) => {
      const frameEl = document.querySelector('[data-stage-frame] iframe') as HTMLIFrameElement;
      const el = frameEl.contentDocument?.querySelector(`[data-n="${id}"]`);
      if (!el) return { why: 'không thấy node trong khung' };

      const boxes = [
        ...document.querySelectorAll<HTMLElement>('[data-stage-frame] > div.pointer-events-none'),
      ];
      const box = boxes.find((b) => b.querySelector('span')?.textContent === id);
      if (!box) return { why: 'không có viền nào mang id này' };

      const r = el.getBoundingClientRect();
      const dw = Math.abs(Number.parseFloat(box.style.width) - r.width);
      const dh = Math.abs(Number.parseFloat(box.style.height) - r.height);
      const dt = Math.abs(Number.parseFloat(box.style.top) - r.top);
      // Ngưỡng 1px: cả hai bên đều là số thực từ getBoundingClientRect.
      return { why: '', khop: dw <= 1 && dh <= 1 && dt <= 1, dw, dh, dt };
    }, wantId);

  /*
   * BẤM LẠI trong mỗi nhịp poll, không bấm một lần rồi chờ.
   *
   * Bản trước bấm một lần và đỏ khoảng 1 trên 7 lượt. Nguyên nhân đã tìm ra và nó là
   * hành vi thật của iframe, không phải lỗi test: `EditorShell` tăng `frameKey` khi
   * `candidateDoc` được khởi tạo, nên khung nạp lại một lần ngay sau khi mount. Trong
   * khoảng đó, document cũ đã bị tháo listener và document mới chưa gắn — nên một cú
   * bấm rơi vào đúng khe ấy KHÔNG chọn được gì, và chờ thêm bao lâu cũng không cứu.
   *
   * Bấm lại là vô hại (chọn cùng một node) và nó biến một cuộc đua thành một vòng lặp
   * hội tụ. Đây cũng đúng thứ người dùng thật làm khi cú bấm đầu không ăn.
   */
  await expect
    .poll(
      async () => {
        await h1.click({ force: true }).catch(() => undefined);
        return (await compare()).khop === true;
      },
      { timeout: 25_000, intervals: [300, 600, 1000, 1500, 2000] },
    )
    .toBe(true);
});

test('nút 100% cho xem đúng kích thước thật', async ({ page }) => {
  await openEditor(page);

  await page.locator('[data-screen-button="w1920"]').click();
  // Ở khổ 1920 trong pane hẹp thì phải đang bị thu nhỏ — nếu không, phần dưới không
  // kiểm được gì.
  await expect.poll(async () => (await view(page)).scale, { timeout: 5_000 }).toBeLessThan(1);

  await page.locator('[data-stage-actual-size]').click();
  await expect.poll(async () => (await view(page)).scale, { timeout: 5_000 }).toBe(1);

  await page.locator('[data-stage-actual-size]').click();
  await expect.poll(async () => (await view(page)).scale, { timeout: 5_000 }).toBeLessThan(1);
});

test('trang xem nháp: nút giả lập width, và bản TRẦN vẫn render trực tiếp', async ({
  page,
  request,
}) => {
  const pageId = await openEditor(page);

  /*
   * Bản trần PHẢI render trang thẳng vào document, không qua iframe.
   *
   * Không phải để cho gọn: `pnpm check:layout` đo `[data-n]` ở document trên cùng, và
   * bốn spec e2e (`carousel`, `chapter-parallax`, `panel-stack`, `savings`) chạy
   * effect ở đó. Bọc iframe theo mặc định là làm hỏng cả năm thứ cùng lúc.
   */
  /*
   * Node render = THUỘC TÍNH `data-n="…"` trên phần tử HTML. So chuỗi `data-n=` trơ thì khớp cả
   * bộ chọn CSS `[data-n=…]` trong payload RSC — mà payload nào của segment cũng mang CSS của
   * trang 404 hệ thống (ranh giới not-found của Next), kể cả vỏ giả lập.
   */
  const NODE_ATTR = /\sdata-n="/;
  const raw = await (await request.get(`/preview/${pageId}`)).text();
  expect(raw, 'bản trần phải có node render trực tiếp').toMatch(NODE_ATTR);
  expect(raw, 'bản trần KHÔNG được bọc iframe').not.toMatch(/<iframe[^>]*src="\/preview\//);
  expect(raw, 'phải có nút giả lập width').toContain('data-preview-width=');

  // `?w=` → vỏ chứa iframe, và KHÔNG render trực tiếp (tránh dựng trang hai lần).
  const sim = await (await request.get(`/preview/${pageId}?w=768`)).text();
  expect(sim).toMatch(/<iframe[^>]*src="\/preview\//);
  expect(sim).not.toMatch(NODE_ATTR);

  // Giá trị vô nghĩa thì BỎ QUA, không kẹp về biên: `?w=0` là link hỏng, và một iframe
  // rộng 240px không phải thứ người ta muốn khi gõ 0.
  for (const bad of ['0', '99999', 'abc']) {
    const fallback = await (await request.get(`/preview/${pageId}?w=${bad}`)).text();
    expect(fallback, `?w=${bad} phải rơi về bản trần`).toMatch(NODE_ATTR);
  }
});

/*
 * 22/10/2026 (ảnh user gửi): mở "Chia sẻ" thì nhãn "đang sửa lớp…", "Khổ màn", "Toàn trang" và
 * ô % của thanh khổ màn VẼ ĐÈ lên bảng. Header không có z-index nên bảng `z-30` của nó ngang
 * hàng với thanh khổ màn `z-30` đứng sau trong DOM — và cái đứng sau thắng. Kiểm bằng thứ
 * người dùng bấm được: ở tâm mỗi nút của thanh khổ màn nằm dưới bảng, phần tử trên cùng
 * phải thuộc về bảng.
 */
test('bảng "Chia sẻ" nằm TRÊN thanh khổ màn của canvas', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Chia sẻ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Chia sẻ trang' });
  await expect(dialog).toBeVisible();

  const covered = await dialog.evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    const bar = document.querySelector('[data-screen-manage]')!.closest('.z-30')!;
    const out: { text: string; onTop: boolean }[] = [];
    for (const el of bar.querySelectorAll<HTMLElement>('button, [class*="rounded"]')) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      const top = document.elementFromPoint(x, y);
      out.push({ text: el.textContent?.trim() ?? '', onTop: !!top && panel.contains(top) });
    }
    return out;
  });
  // Bố cục 1280px phải thật sự có chỗ chồng nhau, nếu không test này không kiểm gì cả.
  expect(covered.length).toBeGreaterThan(0);
  expect(covered.filter((c) => !c.onTop)).toEqual([]);
});
