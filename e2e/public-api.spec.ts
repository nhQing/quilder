import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Hợp đồng của `/api/public/v1` — bài kiểm mà mọi client ngoài builder dựa vào.
 *
 * ## Vì sao spec này tồn tại
 *
 * Trước nó, bốn route công khai KHÔNG có test nào; chỉ tầng đọc tham số
 * (`public-params.test.ts`) có. Hệ quả đo được ngày 28/08/2026, bằng tay, bằng curl:
 * bốn lỗi hợp đồng cùng sống trong nhánh đó — bản dịch còn nháp đi ra ngoài, cuid danh
 * mục đi ra ngoài, mảng rỗng trả `null`, `populate` một field taxonomy được nhận rồi
 * không làm gì. Không một lỗi nào trong bốn cái đó làm bất kỳ test nào đỏ.
 *
 * Nên spec này không kiểm "route có chạy không" — nó chốt những BẤT BIẾN mà FE dựng
 * code lên trên: hình dạng envelope, khoá hệ thống, "mảng luôn là mảng", "không id nội
 * bộ nào ra ngoài", mã lỗi máy đọc, và `?locale=` chỉ thấy bản dịch ĐÃ ĐĂNG. Đổi một
 * trong số đó là làm app ngoài kia vỡ, nên nó phải làm CI đỏ trước.
 *
 * ## Hai context, có chủ đích
 *
 * `pub` KHÔNG mang cookie: nó chứng minh namespace này mở thật, không phải đang chạy
 * nhờ phiên đăng nhập của `auth.setup.ts`. `request` (đã đăng nhập) chỉ dùng để DỰNG
 * dữ liệu qua đường ghi thật của admin.
 *
 * ## Dọn dẹp
 *
 * Cùng luật với `collection-admin.spec.ts`: `Entry` là nguồn LIVE, một spec để lại rác
 * là để một bài viết giả trên site thật. Dọn cả ở `beforeAll` (lần chạy trước có thể
 * đã chết giữa đường) lẫn `afterAll`, theo đúng thứ tự mà đường ghi bắt buộc: lưu trữ →
 * xoá hẳn → xoá loại.
 */

const TYPE_KEY = 'api-hop-dong';
const V1 = '/api/public/v1';

/** Khoá hệ thống — phải có mặt trong MỌI entry, ở cả hai endpoint. */
const RESERVED = ['id', 'slug', 'publishedAt', 'updatedAt', 'taxonomies'];

let pub: APIRequestContext;
let mainId = '';
let relatedId = '';
let taxonomyId = '';

