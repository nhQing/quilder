import { crc32 } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Xuất / nhập trang — spec docs/superpowers/specs/2026-10-14-page-import-export-design.md.
 *
 * Gói nhập được DỰNG TRONG TEST với một ảnh PNG mới tinh (chunk tEXt ngẫu nhiên → sha mới), để
 * đi qua đường tải file lên. Xuất rồi nhập cùng một DB thì mọi ảnh đều "đã có" và đường đó không
 * bao giờ chạy.
 */

let cleanup: Array<(r: APIRequestContext) => Promise<unknown>> = [];
test.afterEach(async ({ request }) => {
  for (const job of cleanup.reverse()) await job(request).catch(() => undefined);
  cleanup = [];
});

async function tool(request: APIRequestContext, name: string, input: unknown) {
  const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).result;
}

async function newPage(request: APIRequestContext, slug: string) {
  const res = await request.post('/api/pages', { data: { title: `E2E ${slug}`, slug } });
  expect(res.ok(), await res.text()).toBe(true);
  const id = (await res.json()).page.id as string;
  cleanup.push(async (r) => { await r.delete(`/api/pages/${id}`); await r.delete(`/api/pages/${id}?purge=1`); });
  return id;
}

/** PNG 1×1 hợp lệ, thêm chunk tEXt ngẫu nhiên để sha256 mới mỗi lần chạy. */
function uniquePng(): Uint8Array {
  const base = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  const data = Buffer.concat([Buffer.from('Comment\0'), Buffer.from(randomBytes(8).toString('hex'))]);
  const type = Buffer.from('tEXt');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  const iend = base.length - 12;
  return new Uint8Array(Buffer.concat([base.subarray(0, iend), len, type, data, crc, base.subarray(iend)]));
}

/** Gói thật của một trang (manifest), lấy qua route xuất. */
async function exportBundle(request: APIRequestContext, pageId: string) {
  const res = await request.get(`/api/pages/${pageId}/export`);
  expect(res.ok(), await res.text()).toBe(true);
  return JSON.parse(strFromU8(unzipSync(new Uint8Array(await res.body()))['manifest.json']!));
}

/** Xem trước rồi ghi qua API, đúng trình tự hộp thoại làm (expectDraftVersionId lấy từ xem trước). */
async function importApi(request: APIRequestContext, bundle: unknown, target: unknown) {
  const preview = await request.post('/api/transfer/preview', { data: { bundle, target } });
  expect(preview.ok(), await preview.text()).toBe(true);
  const plan = (await preview.json()).plan;
  const commit = await request.post('/api/transfer/commit', {
    data: { bundle, target, expectDraftVersionId: plan.target?.draftVersionId ?? null, takeMeta: false },
  });
  expect(commit.ok(), await commit.text()).toBe(true);
  return { plan, result: (await commit.json()) as { pageId: string; importId: string } };
}

test('xuất: kiểm trước rồi tải về một gói có manifest và file', async ({ request }) => {
  const id = await newPage(request, 'e2e-xuat-nguon');
  const check = await request.post(`/api/pages/${id}/export/check`);
  expect(check.ok(), await check.text()).toBe(true);
  expect((await check.json()).ok).toBe(true);

  const zip = await request.get(`/api/pages/${id}/export`);
  expect(zip.ok()).toBe(true);
  expect(zip.headers()['content-disposition']).toContain('e2e-xuat-nguon-');
  const files = unzipSync(new Uint8Array(await zip.body()));
  const manifest = JSON.parse(strFromU8(files['manifest.json']!));
  expect(manifest.page.slug).toBe('e2e-xuat-nguon');
  expect(manifest.format).toBe('quilder-page');
});

