import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Thư mục kho ảnh: tạo rỗng, dời ảnh, đổi tên, xoá.
 *
 * ## Vì sao phần lớn test này gõ vào API chứ không vào giao diện
 *
 * Thứ dễ vỡ ở tính năng này không phải nút bấm — nó là **luật giữ hai nguồn khớp
 * nhau**: bảng `AssetFolder` nói thư mục nào tồn tại, cột `Asset.folder` nói ảnh nào
 * nằm đâu, và mọi lối ghi phải cập nhật cả hai. Một test bấm nút chỉ chứng minh nút
 * chạy trên một đường; test ở API đi đúng chỗ luật đó có thể trôi.
 *
 * Phần giao diện được kiểm ở một test riêng, và chỉ kiểm thứ chỉ có ở giao diện:
 * thư mục rỗng có hiện trong cây không.
 *
 * ## Kéo-thả cố ý KHÔNG có test tự động
 *
 * `dataTransfer` của HTML5 không mô phỏng trung thực được bằng Playwright — cú
 * `dragTo` tổng hợp không mang theo `types`, mà đó lại chính là thứ mã ở đây dùng để
 * phân biệt "kéo file" với "kéo ảnh". Một test xanh dựa trên sự kiện giả sẽ nói dối
 * về đúng dòng code nó phải canh. Đường ghi mà cú thả gọi tới (`PATCH
 * /api/assets/move`) thì được kiểm đầy đủ ở đây.
 */

/** Tiền tố riêng cho từng lần chạy, để test không đụng thư mục thật trong kho. */
const RUN = `e2e-tm-${Date.now().toString(36)}`;

