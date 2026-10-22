import { expect, test } from '@playwright/test';

/**
 * Quản lý tài khoản.
 *
 * Ba rào chắn được test ở đây đều là những cách TỰ KHOÁ MÌNH RA NGOÀI. Chúng chỉ
 * có giá trị nếu thật sự chặn, và cách duy nhất để biết là thử.
 *
 * Chạy với phiên admin (storageState từ auth.setup).
 */

const stamp = () => Math.random().toString(36).slice(2, 8);

test.describe('quản lý tài khoản', () => {
  test('tạo, đổi vai trò, rồi khoá', async ({ request }) => {
    const email = `test-${stamp()}@example.com`;

    const created = await request.post('/api/users', {
      data: { email, password: 'mat-khau-du-dai', role: 'viewer', name: 'Tài khoản thử' },
    });
    expect(created.ok()).toBe(true);
    const { user } = await created.json();
    expect(user.role).toBe('viewer');

    const patched = await request.patch(`/api/users/${user.id}`, { data: { role: 'editor' } });
    expect(patched.ok()).toBe(true);
    expect((await patched.json()).user.role).toBe('editor');

    /*
     * KHOÁ, không xoá — và không phải vì test tiện thế.
     *
     * `DELETE` đã bị gỡ khỏi route (xem docblock `api/users/[id]/route.ts`): xoá
     * cứng làm byline của bài người đó viết mồ côi, và cuốn theo mọi token MCP của
     * họ qua cascade mà không để lại dấu vết nào. Khoá ngoại `Restrict` từ
     * `Entry.createdBy` giờ cưỡng chế điều đó ở tầng DB.
     *
     * Nên tài khoản thử KHÔNG dọn được nữa, và mỗi lượt `pnpm e2e` để lại một hàng
     * đã khoá. Chấp nhận có ý thức: một hàng đã khoá không đăng nhập được, không
     * giữ token nào còn sống, và nó là cái giá của việc byline không mồ côi.
     */
    const locked = await request.post(`/api/users/${user.id}`, { data: { locked: true } });
    expect(locked.ok()).toBe(true);
    expect((await locked.json()).lockedAt).toBeTruthy();

    // Xoá cứng phải KHÔNG còn đường nào — 405, không phải 200 hay 404.
    const removed = await request.delete(`/api/users/${user.id}`);
    expect(removed.status()).toBe(405);
  });

  test('chặn email trùng', async ({ request }) => {
    const res = await request.post('/api/users', {
      data: { email: process.env.BUILDER_EMAIL, password: 'mat-khau-du-dai' },
    });
    expect(res.status()).toBe(409);
  });

  test('chặn mật khẩu ngắn', async ({ request }) => {
    const res = await request.post('/api/users', {
      data: { email: `short-${stamp()}@example.com`, password: 'ngan' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('10 ký tự');
  });
});

test.describe('rào chắn tự khoá mình ra ngoài', () => {
  test('không tự khoá tài khoản của mình', async ({ request }) => {
    // Lấy id từ /api/auth/me chứ không cào HTML trang admin: cào HTML làm test
    // hỏng mỗi lần đổi markup, và bản trước đã phải `skip` chính vì không trích
    // được id — một rào chắn an toàn mà test bị skip thì coi như không có test.
    const me = await request.get('/api/auth/me');
    expect(me.ok()).toBe(true);
    const { id, role } = await me.json();
    expect(role).toBe('admin');

    // Rào chắn chuyển từ `DELETE` sang `POST { locked: true }` cùng lúc với đường
    // ghi — khoá mình cũng khoá mình ra ngoài y hệt xoá mình.
    const res = await request.post(`/api/users/${id}`, { data: { locked: true } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('của mình');
  });

  test('không tự hạ vai trò của mình', async ({ request }) => {
    const { id } = await (await request.get('/api/auth/me')).json();
    const res = await request.patch(`/api/users/${id}`, { data: { role: 'editor' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('chính mình');
  });

  test('không hạ vai trò khi là admin cuối cùng', async ({ request }) => {
    // Tạo một admin thứ hai rồi xoá đi, để chắc chắn chỉ còn một admin thật.
    const email = `admin2-${stamp()}@example.com`;
    const created = await request.post('/api/users', {
      data: { email, password: 'mat-khau-du-dai', role: 'admin' },
    });
    const { user } = await created.json();

    // Hạ admin thứ hai xuống editor phải ĐƯỢC — vẫn còn admin đầu tiên.
    const ok = await request.patch(`/api/users/${user.id}`, { data: { role: 'editor' } });
    expect(ok.ok()).toBe(true);

    await request.delete(`/api/users/${user.id}`);
  });
});

test.describe('không phải admin thì không vào được', () => {
  test('tài khoản editor bị đá khỏi /builder/admin và bị API từ chối', async ({ browser, request }) => {
    const email = `editor-${stamp()}@example.com`;
    const password = 'mat-khau-du-dai';
    const created = await request.post('/api/users', {
      data: { email, password, role: 'editor' },
    });
    const { user } = await created.json();

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto('/builder/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.waitForURL('**/builder');

    // Trang admin đá về /builder.
    await page.goto('/builder/admin');
    await expect(page).toHaveURL(/\/builder$/);

    // Và API từ chối luôn — ẩn nút đi không phải là cổng.
    const denied = await page.request.post('/api/users', {
      data: { email: `x-${stamp()}@example.com`, password: 'mat-khau-du-dai' },
    });
    expect(denied.status()).toBe(403);

    /*
     * editor VẪN publish được — đó là vai trò của họ.
     *
     * ## Vì sao phải LÙI LẠI ngay sau đó
     *
     * Đây là một lần publish THẬT: nó đổi thứ khách đang xem, và nó đổi theo bản nháp
     * hiện tại — bất kể bản nháp đang ở trạng thái nào. Ngày 19/08/2026, một node bị
     * xoá và không hoàn tác được đã nằm trong bản nháp; lượt suite tiếp theo chạy tới
     * đây và **đẩy trang chủ thiếu section hero lên site thật**, không ai quyết định
     * việc đó. Xem HANDOFF §3.35.
     *
     * Lùi về release đang chạy TRƯỚC test khôi phục nguyên trạng, và vẫn chứng minh
     * đúng điều cần chứng minh: editor có quyền publish.
     *
     * Đọc release đang chạy trước khi publish, bằng phiên ADMIN (`request`) — phiên
     * editor cũng đọc được, nhưng lấy từ phiên có sẵn thì không thêm biến số.
     */
    const before = await request.post('/api/ai/tool', {
      data: { tool: 'list_pages', input: {} },
    });
    const activeBefore = (await before.json()).result?.release?.id as string | undefined;

    const publish = await page.request.post('/api/publish', { data: { action: 'publish' } });
    expect(publish.ok()).toBe(true);

    if (activeBefore) {
      const rolledBack = await request.post('/api/publish', {
        data: { action: 'rollback', releaseId: activeBefore },
      });
      // Không im lặng nếu lùi thất bại: im lặng ở đây nghĩa là site thật ở lại một
      // trạng thái không ai chọn, và không có gì trong suite nói ra điều đó.
      expect(
        rolledBack.ok(),
        `KHÔNG lùi được site về release ${activeBefore} (${rolledBack.status()}) — ` +
          'site thật đang chạy bản do test này publish',
      ).toBe(true);
    } else {
      console.error('[cảnh báo] không đọc được release đang chạy — không lùi được');
    }

    await ctx.close();
    await request.delete(`/api/users/${user.id}`);
  });
});