test('nhập qua giao diện vào trang có sẵn (ảnh mới, form chưa có URL), mở editor, hoàn tác bị chặn khi bản dịch sửa sau rồi hoàn tác được; nhập lại dùng lại ảnh', async ({ page, request }) => {
  test.setTimeout(180_000);
  // Ảnh tải lên là Asset + object thật trong kho: dọn (thùng rác → xoá hoàn toàn) SAU khi hai trang đã bị purge,
  // vì bản cũ của trang đích còn có thể giữ tham chiếu. Job này đăng ký TRƯỚC nên chạy SAU (cleanup đảo ngược).
  let uploadedAssetId: string | null = null;
  cleanup.push(async (r) => {
    if (!uploadedAssetId) return;
    const ids = [uploadedAssetId];
    await r.post('/api/assets/trash', { data: { ids } });
    const dry = await (await r.post('/api/assets/purge', { data: { dryRun: true, ids } })).json();
    for (const b of dry.batches ?? []) await r.post('/api/assets/purge', { data: { ids: b.ids, confirmToken: b.confirmToken } });
  });
  const sourceId = await newPage(request, 'e2e-nhap-nguon');
  const targetId = await newPage(request, 'e2e-nhap-dich');

  // Gói: lấy gói thật của trang nguồn, thêm một node Image trỏ ảnh mới tinh.
  const exported = unzipSync(new Uint8Array(await (await request.get(`/api/pages/${sourceId}/export`)).body()));
  const bundle = JSON.parse(strFromU8(exported['manifest.json']!));
  const png = uniquePng();
  const sha = createHash('sha256').update(png).digest('hex');
  const assetId = 'ce2etransferasset00000001';
  bundle.assets.push({ id: assetId, key: `public/builder/e2e-moi-${sha.slice(0, 8)}.png`, name: 'e2e-moi.png', kind: 'image', mime: 'image/png', bytes: png.length, width: 1, height: 1, blurhash: null, alt: 'Ảnh e2e', folder: null, sha256: sha, file: `files/${sha}.png` });
  const root = bundle.doc.nodes[bundle.doc.rootId];
  root.children.push('e2eimg');
  bundle.doc.nodes.e2eimg = { id: 'e2eimg', type: 'Image', parentId: bundle.doc.rootId, children: [], effects: [], style: { base: {} }, assetId, alt: 'Ảnh e2e', fit: { base: 'cover' } };
  // Form gửi tới một khoá chưa có URL ở đây → hướng dẫn C1.
  root.children.push('e2eform');
  bundle.doc.nodes.e2eform = { id: 'e2eform', type: 'Composite', composite: 'Form', parentId: bundle.doc.rootId, params: { endpointKey: 'e2e-chua-co-url' }, slots: {}, children: [], effects: [], style: { base: {} } };
  bundle.needs.endpointKeys = [...bundle.needs.endpointKeys, 'e2e-chua-co-url'].sort();
  const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(bundle)), [`files/${sha}.png`]: png });

  await page.goto('/builder');
  await page.getByRole('button', { name: 'Nhập trang' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'goi.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.locator('[data-import-dialog="preview"]')).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('Trang đích', { exact: true }).selectOption(targetId);
  await expect(page.getByText('1 mới')).toBeVisible();
  // Nút Nhập khoá cho tới khi chọn thư mục — không có thư mục mặc định.
  await expect(page.getByRole('button', { name: 'Nhập', exact: true })).toBeDisabled();
  await page.getByLabel('Giữ thư mục như bên nguồn').check();
  await expect(page.locator('[data-transfer-issue="endpoint-missing"]')).toBeVisible();
  const committed = page.waitForResponse((r) => r.url().endsWith('/api/transfer/commit'));
  await page.getByRole('button', { name: 'Nhập', exact: true }).click();
  const importId = (await (await committed).json()).importId as string;
  await expect(page.locator('[data-import-done]')).toContainText('Đã nhập vào bản nháp', { timeout: 60_000 });
  await expect(page.locator('[data-transfer-issue="publish"]')).toBeVisible();
  // C1 ở màn kết quả: form vẫn tắt cho tới khi có URL của môi trường này.
  await expect(page.locator('[data-import-done] [data-transfer-issue="endpoint-missing"]')).toContainText('e2e-chua-co-url');

  // Mở editor ngay tại node vừa nhập (tab riêng để hộp thoại còn nguyên).
  const editor = await page.context().newPage();
  await editor.goto(`/builder/${targetId}?node=e2eimg`);
  await expect(editor.locator('[data-node-name]')).toBeVisible({ timeout: 30_000 });
  await editor.close();

  const { nodes } = await tool(request, 'get_node', { pageId: targetId, nodeIds: ['e2eimg'] });
  uploadedAssetId = nodes.e2eimg.assetId;
  expect(typeof uploadedAssetId).toBe('string');
  expect(uploadedAssetId!.length).toBeGreaterThan(0);
  expect(uploadedAssetId).not.toBe(assetId); // id ĐÍCH, không phải id trong gói

  // Có người sửa bản dịch sau lần nhập → hoàn tác bị từ chối, nói rõ lý do (không xoá lặng lẽ).
  const translation = { pageId: targetId, locale: 'en', nodeId: 'e2eimg', field: 'alt' };
  const tr = await request.post('/api/translations', { data: { ...translation, value: 'E2E alt tiếng Anh' } });
  expect(tr.ok(), await tr.text()).toBe(true);
  await page.getByRole('button', { name: 'Hoàn tác lần nhập' }).click();
  await expect(page.locator('[data-import-undo-confirm]')).toContainText('Component, token và ảnh đã thêm vẫn giữ lại');
  await page.getByRole('button', { name: 'Xác nhận hoàn tác' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'bản dịch hoặc SEO' })).toBeVisible();
  const refused = await request.post('/api/transfer/undo', { data: { importId } });
  expect(refused.status()).toBe(409);

  // Gỡ bản dịch đó thì trang lại đúng như lần nhập để lại → hoàn tác được.
  await request.post('/api/translations', { data: { ...translation, value: null } });
  await page.getByRole('button', { name: 'Hoàn tác lần nhập' }).click();
  await page.getByRole('button', { name: 'Xác nhận hoàn tác' }).click();
  await expect(page.locator('[data-import-done]')).toContainText('Đã hoàn tác');
  const after = await tool(request, 'get_node', { pageId: targetId, nodeIds: ['e2eimg'] });
  expect(after.nodes.e2eimg ?? null).toBeNull();

  // Nhập lại đúng gói đó: ảnh đã lên kho lần trước → "đã có", không tải lại file nào.
  const again = await importApi(request, bundle, { kind: 'existing', pageId: targetId });
  const rows = again.plan.assets as { sourceId: string; status: string }[];
  expect(rows.filter((a) => a.status === 'upload')).toEqual([]);
  expect(rows.find((a) => a.sourceId === assetId)?.status).toBe('reuse');
  const reused = await tool(request, 'get_node', { pageId: targetId, nodeIds: ['e2eimg'] });
  expect(reused.nodes.e2eimg.assetId).toBe(uploadedAssetId);
});

