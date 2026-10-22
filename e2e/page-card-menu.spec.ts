import { expect, test } from '@playwright/test';

/**
 * Menu "…" của thẻ trang chủ (thẻ hero) ở bảng điều khiển.
 *
 * Lỗi 13/10/2026: khối bọc menu và nút "Mở editor" của thẻ hero cùng `relative z-10`.
 * Khối bọc tạo stacking context nên `z-30` của danh sách menu chỉ có nghĩa bên trong nó,
 * và nút đứng sau trong DOM vẽ đè lên mục menu — nhìn thấy mà bấm không trúng.
 *
 * Đo ĐÚNG chỗ hai thứ chồng nhau, không đo tâm mục menu: phần chồng có thể chỉ là một mép
 * của mục, tâm của mục nằm ngoài nút — một phép đo ở tâm vẫn xanh khi lỗi còn đó.
 *
 * Mục nào chồng lên nút tuỳ chiều cao thẻ (mô tả, ảnh) — lúc viết là "Lưu trữ" trên dữ liệu
 * của một site, trên site mẫu thì là mục khác. Nên tìm MỌI mục chồng lên nút, không gọi tên.
 */

test('menu của thẻ trang chủ nằm TRÊN nút Mở editor của thẻ', async ({ page }) => {
  await page.goto('/builder');
  const trigger = page.getByRole('button', { name: 'Tuỳ chọn cho Trang chủ', exact: true });
  const card = page.locator('article').filter({ has: trigger });
  await trigger.click();

  const items = page.getByRole('menuitem');
  await expect(items.first()).toBeVisible();
  const b = (await card.getByRole('link', { name: /^Mở editor/ }).boundingBox())!;

  const overlaps: { name: string; x: number; y: number }[] = [];
  for (const item of await items.all()) {
    const a = (await item.boundingBox())!;
    const x1 = Math.max(a.x, b.x);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y1 = Math.max(a.y, b.y);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 > x1 && y2 > y1) overlaps.push({ name: (await item.textContent()) ?? '', x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
  }
  expect(overlaps.length, 'bố cục đổi: menu không còn chồng lên nút, test này hết nghĩa').toBeGreaterThan(0);

  for (const o of overlaps) {
    const onTop = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="menuitem"]')?.textContent ?? null,
      [o.x, o.y] as const,
    );
    expect(onTop, `mục "${o.name}" bị nút Mở editor vẽ đè`).toBe(o.name);
  }
});
