/**
 * Rủi ro R2 — bất biến "một vòng lặp animation duy nhất" dưới React.
 *
 * Plan gọi bài test này là bất khả xâm phạm, và nó phải chạy trên trình duyệt
 * thật: StrictMode double-mount, client navigation và Suspense re-mount đều là
 * hành vi runtime mà unit test không tái hiện được.
 *
 * Điều kiện: dev server đang chạy, DB đã có hai trang (`pnpm exec tsx
 * scripts/seed-second-page.ts`).
 */

import { expect, test } from '@playwright/test';

/** Đọc số subscriber đang sống. Chỉ có ở dev — xem EffectRuntime. */
async function rafCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const mm = (window as unknown as { __mm?: { raf: { count(): number } } }).__mm;
    return mm ? mm.raf.count() : -1;
  });
}

async function driver(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    const mm = (window as unknown as { __mm?: { raf: { getDriver(): string | null } } }).__mm;
    return mm ? mm.raf.getDriver() : null;
  });
}

test.describe('R2 — một vòng lặp animation duy nhất', () => {
  test('vòng lặp chạy và clock bằng gsap', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => '__mm' in window);

    // gsap chứ không phải raf: ScrollTrigger đăng ký vĩnh viễn vào gsap.ticker,
    // nên một rAF riêng ở đây nghĩa là HAI vòng lặp sống.
    expect(await driver(page)).toBe('gsap');
    expect(await rafCount(page)).toBeGreaterThan(0);
  });

  test('điều hướng client đi–về 3 vòng, subscriber về đúng baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => '__mm' in window);
    const baseline = await rafCount(page);
    expect(baseline).toBeGreaterThan(0);

    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('link', { name: 'Tới trang giới thiệu' }).click();
      await page.waitForURL('**/gioi-thieu');
      await page.waitForFunction(() => '__mm' in window);

      await page.getByRole('link', { name: 'Về trang chủ' }).click();
      await page.waitForURL((url) => url.pathname === '/');
      await page.waitForFunction(() => '__mm' in window);
    }

    // Đây là phép đo quan trọng nhất của Plan 2. Tăng lên nghĩa là mỗi lần điều
    // hướng để lại subscriber — vài phút duyệt web là hàng trăm callback chạy
    // mỗi frame trên những element đã biến mất khỏi DOM.
    expect(await rafCount(page)).toBe(baseline);
  });

  test('không có runtime thứ hai, và không lỗi console', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto('/');
    await page.waitForFunction(() => '__mm' in window);
    await page.getByRole('link', { name: 'Tới trang giới thiệu' }).click();
    await page.waitForURL('**/gioi-thieu');
    await page.waitForTimeout(500);

    // 'đã có một runtime đang mount' là lỗi cấu hình và phải ồn ào.
    expect(errors.filter((e) => e.includes('EffectRuntime'))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('điều hướng là phía client, không reload cả trang', async ({ page }) => {
    await page.goto('/');
    // Đánh dấu lên window. Reload cả trang sẽ xoá nó.
    await page.evaluate(() => {
      (window as unknown as { __navProbe: number }).__navProbe = 42;
    });

    await page.getByRole('link', { name: 'Tới trang giới thiệu' }).click();
    await page.waitForURL('**/gioi-thieu');

    const survived = await page.evaluate(
      () => (window as unknown as { __navProbe?: number }).__navProbe,
    );
    // Nếu fail: ButtonNode đang render <a> thuần thay vì next/link.
    expect(survived).toBe(42);
  });
});

test.describe('R2 — thang degradation', () => {
  test('reduced motion: nội dung vẫn hiện đầy đủ', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/gioi-thieu');
    await page.waitForFunction(() => '__mm' in window);

    // scroll-reveal phải hiện ngay thay vì kẹt ở opacity 0 — đây chính là chỗ
    // gate respectReducedMotion bị tắt có chủ đích trong effect đó.
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();
    await expect(h1).toHaveAttribute('data-revealed', 'true');

    // Lenis không được khởi tạo khi reduced motion.
    const lenis = await page.evaluate(() => {
      const mm = (window as unknown as { __mm?: { scroll: { getLenis(): unknown } } }).__mm;
      return mm ? mm.scroll.getLenis() : 'no-mm';
    });
    expect(lenis).toBeNull();

    await ctx.close();
  });

  test('tắt hẳn JavaScript: trang vẫn đọc được', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto('/');

    // Đây là thứ thay thế cho CSS failsafe 8 giây của site cũ: nội dung nằm sẵn
    // trong HTML nên đảm bảo mang tính cấu trúc, không phải một cái hẹn giờ.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await ctx.close();
  });
});
