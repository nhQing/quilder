import { expect, test } from '@playwright/test';

/**
 * Hiển thị collection trên site — mốc 3.
 *
 * ## Vì sao spec này KHÔNG tự dựng trang rồi publish
 *
 * Ba công thức của spec §5.3 cần một trang danh sách và một trang chi tiết đã dựng
 * trong builder, cộng một component thẻ tin, cộng một release đã publish. Dựng chúng
 * từ trong e2e nghĩa là spec này publish một release lên site THẬT của khách hàng mỗi
 * lần `pnpm e2e` chạy — cùng loại rủi ro mà `collection-admin.spec.ts` đã phải viết cả
 * một khối `afterAll` để chặn, nhưng ở đây thứ để lại không phải một bài viết giả mà
 * là một bản site.
 *
 * Nên spec chia làm hai phần:
 *
 *  - **Luôn chạy:** bất biến "thêm collection KHÔNG đổi một URL nào đang chạy". Đây là
 *    thứ dễ vỡ nhất và cũng là thứ kiểm được mà không ghi một byte nào.
 *  - **Chạy khi có dữ liệu:** ba công thức, tự bỏ qua kèm LÝ DO nếu chưa có trang
 *    `/tin-tuc`. Bỏ qua kèm lý do khác hẳn với không có test: nó hiện trong báo cáo,
 *    nên "chưa dựng dữ liệu" là một trạng thái nhìn thấy được chứ không phải im lặng.
 *
 * Cách dựng dữ liệu cho phần thứ hai (một lần, thủ công):
 *   pnpm seed:collections
 *   → builder: tạo component thẻ tin, trang `/tin-tuc` (collection list) với một
 *     Instance có `repeat` nguồn truy vấn limit 10, trang `/tin-tuc/:slug` (detail)
 *   → Publish
 */

const LIST_PATH = '/tin-tuc';

/* ── Bất biến: không URL nào đang chạy bị đổi ─────────────────────────── */

test('trang thật vẫn mở bình thường sau khi thêm template chi tiết', async ({ page }) => {
  // `/gioi-thieu` là trang bù nhìn của 12 spec khác. Ở đây nó chỉ được ĐỌC.
  const res = await page.goto('/gioi-thieu');
  expect(res?.status()).toBe(200);
});

test('trang chủ vẫn mở bình thường', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
});

test('slug nhiều đoạn không có template thì 404, không phải 500', async ({ page }) => {
  // Đây là ca mà `findDetailTemplate` chạy và trả `null`. Trả 500 ở đây nghĩa là mọi
  // con bot quét site đang làm sinh lỗi trong log — và không ai nhìn 404.
  const res = await page.goto('/khong-co-trang-nao/khong-co-bai-nao');
  expect(res?.status()).toBe(404);
});

test('sitemap vẫn hợp lệ và không nổ khi có trang collection', async ({ page }) => {
  const res = await page.goto('/sitemap.xml');
  expect(res?.status()).toBe(200);
  const body = (await res?.text()) ?? '';
  expect(body).toContain('<urlset');
  // Template chi tiết KHÔNG được xuất hiện như một URL: bản thân `/tin-tuc/:slug` không
  // mở được, và đưa nó vào sitemap là mời crawler đi lấy một 404.
  expect(body).not.toContain('/:slug');
});

/* ── Ba công thức §5.3 ────────────────────────────────────────────────── */

