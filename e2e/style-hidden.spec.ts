import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Cờ `hidden` (D4): ẩn tạm một lớp bóng trong inspector.
 *
 * Nghiệm thu trong lộ trình: "Ẩn một lớp bóng thì CSS không còn lớp đó. Bật lại thì
 * đúng như cũ, và lịch sử có hai version." Test đọc `box-shadow` THẬT trong khung
 * canvas — không đọc doc — vì câu hỏi là trang trông ra sao, không phải doc lưu gì.
 *
 * Dọn trong `afterEach` như `inspector.spec.ts`: bản nháp bẩn sẽ bị spec publish đẩy
 * lên site.
 */

const PAGE_SLUG = 'gioi-thieu';
const NODE = 'ab000002';

let pending: { pageId: string; ops: unknown[] } | null = null;

test.afterEach(async ({ request }) => {
  if (!pending) return;
  const { pageId, ops } = pending;
  pending = null;
  await request.post('/api/ops', { data: { pageId, label: 'e2e ẩn lớp — hoàn tác', ops } });
});

async function openEditor(page: Page): Promise<string> {
  await page.goto('/builder');
  await page.getByRole('link', { name: new RegExp(PAGE_SLUG) }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  return page.url().split('/').pop()!;
}

/** Các bản mới nhất trước. API có trần số bản, nên so `seq` chứ không đếm. */
async function history(request: APIRequestContext, pageId: string) {
  const res = await request.get(`/api/pages/${pageId}/history`);
  const json = (await res.json()) as { versions: { seq: number; label: string | null }[] };
  return json.versions;
}

const px = (v: number) => ({ v, u: 'px' });
const LAYERS = [
  { x: px(0), y: px(2), blur: px(4), spread: px(0), color: { hex: '#ff0000' } },
  { x: px(0), y: px(24), blur: px(48), spread: px(0), color: { hex: '#0000ff' } },
];

test('ẩn một lớp bóng: CSS mất lớp đó, bật lại như cũ, lịch sử thêm hai version', async ({ page, request }) => {
  test.setTimeout(120_000);
  const pageId = await openEditor(page);

  pending = {
    pageId,
    ops: [{ op: 'setStyle', nodeId: NODE, target: 'base', patch: { shadow: null } }],
  };
  const seed = await request.post('/api/ops', {
    data: { pageId, label: 'e2e ẩn lớp — bóng hai lớp', ops: [{ op: 'setStyle', nodeId: NODE, target: 'base', patch: { shadow: LAYERS } }] },
  });
  expect(seed.ok()).toBe(true);

  // Nạp lại để store của editor thấy bản nháp vừa ghi qua API.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await page.getByRole('button', { name: /Tiêu đề/ }).first().click();
  await expect(page.getByTitle(NODE)).toBeVisible();

  const second = page.locator('[data-shadow-layer="1"] [data-style-hidden]');
  if ((await second.count()) === 0) await page.getByRole('button', { name: /Nền & viền/ }).click();
  await expect(second).toBeVisible();

  const frame = page.frameLocator('[data-stage-frame] iframe[data-canvas-frame="shown"]');
  const shadow = () => frame.locator(`[data-n="${NODE}"]`).first().evaluate((el) => getComputedStyle(el).boxShadow);

  await expect.poll(shadow, { timeout: 20_000 }).toContain('rgb(0, 0, 255)');
  const before = await shadow();
  const seqBefore = (await history(request, pageId))[0]!.seq;

  // Ẩn lớp 2 (xanh).
  await second.click();
  await expect(second).toHaveAttribute('data-style-hidden', 'true');
  await expect.poll(shadow, { timeout: 20_000 }).not.toContain('rgb(0, 0, 255)');
  expect(await shadow()).toContain('rgb(255, 0, 0)');

  // Bật lại.
  await second.click();
  await expect(second).toHaveAttribute('data-style-hidden', 'false');
  await expect.poll(shadow, { timeout: 20_000 }).toBe(before);

  await expect.poll(async () => (await history(request, pageId))[0]!.seq, { timeout: 15_000 }).toBe(seqBefore + 2);
  const [last, prev] = await history(request, pageId);
  expect([prev!.label, last!.label]).toEqual(['ẩn lớp bóng 2', 'hiện lớp bóng 2']);
});
