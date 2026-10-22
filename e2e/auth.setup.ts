import { expect, test as setup } from '@playwright/test';

/**
 * Đăng nhập một lần rồi lưu cookie phiên cho mọi test dùng chung.
 *
 * Đi qua ĐÚNG form mà con người dùng, không tiêm cookie thẳng vào context. Nếu
 * tiêm cookie thì bản thân đường đăng nhập không bao giờ được test, và nó là thứ
 * đứng giữa internet và nút Publish.
 */

const STATE = 'e2e/.auth/state.json';

setup('đăng nhập', async ({ page }) => {
  /*
   * Nới hạn cho bước nung nóng, không cho các assertion.
   *
   * Biên dịch mười ba route ở lần đầu vượt xa 30s mặc định, và khi hết hạn thì Playwright
   * đóng page giữa lúc `goto` — lỗi hiện ra là "Target page has been closed", chẳng nói
   * gì về nguyên nhân. Đây là chi phí một-lần của cả suite, nên nó thuộc về đây chứ không
   * phải rải vào từng test.
   */
  setup.setTimeout(300_000);

  const email = process.env.BUILDER_EMAIL;
  const password = process.env.BUILDER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Thiếu BUILDER_EMAIL / BUILDER_PASSWORD trong .env — xem scripts/create-user.ts',
    );
  }

  /*
   * Bắt `ERR_CONNECTION_REFUSED` và dịch nó sang việc phải làm.
   *
   * `playwright.config.ts` CỐ Ý không tự bật dev server (test R2 cần `__mm` chỉ có
   * ở dev, và cần DB đã seed). Cái giá là lần nào quên bật `pnpm dev` thì lỗi đầu
   * tiên của cả suite là một mã lỗi mạng — đúng, nhưng không nói ra thứ cần gõ.
   */
  try {
    await page.goto('/builder/login');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(msg)) throw e;
    throw new Error(
      // Đọc lại từ env chứ không moi `baseURL` ra khỏi context: nó là API riêng
      // của Playwright, không có trong kiểu công khai, và đây là chỗ báo lỗi —
      // không phải chỗ để thêm một thứ có thể tự vỡ ở bản nâng cấp sau.
      `Không có gì lắng nghe ở ${process.env.E2E_BASE_URL ?? 'http://localhost:3001'}. `
      + 'Bật server trước, ở một terminal khác: `pnpm db:up` rồi `pnpm dev`, đợi dòng '
      + '"- Local:" rồi chạy lại `pnpm e2e`. Config CỐ Ý không tự bật server — xem docblock '
      + 'của playwright.config.ts.',
    );
  }

  /*
   * Chốt chặn DỮ LIỆU, đặt trước cả đăng nhập (đăng nhập đã là một lần ghi).
   *
   * Từ 08/10/2026 e2e chạy trên stack dùng một lần (`pnpm e2e`, scripts/e2e-stack.mjs).
   * Server của stack đó trả 200 ở `/api/e2e/ping`; dev server thường trả 404. Trỏ nhầm
   * vào dev là dừng ở đây, trước khi test kịp publish gì lên dữ liệu thật — đúng thứ đã
   * xảy ra ngày 19/08 (HANDOFF §3.35). `pnpm e2e:shared` đặt E2E_ALLOW_SHARED_DB=1 cho
   * ai thật sự cần chạy trên dev.
   */
  if (process.env.E2E_ALLOW_SHARED_DB !== '1') {
    const ping = await page.request.get('/api/e2e/ping');
    if (ping.status() !== 200) {
      throw new Error(
        `${page.url() || process.env.E2E_BASE_URL} không phải server của stack e2e ` +
          `(/api/e2e/ping trả ${ping.status()}). Dừng để không ghi vào DB dev. ` +
          'Chạy `pnpm e2e`, hoặc `pnpm e2e:shared` nếu thật sự muốn chạy trên DB dev.',
      );
    }
  }

  /*
   * Chốt chặn CỔNG, đặt trước mọi thao tác.
   *
   * Gõ nhầm vào một app Next khác thì `getByLabel(/email/i)` vẫn có thể khớp một ô
   * nào đó của nó, và lỗi chỉ lộ ra ở ô tiếp theo — sau 5 phút chờ, bằng một câu
   * không nhắc gì tới cổng. Kiểm một thứ CHỈ trang này có, với hạn 15s, biến năm
   * phút mù thành mười lăm giây có tên.
   */
  await expect(
    page.getByRole('heading', { name: 'Đăng nhập' }),
    `Không thấy form đăng nhập của builder ở ${page.url()} — nhiều khả năng sai cổng. ` +
      'Builder chạy ở 3001; đặt E2E_BASE_URL trong .env cho khớp cổng đang in ra ở terminal `pnpm dev`.',
  ).toBeVisible({ timeout: 15_000 });

  await page.getByLabel(/email/i).fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();

  await page.waitForURL('**/builder');
  await expect(page.getByRole('heading', { name: 'Trang' })).toBeVisible();

  await page.context().storageState({ path: STATE });

  await warmRoutes(page);
});