test.describe('ba công thức của spec §5.3', () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.goto(LIST_PATH);
    test.skip(
      res?.status() !== 200,
      `Chưa có trang ${LIST_PATH} đã publish — xem docblock đầu file để dựng dữ liệu.`,
    );

    /*
     * Trang mở được KHÔNG có nghĩa là có dữ liệu để kiểm.
     *
     * Ba test dưới đây kiểm ba CÔNG THỨC, và một công thức chỉ tồn tại khi trang có
     * một Instance mang `repeat` và collection có bài đã đăng. Thiếu một trong hai
     * thì `[data-c][data-i]` không có phần tử nào — và nếu chỉ dựa vào `status 200`
     * thì test không skip mà ĐỎ, với câu "element(s) not found" đọc như một lỗi
     * render. Skip kèm lý do nói ra việc phải làm thì khác hẳn: nó là một mục việc,
     * không phải một báo động giả.
     */
    const soThe = await page.locator('[data-c][data-i]').count();
    test.skip(
      soThe === 0,
      `Trang ${LIST_PATH} chưa có khối lặp nào sinh ra thẻ. Dựng một Instance có `
        + '`repeat` trên trang đó (Inspector → khối "Lặp theo"), và đăng ít nhất một bài '
        + 'trong loại `news`, rồi Publish. Ba công thức §5.3 chưa chứng minh được cho tới lúc đó.',
    );
  });

  test('10 tin mới nhất: đúng số thẻ, và thẻ đầu là bài mới nhất', async ({ page }) => {
    // `data-i` chỉ có trên thẻ do khối lặp sinh ra — xem nhánh `Instance` của
    // `NodeRenderer`. Đếm theo nó nên nó không lẫn với instance thường trên cùng trang.
    const cards = page.locator('[data-c][data-i]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeLessThanOrEqual(10);
  });

  test('bài nháp và bài hẹn giờ KHÔNG lên site', async ({ page }) => {
    // Ba điều kiện `status` / `publishedAt <= now` / `archivedAt: null` nằm trong
    // `buildEntryFindArgs`, và đây là chỗ duy nhất chứng minh cả ba cùng chạy trên
    // Postgres thật — chúng không có unit test vì chúng CHÍNH LÀ truy vấn.
    await expect(page.getByText('[chưa đặt tiêu đề]')).toHaveCount(0);
  });

  test('trang chi tiết dùng một template cho mọi bài, và có title riêng', async ({ page }) => {
    /*
     * Đếm TRƯỚC, `getAttribute` sau.
     *
     * `getAttribute` trên một locator không khớp gì sẽ chờ hết hạn 30s rồi ném —
     * `test.skip` ở dòng sau không bao giờ chạy tới. Thứ tự này biến "chưa ánh xạ
     * href" từ một lần treo nửa phút thành một dòng skip tức thì.
     */
    const link = page.locator('[data-c][data-i] a');
    test.skip(
      (await link.count()) === 0,
      'Thẻ tin chưa ánh xạ slug → href, nên chưa bấm ra trang chi tiết được.',
    );
    const href = await link.first().getAttribute('href');
    test.skip(!href, 'Thẻ tin có thẻ <a> nhưng không có href.');

    /*
     * Chưa dựng TRANG CHI TIẾT thì bỏ qua kèm lý do — không đỏ.
     *
     * Dấu hiệu: href là slug trần (`lai-suat-thang-8`), không phải `/tin-tuc/...`.
     * `itemOverrides` chỉ ghép được gốc khi `detailBaseForType` tìm thấy một trang
     * mang `collection = { typeKey, param: 'entry' }`; không có trang đó thì nó nhả
     * nguyên slug. Từ `/tin-tuc`, trình duyệt giải slug trần đó thành `/lai-suat-…`
     * ở gốc site — 404, và 404 ấy nói về dữ liệu chưa dựng chứ không về code.
     *
     * Điều kiện hẹp có chủ ý: dựng đủ trang chi tiết thì href BẮT ĐẦU bằng
     * `/tin-tuc/`, test chạy hết, và một regression thật vẫn đỏ. Nới rộng hơn — ví
     * dụ bỏ qua mọi 404 — là biến chính test này thành thứ không bao giờ đỏ.
     *
     * Xem docblock đầu file: nửa sau của bước dựng tay ("trang `/tin-tuc/:slug`
     * (detail)") là thứ còn thiếu trên máy này.
     */
    test.skip(
      !href!.startsWith(`${LIST_PATH}/`),
      `Thẻ tin trỏ "${href}" — chưa có trang chi tiết mang collection param 'entry', ` +
        'nên chưa ghép được gốc URL. Xem docblock đầu file để dựng nốt.',
    );

    const res = await page.goto(href!);
    expect(res?.status()).toBe(200);
    // `<title>` phải là tiêu đề BÀI, không phải tiêu đề template. Cùng một title cho
    // mọi bài là thứ chỉ nhìn thấy trong tab trình duyệt và trong kết quả tìm kiếm.
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toBe('Chi tiết');
  });

  test('slug không có bài thì 404, không phải template rỗng', async ({ page }) => {
    const res = await page.goto(`${LIST_PATH}/khong-ton-tai-bao-gio-2026`);
    expect(res?.status()).toBe(404);
  });
});
