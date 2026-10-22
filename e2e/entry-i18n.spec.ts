import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Đa ngôn ngữ cho entry: dịch, đặt đường dẫn riêng, và ĐĂNG RIÊNG từng bản.
 *
 * Spec này đi qua GIAO DIỆN, vì thứ vừa được thêm là giao diện: trước đó backend đã
 * nhận `i18n` từ lâu nhưng form chỉ in một dòng chỉ người dùng sang `/builder/text`
 * — một màn làm việc với bảng `Translation` khoá theo `pageId/nodeId/field`, không
 * biết entry là gì. Nói cách khác, đường ghi đã sống nhưng KHÔNG ai bấm tới được, và
 * một test API sẽ xanh trong khi người dùng vẫn không dịch được bài nào.
 *
 * ## Loại riêng, key riêng
 *
 * `bai-i18n`, không dùng chung `thong-bao` của `collection-admin.spec.ts` hay
 * `api-hop-dong` của `public-api.spec.ts`. Ba spec cùng chạm một loại nghĩa là thứ
 * tự chạy quyết định kết quả, và `Entry` là nguồn LIVE nên rác ở đây là một bài viết
 * giả trên site thật — xem docblock dọn dẹp của `collection-admin.spec.ts`.
 *
 * ## Điều kiện: phải có ít nhất một ngôn ngữ KHÁC đang bật
 *
 * Thanh tab chỉ hiện những ngôn ngữ `enabled` và không phải mặc định. DB chưa bật
 * ngôn ngữ nào thì không có gì để kiểm, nên spec `skip` với lý do nói rõ — thà bỏ
 * qua có lý do còn hơn một test xanh vì nó không kiểm gì.
 */

const TYPE_KEY = 'bai-i18n';

/** Dọn sạch loại của spec này và mọi bài của nó. An toàn khi chạy lại. */
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

let entryId = '';