/**
 * Nung nóng các route nặng TRƯỚC khi suite chạy.
 *
 * ## Vì sao cần, và bằng chứng
 *
 * Bộ e2e này chạy trên dev server (xem `playwright.config.ts`: test cần `__mm`, thứ
 * chỉ có ở dev). Next dev BIÊN DỊCH route ở lần truy cập đầu, và lần đầu đó tốn hàng
 * chục giây — trong khi nhiều assertion chỉ chờ 5s.
 *
 * Đo được: `component-route.spec.ts` mở `/builder/components/<id>/edit` bị timeout 30s
 * ở `page.goto`, rồi lần chạy ngay sau (route đã nóng) mất 10.8s và xanh. Cùng dấu vết
 * ở `component-edit.spec.ts` (chờ 5s banner sau một cú bấm có fetch) và ở hai lần đỏ
 * trước đó trong `inspector-layout.spec.ts` — cả bốn đều là lần chạy ĐẦU sau khi source
 * vừa đổi, và cả bốn xanh ở mọi lần sau mà không sửa gì.
 *
 * Nung nóng thay vì nới timeout từng chỗ: nới timeout làm test chậm hơn ở MỌI lần chạy
 * để che một chi phí chỉ xảy ra một lần, và làm mất luôn khả năng phát hiện một trang
 * thật sự chậm.
 *
 * Chạy TRONG setup đăng nhập, sau khi state đã lưu: mọi route builder đều đòi phiên, và
 * `page.request` dùng chung cookie với context vừa đăng nhập — fixture `request` thì
 * không, nên gọi bằng nó chỉ nhận 401 và nung nóng đúng trang login.
 */
async function warmRoutes(page: import('@playwright/test').Page) {
  const tool = async (name: string) => {
    const res = await page.request.post('/api/ai/tool', { data: { tool: name, input: {} } });
    return res.ok() ? ((await res.json()).result as Record<string, unknown>) : null;
  };

  // Route động chỉ biên dịch khi có tham số thật, nên phải lấy một id trang và một id
  // component trước.
  const pageId = (await tool('list_pages'))?.pages as { id: string }[] | undefined;
  const compId = (await tool('list_components'))?.components as { id: string }[] | undefined;
  const pid = pageId?.[0]?.id;
  const cid = compId?.[0]?.id;

  const routes = [
    '/builder',
    '/builder/text',
    '/builder/components',
    '/builder/assets',
    '/builder/settings',
    '/builder/releases',
    '/builder/admin',
    ...(pid ? [`/builder/${pid}`, `/preview/${pid}`, `/render/${pid}`] : []),
    ...(cid ? [`/builder/components/${cid}`, `/builder/components/${cid}/edit`] : []),
    // `?component=<id>` trong editor gọi route này NGAY khi mở; lạnh thì "Đang mở
    // component…" vượt mốc 5s của `components.spec.ts` (đo 09/10/2026). GET chỉ đọc.
    ...(cid ? [`/api/presets/${cid}`] : []),
  ];

  for (const route of routes) {
    // Không assert status: mục đích là BẮT Next biên dịch, không phải kiểm route — mỗi
    // route đã có test riêng. Một route lỗi ở đây sẽ đỏ ở đúng test của nó với thông
    // điệp có nghĩa, thay vì làm cả suite dừng ở bước nung nóng.
    await page.request.get(route).catch(() => undefined);
  }

  /*
   * `/api/pages` chỉ có POST. Đo ngày 09/10/2026: biên dịch lần đầu 5.6s ngay TRONG
   * `new-page-button.spec.ts`, nên hộp thoại còn "Đang tạo…" lúc mốc 5s của assert hết.
   *
   * Thân KHÔNG phải JSON: route trả 400 ở bước đọc body, TRƯỚC `createPage` — nung nóng
   * mà không có đường nào tạo ra một trang.
   */
  await page.request
    .post('/api/pages', { data: 'nung-nong', headers: { 'content-type': 'text/plain' } })
    .catch(() => undefined);

  /*
   * `request.get` lấy HTML nhưng KHÔNG chạy JS, nên bundle client của canvas và của
   * pane phải vẫn lạnh. Một lượt `goto` thật là chỗ duy nhất nung được chúng.
   */
  if (pid) {
    await page.goto(`/builder/${pid}`);
    await page.getByRole('button', { name: 'Publish' }).waitFor({ timeout: 60_000 });
  }
}
