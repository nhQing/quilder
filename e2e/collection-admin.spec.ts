import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Bài kiểm chứng cho metric thành công DUY NHẤT của dự án, áp cho nội dung: một
 * người không phải dev tạo được loại nội dung, thêm field, nhập bài, và đăng —
 * hết, không mở terminal.
 *
 * Spec này cố ý đi qua GIAO DIỆN chứ không gọi API: đường API đã có test riêng, và
 * thứ dễ vỡ là các bước bấm.
 *
 * ## Dọn dẹp, và vì sao nó khó hơn ở các spec khác
 *
 * `Entry` là nguồn LIVE: bấm Đăng là bài lên site thật ngay, không qua release.
 * Một spec để lại rác ở đây không chỉ làm test sau đếm sai (như rác component ở
 * `components.spec.ts`) — nó để một bài viết giả trên site của khách hàng. Xem
 * HANDOFF §3.25 và sự cố §3.35.
 *
 * Nên spec này chỉ chạm loại `thong-bao` của riêng nó, và `afterAll` dọn theo đúng
 * thứ tự mà đường ghi bắt buộc: lưu trữ → xoá hẳn từng bài → xoá loại. `deleteType`
 * TỪ CHỐI khi còn entry, nên một bước thiếu sẽ làm dọn dẹp FAIL rõ ràng thay vì im
 * lặng để lại rác.
 */

const TYPE_KEY = 'thong-bao';

/** Dọn sạch loại `thong-bao` và mọi bài của nó. An toàn khi chạy lại. */
async function purgeType(request: APIRequestContext): Promise<void> {
  const list = await request.get(`/api/collections/${TYPE_KEY}/entries`);
  if (list.ok()) {
    const { entries } = (await list.json()) as { entries?: { id: string }[] };
    for (const e of entries ?? []) {
      // Lưu trữ trước, rồi xoá hẳn: `purgeEntry` từ chối một entry chưa lưu trữ.
      await request.delete(`/api/collections/entries/${e.id}`);
      await request.delete(`/api/collections/entries/${e.id}?purge=1`);
    }
  }
  await request.delete(`/api/collections/types/${TYPE_KEY}`);
}

test.beforeAll(async ({ request }) => {
  // Lần chạy trước có thể đã chết giữa đường. Dọn TRƯỚC, không chỉ sau — nếu không
  // thì "tạo loại Thông báo" fail vì key đã bị chiếm, và lỗi đọc như một lỗi thật.
  await purgeType(request);
});

test.afterAll(async ({ request }) => {
  await purgeType(request);
});

test.describe.configure({ mode: 'serial' });