test.beforeAll(async ({ request }) => {
  // Lần chạy trước có thể đã chết giữa đường. Dọn TRƯỚC, không chỉ sau.
  await purgeType(request);

  // Tạo loại rồi PATCH cấu trúc: `POST /types` chỉ nhận key/name/namePlural/icon/
  // singleton — cấu trúc field đi đường riêng.
  const type = await request.post('/api/collections/types', {
    data: { key: TYPE_KEY, name: 'Bài i18n', namePlural: 'Bài i18n' },
  });
  expect(type.ok(), await type.text()).toBeTruthy();

  const patched = await request.patch(`/api/collections/types/${TYPE_KEY}`, {
    data: {
      titleField: 'title',
      schema: [
        { t: 'text', key: 'title', label: 'Tiêu đề', required: true, maxLength: 200 },
        { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
      ],
    },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();

  const entry = await request.post(`/api/collections/${TYPE_KEY}/entries`, {
    // Slug gõ tường minh, không để server suy ra: spec này assert trên URL của bản
    // dịch, và một slug suy ra có thể mang hậu tố `-2` nếu lần chạy trước để lại rác.
    data: { data: { title: 'Lãi suất tháng 8', slug: 'lai-suat-thang-8' } },
  });
  expect(entry.ok(), await entry.text()).toBeTruthy();
  entryId = ((await entry.json()) as { entry: { id: string } }).entry.id;
});

test.afterAll(async ({ request }) => {
  await purgeType(request);
});

test.describe.configure({ mode: 'serial' });

/**
 * Tab ngôn ngữ đầu tiên không phải bản gốc.
 *
 * Nhắm theo `data-locale`, không theo nhãn: nhãn nằm trong bảng `Locale`, do người
 * dùng đặt và đổi được, nên một test nhắm nhãn sẽ đỏ vì một lần đổi tên vô hại.
 */
function localeTabs(page: Page) {
  return page.locator('[data-locale]:not([data-locale="base"])');
}

test('tab ngôn ngữ: dịch, đặt đường dẫn riêng, đăng riêng bản dịch', async ({ page }) => {
  await page.goto(`/builder/content/${TYPE_KEY}/${entryId}`);

  const tabs = localeTabs(page);
  test.skip((await tabs.count()) === 0, 'DB chưa bật ngôn ngữ nào ngoài ngôn ngữ mặc định');

  const tab = tabs.first();
  // Bài vừa tạo chưa dịch gì.
  await expect(tab).toContainText('0%');
  await tab.click();

  /*
   * Field `slug` của bản gốc phải BIẾN MẤT ở tab ngôn ngữ.
   *
   * Slug riêng nằm ở bảng `EntryLocale`, không nằm trong lớp phủ `i18n`. Nếu ô slug
   * gốc còn đây thì người dùng gõ vào một khoá không đường đọc nào nhìn vào — một ô
   * không có tác dụng, và không có gì trên màn hình nói ra điều đó.
   */
  await expect(page.getByRole('button', { name: 'Sửa tay' })).toHaveCount(0);

  await page.getByLabel('Tiêu đề').fill('August interest rates');
  await page.getByLabel('Đường dẫn riêng').fill('august-interest-rates');

  /*
   * Nút "Đăng" trong khối hành động ở ĐẦU CỘT PHẢI, và nó tác động lên đúng ngôn ngữ
   * đang mở — đó là thứ test này khẳng định.
   *
   * `exact: true` không còn để tránh nút "Lên sóng" (công tắc trạng thái trong cột
   * phải đã bị bỏ từ 04/09 — xem docblock của `EntryActions`), mà để tránh khớp
   * "Hẹn đăng <ngày>": nút tự đổi chữ khi mốc đăng ở tương lai, và một test khớp
   * lỏng sẽ xanh trong khi bấm vào một hành động khác.
   */
  await page.getByRole('button', { name: 'Đăng', exact: true }).click();
  await expect(page.getByText('đã lưu')).toBeVisible();

  // Nạp lại từ DB: thứ vừa ghi phải sống qua một lượt tải trang, không chỉ sống
  // trong state của React.
  await page.reload();
  const tabSau = localeTabs(page).first();
  /*
   * Assert theo '100%', KHÔNG theo `not.toContainText('0%')`.
   *
   * '100%' CHỨA chuỗi '0%', nên phép phủ định kia đỏ ngay khi bản dịch xong hoàn
   * toàn — tức nó đỏ đúng lúc mọi thứ đúng. Loại này chỉ có một field dịch được
   * (`title`; `slug` không thuộc lớp phủ), nên 100% là con số xác định.
   */
  await expect(tabSau).toContainText('100%');
  await tabSau.click();

  await expect(page.getByLabel('Tiêu đề')).toHaveValue('August interest rates');
  await expect(page.getByLabel('Đường dẫn riêng')).toHaveValue('august-interest-rates');
  await expect(page.getByText('đang trên site')).toBeVisible();

  /*
   * BẢN GỐC vẫn phải là NHÁP.
   *
   * Đây là phép kiểm chịu lực của cả tính năng: bài này chưa từng được đăng ở tab
   * Bản gốc, chỉ bản dịch được đăng. Nếu bản gốc cũng thành "đã đăng" thì hai trạng
   * thái đang dùng chung một cột và "publish riêng từng ngôn ngữ" chỉ là cái tên.
   */
  const list = await page.request.get(`/api/collections/${TYPE_KEY}/entries`);
  const { entries } = (await list.json()) as { entries: { id: string; status: string }[] };
  expect(entries.find((e) => e.id === entryId)?.status).toBe('draft');
});

test('hạ bản dịch xuống nháp không đụng tới đường dẫn riêng', async ({ page }) => {
  await page.goto(`/builder/content/${TYPE_KEY}/${entryId}`);

  const tabs = localeTabs(page);
  test.skip((await tabs.count()) === 0, 'DB chưa bật ngôn ngữ nào ngoài ngôn ngữ mặc định');
  await tabs.first().click();

  /*
   * Hạ xuống nháp giờ là MỘT nút, không phải chọn-rồi-lưu.
   *
   * Công tắc "Nháp / Lên sóng" trong cột phải đã bị bỏ (04/09) vì nó là bản thứ hai
   * của một quyết định đã có nút riêng — xem docblock của `EntryActions`. Đường thay
   * thế là "Gỡ khỏi site" trong khối Gỡ, và nó tự ghi luôn: `unpublish()` gửi ĐÚNG
   * `status`, không gửi nội dung và không gửi `publishedAt`.
   *
   * Chính vì thế test này vẫn kiểm được điều nó sinh ra để kiểm — đường dẫn riêng
   * không bị đụng tới — và giờ kiểm mạnh hơn: không còn một bước "Lưu nháp" có thể
   * vô tình ghi lại cả slug.
   */
  await page.getByRole('button', { name: 'Gỡ khỏi site' }).click();
  await expect(page.getByText('đã lưu')).toBeVisible();

  await page.reload();
  await localeTabs(page).first().click();
  await expect(page.getByText('nháp', { exact: true })).toBeVisible();

  // Hạ xuống nháp là đổi TRẠNG THÁI, không phải xoá cấu hình URL của ngôn ngữ đó.
  await expect(page.getByLabel('Đường dẫn riêng')).toHaveValue('august-interest-rates');
});
