import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Hai bên cùng sửa một trang — người trong builder và "bên kia" (agent qua MCP, hoặc
 * một tab khác) — không bên nào mất thay đổi.
 *
 * Trước 08/10/2026 bản nháp trỏ vào version mới VÔ ĐIỀU KIỆN, nên lần ghi sau âm thầm
 * xoá lần ghi trước khỏi nhánh nháp (`scripts/prove-concurrent-ops.ts` đo trên code cũ:
 * 12 batch đồng thời, 11 mất, cả 12 báo ok). Giờ client gửi `baseSeq`; lệch thì server
 * trả 409 và builder áp lại thao tác lên bản mới nhất, rồi NÓI RA điều đó.
 */

const PAGE_SLUG = 'gioi-thieu';
const HEADING = 'ab000002';

async function openEditor(page: Page): Promise<string> {
  await page.goto('/builder');
  await page.getByRole('link', { name: new RegExp(PAGE_SLUG) }).first().click();
  await page.waitForURL(/\/builder\/[a-z0-9]+$/);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  return page.url().split('/').pop()!;
}

async function tool(request: APIRequestContext, name: string, input: unknown) {
  const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
  return (await res.json()).result;
}

let cleanup: (() => Promise<unknown>) | null = null;
test.afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

test('baseSeq lệch thì /api/ops trả 409 kèm currentSeq, không ghi gì', async ({ page, request }) => {
  const pageId = await openEditor(page);
  const outline = await tool(request, 'get_page_outline', { pageId });

  const stale = await request.post('/api/ops', {
    data: {
      pageId,
      baseSeq: outline.draftSeq - 1,
      ops: [{ op: 'setName', nodeId: outline.rootId, name: 'e2e-khong-duoc-ghi' }],
    },
  });
  expect(stale.status()).toBe(409);
  const body = await stale.json();
  expect(body.conflict).toBe(true);
  expect(body.currentSeq).toBe(outline.draftSeq);

  const after = await tool(request, 'get_page_outline', { pageId });
  expect(after.draftSeq, 'không có version mới').toBe(outline.draftSeq);
});

test('bên kia sửa trong lúc mình đang mở: thao tác của mình gộp lên bản mới, cả hai còn', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const pageId = await openEditor(page);
  const outline = await tool(request, 'get_page_outline', { pageId });
  const rootName = outline.nodes.find((n: { id: string }) => n.id === outline.rootId)?.name ?? null;

  cleanup = () =>
    request.post('/api/ops', {
      data: {
        pageId,
        label: 'e2e concurrent — hoàn tác',
        ops: [
          { op: 'setName', nodeId: outline.rootId, name: rootName },
          { op: 'setStyle', nodeId: HEADING, target: 'lg', patch: { spacing: { pt: null } } },
        ],
      },
    });

  // Bên kia ghi: KHÔNG qua builder đang mở, nên store của builder vẫn giữ seq cũ.
  const other = await request.post('/api/ops', {
    data: { pageId, ops: [{ op: 'setName', nodeId: outline.rootId, name: 'e2e-ben-kia' }] },
  });
  expect(other.ok()).toBe(true);

  // Mình sửa trong builder, dựa trên bản đã cũ.
  await page.getByRole('button', { name: /Tiêu đề/ }).first().click();
  await expect(page.getByTitle(HEADING)).toBeVisible();
  const pt = page.getByLabel('padding-block-start', { exact: true });
  if ((await pt.count()) === 0) await page.getByRole('button', { name: /khoảng cách/i }).click();
  await pt.fill('space-xl');
  await pt.press('Enter');

  // Builder không im lặng: chip nói rằng đã gộp với một thay đổi khác.
  await expect(page.getByText(/gộp bản mới/)).toBeVisible({ timeout: 15_000 });

  // Và cả hai thay đổi đều nằm trong bản nháp.
  await expect
    .poll(async () => {
      const now = await tool(request, 'get_page_outline', { pageId });
      return now.nodes.find((n: { id: string }) => n.id === now.rootId)?.name;
    })
    .toBe('e2e-ben-kia');
  await expect
    .poll(async () => {
      const node = await tool(request, 'get_node', { pageId, nodeIds: [HEADING] });
      return node.nodes[HEADING].style.lg?.spacing?.pt;
    })
    .toEqual({ $token: 'space-xl' });
});
