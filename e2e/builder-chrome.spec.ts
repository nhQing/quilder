import { expect, test, type Page } from '@playwright/test';

/**
 * Vỏ builder: thanh menu và theme.
 *
 * ## Vì sao test này tồn tại
 *
 * Trước `BuilderNav`, mỗi trang tự khai tập link của nó. Không có gì hỏng theo
 * nghĩa một exception — 7/18 trang chỉ đơn giản là KHÔNG có đường đăng xuất, và
 * mười trang cùng họ có mười tập link khác nhau. Loại lỗi đó không có stack trace
 * và không ai báo; nó chỉ được phát hiện khi có người đếm. Test này là cái đếm đó,
 * chạy mỗi lần.
 *
 * Phiên đến từ `storageState` (xem `playwright.config.ts` + `e2e/auth.setup.ts`),
 * nên ở đây chỉ `page.goto` — không tự đăng nhập.
 */

/** Mọi route builder TĨNH. Thêm khu mới thì thêm một dòng ở đây và ở `SECTIONS`. */
const ROUTES = [
  '/builder',
  '/builder/text',
  '/builder/content',
  '/builder/components',
  '/builder/assets',
  '/builder/settings',
  '/builder/releases',
  '/builder/admin',
  '/builder/admin/tokens',
  '/builder/claude',
];

function nav(page: Page) {
  return page.getByRole('navigation', { name: 'Khu của builder' });
}

test.describe('thanh menu của vỏ builder', () => {
  test('có mặt, và có Đăng xuất, ở mọi route builder', async ({ page }) => {
    // Chín route trong một test chứ không chín test: mỗi test phải chờ Next biên
    // dịch lại route lần đầu, và chi phí đó không đáng nhân lên chín lần cho một
    // phép kiểm chỉ đọc.
    test.setTimeout(180_000);

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(nav(page), `thiếu thanh menu ở ${route}`).toBeVisible();
      await expect(
        nav(page).getByRole('button', { name: 'Đăng xuất' }),
        `thiếu đường đăng xuất ở ${route}`,
      ).toBeVisible();
      // Trong thanh, không rải ra trong trang: một nút "Đăng xuất" ở giữa nội
      // dung là đúng thứ mà B1 vừa dọn.
      await expect(page.getByRole('button', { name: 'Đăng xuất' })).toHaveCount(1);
    }
  });

  test('còn nguyên ở màn editor toàn màn', async ({ page }) => {
    // Hai màn editor từng dùng `h-screen`, tức cao BẰNG CẢ MÀN — cộng thanh menu
    // là tràn ra ngoài đáy. Nếu chúng quay lại `h-screen` thì thanh vẫn "visible"
    // với Playwright, nên phép kiểm thật là: trang không cuộn dọc quá thanh menu.
    const res = await page.request.post('/api/ai/tool', {
      data: { tool: 'list_pages', input: {} },
    });
    const pageId = (await res.json()).result?.pages?.[0]?.id as string | undefined;
    test.skip(!pageId, 'chưa seed trang nào');

    await page.goto(`/builder/${pageId}`);
    await expect(nav(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();

    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement!;
      return el.scrollHeight - el.clientHeight;
    });
    expect(overflow, 'editor + thanh menu cao hơn màn — h-screen đã quay lại?').toBeLessThan(4);
  });

  test('sáng đúng khu ở trang con, không chỉ ở trang gốc', async ({ page }) => {
    await page.goto('/builder/admin/tokens');

    // `/builder/admin/tokens` khớp cả `/builder` và `/builder/admin`. Tiền tố dài
    // nhất phải thắng, nếu không thì thanh menu chỉ tay vào một khu khác với khu
    // đang mở.
    await expect(nav(page).getByRole('link', { name: 'Tài khoản' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav(page).getByRole('link', { name: 'Trang' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('trang đăng nhập KHÔNG có thanh menu', async ({ page }) => {
    // Mọi link trong thanh đều bị middleware đá ngược về đây, và một nút Đăng xuất
    // cho người chưa đăng nhập là vô nghĩa.
    await page.goto('/builder/login');
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });
});

test.describe('sáng / tối', () => {
  test('đổi tức thì và giữ nguyên khi sang trang khác', async ({ page }) => {
    await page.goto('/builder');
    const html = page.locator('html');

    await nav(page).getByRole('button', { name: 'Tối' }).click();
    // Không `waitForNavigation`: nút cố ý KHÔNG `router.refresh()`, nên nếu phép
    // kiểm này chỉ xanh sau một lượt tải lại thì cơ chế đã sai.
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Cookie là thứ giữ cho lần tải sau đúng ngay từ byte HTML đầu — sang một
    // trang khác là phép kiểm rẻ nhất cho việc đó.
    await page.goto('/builder/settings');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(nav(page).getByRole('button', { name: 'Tối' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await nav(page).getByRole('button', { name: 'Sáng' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('mặc định là theo hệ thống, không phải một bên đã chọn sẵn', async ({ page }) => {
    // Mỗi test có context riêng, và `storageState` chỉ mang cookie phiên — nên ở
    // đây KHÔNG có `mm-theme`, đúng tình huống của người mở builder lần đầu.
    await page.goto('/builder');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
    await expect(nav(page).getByRole('button', { name: 'Theo hệ thống' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
