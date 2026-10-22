import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Vòng đời token service.
 *
 * Thu hồi là lý do duy nhất khiến bảng `ServiceToken` tồn tại — JWT tự nó không
 * thu hồi được. Nếu nút Thu hồi không thật sự cắt được quyền truy cập thì cả
 * thiết kế đó vô nghĩa, và cách duy nhất để biết là thử.
 *
 * Kiểm trên CẢ HAI bề mặt, vì chúng đi qua hai đường khác nhau:
 *   - `/api/ai/tool`  → route handler, gọi requireAuth
 *   - `/preview/<id>` → server component; trước đây chỉ có middleware canh, mà
 *                       middleware chạy trên Edge nên không tra được database
 */

async function mint(
  request: APIRequestContext,
  name: string,
  days = 7,
): Promise<{ id: string; token: string }> {
  const res = await request.post('/api/tokens', { data: { name, days } });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

test.describe('token service', () => {
  test('cấp → dùng được → thu hồi → chết ngay', async ({ request }) => {
    const { id, token } = await mint(request, 'e2e — vòng đời');

    const before = await request.post('/api/ai/tool', {
      headers: bearer(token),
      data: { tool: 'list_pages', input: {} },
    });
    expect(before.status()).toBe(200);

    const revoked = await request.delete(`/api/tokens/${id}`);
    expect(revoked.ok()).toBe(true);

    const after = await request.post('/api/ai/tool', {
      headers: bearer(token),
      data: { tool: 'list_pages', input: {} },
    });
    expect(after.status(), 'token đã thu hồi vẫn gọi được API').toBe(401);
  });

  test('token đã thu hồi cũng không mở được bản nháp', async ({ browser, request }) => {
    const { id, token } = await mint(request, 'e2e — preview');

    const pages = await (
      await request.post('/api/ai/tool', {
        headers: bearer(token),
        data: { tool: 'list_pages', input: {} },
      })
    ).json();
    const pageId = pages.result.pages[0].id;

    // Trình duyệt sạch, mang token làm cookie phiên — đúng cách screenshot_page
    // vào /preview.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await ctx.addCookies([
      { name: 'mm_session', value: token, domain: 'localhost', path: '/', httpOnly: true },
    ]);
    const page = await ctx.newPage();

    await page.goto(`/preview/${pageId}`);
    await expect(page.locator('[data-preview-banner]')).toBeVisible();

    await request.delete(`/api/tokens/${id}`);

    await page.goto(`/preview/${pageId}`);
    await expect(page, 'bản nháp vẫn xem được bằng token đã thu hồi').toHaveURL(/\/builder\/login/);

    await ctx.close();
  });

  test('thu hồi hai lần không lỗi', async ({ request }) => {
    const { id } = await mint(request, 'e2e — thu hồi lặp');
    expect((await request.delete(`/api/tokens/${id}`)).ok()).toBe(true);

    const second = await request.delete(`/api/tokens/${id}`);
    expect(second.ok()).toBe(true);
    expect((await second.json()).alreadyRevoked).toBe(true);
  });

  test('token xuất hiện trong danh sách với đúng trạng thái', async ({ request }) => {
    const { id } = await mint(request, 'e2e — danh sách');

    const active = (await (await request.get('/api/tokens')).json()).tokens
      .find((t: { id: string }) => t.id === id);
    expect(active.status).toBe('active');

    await request.delete(`/api/tokens/${id}`);

    const gone = (await (await request.get('/api/tokens')).json()).tokens
      .find((t: { id: string }) => t.id === id);
    // Thu hồi là ĐÁNH DẤU chứ không xoá: mất row là mất luôn dấu vết điều tra.
    expect(gone, 'row bị xoá mất — không còn lịch sử để truy vết').toBeTruthy();
    expect(gone.status).toBe('revoked');
  });

  test('phải đặt tên', async ({ request }) => {
    const res = await request.post('/api/tokens', { data: { name: '  ', days: 7 } });
    expect(res.status()).toBe(400);
  });

  test('hạn bị chặn trần', async ({ request }) => {
    expect((await request.post('/api/tokens', { data: { name: 'x', days: 3650 } })).status()).toBe(400);
    expect((await request.post('/api/tokens', { data: { name: 'x', days: 0 } })).status()).toBe(400);
  });

  test('không cấp token cho tài khoản viewer', async ({ request }) => {
    const email = `tk-viewer-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const created = await request.post('/api/users', {
      data: { email, password: 'mat-khau-du-dai', role: 'viewer' },
    });
    const { user } = await created.json();

    // Token viewer sẽ đọc được nhưng apply_ops trả 403 — hỏng ở tận trong Claude
    // Desktop, nơi gần như không chẩn đoán được. Chặn ngay lúc cấp.
    const res = await request.post('/api/tokens', {
      data: { name: 'viewer', days: 7, userId: user.id },
    });
    expect(res.status()).toBe(400);

    await request.delete(`/api/users/${user.id}`);
  });
});

/**
 * Từ 16/10/2026 mỗi người tự cấp token cho máy mình ở `/builder/claude` — nhưng CHỈ token
 * đứng tên mình. Biên giới là thứ phải kiểm: editor không thấy, không thu hồi, không cấp
 * hộ token của người khác, và "Thu hồi tất cả" của editor không cắt máy của admin.
 */
test.describe('editor tự kết nối Claude, chỉ trong phạm vi của mình', () => {
  test('cấp, thấy và thu hồi được token của mình — không đụng được của người khác', async ({ browser, request }) => {
    const email = `tk-editor-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'mat-khau-du-dai';
    const { user } = await (
      await request.post('/api/users', { data: { email, password, role: 'editor' } })
    ).json();
    // Token của admin (phiên của bộ test) — thứ editor KHÔNG được đụng tới.
    const admins = await mint(request, `e2e — của admin ${Date.now()}`);

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto('/builder/login');
      await page.getByLabel(/email/i).fill(email);
      await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(password);
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await page.waitForURL('**/builder');

      // Đường vào ở thanh menu; đường cũ của admin đưa sang màn cá nhân.
      const nav = page.getByRole('navigation', { name: 'Khu của builder' });
      await expect(nav.getByRole('link', { name: 'Kết nối Claude' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Tài khoản' })).toHaveCount(0);
      await page.goto('/builder/admin/tokens');
      await expect(page).toHaveURL(/\/builder\/claude$/);

      // Cấp qua giao diện → hiện hướng dẫn kèm token.
      await page.getByLabel(/Tên thiết bị/i).fill(`${UI_PREFIX} editor ${Date.now()}`);
      await page.getByRole('button', { name: 'Cấp token' }).click();
      await expect(page.locator('pre').first()).toBeVisible({ timeout: 15_000 });

      const api = page.request;
      const listed = (await (await api.get('/api/tokens')).json()).tokens as { id: string; email: string; status: string }[];
      expect(listed.length).toBeGreaterThanOrEqual(1);
      expect(listed.every((t) => t.email === email), 'editor thấy token của người khác').toBe(true);
      expect(listed.some((t) => t.id === admins.id)).toBe(false);

      // Token của admin: thu hồi trả 404 (như không tồn tại), cấp hộ người khác trả 403.
      expect((await api.delete(`/api/tokens/${admins.id}`)).status()).toBe(404);
      expect((await api.post('/api/tokens', { data: { name: 'hộ', days: 7, userId: 'khong-phai-minh' } })).status()).toBe(403);

      // "Thu hồi tất cả" của editor chỉ cắt máy của editor.
      const all = await api.delete('/api/tokens');
      expect(all.ok(), await all.text()).toBe(true);
      expect((await all.json()).revoked).toBe(listed.filter((t) => t.status === 'active').length);
      const adminSide = (await (await request.get('/api/tokens')).json()).tokens.find((t: { id: string }) => t.id === admins.id);
      expect(adminSide.status, 'editor thu hồi được token của admin').toBe('active');
    } finally {
      await ctx.close();
      await request.delete(`/api/tokens/${admins.id}`);
      // Cascade: xoá tài khoản xoá luôn token của nó.
      await request.delete(`/api/users/${user.id}`);
    }
  });

  test('vai trò Xem không có đường vào và được giải thích lý do', async ({ browser, request }) => {
    const email = `tk-viewer-ui-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'mat-khau-du-dai';
    const { user } = await (
      await request.post('/api/users', { data: { email, password, role: 'viewer' } })
    ).json();

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto('/builder/login');
      await page.getByLabel(/email/i).fill(email);
      await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(password);
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await page.waitForURL('**/builder');

      const nav = page.getByRole('navigation', { name: 'Khu của builder' });
      await expect(nav.getByRole('link', { name: 'Trang' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Kết nối Claude' })).toHaveCount(0);

      await page.goto('/builder/claude');
      await expect(page.getByText('Vai trò “Xem” không nối được Claude.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cấp token' })).toHaveCount(0);
    } finally {
      await ctx.close();
      await request.delete(`/api/users/${user.id}`);
    }
  });
});

test.describe('Tài khoản › Kết nối Claude (admin)', () => {
  test('là một tab của Tài khoản, liệt kê token của mọi người và không có ô cấp', async ({ page, request }) => {
    const { id } = await mint(request, `e2e — tab admin ${Date.now()}`);
    try {
      await page.goto('/builder/admin');
      await page.locator('[data-account-tab="tokens"]').click();
      // 15s: lượt đầu sau khi dựng stack, dev server còn biên dịch route đích (đo được ~6s).
      await expect(page).toHaveURL(/\/builder\/admin\/tokens$/, { timeout: 15_000 });
      await expect(page.locator('[data-account-tab="tokens"]')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('button', { name: 'Cấp token' })).toHaveCount(0);
      await expect(page.getByText('Mỗi người tự cấp token cho máy của mình')).toBeVisible();
      await expect(page.getByText('e2e-admin@example.com').first()).toBeVisible();
    } finally {
      await request.delete(`/api/tokens/${id}`);
    }
  });
});

/**
 * Dọn token do test cấp QUA GIAO DIỆN.
 *
 * Giao diện không lộ id, nên không dọn được bằng id như các test khác. Lọc theo tiền tố
 * tên là đường duy nhất — và phải dọn, vì token còn hiệu lực là quyền ghi vào site còn
 * mở. Bộ e2e này từng để lại rác trong bản nháp một lần rồi (HANDOFF §3.35).
 */
const UI_PREFIX = 'e2e hướng dẫn';

test.afterEach(async ({ request }) => {
  const res = await request.get('/api/tokens');
  if (!res.ok()) return;
  const { tokens } = (await res.json()) as { tokens: { id: string; name: string; status: string }[] };
  for (const t of tokens) {
    if (t.status === 'active' && t.name.startsWith(UI_PREFIX)) {
      await request.delete(`/api/tokens/${t.id}`);
    }
  }
});

/**
 * Hướng dẫn cấu hình phải ĐÚNG cho từng nền tảng.
 *
 * Sự cố 21/08/2026: cấu hình được dán vào `%APPDATA%\Claude\` — đường dẫn mà mọi tài
 * liệu đều chỉ — rồi Claude Desktop không thấy công cụ nào. Nguyên nhân: bản cài từ
 * Microsoft Store là app MSIX và Windows CHUYỂN HƯỚNG `%APPDATA%` của nó. Tạo file ở đó
 * thành công, im lặng, và vô ích.
 *
 * Trang cấp token là chỗ DUY NHẤT người dùng đọc hướng dẫn, nên nó phải nói cả hai
 * đường dẫn — và phải nói rõ bản Store không đọc cái kia.
 */
test.describe('hướng dẫn cấu hình', () => {
  /** Cấp token QUA GIAO DIỆN — khối hướng dẫn chỉ hiện sau khi cấp từ chính trang này. */
  const mintInUi = async (page: Page) => {
    await page.goto('/builder/claude');
    await page.getByLabel(/Tên thiết bị/i).fill(`${UI_PREFIX} ${Date.now()}`);
    await page.getByRole('button', { name: 'Cấp token' }).click();
    await expect(page.locator('pre').first()).toBeVisible({ timeout: 15_000 });
  };

  test('nói CẢ HAI đường dẫn Windows, và đổi được sang macOS', async ({ page }) => {
    await mintInUi(page);

    await page.locator('[data-os-tab="windows"]').click();

    /*
     * Trỏ tới ĐƯỜNG DẪN CONFIG, không phải một chuỗi con dùng chung.
     *
     * `LocalCache\Roaming\Claude` khớp cả đường dẫn config lẫn đường dẫn log (bước 3
     * cũng nằm trong thư mục đó), nên regex rộng làm strict mode đỏ với hai phần tử.
     * Chốt bằng tên file: chỉ config mới có `claude_desktop_config.json`.
     */
    await expect(
      page.getByText(/LocalCache\\Roaming\\Claude\\claude_desktop_config\.json/),
    ).toBeVisible();
    await expect(page.getByText(/%APPDATA%\\Claude/).first()).toBeVisible();
    // Và phải nói rõ bản Store KHÔNG đọc %APPDATA% — biết đường dẫn mà không biết điều
    // này thì vẫn sửa sai file.
    await expect(page.getByText(/không.*đọc/i).first()).toBeVisible();

    await page.locator('[data-os-tab="mac"]').click();
    await expect(page.getByText(/Library\/Application Support\/Claude/)).toBeVisible();
    // Đường dẫn Windows phải BIẾN MẤT: hiện cả hai thì nó không còn là hướng dẫn.
    await expect(page.getByText(/LocalCache\\Roaming\\Claude/)).toHaveCount(0);
  });

  test('tên kết nối sửa được, được làm sạch, và khoá + thư mục đổi theo', async ({ page }) => {
    await mintInUi(page);
    const name = page.locator('[data-mcp-name]');
    await expect(name).toHaveValue(/^quilder-localhost-\d+$/);

    await name.fill('Dự án ABC (dev)');
    const cfg = JSON.parse((await page.locator('pre').first().textContent()) ?? '') as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(Object.keys(cfg.mcpServers)).toEqual(['du-an-abc-dev']);
    expect(cfg.mcpServers['du-an-abc-dev']!.args[0]).toContain('/quilder-mcp/du-an-abc-dev/');
    // Nói ra tên sẽ dùng khi khác chữ đã gõ, và dặn THÊM khối chứ đừng thay cả file.
    await expect(page.getByText('du-an-abc-dev').first()).toBeVisible();
    await expect(page.getByText(/đừng thay cả file/)).toBeVisible();
  });

  test('args dùng dấu / và giữ MM_BUILDER_URL', async ({ page }) => {
    await mintInUi(page);

    const json = (await page.locator('pre').first().textContent()) ?? '';

    /*
     * Khối cấu hình phải PARSE được, và `args[0]` không được chứa `\`.
     *
     * Trong JSON, `\` phải viết đôi. Một mẫu dùng `\` mời người dùng sửa tay rồi viết
     * một dấu — kết quả là JSON lỗi, hoặc tệ hơn, âm thầm mất dấu gạch (`\U` → `U`) và
     * Claude Desktop không chạy được server mà không báo gì. Đúng lỗi đã xảy ra.
     */
    const cfg = JSON.parse(json) as {
      mcpServers: Record<string, { args: string[]; env: Record<string, string> }>;
    };
    // Tên kết nối theo DOMAIN của builder (20/10/2026): một tên cố định thì
    // nối hai builder là khối sau đè khối trước. Trên stack e2e: localhost:<cổng>.
    const names = Object.keys(cfg.mcpServers);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^quilder-localhost-\d+$/);
    const entry = cfg.mcpServers[names[0]!]!;
    expect(entry.args[0]).toContain('/');
    expect(entry.args[0]).not.toContain('\\');
    // Mỗi builder một thư mục server — hai builder khác phiên bản không dùng chung file.
    expect(entry.args[0]).toContain(`/quilder-mcp/${names[0]}/quilder-mcp-server.mjs`);

    // Thiếu MM_BUILDER_URL thì server mặc định localhost:3001 — trên máy dev đó là một
    // app KHÁC, và lỗi báo ra không liên quan gì tới nguyên nhân.
    expect(entry.env.MM_BUILDER_URL).toMatch(/^https?:\/\//);
  });
});

/**
 * Bộ lọc trạng thái và nút thu hồi tất cả.
 *
 * ## Vì sao test này KHÔNG bấm nút thu hồi tất cả
 *
 * Endpoint đó thu hồi mọi token còn hiệu lực của cả hệ thống — kể cả token đang cắm vào
 * Claude Desktop của người đang chạy test. Một test làm người dùng mất kết nối MCP là
 * một test đắt hơn giá trị nó mang lại, và không có đường hoàn lại: token không đọc lại
 * được sau khi cấp, nên "dọn" nghĩa là cấp cái mới rồi sửa tay config Desktop.
 *
 * Nên ở đây kiểm phần quan sát được mà không phá gì: bộ lọc, số đếm, và nút có mang đúng
 * số lượng. Phần THỰC SỰ thu hồi cả loạt nằm ở test dưới, chỉ chạy khi được yêu cầu
 * tường minh bằng `E2E_DESTRUCTIVE_TOKENS=1`.
 */
test.describe('lọc và thu hồi cả loạt', () => {
  test('bộ lọc đếm đúng, và nút thu hồi tất cả mang đúng số lượng', async ({ page, request }) => {
    /*
     * Tên mang dấu thời gian, và test so theo tên ĐẦY ĐỦ.
     *
     * So theo tiền tố thì nó bắt luôn token cùng tiền tố của những lần chạy TRƯỚC (đã
     * thu hồi, vẫn nằm trong danh sách vì thu hồi là đánh dấu chứ không xoá row) — và
     * assertion "đã biến mất" đỏ vì một lý do chẳng liên quan gì tới thứ đang kiểm.
     */
    const stamp = Date.now();
    const minted = [] as { id: string; name: string }[];
    for (let i = 0; i < 2; i += 1) {
      const name = `e2e lọc ${i} ${stamp}`;
      const { id } = await mint(request, name, 7);
      minted.push({ id, name });
    }

    try {
      await page.goto('/builder/admin/tokens');

      const pill = (id: string) => page.locator(`[data-token-filter="${id}"]`);
      const countIn = async (id: string) =>
        Number((await pill(id).textContent())?.match(/\d+/)?.[0] ?? '-1');

      await expect(pill('all')).toBeVisible();

      const all = await countIn('all');
      const active = await countIn('active');
      const expired = await countIn('expired');
      const revoked = await countIn('revoked');

      // Bốn trạng thái phải cộng lại bằng tổng — nếu không thì có token nào đó không
      // thuộc nhóm nào, tức bộ lọc đang che dữ liệu.
      expect(active + expired + revoked).toBe(all);
      expect(active).toBeGreaterThanOrEqual(2);

      // Nút mang ĐÚNG SỐ token còn hiệu lực, không phải chữ "tất cả": con số là thứ
      // duy nhất chặn được một cú bấm theo phản xạ.
      await expect(page.locator('[data-revoke-all]')).toContainText(String(active));

      // Lọc sang "đã thu hồi" thì hai token vừa cấp phải BIẾN MẤT khỏi danh sách.
      await pill('revoked').click();
      for (const m of minted) {
        await expect(page.getByText(m.name, { exact: false })).toHaveCount(0);
      }
    } finally {
      for (const m of minted) await request.delete(`/api/tokens/${m.id}`);
    }
  });

  /**
   * Đường thu hồi cả loạt THẬT.
   *
   * Chỉ chạy khi `E2E_DESTRUCTIVE_TOKENS=1`, vì nó thu hồi mọi token của cả hệ thống.
   * Không phải để test chạy nhanh hơn — mà vì hậu quả của nó nằm ngoài phạm vi test.
   */
  test('thu hồi cả loạt: đúng một lần có tác dụng, lần hai trả 0', async ({ request }) => {
    test.skip(
      process.env.E2E_DESTRUCTIVE_TOKENS !== '1',
      'Thu hồi MỌI token của hệ thống, kể cả token đang dùng thật. Chạy với E2E_DESTRUCTIVE_TOKENS=1.',
    );

    await mint(request, `e2e loạt ${Date.now()}`, 7);

    const first = await request.delete('/api/tokens');
    expect(first.ok(), await first.text()).toBe(true);
    expect((await first.json()).revoked).toBeGreaterThanOrEqual(1);

    // Lần hai phải là 0: `revokedAt` là dấu thời gian của hành động, ghi lại nó lần nữa
    // sẽ xoá mất thời điểm thật.
    const second = await request.delete('/api/tokens');
    expect(second.ok()).toBe(true);
    expect((await second.json()).revoked).toBe(0);
  });
});
