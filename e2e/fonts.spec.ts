import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { interTtf } from '../tests/fixtures/fonts/make-fixtures';

/**
 * Màn Cài đặt › Font (§11). Phần còn lại của luồng font (Inspector, publish, site) ở
 * các spec riêng của Task 15.
 */
test.describe('màn Font', () => {
  test('màn Font liệt kê Inter chỉ đọc', async ({ page }) => {
    await page.goto('/builder/settings/fonts');

    const inter = page.locator('[data-font-row="font-body"]');
    await expect(inter).toContainText('Inter Variable');
    await expect(inter).toContainText('chỉ đọc');

    await expect(page.getByRole('button', { name: 'Nhập từ Google Fonts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tải file font' })).toBeVisible();

    await page.getByRole('link', { name: 'Chung', exact: true }).click();
    await expect(page).toHaveURL(/\/builder\/settings$/);
  });

  test('tải TTF lên', async ({ page, request }) => {
    const family = `E2E Font ${Date.now()}`;
    const token = `font-${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const dir = await mkdtemp(path.join(tmpdir(), 'mm-font-'));
    const file = path.join(dir, 'e2e-font.ttf');
    await writeFile(file, await interTtf());

    try {
      await page.goto('/builder/settings/fonts');
      await page.getByRole('button', { name: 'Tải file font' }).click();

      const dialog = page.getByRole('dialog', { name: 'Tải file font' });
      await dialog.getByLabel('File font', { exact: true }).setInputFiles(file);

      // Tên họ của file Inter bị giữ chỗ cho họ có sẵn → đặt tên riêng rồi để dryRun kiểm lại.
      const name = dialog.getByLabel('Tên họ');
      await name.fill(family);
      await name.blur();

      await dialog.getByLabel(/xác nhận có giấy phép/).check();
      const save = dialog.getByRole('button', { name: 'Lưu', exact: true });
      await expect(save).toBeEnabled();
      await save.click();

      const row = page.locator(`[data-font-row="${token}"]`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(family);
      await expect(row.locator('[data-font-token]')).toHaveText(token);
      await expect(row).toContainText('Chưa publish');
    } finally {
      const list = await request.get('/api/fonts');
      const fonts = ((await list.json()) as { fonts: { id: string | null; cssName: string }[] }).fonts;
      const made = fonts.find((f) => f.cssName === family);
      if (made?.id) await request.delete(`/api/fonts/${made.id}`);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
