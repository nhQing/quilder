import { expect, test } from '@playwright/test';

/**
 * Hợp đồng niêm phong release, kiểm qua trình duyệt thật.
 *
 * `scripts/prove-release-sealed.ts` đã kiểm ở cấp DB + HTTP: sửa token, globals,
 * ảnh, component đều không lên site. Spec này kiểm thứ script KHÔNG thấy — **thứ tự
 * cascade sau khi trình duyệt phân giải layer**.
 *
 * Vì sao cần cả hai: bó base được phát qua `<link>` mà React nâng lên `<head>`, và
 * nó mở đầu bằng `@layer base, doc, doc-custom;`. Nếu nó xuống SAU `<style>` của
 * trang thì thứ tự khai đảo, reset cấp element đè lên toàn bộ `@layer doc`, và mọi
 * style người dùng đặt biến mất. HTML vẫn hợp lệ, HTTP vẫn 200, script vẫn xanh —
 * chỉ hiển thị là sai.
 *
 * KHÔNG sửa nội dung, nên không cần `afterEach` dọn. Xem `docs/HANDOFF.md` §3.1 về
 * lý do mọi test CÓ sửa nội dung đều phải dọn.
 */

test('bó CSS của release nằm trong head, trước CSS của doc', async ({ page }) => {
  await page.goto('/');

  const order = await page.evaluate(() => {
    // Duyệt theo thứ tự tài liệu, lấy cả `<link>` lẫn `<style>` của ta.
    const nodes = [
      ...document.querySelectorAll('link[rel="stylesheet"], style[data-mm-doc], style[data-mm-tokens]'),
    ];
    return nodes.map((n) => {
      if (n.tagName === 'LINK') return (n as HTMLLinkElement).href.includes('/mm-css/') ? 'base' : 'khac';
      return n.hasAttribute('data-mm-doc') ? 'doc' : 'tokens';
    });
  });

  expect(order).toContain('base');
  expect(order).toContain('doc');
  expect(order.indexOf('base')).toBeLessThan(order.indexOf('doc'));
});

test('layer doc THẮNG reset — bằng chứng thứ tự khai đúng', async ({ page }) => {
  await page.goto('/');

  /*
   * Phép thử thật, không phải phép thử về DOM.
   *
   * `reset.css` đặt `margin: 0` ở cấp element trong `@layer base`. Nếu thứ tự khai
   * sai thì nó thắng và mọi khoảng cách do người dùng đặt biến mất. Nên đo một node
   * THẬT có margin trong `@layer doc`, và đòi giá trị đó khác 0.
   */
  const hasSpacing = await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-n]')) {
      const cs = getComputedStyle(el);
      const px = [cs.marginTop, cs.marginBottom, cs.paddingTop, cs.paddingBottom]
        .map((v) => parseFloat(v) || 0)
        .reduce((a, b) => a + b, 0);
      if (px > 0) return true;
    }
    return false;
  });

  // Không node nào có khoảng cách nghĩa là reset đã ăn hết — đúng triệu chứng của
  // thứ tự layer đảo.
  expect(hasSpacing).toBe(true);
});

test('bó CSS tải được và có nội dung thật', async ({ page }) => {
  await page.goto('/');

  const href = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) =>
      (links as HTMLLinkElement[]).map((l) => l.getAttribute('href')).find((h) => h?.includes('/mm-css/')),
    );
  expect(href).toBeTruthy();

  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/css');
  // `immutable` an toàn vì hash nằm trong URL: một URL luôn trả cùng byte.
  expect(res.headers()['cache-control']).toContain('immutable');

  const css = await res.text();
  // Dòng khai layer phải là thứ đầu tiên — đây là bất biến mà cả hợp đồng dựa vào.
  expect(css.trimStart().startsWith('@layer base, doc, doc-custom;')).toBe(true);
  expect(css.length).toBeGreaterThan(10_000);
});

test('URL bó CSS sai định dạng trả 404, không trả CSS rỗng', async ({ page }) => {
  // CSS rỗng là một trang trắng không có lý do; 404 thì hiện trong network tab.
  expect((await page.request.get('/mm-css/khong-phai-hash.css')).status()).toBe(404);
  expect((await page.request.get(`/mm-css/${'0'.repeat(64)}.css`)).status()).toBe(404);
});
