import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { interTtf, interTtfWith } from '../tests/fixtures/fonts/make-fixtures';

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

async function uploadFace(request: APIRequestContext, family: string, ttf: Uint8Array): Promise<void> {
  const res = await request.post('/api/fonts', {
    multipart: {
      file: { name: 'e2e-font.ttf', mimeType: 'font/ttf', buffer: Buffer.from(ttf) },
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

/** Gán token của họ cho một node Text của trang chủ (bản nháp). */
async function assignFamily(
  request: APIRequestContext,
  family: string,
): Promise<{ pageId: string; nodeId: string }> {
  const pageId = await homePageId(request);
  const outline = await request.post('/api/ai/tool', {
    data: { tool: 'get_page_outline', input: { pageId } },
  });
  const nodes = (await outline.json()).result.nodes as { id: string; type: string }[];
  const nodeId = nodes.find((n) => n.type === 'Text')!.id;
  const set = await request.post('/api/ops', {
    data: {
      pageId,
      label: 'e2e font — gán họ',
      ops: [{ op: 'setStyle', nodeId, target: 'base', patch: { typography: { family: { $token: slugOf(family) } } } }],
    },
  });
  expect(set.ok(), await set.text()).toBe(true);
  return { pageId, nodeId };
}

async function unassignFamily(request: APIRequestContext, a: { pageId: string; nodeId: string } | null) {
  if (!a) return;
  await request.post('/api/ops', {
    data: {
      pageId: a.pageId,
      label: 'e2e font — gỡ họ',
      ops: [{ op: 'setStyle', nodeId: a.nodeId, target: 'base', patch: { typography: { family: null } } }],
    },
  });
}

const liveFontCss = async (page: Page) => {
  await page.goto('/');
  return (await page.locator('style[data-mm-fonts]').allTextContents()).join('\n');
};

const faceUrl = (css: string, family: string) =>
  /url\("(\/mm-font\/[^"]+)"\)/.exec(css.slice(css.indexOf(family)))?.[1];

test.describe('font động end-to-end', () => {
  test('bản nháp: canvas có @font-face và nạp được họ vừa gán', async ({ page, request }) => {
    const family = `E2E Draft ${Date.now()}`;
    let assigned: { pageId: string; nodeId: string } | null = null;
    try {
      await uploadFace(request, family, await interTtf());
      assigned = await assignFamily(request, family);

      await page.goto(`/builder/${assigned.pageId}`);
      const frameEl = page.locator('[data-stage-frame] iframe[data-canvas-frame="shown"]');
      await expect(frameEl).toBeVisible();
      const frame = await (await frameEl.elementHandle())!.contentFrame();
      expect(frame).toBeTruthy();

      await expect
        .poll(() => frame!.evaluate(() => document.querySelectorAll('style[data-mm-fonts]').length))
        .toBeGreaterThan(0);
      const css = await frame!.evaluate(() =>
        [...document.querySelectorAll('style[data-mm-fonts]')].map((s) => s.textContent).join('\n'),
      );
      expect(css).toContain(family);

      // Face chỉ tải khi có chữ dùng nó: load() trước, rồi mới check().
      const ok = await frame!.evaluate(async (f) => {
        await document.fonts.load(`16px "${f}"`);
        return document.fonts.check(`16px "${f}"`);
      }, family);
      expect(ok).toBe(true);
    } finally {
      await unassignFamily(request, assigned);
      await removeFamily(request, family);
    }
  });

  test('niêm phong: font mới và face thay chỉ lên site sau Publish', async ({ page, request, baseURL }) => {
    test.skip(
      !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? ''),
      'Publish chỉ chạy trên stack e2e local',
    );
    const family = `E2E Seal ${Date.now()}`;
    try {
      await uploadFace(request, family, await interTtf());

      // Chưa Publish → site đang chạy chưa biết họ này.
      expect(await liveFontCss(page)).not.toContain(family);

      const pub = await request.post('/api/publish', { data: {} });
      expect(pub.ok(), await pub.text()).toBe(true);

      const css1 = await liveFontCss(page);
      expect(css1).toContain(family);
      const url1 = faceUrl(css1, family);
      expect(url1, 'face của họ mới phải trỏ /mm-font/…').toBeTruthy();
      const file = await request.get(url1!);
      expect(file.status()).toBe(200);
      expect(file.headers()['cache-control']).toContain('immutable');

      // Thay face (cùng họ/weight/kiểu, file khác byte): site chưa đổi cho tới Publish.
      await uploadFace(request, family, await interTtfWith('AaBbCc0123 ạảãếộữơưƯĐ XyZ'));
      expect(faceUrl(await liveFontCss(page), family)).toBe(url1);

      const pub2 = await request.post('/api/publish', { data: {} });
      expect(pub2.ok(), await pub2.text()).toBe(true);
      const url2 = faceUrl(await liveFontCss(page), family);
      expect(url2).toBeTruthy();
      expect(url2).not.toBe(url1);
    } finally {
      await removeFamily(request, family);
    }
  });

  test('xoá họ bị khoá khi còn trang dùng', async ({ page, request }) => {
    const family = `E2E Lock ${Date.now()}`;
    const token = slugOf(family);
    let assigned: { pageId: string; nodeId: string } | null = null;
    try {
      await uploadFace(request, family, await interTtf());
      assigned = await assignFamily(request, family);

      await page.goto('/builder/settings/fonts');
      await page.locator(`[data-font-row="${token}"]`).click();
      await expect(page.getByRole('button', { name: 'Xoá họ' })).toBeDisabled();

      const fonts = ((await (await request.get('/api/fonts')).json()) as { fonts: ApiFont[] }).fonts;
      const made = fonts.find((f) => f.cssName === family);
      const refused = await request.delete(`/api/fonts/${made!.id}`);
      expect(refused.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await unassignFamily(request, assigned);
      await removeFamily(request, family);
    }
  });
});