test('nhập thành TRANG MỚI rồi hoàn tác → trang bị xoá hẳn', async ({ request }) => {
  const sourceId = await newPage(request, 'e2e-moi-nguon');
  const bundle = await exportBundle(request, sourceId);
  const slug = `e2e-nhap-trang-moi-${Date.now()}`;
  const { result } = await importApi(request, bundle, { kind: 'new', slug, title: 'E2E trang mới từ gói' });
  cleanup.push(async (r) => { await r.delete(`/api/pages/${result.pageId}`); await r.delete(`/api/pages/${result.pageId}?purge=1`); });
  expect((await tool(request, 'get_page_outline', { pageId: result.pageId })).rootId).toBeTruthy();

  const undo = await request.post('/api/transfer/undo', { data: { importId: result.importId } });
  expect(undo.ok(), await undo.text()).toBe(true);
  expect(await undo.json()).toMatchObject({ ok: true, pageId: result.pageId, purged: true });
  // Không còn cả trong lưu trữ: khôi phục trả 404.
  expect((await request.delete(`/api/pages/${result.pageId}?restore=1`)).status()).toBe(404);
});

test('sửa SEO sau lần nhập → hoàn tác ở thẻ trang bị từ chối kèm lý do, mục menu biến mất, API trả 409', async ({ page, request }) => {
  const sourceId = await newPage(request, 'e2e-seo-nguon');
  const targetId = await newPage(request, 'e2e-seo-dich');
  const bundle = await exportBundle(request, sourceId);
  const { result } = await importApi(request, bundle, { kind: 'existing', pageId: targetId });

  // Trang chủ builder: lần nhập mới nhất còn hoàn tác được → có mục menu, mở ra hộp xác nhận.
  await page.goto('/builder');
  await page.getByRole('button', { name: 'Tuỳ chọn cho E2E e2e-seo-dich', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Hoàn tác lần nhập' }).click();
  const confirm = page.getByRole('dialog', { name: 'Hoàn tác lần nhập vào /e2e-seo-dich?' });
  await expect(confirm).toContainText('Bản nháp và bản dịch của trang trở về như trước lần nhập');

  // Ai đó sửa SEO trong lúc hộp xác nhận đang mở → bấm Hoàn tác bị từ chối, lý do hiện ngay trong hộp.
  const seo = await request.patch(`/api/pages/${targetId}`, { data: { description: 'SEO sửa sau lần nhập' } });
  expect(seo.ok(), await seo.text()).toBe(true);
  await confirm.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expect(confirm.getByRole('alert')).toContainText('bản dịch hoặc SEO');

  const undo = await request.post('/api/transfer/undo', { data: { importId: result.importId } });
  expect(undo.status()).toBe(409);
  expect((await undo.json()).error).toContain('bản dịch hoặc SEO');

  await page.reload();
  await page.getByRole('button', { name: 'Tuỳ chọn cho E2E e2e-seo-dich', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Xuất trang (.zip)' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Hoàn tác lần nhập' })).toHaveCount(0);
});

test('trang đích bị sửa giữa lúc xem trước và lúc ghi → 409 target-changed', async ({ request }) => {
  const sourceId = await newPage(request, 'e2e-409-nguon');
  const targetId = await newPage(request, 'e2e-409-dich');
  const exported = unzipSync(new Uint8Array(await (await request.get(`/api/pages/${sourceId}/export`)).body()));
  const bundle = JSON.parse(strFromU8(exported['manifest.json']!));

  const preview = await request.post('/api/transfer/preview', { data: { bundle, target: { kind: 'existing', pageId: targetId } } });
  const draft = (await preview.json()).plan.target.draftVersionId as string;

  const { rootId } = await tool(request, 'get_page_outline', { pageId: targetId });
  const edit = await request.post('/api/ops', { data: { pageId: targetId, label: 'e2e xen', ops: [{ op: 'setName', nodeId: rootId, name: 'Sửa xen' }] } });
  expect(edit.ok(), await edit.text()).toBe(true);

  const commit = await request.post('/api/transfer/commit', { data: { bundle, target: { kind: 'existing', pageId: targetId }, expectDraftVersionId: draft, takeMeta: false } });
  expect(commit.status()).toBe(409);
  expect((await commit.json()).issues[0].code).toBe('target-changed');
});

test('gói thiếu file (manifest nhắc file không có trong zip) bị từ chối ngay ở trình duyệt với hướng dẫn G4', async ({ page }) => {
  const sha = 'b'.repeat(64);
  const manifest = { format: 'quilder-page', formatVersion: 1, assets: [{ file: `files/${sha}.png`, sha256: sha }] };
  const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) });
  await page.goto('/builder');
  await page.getByRole('button', { name: 'Nhập trang' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'hong.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.locator('[data-transfer-issue="file-corrupt"]')).toBeVisible();
  await expect(page.locator('[data-transfer-issue="file-corrupt"] [data-transfer-steps] li')).toHaveCount(3);
});