test('tạo loại nội dung, thêm field, nhập bài, đăng', async ({ page }) => {
  /*
   * `slow()` — ngân sách 90s thay vì 30s cho CẢ test; từng assert vẫn giữ mốc riêng.
   *
   * Test này đi qua năm route mà phần lớn chưa biên dịch lần nào trong lượt chạy, và
   * dev server biên dịch chúng ngay trong test. Đo ngày 09/10/2026 trong cả bộ: màn Cấu
   * trúc 6.2s, form nhập bài (CKEditor + chọn ảnh, 3265 module) 14.1s — cộng các route
   * còn lại là quá 30s, dù mọi bước đều xanh: bài đã được tạo và đăng, test hết giờ ở
   * bước đọc lại bảng. Đó là chậm của chế độ dev, không phải sai.
   */
  test.slow();
  await page.goto('/builder/content');

  // 1. Tạo loại mới
  // Dấu "+" là icon SVG (`aria-hidden`), không còn là chữ trong nhãn.
  await page.getByRole('button', { name: 'Tạo loại nội dung', exact: true }).click();

  /*
   * Nhắm TRONG hộp thoại, không nhắm cả trang.
   *
   * Màn này có hai `<dialog>` cùng nằm sẵn trong DOM — "Loại nội dung mới" và
   * "Nhóm field mới" — và cả hai đều có một ô nhãn "Tên". `getByLabel('Tên')` trần
   * khớp hai phần tử và Playwright từ chối ở chế độ strict. Nó ĐÚNG khi từ chối:
   * cái nào cũng có thể là cái ta muốn, và đoán bừa một trong hai là cách sinh ra
   * một test xanh nhờ may mắn.
   */
  const hopThoai = page.getByRole('dialog').filter({ hasText: 'Loại nội dung mới' });
  await hopThoai.getByLabel('Tên', { exact: true }).fill('Thông báo');
  await hopThoai.getByLabel('Tên số nhiều').fill('Thông báo');
  await hopThoai.getByRole('button', { name: 'Tạo', exact: true }).click();
  /*
   * 15s, không phải 5s mặc định.
   *
   * Bước này là POST tạo loại RỒI `router.push` sang màn cấu trúc — tức phải chờ một
   * transaction và một route chưa từng biên dịch trong lượt chạy này. Đo được: 16.3s
   * cho cả test khi chạy riêng, và trong cả bộ thì nút còn đứng ở "Đang tạo…" lúc mốc
   * 5s hết. Đó là chậm, không phải sai.
   *
   * Nới ĐÚNG dòng này chứ không đặt `expect.timeout` toàn cục: mọi assert khác trong
   * bộ vẫn nên đỏ nhanh. 15s là mốc mà repo đã dùng ở 22 chỗ cho cùng loại chờ.
   */
  await expect(page).toHaveURL(new RegExp(`/builder/content/types/${TYPE_KEY}$`), {
    timeout: 15_000,
  });

  /*
   * 2. Loại mới có sẵn Tiêu đề và Đường dẫn — không phải một màn trắng.
   *
   * Định vị bằng `data-field-row`, không bằng chữ trong nút.
   *
   * Bản trước dùng `getByRole('button').filter({ hasText: /^Tiêu đề\s*title/ })`, và
   * neo `^` ở đó có lý do thật: chuỗi `title` cũng nằm trong
   * `<option value="title">title — Tiêu đề</option>` của mấy ô select bên phải.
   * Nhưng neo vào ĐẦU chuỗi nghĩa là bám vào thứ tự các phần tử trong nút — và nó
   * vỡ đúng ngày ai đó thêm một tay cầm kéo `⠿` vào trước nhãn.
   *
   * Móc thì không vỡ vì một icon, và nó vẫn loại được `<option>`.
   */
  const fieldRow = (key: string) => page.locator(`[data-field-row="${key}"]`);
  await expect(fieldRow('title')).toContainText('Tiêu đề');
  await expect(fieldRow('slug')).toContainText('Đường dẫn');

  // 3. Nhập một bài và đăng
  await page.goto(`/builder/content/${TYPE_KEY}`);
  await page.getByRole('link', { name: 'Thêm mục', exact: true }).click();
  /*
   * Tên trợ năng của ô là "Tiêu đề *", không phải "Tiêu đề".
   *
   * `title` của một loại mới mang `required: true` (xem `createCollectionType`), và
   * `Label` trong `FieldInput` nối dấu bắt buộc vào TRONG `<label>`, nên nó thuộc tên
   * trợ năng và `exact: true` với 'Tiêu đề' không bao giờ khớp.
   *
   * Neo `^` chứ không bỏ hẳn độ chặt: nó vẫn loại "Phụ đề", và vẫn loại chuỗi
   * `title — Tiêu đề` trong `<option>` của các ô select bên phải (cùng cái bẫy mà
   * docblock ở bước 2 đã mô tả). Cố ý KHÔNG hardcode phần đuôi: dấu `*` từng nằm
   * trong tên (trình đọc màn hình đọc "Tiêu đề sao"), giờ nó `aria-hidden` và chỗ đó
   * là " (bắt buộc)". Selector này đúng ở cả hai thời điểm, và sẽ còn đúng nếu câu
   * chữ ấy đổi lần nữa.
   */
  await page.getByLabel(/^Tiêu đề/).fill('Bảo trì hệ thống ngày 25/08');
  // `exact: true` BẮT BUỘC: phép so tên của `getByRole` là chuỗi con, nên 'Đăng' khớp
  // cả nút "Đăng xuất" ở thanh nav — hai phần tử, và Playwright từ chối ở chế độ
  // strict. Cùng lý do `entry-i18n.spec.ts:123` đã phải neo exact.
  await page.getByRole('button', { name: 'Đăng', exact: true }).click();

  // 4. Bài hiện trong bảng với trạng thái đã đăng, và slug sinh từ tiêu đề
  await page.goto(`/builder/content/${TYPE_KEY}`);
  // Neo vào LINK tiêu đề, không `getByText`: từ giao diện v2 mỗi dòng có ô chọn với nhãn
  // ẩn "Chọn <tiêu đề>", và phép so chuỗi con của `getByText` khớp cả nhãn đó.
  await expect(page.getByRole('link', { name: 'Bảo trì hệ thống ngày 25/08', exact: true })).toBeVisible();
  /*
   * Neo vào Ô CỦA BẢNG, không tìm chuỗi slug trên cả trang.
   *
   * Khu API ở cuối màn in một URL mẫu dựng từ chính bài mới nhất
   * (`GET …/api/public/v1/thong-bao/bao-tri-he-thong-ngay-25-08`), nên một
   * `getByText` trần khớp HAI phần tử và Playwright từ chối ở chế độ strict.
   *
   * Bảng hiện slug dưới dạng đường dẫn (`/<slug>`), và `exact` khiến dòng URL dài
   * kia không khớp — nên phép so này vẫn nói đúng điều cần nói: hàng vừa tạo mang
   * slug sinh từ tiêu đề, có bỏ dấu.
   */
  await expect(page.getByText('/bao-tri-he-thong-ngay-25-08', { exact: true })).toBeVisible();
  await expect(page.getByText('đã đăng').first()).toBeVisible();
});

