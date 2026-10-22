import { expect, test } from '@playwright/test';

/**
 * Cổng chặn.
 *
 * Những test này chạy KHÔNG có phiên (`storageState: undefined`) trong khi cả
 * bộ còn lại chạy có phiên. Đây là thứ đứng giữa internet và nút Publish, nên nó
 * phải có test — kiểm bằng tay một lần rồi tin mãi là cách một cổng lặng lẽ mở
 * ra sau vài lần refactor.
 */

test.describe('chưa đăng nhập', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/builder chuyển hướng sang đăng nhập, nhớ chỗ định vào', async ({ page }) => {
    await page.goto('/builder');
    await expect(page).toHaveURL(/\/builder\/login\?next=%2Fbuilder/);
  });

  test('API ghi trả 401, không phải trang HTML', async ({ request }) => {
    for (const path of ['/api/publish', '/api/ops', '/api/pages']) {
      const res = await request.post(path, { data: {} });
      expect(res.status(), path).toBe(401);
      // API phải trả JSON — client fetch cần mã lỗi, không cần trang đăng nhập.
      expect(res.headers()['content-type']).toContain('application/json');
    }
  });

  test('bản nháp không xem được', async ({ page }) => {
    const res = await page.goto('/preview/bat-ky');
    expect(res?.url()).toContain('/builder/login');
  });

  test('site công khai vẫn mở', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
  });

  test('TẮT JAVASCRIPT vẫn không vào được builder', async ({ browser }) => {
    // Đây là phép thử quyết định. Guard phía client (useEffect rồi redirect)
    // sẽ PASS mọi test ở trên và FAIL đúng test này — vì không có JS thì không
    // có gì chạy để chuyển hướng. Middleware chạy trước React nên nó vẫn chặn.
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto('/builder');
    expect(page.url()).toContain('/builder/login');
    await ctx.close();
  });

  test('cookie phiên là httpOnly — JavaScript không đọc được', async ({ page, request }) => {
    const email = process.env.BUILDER_EMAIL!;
    const password = process.env.BUILDER_PASSWORD!;
    const res = await request.post('/api/auth/login', { data: { email, password } });
    expect(res.ok()).toBe(true);

    const cookies = await request.storageState();
    const session = cookies.cookies.find((c) => c.name === 'mm_session');
    expect(session?.httpOnly, 'cookie phiên phải là httpOnly').toBe(true);
    expect(session?.sameSite).toBe('Lax');

    // Và xác nhận từ phía trang: XSS không lấy được token.
    await page.goto('/');
    const visible = await page.evaluate(() => document.cookie.includes('mm_session'));
    expect(visible).toBe(false);
  });

  test('sai mật khẩu và email không tồn tại trả CÙNG một thông báo', async ({ request }) => {
    // Phân biệt hai trường hợp cho phép dò xem email nào có trong hệ thống.
    const a = await request.post('/api/auth/login', {
      data: { email: process.env.BUILDER_EMAIL, password: 'sai-mat-khau' },
    });
    const b = await request.post('/api/auth/login', {
      data: { email: 'khong-ton-tai@example.com', password: 'sai-mat-khau' },
    });
    expect(a.status()).toBe(401);
    expect(b.status()).toBe(401);
    expect((await a.json()).error).toBe((await b.json()).error);
  });
});