test('kéo thả file vào ô chọn gói: file không phải .zip bị từ chối tại chỗ, file .zip được mở', async ({ page }) => {
  const sha = 'c'.repeat(64);
  const manifest = { format: 'quilder-page', formatVersion: 1, assets: [{ file: `files/${sha}.png`, sha256: sha }] };
  const zip = Array.from(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) }));

  await page.goto('/builder');
  await page.getByRole('button', { name: 'Nhập trang' }).click();
  const zone = page.locator('[data-zip-drop]');
  await expect(zone.getByRole('button', { name: 'Chọn file .zip' })).toBeVisible();

  // Thả THẬT: sự kiện drop mang DataTransfer có File — đúng thứ trình duyệt gửi khi
  // người dùng kéo file từ thư mục Tải về vào.
  const drop = async (name: string, type: string, bytes: number[]) => {
    const dt = await page.evaluateHandle(
      ({ name, type, bytes }) => {
        const d = new DataTransfer();
        d.items.add(new File([new Uint8Array(bytes)], name, { type }));
        return d;
      },
      { name, type, bytes },
    );
    await zone.dispatchEvent('dragover', { dataTransfer: dt });
    await expect(zone).toHaveAttribute('data-over', 'true');
    await zone.dispatchEvent('drop', { dataTransfer: dt });
  };

  await drop('anh.png', 'image/png', [1, 2, 3]);
  await expect(page.getByRole('alert').filter({ hasText: 'không phải file .zip' })).toContainText('anh.png');

  await drop('goi.zip', 'application/zip', zip);
  // Gói được mở và kiểm: manifest thiếu file → hướng dẫn G4 hiện ra.
  await expect(page.locator('[data-transfer-issue="file-corrupt"]')).toBeVisible();
});
