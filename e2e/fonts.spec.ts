import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { interTtf } from '../tests/fixtures/fonts/make-fixtures';

/**
 * Màn Cài đặt › Font (§11). Phần còn lại của luồng font (canvas, Publish, khoá xoá) ở cuối file.
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

/*
 * Kịch bản §16 E2E 2–5. Chúng GHI (font + bản nháp, và Publish ở kịch bản niêm phong) nên
 * mọi bước dọn nằm trong `finally`; Publish chỉ chạy trên stack e2e, không bao giờ trên staging.
 */
type ApiFont = { id: string | null; cssName: string; token: string };

const slugOf = (family: string) => `font-${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

async function uploadTtf(request: APIRequestContext, family: string): Promise<void> {
  const res = await request.post('/api/fonts', {
    multipart: {
      file: { name: 'e2e-font.ttf', mimeType: 'font/ttf', buffer: Buffer.from(await interTtf()) },
      family,
      licenseConfirmed: 'true',
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function removeFamily(request: APIRequestContext, family: string): Promise<void> {
  const list = await request.get('/api/fonts');
  const fonts = ((await list.json()) as { fonts: ApiFont[] }).fonts;
  const made = fonts.find((f) => f.cssName === family);
  if (made?.id) await request.delete(`/api/fonts/${made.id}`);
}

async function homePageId(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/ai/tool', { data: { tool: 'list_pages', input: {} } });
  const { result } = await res.json();
  const home = (result.pages as { id: string; path: string }[]).find((p) => p.path === '/');
  expect(home, 'cần trang chủ').toBeTruthy();
  return home!.id;
}

test.describe('font động end-to-end', () => {
  test('bản nháp: canvas có @font-face của họ vừa tải lên', async ({ page, request }) => {
    const family = `E2E Draft ${Date.now()}`;
    try {
      await uploadTtf(request, family);
      const pageId = await homePageId(request);
      await page.goto(`/render/${pageId}`);

      const css = await page.locator('style[data-mm-fonts]').first().textContent();
      expect(css).toContain(family);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate((f) => document.fonts.check(`16px "${f}"`), family)).toBe(true);
    } finally {
      await removeFamily(request, family);
    }
  });

  test('niêm phong: font mới chỉ lên site sau Publish; file phục vụ immutable', async ({ page, request }) => {
    const family = `E2E Seal ${Date.now()}`;
    try {
      await uploadTtf(request, family);

      // Chưa Publish → site đang chạy chưa biết họ này.
      await page.goto('/');
      const before = (await page.locator('style[data-mm-fonts]').allTextContents()).join('\n');
      expect(before).not.toContain(family);

      const pub = await request.post('/api/publish', { data: {} });
      expect(pub.ok(), await pub.text()).toBe(true);

      await page.goto('/');
      const after = (await page.locator('style[data-mm-fonts]').allTextContents()).join('\n');
      expect(after).toContain(family);

      const url = /url\("(\/mm-font\/[^"]+)"\)/.exec(after.slice(after.indexOf(family)))?.[1];
      expect(url, 'face của họ mới phải trỏ /mm-font/…').toBeTruthy();
      const file = await request.get(url!);
      expect(file.status()).toBe(200);
      expect(file.headers()['cache-control']).toContain('immutable');
    } finally {
      await removeFamily(request, family);
    }
  });

  test('xoá họ bị khoá khi còn trang dùng', async ({ page, request }) => {
    const family = `E2E Lock ${Date.now()}`;
    const token = slugOf(family);
    let pageId = '';
    let nodeId = '';
    try {
      await uploadTtf(request, family);
      pageId = await homePageId(request);
      const outline = await request.post('/api/ai/tool', {
        data: { tool: 'get_page_outline', input: { pageId } },
      });
      const nodes = ((await outline.json()).result.nodes as { id: string; type: string }[]);
      nodeId = nodes.find((n) => n.type === 'Text')!.id;

      const set = await request.post('/api/ops', {
        data: {
          pageId,
          label: 'e2e font — gán họ',
          ops: [{ op: 'setStyle', nodeId, target: 'base', patch: { typography: { family: { $token: token } } } }],
        },
      });
      expect(set.ok(), await set.text()).toBe(true);

      await page.goto('/builder/settings/fonts');
      const row = page.locator(`[data-font-row="${token}"]`);
      await row.click();
      await expect(page.getByRole('button', { name: 'Xoá họ' })).toBeDisabled();

      const fonts = ((await (await request.get('/api/fonts')).json()) as { fonts: ApiFont[] }).fonts;
      const made = fonts.find((f) => f.cssName === family);
      const refused = await request.delete(`/api/fonts/${made!.id}`);
      expect(refused.status()).toBeGreaterThanOrEqual(400);
    } finally {
      if (pageId && nodeId) {
        await request.post('/api/ops', {
          data: {
            pageId,
            label: 'e2e font — gỡ họ',
            ops: [{ op: 'setStyle', nodeId, target: 'base', patch: { typography: { family: null } } }],
          },
        });
      }
      await removeFamily(request, family);
    }
  });
});