test('bốn pill lọc: số đếm là TỔNG, không phải số của trang', async ({ page }) => {
  await page.goto(`/builder/content/${TYPE_KEY}`);

  const all = page.getByRole('button', { name: /^Tất cả/ });
  const before = (await all.textContent()) ?? '';

  await page.getByRole('button', { name: /^Nháp/ }).click();
  await expect(page).toHaveURL(/status=draft/);

  // Con số trên pill KHÔNG đổi khi lọc: nó do server đếm trên toàn bộ loại. Đổi
  // theo bộ lọc nghĩa là "Nháp 3" sẽ hiện 1 khi hai bài kia ở trang sau.
  await expect(all).toHaveText(before);
});

test('nhóm lặp: sửa mục thứ nhất không đổi mục thứ hai', async ({ page }) => {
  // Lỗi kinh điển của clone cạn trong form lồng. `form-state.test.ts` đã bắt nó ở
  // tầng thuần; đây là bài kiểm chứng rằng đường dây từ UI xuống đó không đứt.
  await page.goto('/builder/content/news/moi');

  await page.getByRole('button', { name: /^Thêm đoạn cta$/i }).click();
  await page.getByRole('button', { name: /^Thêm đoạn cta$/i }).click();

  // Nhắm theo id dựng từ `path` (`f-ctas-0-heading`), không theo thứ tự DOM: hai ô
  // cùng nhãn "Tiêu đề" thì `getByLabel` trả cả hai, và `nth()` sẽ trỏ sai ngay khi
  // có ai đổi thứ tự field trong nhóm.
  const first = page.locator('#f-ctas-0-heading');
  const second = page.locator('#f-ctas-1-heading');

  /*
   * KHÔNG cần mở mục nào: `addAndOpen` mở mục vừa thêm.
   *
   * Trước 09/09/2026 `RepeatList` khởi tạo `open = new Set([0])` và thêm mục KHÔNG mở
   * nó, nên `#f-ctas-1-heading` không tồn tại trong DOM và test treo ở "waiting for
   * locator" — trông y như form hỏng. Bản vá đầu của tôi là bấm nút "Mở mục" trong
   * test; nó xanh nhưng để nguyên một bước thừa cho người dùng thật (bấm "Thêm" rồi
   * vẫn phải bấm lần nữa mới gõ được), nên hành vi đã được sửa ở nguồn thay vì ở đây.
   *
   * Hai mục đều mở là điều kiện tiên quyết của phép kiểm dưới: nếu một ngày mục mới
   * lại gập, hai dòng `fill` này đỏ ngay.
   */
  await first.fill('Đoạn một');
  await second.fill('Đoạn hai');

  await expect(first).toHaveValue('Đoạn một');
  await expect(second).toHaveValue('Đoạn hai');

  // Không lưu: test này kiểm state của form, và một bài nháp để lại là rác trên
  // loại `news` THẬT — loại này có bài của khách hàng, không phải của test.
});

test('Dynamic Zone: thêm ba khối khác loại, đổi thứ tự bằng ▲▼', async ({ page }) => {
  await page.goto('/builder/content/news/moi');

  // Nút thêm mang icon `plus`, không còn ký tự '+' trong nhãn (giao diện v2) — nên tên
  // trợ năng là đúng 'Thêm khối'.
  await page.getByRole('button', { name: 'Thêm khối', exact: true }).click();
  await page.getByRole('button', { name: 'quote', exact: true }).click();
  await page.getByRole('button', { name: 'Thêm khối', exact: true }).click();
  await page.getByRole('button', { name: 'figure', exact: true }).click();

  // Nhãn loại khối trên hàng là thứ DUY NHẤT phân biệt Dynamic Zone với một nhóm lặp.
  await expect(page.getByText('quote', { exact: true })).toBeVisible();
  await expect(page.getByText('figure', { exact: true })).toBeVisible();

  await page.locator('#f-zone-0-text').fill('Câu trích thử');
  await page.getByRole('button', { name: 'Xuống' }).first().click();

  // Sau khi xuống một bậc, khối quote nằm ở index 1 — và chữ đi theo nó.
  await expect(page.locator('#f-zone-1-text')).toHaveValue('Câu trích thử');
});

test('xoá danh mục: hộp xác nhận nói rõ hậu quả', async ({ page }) => {
  await page.goto('/builder/content/news/taxonomies');

  await page.getByRole('button', { name: 'Xoá' }).first().click();

  // Ba mệnh đề, không được thiếu mệnh đề nào: bao nhiêu bài bị gỡ, bài có bị xoá
  // không, và danh mục con đi đâu.
  await expect(page.getByText(/sẽ bị gỡ khỏi/)).toBeVisible();
  await expect(page.getByText(/không.*bị xoá/)).toBeVisible();
  await expect(page.getByText(/con sẽ thành danh mục gốc/)).toBeVisible();

  // Giữ lại — spec này kiểm CÂU CHỮ của hộp xác nhận, không kiểm việc xoá. Danh
  // mục của `news` là dữ liệu thật.
  await page.getByRole('button', { name: 'Giữ lại' }).click();
});