async function createFolder(request: APIRequestContext, path: string) {
  const res = await request.post('/api/assets/folders', { data: { path } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { ok: true; path: string };
}

async function tree(request: APIRequestContext) {
  const res = await request.get('/api/assets/folders');
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as {
    folders: { path: string; total: number; count: number }[];
    unfiled: number;
    all: number;
  };
}

async function someAssetId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/assets');
  expect(res.ok(), await res.text()).toBe(true);
  const json = (await res.json()) as { assets: { id: string; folder: string | null }[] };
  expect(json.assets.length, 'kho chưa có ảnh nào — chạy pnpm db:seed trước').toBeGreaterThan(0);
  return json.assets[0]!.id;
}

test.describe('thư mục kho ảnh', () => {
  test.afterEach(async ({ request }) => {
    // Dọn theo tiền tố: một test đỏ giữa chừng vẫn không để lại rác cho lần sau.
    const { folders } = await tree(request);
    for (const f of folders.filter((x) => x.path.startsWith(RUN) && !x.path.includes('/'))) {
      await request.delete(`/api/assets/folders?path=${encodeURIComponent(f.path)}`);
    }
  });

  test('tạo thư mục rỗng — nó tồn tại dù chưa có ảnh nào', async ({ request }) => {
    const path = `${RUN}-rong`;
    await createFolder(request, path);

    const { folders } = await tree(request);
    const node = folders.find((f) => f.path === path);
    expect(node, 'thư mục rỗng không xuất hiện trong cây').toBeTruthy();
    expect(node!.total).toBe(0);
  });

  test('tên có dấu được chuẩn hoá, và server nói lại đường dẫn thật', async ({ request }) => {
    const res = await createFolder(request, `${RUN}-Trang Chủ`);
    expect(res.path).toBe(`${RUN}-trang-chu`);

    const { folders } = await tree(request);
    expect(folders.map((f) => f.path)).toContain(`${RUN}-trang-chu`);
  });

  test('tạo thư mục lồng cấp thì cấp cha cũng có thật', async ({ request }) => {
    await createFolder(request, `${RUN}-cha/con/chau`);

    const paths = (await tree(request)).folders.map((f) => f.path);
    expect(paths).toContain(`${RUN}-cha`);
    expect(paths).toContain(`${RUN}-cha/con`);
    expect(paths).toContain(`${RUN}-cha/con/chau`);
  });

  test('dời hàng loạt: một request, và số đếm của cây đi theo', async ({ request }) => {
    const path = `${RUN}-lo`;
    await createFolder(request, path);
    const id = await someAssetId(request);

    const moved = await request.patch('/api/assets/move', { data: { ids: [id], folder: path } });
    expect(moved.ok(), await moved.text()).toBe(true);
    expect((await moved.json()).moved).toBe(1);

    expect((await tree(request)).folders.find((f) => f.path === path)!.total).toBe(1);

    // Trả ảnh về chỗ cũ để test sau không thấy kho bị xáo.
    const back = await request.patch('/api/assets/move', { data: { ids: [id], folder: null } });
    expect(back.ok()).toBe(true);
  });

  test('thiếu "folder" bị từ chối — không đoán thành "chưa phân loại"', async ({ request }) => {
    const id = await someAssetId(request);
    const res = await request.patch('/api/assets/move', { data: { ids: [id] } });
    expect(res.status()).toBe(400);
  });

  test('một id sai làm hỏng CẢ LÔ, không dời một phần', async ({ request }) => {
    const path = `${RUN}-nguyen-lo`;
    await createFolder(request, path);
    const id = await someAssetId(request);

    const res = await request.patch('/api/assets/move', {
      data: { ids: [id, 'khong-co-that'], folder: path },
    });
    expect(res.status()).toBe(404);

    expect(
      (await tree(request)).folders.find((f) => f.path === path)!.total,
      'lô hỏng vẫn dời được một phần',
    ).toBe(0);
  });

  test('đổi tên chạy được trên thư mục RỖNG, và kéo theo thư mục con', async ({ request }) => {
    await createFolder(request, `${RUN}-cu/con`);

    const res = await request.patch('/api/assets/folders', {
      data: { from: `${RUN}-cu`, to: `${RUN}-moi` },
    });
    expect(res.ok(), await res.text()).toBe(true);

    const paths = (await tree(request)).folders.map((f) => f.path);
    expect(paths).toContain(`${RUN}-moi`);
    expect(paths).toContain(`${RUN}-moi/con`);
    expect(paths).not.toContain(`${RUN}-cu`);
    expect(paths).not.toContain(`${RUN}-cu/con`);

    await request.delete(`/api/assets/folders?path=${encodeURIComponent(`${RUN}-moi`)}`);
  });

  test('không dời được một thư mục vào bên trong chính nó', async ({ request }) => {
    await createFolder(request, `${RUN}-vong`);
    const res = await request.patch('/api/assets/folders', {
      data: { from: `${RUN}-vong`, to: `${RUN}-vong/ben-trong` },
    });
    expect(res.status()).toBe(400);
  });

  test('xoá thư mục đưa ảnh về Chưa phân loại và KHÔNG xoá ảnh', async ({ request }) => {
    const path = `${RUN}-xoa`;
    await createFolder(request, path);
    const id = await someAssetId(request);
    await request.patch('/api/assets/move', { data: { ids: [id], folder: path } });

    const before = await tree(request);

    const del = await request.delete(`/api/assets/folders?path=${encodeURIComponent(path)}`);
    expect(del.ok(), await del.text()).toBe(true);
    expect((await del.json()).moved).toBe(1);

    const after = await tree(request);
    expect(after.folders.map((f) => f.path)).not.toContain(path);
    expect(after.all, 'xoá thư mục đã xoá mất ảnh').toBe(before.all);
    expect(after.unfiled).toBe(before.unfiled + 1);
  });

  test('xoá thư mục không tồn tại là 404, không phải 403', async ({ request }) => {
    const res = await request.delete(`/api/assets/folders?path=${RUN}-khong-co`);
    expect(res.status()).toBe(404);
  });

  /*
   * Ô chọn thư mục là listbox tự dựng, không phải `<select>` — nên bàn phím là code
   * của chúng ta và nó vỡ được.
   *
   * Test này không phải để cho đủ: nó ĐÃ bắt một lỗi thật. Bản đầu gọi `focus()`
   * trong cùng effect với lúc panel còn `visibility: hidden`, và một phần tử ẩn theo
   * kiểu đó không nhận focus — mũi lên/xuống lặng thinh, Escape không đóng, mà ảnh
   * chụp màn hình thì trông hoàn toàn bình thường.
   */
  test('dropdown thư mục đi được bằng bàn phím', async ({ page }) => {
    await page.goto('/builder/assets');

    const trigger = page.locator('button[aria-haspopup="listbox"]').first();
    await trigger.click();

    const list = page.getByRole('listbox');
    await expect(list).toBeVisible();

    // Mở ra là mục đang chọn được nhấn sẵn: Enter ngay không được đổi thư mục nào.
    const first = await list.getAttribute('aria-activedescendant');
    await expect(page.locator(`#${first}`)).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowDown');
    expect(
      await list.getAttribute('aria-activedescendant'),
      'mũi xuống không di chuyển — listbox không nhận được focus',
    ).not.toBe(first);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });

  test('cây thư mục hiện thư mục rỗng trên giao diện', async ({ page, request }) => {
    const path = `${RUN}-hien`;
    await createFolder(request, path);

    await page.goto('/builder/assets');
    /*
     * Khớp cả nhãn số đếm chứ không chỉ tên: node thư mục và nút menu "⋯" bên cạnh
     * nó đều mang tên thư mục trong tên khả truy cập, nên một regex chỉ có tên sẽ
     * trúng hai phần tử.
     *
     * "trống" chứ không phải "0": số 0 đọc như một lỗi tải dữ liệu.
     */
    await expect(page.getByRole('button', { name: `${path} trống`, exact: true })).toBeVisible();
  });
});
