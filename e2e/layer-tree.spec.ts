import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Cây node — gập nhánh và ẩn/hiện khối.
 *
 * Hợp đồng với người dùng:
 *  - gập một nhánh cất hậu duệ của nó đi, và nói rõ cất bao nhiêu
 *  - ô tìm XUYÊN QUA nhánh đang gập; nếu không thì bộ đếm "19/159" là lời nói dối
 *  - chọn một node từ preview thì cây tự mở đường tới nó
 *  - chọn một node từ cây (hay từ danh sách cảnh báo) thì KHUNG cuộn tới nó; bấm
 *    trong khung thì không cuộn
 *  - nút mắt ẩn khối mà KHÔNG xoá, và khối đã ẩn thì không lên site khi publish
 *
 * MỌI test sửa nội dung phải dọn trong `afterEach`: trong bộ e2e này một bản nháp
 * bẩn sẽ bị `users.spec.ts` publish thẳng lên site thật. Nhóm "ẩn/hiện" dưới đây
 * có ghi, nên nó dọn bằng op nghịch đảo chứ không dựa vào việc bấm lại nút.
 */

const HOME = /^Trang chủ \/$/;
const TEST_PAGE = /gioi-thieu/;

let pending: { pageId: string; ops: unknown[] } | null = null;

test.afterEach(async ({ request }) => {
  if (!pending) return;
  const { pageId, ops } = pending;
  pending = null;
  const res = await request.post('/api/ops', {
    data: { pageId, label: 'e2e cây node — hoàn tác', ops },
  });
  // Không log thì một op sai tên (không khớp schema) vẫn trả về "xong" ở đây trong
  // khi thật ra no-op ở server — đúng lỗi từng để lọt một node `render: false` vào
  // bản nháp thật. Log cho lần sau lộ ra ngay, không phải dò tay.
  if (!res.ok()) console.error(`[dọn] THẤT BẠI ${res.status()}: ${await res.text()}`);
});