async function purge(request: APIRequestContext): Promise<void> {
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

test.beforeAll(async ({ playwright, request }) => {
  pub = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
    // Không storageState: mọi lượt gọi công khai đi qua context này, KHÔNG cookie.
  });

  await purge(request);

  const created = await request.post('/api/collections/types', {
    data: { key: TYPE_KEY, name: 'Hợp đồng API', namePlural: 'Hợp đồng API' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  /*
   * Cấu trúc có đủ BA hình dạng mảng (`richtext`, `image multiple`, `relation many`)
   * cộng một field `taxonomy`.
   *
   * Ba hình dạng mảng là điều kiện để phép kiểm "mảng rỗng là `[]`, không phải `null`"
   * có nghĩa — một loại chỉ có `text` thì luật đó không có gì để chạm vào. Field
   * `taxonomy` là điều kiện để kiểm được rằng cuid danh mục KHÔNG đi ra ngoài.
   */
  const patched = await request.patch(`/api/collections/types/${TYPE_KEY}`, {
    data: {
      titleField: 'title',
      schema: [
        { t: 'text', key: 'title', label: 'Tiêu đề', required: true, maxLength: 200 },
        { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
        { t: 'richtext', key: 'sapo', label: 'Sapo' },
        { t: 'image', key: 'anh', label: 'Ảnh', multiple: true },
        { t: 'relation', key: 'lienquan', label: 'Liên quan', typeKey: TYPE_KEY, cardinality: 'many' },
        { t: 'taxonomy', key: 'cats', label: 'Danh mục', multiple: true },
      ],
    },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();

  const tax = await request.post('/api/collections/taxonomies', {
    data: { typeKey: TYPE_KEY, name: 'Nhóm kiểm thử' },
  });
  expect(tax.ok(), await tax.text()).toBeTruthy();
  taxonomyId = ((await tax.json()) as { taxonomy: { id: string } }).taxonomy.id;

  const mk = async (title: string) => {
    const r = await request.post(`/api/collections/${TYPE_KEY}/entries`, { data: { data: { title } } });
    expect(r.ok(), await r.text()).toBeTruthy();
    const { entry } = (await r.json()) as { entry: { id: string } };
    const up = await request.post(`/api/collections/entries/${entry.id}`, {
      data: { status: 'published' },
    });
    expect(up.ok(), await up.text()).toBeTruthy();
    return entry.id;
  };

  relatedId = await mk('Bài được trỏ tới');
  mainId = await mk('Bài chính');

  // Gắn quan hệ SAU khi cả hai đã có id — `populate` cần một id trỏ tới bài đã đăng.
  const rel = await request.patch(`/api/collections/entries/${mainId}`, {
    data: {
      data: { title: 'Bài chính', sapo: [{ t: 'text', v: 'Sapo' }], lienquan: [relatedId] },
      taxonomyIds: [taxonomyId],
    },
  });
  expect(rel.ok(), await rel.text()).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  await purge(request);
  await pub.dispose();
});

test.describe.configure({ mode: 'serial' });

test('không cần token: /types trả cấu trúc mọi loại', async () => {
  const r = await pub.get(`${V1}/types`);
  expect(r.status()).toBe(200);
  const body = (await r.json()) as {
    data: { key: string; fields: { key: string }[] }[];
    fieldGroups: unknown[];
  };
  const mine = body.data.find((t) => t.key === TYPE_KEY);
  expect(mine, 'loại vừa tạo phải xuất hiện ngay — cache có tag, không phải TTL cứng').toBeTruthy();
  expect(mine!.fields.map((f) => f.key)).toEqual(['title', 'slug', 'sapo', 'anh', 'lienquan', 'cats']);
  expect(Array.isArray(body.fieldGroups)).toBe(true);
});

test('danh sách: envelope {data, meta} và năm khoá hệ thống', async () => {
  const r = await pub.get(`${V1}/${TYPE_KEY}?pageSize=10`);
  expect(r.status()).toBe(200);
  const body = (await r.json()) as { data: Record<string, unknown>[]; meta: Record<string, number> };

  expect(Object.keys(body.meta).sort()).toEqual(['page', 'pageCount', 'pageSize', 'total']);
  expect(body.meta.total).toBe(2);
  for (const entry of body.data) {
    for (const k of RESERVED) expect(entry, `thiếu khoá ${k}`).toHaveProperty(k);
    // Field nằm PHẲNG — không có lớp `attributes` (Strapi v5 đã bỏ nó).
    expect(entry).not.toHaveProperty('attributes');
  }
});

test('mảng rỗng là [], không bao giờ null — kể cả khi biên tập viên chưa điền', async () => {
  // Lỗi đo ngày 28/08/2026: `ctas`, `zone`, `related` cùng trả `null` trong khi tài
  // liệu hứa `[]`. `null` ở đây đẩy phép kiểm sang MỌI client, và bản quên `?? []` vỡ
  // đúng lúc không ai đang xem log.
  const r = await pub.get(`${V1}/${TYPE_KEY}/bai-duoc-tro-toi`);
  const { data } = (await r.json()) as { data: Record<string, unknown> };
  expect(Array.isArray(data.sapo), 'richtext chưa điền').toBe(true);
  expect(Array.isArray(data.anh), 'image multiple chưa điền').toBe(true);
  expect(Array.isArray(data.lienquan), 'relation many chưa điền').toBe(true);
  // Scalar thì vẫn `null` — `[]` ở đó là một lời nói dối.
  expect(data.title).toBe('Bài được trỏ tới');
});

test('không id nội bộ nào ra ngoài: assetId và cuid danh mục', async () => {
  const r = await pub.get(`${V1}/${TYPE_KEY}?pageSize=100`);
  const text = await r.text();
  expect(text).not.toContain('assetId');
  expect(text).not.toContain('taxonomyId');
});

test('field taxonomy KHÔNG có khoá trong data — danh mục ra ngoài bằng KHOÁ', async () => {
  /*
   * Đo ngày 28/08/2026: `"cats":["cmt1gnf2u0004qfas2bm9af9s"]` đi ra ngoài, vì nhánh
   * `taxonomy` của `fieldOut` rơi vào `default: return raw`. Cùng loại rò với `assetId`
   * — một cuid nội bộ mà client sẽ lưu rồi phụ thuộc vào, và không ai gõ được.
   */
  const r = await pub.get(`${V1}/${TYPE_KEY}/bai-chinh`);
  const { data } = (await r.json()) as { data: Record<string, unknown> };
  expect('cats' in data, 'field taxonomy không được có khoá trong data').toBe(false);
  expect(data.taxonomies).toEqual([{ key: 'nhom-kiem-thu', name: 'Nhóm kiểm thử' }]);
  expect(await r.text()).not.toContain(taxonomyId);
});

test('cây danh mục: khoá cha là KHOÁ, và entryCount chỉ đếm bài đã đăng', async () => {
  const r = await pub.get(`${V1}/taxonomies/${TYPE_KEY}`);
  expect(r.status()).toBe(200);
  const { data } = (await r.json()) as {
    data: { key: string; name: string; parent: string | null; entryCount: number }[];
  };
  expect(data).toEqual([
    { key: 'nhom-kiem-thu', name: 'Nhóm kiểm thử', parent: null, entryCount: 1 },
  ]);
});

test('lọc theo danh mục bằng khoá; khoá không tồn tại trả danh sách RỖNG', async () => {
  const hit = await pub.get(`${V1}/${TYPE_KEY}?taxonomy=nhom-kiem-thu`);
  expect(((await hit.json()) as { meta: { total: number } }).meta.total).toBe(1);

  // Bỏ qua điều kiện thì `?taxonomy=go-sai` trả MỌI bài, và client tưởng danh mục đó
  // có mọi thứ — một lỗi im lặng, không phải một lỗi hiển thị.
  const miss = await pub.get(`${V1}/${TYPE_KEY}?taxonomy=go-sai`);
  expect(((await miss.json()) as { meta: { total: number } }).meta.total).toBe(0);
});

test('chỉ đọc: bốn method ghi đều 405', async () => {
  const url = `${V1}/${TYPE_KEY}`;
  expect((await pub.post(url)).status()).toBe(405);
  expect((await pub.put(url)).status()).toBe(405);
  expect((await pub.patch(url)).status()).toBe(405);
  expect((await pub.delete(url)).status()).toBe(405);
});

test('lỗi mang MÃ máy đọc, không chỉ một câu tiếng Việt', async () => {
  // Một client phân biệt "tham số sai" với "không có loại nội dung" bằng `code`. Nếu
  // chỉ có `error`, nó phải so khớp chuỗi tiếng Việt — và lần đầu ai đó sửa một dấu
  // phẩy trong câu là lần app ngoài kia rẽ nhánh sai, im lặng.
  const cases: [string, number, string][] = [
    [`${V1}/${TYPE_KEY}?sort=title:asc`, 400, 'bad_param'],
    [`${V1}/${TYPE_KEY}?format=xml`, 400, 'bad_param'],
    [`${V1}/${TYPE_KEY}?populate=title`, 400, 'bad_param'],
    [`${V1}/khong-co-loai-nay`, 404, 'unknown_type'],
    [`${V1}/${TYPE_KEY}/khong-co-slug`, 404, 'not_found'],
  ];
  for (const [url, status, code] of cases) {
    const r = await pub.get(url);
    expect(r.status(), url).toBe(status);
    const body = (await r.json()) as { error: string; code: string };
    expect(body.code, url).toBe(code);
    expect(body.error.length, url).toBeGreaterThan(0);
  }
});

test('ETag: gửi lại If-None-Match nhận 304 và không thân phản hồi', async () => {
  const first = await pub.get(`${V1}/${TYPE_KEY}`);
  const etag = first.headers()['etag'];
  expect(etag).toBeTruthy();
  const again = await pub.get(`${V1}/${TYPE_KEY}`, { headers: { 'if-none-match': etag! } });
  expect(again.status()).toBe(304);
  expect(await again.text()).toBe('');
});

test('fields cắt payload: chỉ field đã xin, cộng khoá hệ thống', async () => {
  const r = await pub.get(`${V1}/${TYPE_KEY}?fields=title`);
  const { data } = (await r.json()) as { data: Record<string, unknown>[] };
  expect(Object.keys(data[0]!).sort()).toEqual(['title', ...RESERVED].sort());
});

test('fields chỉ gồm khoá hệ thống: không field nội dung nào ra ngoài', async () => {
  // Đúng thứ một client cần để đồng bộ danh sách id mà không tải nội dung.
  const r = await pub.get(`${V1}/${TYPE_KEY}?fields=id,slug`);
  const { data } = (await r.json()) as { data: Record<string, unknown>[] };
  expect(Object.keys(data[0]!).sort()).toEqual([...RESERVED].sort());
});

test('populate mở đúng một cấp, và trả TÓM TẮT chứ không phải cả entry', async () => {
  const r = await pub.get(`${V1}/${TYPE_KEY}/bai-chinh?populate=lienquan`);
  const { data } = (await r.json()) as { data: { lienquan: Record<string, unknown>[] } };
  expect(data.lienquan).toHaveLength(1);
  expect(Object.keys(data.lienquan[0]!).sort()).toEqual(['id', 'publishedAt', 'slug', 'title']);
});

test.describe('?locale=', () => {
  const OVERLAY = 'BAN-DICH-CHUA-DUYET';
  const EN_SLUG = 'contract-en';

  test('bản dịch còn NHÁP không đi ra ngoài', async ({ request }) => {
    /*
     * Đây là lỗi nghiêm trọng nhất trong bốn cái đo được ngày 28/08/2026: `locale`
     * không được truyền vào `ctx` của `buildEntryFindArgs`, nên danh sách lọc theo
     * trạng thái đăng của BẢN GỐC rồi phủ nội dung bản dịch lên. Kết quả: nội dung
     * chưa ai duyệt phục vụ công khai với mã 200.
     */
    const set = await request.patch(`/api/collections/entries/${mainId}`, {
      data: { data: { title: 'Bài chính' }, i18n: { en: { title: OVERLAY } } },
    });
    expect(set.ok(), await set.text()).toBeTruthy();
    const draft = await request.post(`/api/collections/entries/${mainId}`, {
      data: { locale: 'en', status: 'draft' },
    });
    expect(draft.ok(), await draft.text()).toBeTruthy();

    const list = await pub.get(`${V1}/${TYPE_KEY}?locale=en&pageSize=100`);
    expect(await list.text()).not.toContain(OVERLAY);

    const one = await pub.get(`${V1}/${TYPE_KEY}/bai-chinh?locale=en`);
    expect(one.status()).toBe(404);
  });

  test('bản dịch ĐÃ ĐĂNG hiện ra, dưới slug riêng của nó', async ({ request }) => {
    const on = await request.post(`/api/collections/entries/${mainId}`, {
      data: { locale: 'en', status: 'published', slug: EN_SLUG },
    });
    expect(on.ok(), await on.text()).toBeTruthy();

    const list = await pub.get(`${V1}/${TYPE_KEY}?locale=en&pageSize=100`);
    const { data } = (await list.json()) as { data: { title: string; slug: string }[] };
    const mine = data.find((d) => d.title === OVERLAY);
    expect(mine, 'bản dịch đã đăng phải có trong danh sách').toBeTruthy();
    // Slug HIỆU LỰC của ngôn ngữ đó — trả slug gốc ở đây là để client tiếng Anh dựng
    // URL chi tiết bằng slug tiếng Việt rồi nhận 404.
    expect(mine!.slug).toBe(EN_SLUG);

    const one = await pub.get(`${V1}/${TYPE_KEY}/${EN_SLUG}?locale=en`);
    expect(one.status()).toBe(200);
    expect(((await one.json()) as { data: { title: string } }).data.title).toBe(OVERLAY);
  });

  test('bản dịch đã đăng sống sót khi bản GỐC bị tháo xuống', async ({ request }) => {
    // "Publish riêng từng ngôn ngữ" chỉ đúng một nửa nếu bản dịch chết theo bản gốc.
    const off = await request.post(`/api/collections/entries/${mainId}`, {
      data: { status: 'draft' },
    });
    expect(off.ok(), await off.text()).toBeTruthy();

    const en = await pub.get(`${V1}/${TYPE_KEY}/${EN_SLUG}?locale=en`);
    expect(en.status()).toBe(200);

    // Còn bản gốc thì đã biến mất khỏi API — nó đang là nháp.
    const vi = await pub.get(`${V1}/${TYPE_KEY}/bai-chinh`);
    expect(vi.status()).toBe(404);
  });
});