async function openEditor(page: Page, link: RegExp): Promise<string> {
  await page.goto('/builder');
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('link', { name: link }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  return page.url().split('/builder/')[1]!;
}

const rows = (page: Page) => page.locator('[data-layer-row]');

test.describe('gập nhánh', () => {
  test('gập tất cả còn một hàng, mở tất cả về nguyên', async ({ page }) => {
    await openEditor(page, HOME);
    const full = await rows(page).count();
    expect(full).toBeGreaterThan(100);

    await page.getByRole('button', { name: 'Gập tất cả nhánh' }).click();
    // Gập gốc là cất cả cây — còn đúng hàng gốc. (Chưa chọn node nào, nên không có
    // nhánh nào được chừa — xem test dưới.)
    await expect.poll(() => rows(page).count(), { timeout: 5_000 }).toBe(1);

    await page.getByRole('button', { name: 'Mở tất cả nhánh' }).click();
    await expect.poll(() => rows(page).count(), { timeout: 5_000 }).toBe(full);
  });

  test('gập tất cả CHỪA nhánh của node đang chọn', async ({ page }) => {
    await openEditor(page, HOME);

    /*
     * Node đang chọn phải còn thấy được sau khi gập.
     *
     * Không thế thì Inspector bày thuộc tính của một node mà cây không hiện — hai
     * khung nói hai chuyện khác nhau, và không có gì giải thích. Đây đúng hành vi
     * Figma: "all expanded layers except for your selection will collapse".
     *
     * `useEffect` mở-đường-tới-selection không cứu được: nó chỉ chạy khi selection
     * ĐỔI, mà bấm gập thì selection giữ nguyên.
     */
    const target = rows(page).nth(4);
    const nodeId = (await target.getAttribute('data-layer-row'))!;
    await target.click();

    await page.getByRole('button', { name: 'Gập tất cả nhánh' }).click();

    // Hàng của node đang chọn VẪN còn trong cây.
    await expect(page.locator(`[data-layer-row="${nodeId}"]`)).toHaveCount(1);

    // Và nhiều hơn một hàng — nếu bằng 1 thì nó đã bị cất và assertion trên xanh
    // vì lý do sai (node được chọn tình cờ là gốc).
    expect(await rows(page).count()).toBeGreaterThan(1);
  });

  test('gập một nhánh cất hậu duệ và hiện số đã cất', async ({ page }) => {
    await openEditor(page, HOME);
    const full = await rows(page).count();

    const chevron = page.getByRole('button', { name: /^Gập / }).nth(1);
    const label = await chevron.getAttribute('aria-label');
    await chevron.click();

    const after = await rows(page).count();
    expect(after).toBeLessThan(full);

    // Hàng đang gập phải nói nó cất bao nhiêu — "vừa cất 3 thứ hay 90 thứ" là
    // câu hỏi duy nhất người dùng có lúc đó.
    const hidden = full - after;
    const row = page.locator('[data-layer-row]').filter({ hasText: String(hidden) });
    await expect(row.first()).toBeVisible();

    // Mở lại bằng chính nút đó, giờ đã đổi nhãn.
    await page.getByRole('button', { name: new RegExp(`^Mở ${escapeRe(label!.replace(/^Gập /, ''))}`) })
      .first()
      .click();
    await expect.poll(() => rows(page).count(), { timeout: 5_000 }).toBe(full);
  });

  test('ô tìm xuyên qua nhánh đang gập', async ({ page }) => {
    await openEditor(page, HOME);

    await page.getByRole('button', { name: 'Gập tất cả nhánh' }).click();
    await expect.poll(() => rows(page).count(), { timeout: 5_000 }).toBe(1);

    // Gập bị VÔ HIỆU khi đang lọc. Không thế thì ô tìm báo có kết quả rồi không
    // cho xem kết quả nào — tệ hơn cả việc không có ô tìm.
    // "Lưới thẻ N" nằm sâu trong các khối mẫu (scripts/seed-demo-content.ts).
    await page.getByLabel('Tìm phần tử').fill('luoi');
    await expect.poll(() => rows(page).count(), { timeout: 5_000 }).toBeGreaterThan(1);
    await expect(rows(page).filter({ hasText: /Lưới/ }).first()).toBeVisible();
  });
});

/**
 * Chọn từ NGOÀI khung thì khung cuộn tới node — `EditorState.reveal`.
 *
 * Lỗi người dùng báo hai lần: ngày 19/08/2026 ("không hiển thị rõ ràng được node đang
 * nằm ở đâu"), và lại sau giao diện v2 — bấm hàng cây hay bấm một cảnh báo chất lượng
 * thì khung chọn vẽ đúng chỗ, nhưng chỗ đó ở ngoài màn hình nên trông như không có gì
 * xảy ra. Lần đầu được sửa bằng phép kéo `pan` của canvas kéo–phóng, và mất theo canvas
 * đó cùng ngày; `layer-row-actions.spec.ts` ghi lý do không có e2e hồi ấy.
 *
 * Mọi test ở đây CHỈ ĐỌC — chọn node không ghi gì — nên không cần dọn.
 *
 * Bốn tiền đề sai của bản e2e cũ (ghi ở `layer-row-actions.spec.ts`) được tránh từng
 * cái: dùng trang chủ chứ không trang 3 node; chọn node theo VỊ TRÍ ĐO ĐƯỢC trong khung
 * đang hiện chứ không theo chỉ số hàng; bỏ qua node không có hộp; và đo trong
 * `iframe[data-canvas-frame="shown"]`, đúng khung mà `Canvas` cuộn.
 */
test.describe('chọn từ ngoài khung thì khung cuộn tới node', () => {
  const SHOWN = '[data-stage-frame] iframe[data-canvas-frame="shown"]';

  /** Khung đang hiện, khi trang trong nó đã nạp xong. */
  async function canvasFrame(page: Page): Promise<Frame> {
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

  /** Node nằm trong khung nhìn của iframe — đúng thứ người dùng thấy, sau khi pane thu. */
  const inView = (frame: Frame, id: string) =>
    frame.evaluate((id) => {
      const r = document.querySelector(`[data-n="${id}"]`)!.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= document.documentElement.clientHeight;
    }, id);

  /**
   * Một node CHẮC CHẮN ngoài tầm nhìn lúc mở: có hộp, đỉnh dưới màn thứ ba, cao không
   * quá nửa khung (node cao hơn khung thì "nằm trọn trong khung" không bao giờ đúng).
   * Lấy ở giữa danh sách thay vì cuối: hàng cuối hay là node đặc biệt (xem tiền đề 3).
   */
  const farBelow = (frame: Frame, ids: string[]) =>
    frame.evaluate((ids) => {
      const vh = document.documentElement.clientHeight;
      const out = ids.filter((id) => {
        const el = document.querySelector(`[data-n="${id}"]`);
        if (!el || el.getClientRects().length === 0) return false;
        const r = el.getBoundingClientRect();
        return r.top + window.scrollY > vh * 3 && r.height < vh / 2;
      });
      return out[Math.floor(out.length / 2)] ?? null;
    }, ids);

  test('bấm một hàng ở sâu trong cây thì khung cuộn tới node đó', async ({ page }) => {
    await openEditor(page, HOME);
    const frame = await canvasFrame(page);

    const ids = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-layer-row')!));
    const target = await farBelow(frame, ids);
    expect(target, 'trang chủ phải có node nằm dưới màn thứ ba').not.toBeNull();

    // Đối chứng: lúc mở thì node KHÔNG thấy. Thiếu bước này thì "đã thấy" bên dưới có
    // thể xanh chỉ vì node vốn ở sẵn trong khung.
    expect(await inView(frame, target!)).toBe(false);

    await page.locator(`[data-layer-row="${target}"]`).click();

    // Poll, không đo một lần: cuộn là lướt, tới đích sau vài trăm mili giây.
    await expect.poll(() => inView(frame, target!), { timeout: 10_000 }).toBe(true);
    expect(await frame.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test('bấm TRONG khung thì chọn node mà KHÔNG cuộn', async ({ page }) => {
    await openEditor(page, HOME);
    const frame = await canvasFrame(page);

    // Đứng ở giữa trang trước: "không cuộn" phải phân biệt được với "về đầu trang".
    await frame.evaluate(() =>
      window.scrollTo({ top: document.documentElement.clientHeight * 2, behavior: 'instant' }),
    );

    // Điểm bấm ở dải giữa khung, và node nhận cú bấm là node mà `elementFromPoint` trả
    // về — đúng đường `attachInert` dùng, nên không đoán node nào sẽ được chọn.
    const hit = await frame.evaluate(() => {
      const vh = document.documentElement.clientHeight;
      const x = document.documentElement.clientWidth / 2;
      for (const y of [0.4, 0.5, 0.3, 0.6].map((f) => vh * f)) {
        const id = document.elementFromPoint(x, y)?.closest('[data-n]')?.getAttribute('data-n');
        if (id) return { id, x, y, scrollY: window.scrollY };
      }
      return null;
    });
    expect(hit, 'giữa khung phải có một node để bấm').not.toBeNull();

    const box = (await page.locator(SHOWN).boundingBox())!;
    const scale = Number(await page.locator('[data-stage]').getAttribute('data-stage-scale'));
    await page.mouse.click(box.x + hit!.x * scale, box.y + hit!.y * scale);

    // Đã chọn: nhãn id của khung chọn hiện ra.
    await expect(page.locator('[data-stage-frame]').getByText(hit!.id, { exact: true })).toBeVisible();

    /*
     * Chờ CỐ ĐỊNH ở đây là có chủ đích: thứ cần chứng minh là một chuyển động KHÔNG xảy
     * ra, và không có sự kiện nào để chờ cho một thứ không xảy ra. 800ms dài hơn cả
     * quãng lướt (~500ms) lẫn một nhịp effect.
     */
    await page.waitForTimeout(800);
    expect(await frame.evaluate(() => window.scrollY)).toBe(hit!.scrollY);
  });

  test('bấm một dòng trong Cảnh báo chất lượng thì khung cuộn tới node của nó', async ({ page }) => {
    await openEditor(page, HOME);
    const frame = await canvasFrame(page);

    await page.locator('[data-quality-toggle]').click();
    const ids = await page
      .locator('[data-quality-item]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-quality-item')!));

    // Node của cảnh báo có thể rỗng (nút không chữ cao 0px) — vẫn có hộp, vẫn cuộn tới được.
    const target = await frame.evaluate((ids) => {
      const vh = document.documentElement.clientHeight;
      return ids.find((id) => {
        const el = document.querySelector(`[data-n="${id}"]`);
        if (!el || el.getClientRects().length === 0) return false;
        const r = el.getBoundingClientRect();
        return r.top > vh && r.height < vh / 2;
      }) ?? null;
    }, ids);
    test.skip(target === null, 'trang đồ gá không có cảnh báo nào nằm ngoài tầm nhìn lúc mở');

    await page.locator(`[data-quality-item="${target}"]`).first().click();
    await expect.poll(() => inView(frame, target!), { timeout: 10_000 }).toBe(true);
    // Danh sách vẫn mở: người ta đi qua từng cảnh báo một.
    await expect(page.locator(`[data-quality-item="${target}"]`).first()).toBeVisible();
  });
});

test.describe('nút mắt — ẩn khối khỏi trang', () => {
  test('ẩn thì mất khỏi canvas và khỏi bản xem trước; hiện lại thì về', async ({ page }) => {
    const pageId = await openEditor(page, TEST_PAGE);

    const canvasText = async () => {
      const body = page.frameLocator('iframe').first().locator('body');
      return (await body.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    };

    // Chờ canvas có nội dung THẬT, không chờ theo thời gian: iframe render sau
    // khi editor mount, và đọc sớm trả về chuỗi rỗng — lúc đó phép thử "biến mất"
    // sẽ xanh vì so rỗng với rỗng.
    await expect.poll(canvasText, { timeout: 20_000 }).not.toBe('');

    // Lấy nút mắt THEO ID của hàng, không theo chỉ số.
    //
    // Hàng gốc không có nút mắt, nên `eye.nth(1)` là hàng thứ hai chứ không phải
    // hàng `nth(1)`. Bản đầu của test này mắc đúng lỗi đó: nó xanh, mà lại ẩn một
    // node và hoàn nguyên một node khác — bản nháp đọng lại một node ẩn, và
    // `users.spec.ts` sẽ publish nó lên site thật.
    const target = rows(page).nth(1);
    const nodeId = (await target.getAttribute('data-layer-row'))!;
    await target.hover();
    const eye = page.locator(`[data-layer-eye="${nodeId}"]`);
    const nodeName = (await eye.getAttribute('aria-label'))!.replace(/^Ẩn /, '');

    // Chữ của node đích phải đang có mặt trước khi ẩn — nếu không thì phép thử
    // "biến mất" không chứng minh được gì.
    const before = await canvasText();
    expect(before.length).toBeGreaterThan(0);

    await eye.click();
    // Đăng ký hoàn tác NGAY sau khi ghi, trước mọi assertion: assertion đỏ cũng
    // không được để lại bản nháp bẩn.
    pending = {
      pageId,
      ops: [{ op: 'setPresence', nodeId, render: null }],
    };

    await expect.poll(canvasText, { timeout: 15_000 }).not.toBe(before);

    // Hàng vẫn còn trong cây — ẩn KHÔNG phải xoá. Đó là cả điểm của nút này.
    await expect(page.locator(`[data-layer-row]`).filter({ hasText: nodeName.slice(0, 10) }).first())
      .toBeVisible();

    // Bản xem trước là đường soát trước khi publish, nên nó phải đồng ý với canvas.
    const preview = await page.context().newPage();
    await preview.goto(`/preview/${pageId}`, { waitUntil: 'networkidle' });
    const previewText = (await preview.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    await preview.close();
    expect(previewText).not.toContain(before.slice(0, 40));

    // Hiện lại đưa nội dung về — vẫn bấm đúng nút của node đó, không phải nút đầu.
    await page.locator(`[data-layer-eye="${nodeId}"]`).click();
    await expect.poll(canvasText, { timeout: 15_000 }).toBe(before);
    pending = null;
  });

  test('bấm mắt KHÔNG làm mất góc nhìn đang đặt', async ({ page }) => {
    const pageId = await openEditor(page, TEST_PAGE);

    /*
     * Bản trước đo `transform` của lớp canvas và mức phóng ở thanh công cụ. Cả hai
     * đã bị bỏ ngày 19/08/2026 cùng với canvas kéo–phóng (HANDOFF §3.39).
     *
     * Bất biến thì KHÔNG mất: một op lên doc không được xoá trạng thái xem của người
     * dùng. `key={frameKey}` trên chính `Canvas` từng dựng lại cả component sau MỖI
     * op, và lúc đó mọi thao tác đều kéo góc nhìn về mặc định. Giờ trạng thái đó là
     * khổ màn đang chọn và chế độ 100%, nên đó là thứ phải đo.
     */
    const view = () =>
      page.locator('[data-stage]').evaluate((el) => ({
        screen: (el as HTMLElement).dataset.stageScreen,
        scale: (el as HTMLElement).dataset.stageScale,
      }));

    // Đổi góc nhìn bằng thao tác của NGƯỜI DÙNG trước đã.
    //
    // Bước này là đối chứng, không phải trang trí: nếu để nguyên mặc định thì một
    // lần dựng lại cũng cho ra đúng con số mặc định, và test xanh vì lý do sai.
    await page.locator('[data-screen-button="w768"]').click();
    await page.locator('[data-stage-actual-size]').click();
    const chosen = await view();
    expect(chosen.screen).toBe('w768');
    expect(chosen.scale).toBe('1.0000');

    const canvasText = async () => {
      const body = page.frameLocator('[data-stage-frame] iframe[data-canvas-frame="shown"]').locator('body');
      return (await body.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    };
    await expect.poll(canvasText, { timeout: 20_000 }).not.toBe('');
    const contentBefore = await canvasText();

    const target = rows(page).nth(1);
    const nodeId = (await target.getAttribute('data-layer-row'))!;
    await target.hover();
    await page.locator(`[data-layer-eye="${nodeId}"]`).click();
    pending = { pageId, ops: [{ op: 'setPresence', nodeId, render: null }] };

    /*
     * Chờ IFRAME ĐÃ NẠP LẠI trước khi đo.
     *
     * `dispatch` đi qua server, nên ngay sau cú click thì chưa có gì đổi và phép đo
     * sẽ đọc đúng giá trị cũ — bản đầu của test này xanh KỂ CẢ khi bug còn nguyên,
     * vì nó đo xong trước lúc `Canvas` bị dựng lại. Nội dung khung đổi là bằng chứng
     * iframe đã nạp lại, tức thời điểm mà cú nhảy — nếu có — đã phải xảy ra rồi.
     */
    await expect.poll(canvasText, { timeout: 20_000 }).not.toBe(contentBefore);

    expect(await view()).toEqual(chosen);
  });

  test('node gốc không ẩn được — ẩn nó là làm trắng cả trang', async ({ page }) => {
    await openEditor(page, TEST_PAGE);
    const rootId = (await rows(page).first().getAttribute('data-layer-row'))!;
    await rows(page).first().hover();
    // Hàng gốc không có nút mắt nào cả.
    await expect(page.locator(`[data-layer-eye="${rootId}"]`)).toHaveCount(0);
    // Nhưng các hàng khác thì có — nếu không, assertion trên xanh vì lý do sai.
    await expect(page.locator('[data-layer-eye]').first()).toHaveCount(1);
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
