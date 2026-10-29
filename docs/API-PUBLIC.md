# API công khai — `/api/public/v1`

Tài liệu cho team mobile và mọi client ngoài builder. Đọc hết một lượt là gọi được;
mục 7 (bất biến để FE không phải sửa theo backend) và mục 9 (điều **không** có) quan
trọng ngang bảy mục trên.

**Đừng gõ tay model.** `pnpm api:types` sinh sẵn `.d.ts` từ chính API — mục 7.1.

---

## 1. Hợp đồng

| Điều | Chi tiết |
|---|---|
| **Chỉ đọc** | Chỉ có `GET` và `OPTIONS`. Bốn method ghi trả **405**. Không `POST`/`PUT`/`PATCH`/`DELETE`, và sẽ không có. |
| **Chỉ nội dung đã đăng** | Một entry chỉ hiện khi `status = 'published'` **và** `publishedAt <= bây giờ` **và** chưa bị lưu trữ. Với `?locale=`, ba điều kiện đó đọc trên **bản dịch** — mục 8. |
| **Không auth** | Không cần token. Namespace không đọc cookie, nên không có phiên và không có bề mặt CSRF. |
| **Shape** | `{ "data": …, "meta": … }`. Field của entry nằm **phẳng** ngay trong object, **không** có lớp `attributes` lồng (Strapi v4 có, và chính Strapi v5 đã bỏ). |
| **Lỗi** | `{ "error": "câu tiếng Việt", "code": "bad_param" }` kèm 400, 404 (hoặc 500 khi một view cấu hình lỗi). **Rẽ nhánh theo `code`**, đừng so khớp `error` — mục 6. |
| **Mảng luôn là mảng** | Field hình dạng mảng chưa điền là `[]`, **không bao giờ** `null`. Field scalar chưa điền là `null`. Xem mục 3. |

Khoá **dành riêng** trong mỗi entry: `id`, `slug`, `publishedAt`, `updatedAt`,
`taxonomies`. Một field trùng tên bị che — `id` phải luôn là id của entry, nếu không
mọi client vỡ ở lần lưu đầu tiên.

---

## 2. Các endpoint

### 2.1 `GET /api/public/v1/types` — cấu trúc mọi loại nội dung

Dùng để sinh model ở client thay vì gõ tay (mục 7.1). Trả về `FieldDef[]` nguyên trạng,
kèm `fieldGroups` để giải nghĩa field kiểu `group` và `blocks`.

```bash
curl -s "http://localhost:3001/api/public/v1/types"
```

```jsonc
{
  "data": [
    {
      "key": "news", "name": "Tin tức", "namePlural": "Tin tức",
      "singleton": false, "titleField": "title", "slugField": "slug",
      "fields": [
        { "t": "text", "key": "title", "label": "Tiêu đề", "required": true },
        { "t": "richdoc", "key": "body", "label": "Thân bài" }
      ]
    }
  ],
  "fieldGroups": [{ "key": "quote", "fields": [ /* FieldDef[] */ ] }]
}
```

`singleton: true` = loại chỉ có **một** entry (trang Giới thiệu, một khối cấu hình).
Nó **không** có endpoint riêng: gọi endpoint danh sách và đọc `data[0] ?? null`.

### 2.2 `GET /api/public/v1/{typeKey}` — danh sách

| Tham số | Mặc định | Ghi chú |
|---|---|---|
| `page` | `1` | Không nhận `skip`. `skip` là chi tiết cài đặt; `page` × `pageSize` là thứ client hiểu. |
| `pageSize` | `20` | **Trần 100.** Vượt trần thì bị *kẹp*, không bị từ chối. |
| `sort` | `publishedAt:desc` | Chỉ bốn cột: `publishedAt`, `updatedAt`, `createdAt`, `slug`. Lặp lại tham số để sắp nhiều cấp. |
| `filter[field][op]` | — | `op` ∈ `eq, ne, gt, gte, lt, lte, contains`. Nhiều điều kiện nối **AND**. Field kiểu `slug` **không** lọc được (mục 9). |
| `taxonomy` | — | **Khoá** danh mục (`tin-thi-truong`), không phải id. |
| `locale` | ngôn ngữ gốc | Mục 8 — nó đổi cả phép lọc "đã đăng", không chỉ đổi chữ. |
| `format` | `json` | `json` hoặc `html` — xem mục 4. |
| `fields` | mọi field | Danh sách field cần, cách nhau bằng dấu phẩy. Cắt payload — xem dưới. |
| `populate` | — | Danh sách field `relation` (chỉ `relation`), cách nhau bằng dấu phẩy. Tối đa 5. Mỗi bản ghi đích ra **tóm tắt** `{ id, slug, title, publishedAt }`. |
| `populate[field]` | — | Như `populate`, cộng thêm các field **của bản ghi đích** cần lấy: `populate[faqs]=title,answer`. Tối đa 10 field mỗi quan hệ — xem dưới. |

```bash
curl -s "http://localhost:3001/api/public/v1/news?pageSize=5&taxonomy=tin-thi-truong&sort=publishedAt:desc"
```

```jsonc
{
  "data": [
    {
      "title": "Lãi suất tháng 8",
      "body": [ /* mảng khối richdoc */ ],
      "cover": { "url": "https://cdn/…", "width": 1600, "height": 900,
                 "blurhash": "LKO2…", "mime": "image/webp", "alt": "Ảnh bìa" },
      "ctas": [], "zone": [], "related": [],
      "id": "clx…", "slug": "lai-suat-thang-8",
      "publishedAt": "2026-08-01T02:00:00.000Z",
      "updatedAt": "2026-08-02T09:11:00.000Z",
      "taxonomies": [{ "key": "tin-thi-truong", "name": "Tin thị trường" }]
    }
  ],
  "meta": { "page": 1, "pageSize": 5, "total": 42, "pageCount": 9 }
}
```

**`?fields=` — client quyết payload.** Không có nó, một màn danh sách chỉ cần tiêu đề và
ảnh bìa vẫn tải cả thân bài: đo được **127KB cho 100 bài**, phần lớn là `body`.

```bash
# chỉ tiêu đề + ảnh bìa; khoá hệ thống LUÔN có, không cần xin
curl -s "http://localhost:3001/api/public/v1/news?fields=title,cover&pageSize=100"

# chỉ khoá hệ thống — đồng bộ danh sách id mà không tải nội dung
curl -s "http://localhost:3001/api/public/v1/news?fields=id"
```

`populate` một field mà `fields` không xin thì **400**: tự thêm vào là trả nhiều hơn
bạn hỏi, bỏ qua là trả ít hơn — im lặng. Xin cả hai: `?fields=title,related&populate=related`.

**`?populate[field]=a,b` — lấy vài field của bản ghi được liên kết.** Khi một bài trỏ tới
bản ghi của loại khác (FAQ, sản phẩm, chuyên gia…), dạng phẳng `populate=faqs` chỉ cho
tóm tắt. Dạng ngoặc cho thêm đúng các field bạn xin, đã qua cùng phép chiếu như field của
bài (ảnh thành `{ url, width, … }`, `richtext` theo `format`, bản dịch theo `locale`):

```bash
curl -sg "http://localhost:3001/api/public/v1/news?fields=title,faqs&populate[faqs]=title,answer&format=html"
```

```jsonc
{ "title": "Chứng chỉ quỹ mở là gì?",
  "faqs": [
    { "title": "Phí quản lý là bao nhiêu?", "answer": "0,5%/năm, <strong>không phí ẩn</strong>",
      "id": "clx…", "slug": "phi-quan-ly-la-gi", "publishedAt": "2026-09-01T00:00:00.000Z" }
  ], … }
```

- Bốn khoá tóm tắt luôn có và **thắng** field trùng tên.
- Field xin được: `text`, `richtext`, `number`, `boolean`, `date`, `enum`, `image`, `file`,
  `link`, `slug`. **Không** xin được `richdoc`/`html` (thân bài), `group`/`blocks`/`json`
  (không có trần kích thước), `relation` (cấp thứ hai), `taxonomy`, `seo` — 400 kèm lý do.
- Field không có ở loại đích, danh sách rỗng, hoặc cùng một quan hệ xin bằng cả hai dạng:
  400.
- Dùng `curl -g` (hoặc mã hoá `[` `]` thành `%5B` `%5D`): không có `-g`, curl hiểu ngoặc
  vuông là mẫu và không gửi request.

**Sai tham số thì 400 kèm câu giải thích và một `code`**, không im lặng bỏ qua:

```bash
curl -s "http://localhost:3001/api/public/v1/news?sort=title:asc"
# {"error":"Không sắp xếp được theo \"title\" — chỉ nhận publishedAt, updatedAt, createdAt, slug","code":"bad_param"}
curl -s "http://localhost:3001/api/public/v1/news?filter[title][regex]=.*"
# {"error":"Toán tử \"regex\" không hợp lệ; chỉ nhận eq, ne, gt, gte, lt, lte, contains","code":"bad_param"}
```

Lý do phải từ chối chứ không bỏ qua: một điều kiện bị bỏ im lặng nghĩa là API trả về
**nhiều hơn** thứ bạn hỏi — ở một API công khai, đó là rò dữ liệu, không phải một lỗi
hiển thị.

`?taxonomy=` trỏ tới một danh mục không tồn tại trả **danh sách rỗng**, không phải mọi
bài.

### 2.3 `GET /api/public/v1/{typeKey}/{slug}` — một entry

Nhận `format`, `locale`, `fields`, `populate` với nghĩa giống hệt endpoint danh sách.

```bash
curl -s "http://localhost:3001/api/public/v1/news/lai-suat-thang-8?format=html"
```

Trả `{ "data": { … } }`. **404** (`code: "not_found"`) cho cả ba trường hợp "không có",
"còn nháp", "hẹn giờ chưa tới" — phân biệt chúng là nói cho người ngoài biết có một bài
chưa đăng.

Với `?locale=`, `{slug}` là **slug của ngôn ngữ đó** khi bản dịch có slug riêng, và rơi
về slug gốc khi chưa có. Endpoint danh sách trả đúng slug ấy ở khoá `slug`, nên đường
đúng luôn là: lấy `slug` từ danh sách, ghép vào URL chi tiết.

### 2.4 `GET /api/public/v1/taxonomies/{typeKey}` — cây danh mục

```bash
curl -s "http://localhost:3001/api/public/v1/taxonomies/news"
```

```jsonc
{ "data": [
  { "key": "tin-thi-truong", "name": "Tin thị trường", "parent": null, "entryCount": 12 },
  { "key": "lai-suat", "name": "Lãi suất", "parent": "tin-thi-truong", "entryCount": 5 }
] }
```

`parent` là **khoá** của danh mục cha, không phải id. `entryCount` chỉ đếm bài đã đăng
và đã tới mốc — con số nói cho bạn có bao nhiêu bài **chưa** công bố cũng là một dạng
rò dữ liệu. Loại không có danh mục nào trả `data: []`, không phải 404.

### 2.5 `GET /api/public/v1/views/{key}[/{slug}]` — view đặt sẵn

Một **view** là bộ tham số đầy đủ (`fields`, `populate[…]`, `sort`, `pageSize`, `filter`…)
mà admin lưu dưới một khoá ngắn, ở builder → Kho dữ liệu → **View của API**. App chỉ gọi
khoá; server áp bộ tham số đã lưu **trong cùng một lượt** (không redirect) rồi đi đúng
endpoint danh sách / chi tiết của loại, nên mọi luật ở trên áp nguyên.

```bash
# view "mobile-news" = /news?fields=title,cover,faqs&populate[faqs]=title,answer&pageSize=20
curl -s "http://localhost:3001/api/public/v1/views/mobile-news?page=2&locale=en"
curl -s "http://localhost:3001/api/public/v1/views/mobile-news/chung-chi-quy-mo-la-gi"
```

- **App gửi thêm được gì** do từng view quyết, trong tập: `page`, `pageSize`, `locale`,
  `taxonomy`, `sort`, `filter`, `format`. Tham số khác → **400** `bad_param`, không bị bỏ qua
  im lặng.
- `fields` và `populate` **không bao giờ** đổi được từ app: đó là phần view cố định.
- `filter[…]` của app **cộng thêm** (AND) vào filter đã lưu, không thay — view không bị nới
  ra. `sort` của app thay cả danh sách sort đã lưu. Tham số còn lại thay giá trị đã lưu.
- Endpoint chi tiết dùng cùng `fields`/`populate` với danh sách, nên màn chi tiết nhận đúng
  hình dạng màn danh sách đã nhận.
- Khoá không có → **404** `unknown_view`. Bộ tham số đã lưu không còn hợp với cấu trúc loại
  (field vừa bị xoá…) → **500** `view_invalid`: lỗi cấu hình, báo admin sửa view, không
  phải sửa app.
- Đổi khoá hoặc xoá view làm app đang gọi khoá đó nhận 404 ngay.

---

## 3. <!-- gen:field-count -->18<!-- /gen --> field type → hình dạng JSON

**Luật giá trị rỗng, theo KIỂU field** — đây là thứ quyết định bộ decode của bạn có phải
kiểm `null` hay không:

| Hình dạng | Chưa điền là | Gồm những kiểu |
|---|---|---|
| Mảng | `[]` | `richtext`, `richdoc`, `blocks`, `image` (`multiple`), `group` (`repeatable`), `relation` (`many`) |
| Chuỗi HTML (`?format=html`) | `""` | `richtext`, `richdoc` |
| Chuỗi HTML (mọi format) | `""` | `html` |
| Object / scalar | `null` | mọi kiểu còn lại |

Field khai trong schema mà entry chưa điền **luôn có mặt** với giá trị rỗng của kiểu đó,
nên bộ decode có kiểu chặt (Swift, Kotlin) không cần khai optional cho mọi khoá, và
không cần `?? []` cho mảng.

| `t` | JSON trả về (`format=json`) | Với `format=html` |
|---|---|---|
| `text` | `string` | như cũ |
| `richtext` | `InlineNode[]` — mảng **inline**: `{t:'text',v}`, `strong`, `em`, `br`, `link`, `split`, `counter`, `bind` | `string` HTML inline |
| `richdoc` | `Block[]` — mảng **khối**: `{b:'p'|'h2'|'h3'|'h4', children: InlineNode[]}`, `{b:'ul'|'ol', items:[{children}]}`, `{b:'quote',children}`, `{b:'figure', image, alt, caption?}`, `{b:'hr'}` | `string` HTML có `<p>`, `<h2>`, `<ul>`, `<figure>` |
| `html` | `string` HTML đã làm sạch (sanitize lại ở đường đọc, iframe chỉ từ host cho phép) | như cũ |
| `number` | `number` | như cũ |
| `boolean` | `boolean` | như cũ |
| `date` | `string` ISO-8601 | như cũ |
| `enum` | `string` (một trong `options[].value`) | như cũ |
| `image` | object ảnh (mục 5); `multiple: true` → mảng ảnh | như cũ |
| `file` | object ảnh (cùng hình dạng) | như cũ |
| `slug` | `string` | như cũ |
| `relation` | `string` id, hoặc `string[]` khi `cardinality: 'many'`; có `populate` thì thành object tóm tắt | như cũ |
| `taxonomy` | **KHÔNG có khoá này trong object** — đọc ở khoá `taxonomies` cấp entry | — |
| `link` | `string` | như cũ |
| `group` | object; `repeatable: true` → mảng object | như cũ |
| `blocks` | mảng object, **mỗi phần tử có `__type`** nói nó là khối gì | như cũ |
| `json` | nguyên trạng, không biến đổi | như cũ |
| `seo` | object `SeoValue` (xem dưới), hoặc `null` khi bài chưa đặt ô SEO nào | như cũ |

**Field `seo`** (từ 21/10/2026) — bộ SEO riêng của bài. Đây là **giá trị ghi đè**, không
phải giá trị site đang dùng: ô trống thì site tự suy ra (tiêu đề bài, sapo, ảnh đầu tiên),
nên client cần tiêu đề hiệu lực thì tự làm `seo.metaTitle ?? title`.

```ts
{
  metaTitle: string | null;
  metaDescription: string | null;
  keywords: string | null;
  ogImage: Asset | null;          // object ảnh như mục 5, không phải assetId
  canonicalUrl: string | null;    // ĐƯỜNG DẪN trên site, ví dụ "/blogs/post/abc"
  noindex: boolean;
  structuredData: object | object[] | null;   // JSON-LD tự khai
}
```

Có object thì mọi khoá đều có mặt. Với `?locale=en`, đây là giá trị **của bản tiếng
Anh**: chữ, `canonicalUrl`, `noindex`, `structuredData` không kế thừa bản tiếng Việt; chỉ
`ogImage` kế thừa khi bản tiếng Anh chưa chọn ảnh riêng.

Field `taxonomy` **vắng mặt hoàn toàn**, không phải trả `null`: giá trị của nó không
sống trong `data` (liên kết ở bảng nối), và những hàng cũ còn sót id danh mục trong JSONB
thì id đó bị chặn lại — cùng luật với `assetId` ở mục 5.

`richtext` và `richdoc` **không thay thế nhau được**: `richtext` chỉ có inline (dùng cho
sapo, nhãn), `richdoc` thêm một tầng khối (dùng cho thân bài). Dựng `richdoc` bằng một
renderer inline là mất hết đoạn, tiêu đề, danh sách và ảnh — im lặng.

Khối `figure` của `richdoc` trả `image` là object ảnh (mục 5) hoặc `null`, **không bao
giờ** trả `assetId`.

---

## 4. `?format=html` — khi nào dùng

**Dùng** nếu client không muốn tự dựng cây `RichText`/`RichDoc`: bạn nhận một chuỗi HTML
đã escape, nhét vào một WebView hoặc một widget HTML là xong.

**Không dùng** nếu bạn muốn chữ theo hệ thống kiểu dáng của app: cây JSON cho bạn quyền
quyết định từng node render bằng component nào, còn HTML thì buộc bạn style bằng CSS.

Bảo đảm của `format=html`:

- Mọi chữ do người nhập đều được escape. `<script>` trong tiêu đề ra thành
  `&lt;script&gt;`.
- `href` mang scheme `javascript:`, `data:`, `vbscript:` bị thay bằng `#`. Hai lớp có
  chủ đích — dữ liệu lưu **trước** khi luật đó tồn tại vẫn có thể mang scheme xấu.
- `split` và `counter` phẳng thành chữ (chúng là hiệu ứng của website, không phải nội
  dung), `bind` phẳng thành `fallback` (API không có ngữ cảnh binding).
- Field `richtext`/`richdoc` chưa điền là `""`, không phải `null`.

---

## 5. Ảnh

```jsonc
{ "url": "https://cdn/x.webp", "width": 1600, "height": 900,
  "blurhash": "LKO2…", "mime": "image/webp", "alt": "Ảnh bìa" }
```

- **`assetId` cố ý không có, ở bất kỳ đâu.** Client không nên phải biết bảng `Asset` tồn
  tại, và một id nội bộ đi ra ngoài là mời client lưu nó rồi phụ thuộc vào nó.
- **`blurhash`** để dựng placeholder mượt mà không cần thêm một lượt gọi.
- **Ảnh đã bị xoá → cả field là `null`**, không phải một object nửa vời. `if (cover)` là
  phép kiểm đúng; `{ url: undefined }` thì lọt qua rồi vỡ lúc render.
- Với `image` `multiple`, ảnh đã xoá bị **loại khỏi mảng**, không để lại lỗ `null`.

---

## 6. Lỗi: rẽ nhánh theo `code`

```jsonc
{ "error": "Không có loại nội dung \"tin-tucc\"", "code": "unknown_type" }
```

| `code` | HTTP | Nghĩa |
|---|---|---|
| `bad_param` | 400 | Tham số không hợp lệ. Sửa URL. |
| `unknown_type` | 404 | Không có loại nội dung đó. Đọc lại `/types`. |
| `not_found` | 404 | Không có nội dung đó (hoặc còn nháp, hoặc hẹn giờ chưa tới — API cố ý không phân biệt). |
| `unknown_view` | 404 | Không có view đó (mục 2.5). |
| `view_invalid` | 500 | View đã lưu không còn đọc được trên cấu trúc loại hiện tại. Lỗi cấu hình phía builder — báo admin. |

`error` là câu cho **người đọc** và được phép đổi chữ bất cứ lúc nào; `code` là tập
**đóng** và không đổi. Client so khớp chuỗi tiếng Việt sẽ rẽ nhánh sai đúng vào lần ai đó
sửa một dấu phẩy trong câu.

---

## 7. Để FE không phải sửa theo mỗi lần backend đổi

### 7.1 Sinh kiểu từ chính API — `pnpm api:types`

```bash
# đọc localhost:3001, ghi generated/public-api.d.ts
pnpm api:types

# chỉ vào server thật và thẳng vào repo mobile
pnpm api:types --url https://<site>/api/public/v1/types --out ../mobile/src/api.d.ts
```

Sinh ra: một `interface` cho mỗi loại nội dung (kèm `EntrySystemKeys`), một cho mỗi nhóm
field, `enum` thành **union literal**, `blocks` thành **union có thẻ `__type`**, cộng
`ListResponse<T>`, `OneResponse<T>`, `PublicError`, `HtmlOf<T>` và bảng tra
`PublicEntry[key]`.

Vì sao đây là đòn chính: một biên tập viên đổi cấu trúc lúc 10 giờ sáng không sửa tài
liệu. Sinh kiểu từ API biến chuyện đó thành **lỗi biên dịch** ở client ngay lúc chạy lại
script, thay vì một ô trắng trên app. Chạy nó trong CI của client và so với file đã commit
là có luôn một máy báo động cho "backend đổi cấu trúc".

Bảng tra dùng để một hàm gọi API có kiểu chặt mà không khai lại từng loại:

```ts
import type { ListResponse, PublicCollectionKey, PublicEntry } from './api';

async function list<K extends PublicCollectionKey>(
  key: K, qs = '',
): Promise<ListResponse<PublicEntry[K]>> {
  const r = await fetch(`${BASE}/api/public/v1/${key}?${qs}`);
  if (!r.ok) throw Object.assign(new Error('API lỗi'), await r.json());
  return r.json();
}
```

### 7.2 Bảy bất biến — được test khoá lại, không phải lời hứa

`e2e/public-api.spec.ts` chốt từng cái; đổi một cái là CI đỏ trước khi app ngoài kia vỡ:

1. Envelope `{data, meta}`; `meta` chỉ được **thêm** khoá, không đổi tên.
2. Field nằm **phẳng**, không có lớp `attributes`.
3. Năm khoá hệ thống luôn có mặt trong mọi entry.
4. Mảng luôn là mảng; scalar chưa điền là `null` (mục 3).
5. Không id nội bộ nào ra ngoài: `assetId`, id danh mục, id asset trong `richdoc`.
6. Lỗi luôn có `code` thuộc tập đóng.
7. `?locale=` chỉ thấy bản dịch **đã đăng**, và trả slug của chính ngôn ngữ đó.

### 7.3 Chính sách phiên bản

`v1` chỉ **thêm**: field mới, tham số mới, khoá mới trong `meta`. Đổi tên hoặc đổi kiểu
một khoá đã có ⇒ `/api/public/v2`, phục vụ song song. Nên client bỏ qua khoá lạ thay vì
từ chối chúng (đừng bật chế độ "unknown key là lỗi" trong bộ decode).

Một điều **không** ổn định: khoá của field do người dùng đặt trong builder. Đổi khoá field
là đổi hợp đồng — về phía builder, ô khoá bị khoá lại sau lần lưu đầu, nhưng người ta vẫn
xoá được field. Nên `pnpm api:types` trong CI là chỗ phát hiện.

---

## 8. `?locale=` — nhiều hơn một phép đổi chữ

Bản dịch **publish riêng** từng ngôn ngữ. Nên `?locale=en` đổi ba thứ cùng lúc:

1. **Phép lọc "đã đăng"** đọc trên hàng của ngôn ngữ đó, không phải trên bản gốc. Bản
   tiếng Anh còn nháp thì **không hiện**, dù bản gốc đã đăng. Ngược lại, bản tiếng Anh đã
   đăng **vẫn hiện** dù bản gốc đã bị tháo xuống.
2. **`slug`** trả về là slug của ngôn ngữ đó (rơi về slug gốc khi chưa đặt riêng), và
   endpoint chi tiết tra theo đúng slug ấy.
3. **`publishedAt`** là mốc đăng của bản dịch, không phải của bản gốc.

Field nào chưa dịch thì giữ nguyên bản gốc — bản dịch là **lớp phủ**, không phải bản sao.

Mã ngôn ngữ đi qua một danh sách hình dạng (`vi`, `en-US`, `zh-Hant-TW`); chuỗi tuỳ ý bị
400.

**Hạn chế phải biết:** `sort` vẫn sắp theo cột của **bản gốc** (`Entry.publishedAt`).
Postgres không `orderBy` được theo một hàng quan hệ trong cùng truy vấn, nên với
`?locale=en&sort=publishedAt:desc`, thứ tự là thứ tự đăng của bản gốc trong khi
`publishedAt` hiển thị là mốc của bản dịch. Hai mốc thường trùng; khi chúng lệch nhau và
bạn cần đúng thứ tự của bản dịch, sắp ở client.

---

## 9. Cache và ETag

Mỗi phản hồi mang:

```
etag: W/"…"
cache-control: public, s-maxage=60, stale-while-revalidate=300
```

`s-maxage` là chỉ dẫn cho **CDN**, không phải cho app: nội dung có thể cũ tối đa 60 giây
sau khi biên tập viên đăng bài. `/types` và `/taxonomies` dùng 300 giây vì chúng đổi
hiếm hơn hàng chục lần.

Gửi lại ETag để nhận `304 Not Modified` và không tải lại thân phản hồi:

```bash
ETAG=$(curl -sI "http://localhost:3001/api/public/v1/news" | grep -i '^etag' | cut -d' ' -f2 | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" "http://localhost:3001/api/public/v1/news"
# 304
```

Với một danh sách 100 bài, đó là vài trăm KB tiết kiệm cho **mỗi lần mở app**.

Phía server: `/types` và `/taxonomies/{typeKey}` được cache theo **tag** (không phải TTL
cứng), nên một lần sửa cấu trúc hay một lần đăng bài làm chúng mới lại ngay. Hệ quả duy
nhất còn lại: `entryCount` của một bài **hẹn giờ** đúng muộn nhất 300 giây sau mốc.
Endpoint danh sách **không** cache theo query string — một khoá cache sinh từ tham số tuỳ
ý là một cache không bao giờ trúng, và ở một namespace mở nó còn là cửa để người ngoài
phình cache bằng tham số rác.

**CORS**: chỉ cần khi gọi từ trình duyệt. Origin được phép khai ở biến môi trường
`PUBLIC_API_ORIGINS` (danh sách cách nhau bằng dấu phẩy, hoặc `*`). App mobile không gửi
`Origin` nên không bị ảnh hưởng.

---

## 10. Điều **không** có, và không nên chờ

Mục này quan trọng ngang chín mục trên: thiếu nó thì sẽ có người dựng kế hoạch quanh một
thứ không tồn tại.

| Không có | Vì sao |
|---|---|
| **Ghi** (`POST`/`PUT`/`PATCH`/`DELETE`) | Namespace này là một **ranh giới bảo mật**, không phải một API chưa làm xong. Không session ⇒ không CSRF. Nội dung được tạo trong builder, bởi người. |
| **Webhook** | Chưa có yêu cầu thật. Dùng `If-None-Match` và nhịp poll thưa. |
| **GraphQL** | Một bề mặt truy vấn thứ hai nghĩa là hai chỗ cưỡng chế "chỉ bài đã đăng", và chỗ bị quên sẽ là chỗ rò. |
| **Realtime / SSE** | Xem spec §12. |
| **Quyền theo field** | Mọi field trong schema là công khai. Đừng để dữ liệu nhạy cảm vào một collection type. |
| **Endpoint riêng cho `singleton`** | Gọi endpoint danh sách và đọc `data[0] ?? null`. Một endpoint thứ hai cho cùng dữ liệu là hai chỗ cưỡng chế "chỉ bài đã đăng". |
| **Sắp theo field trong `data`** | Prisma không `orderBy` được theo đường dẫn trong JSONB. Sắp theo tên bài xấp xỉ được bằng `slug`, vì slug sinh từ tiêu đề. |
| **Lọc theo field kiểu `slug`** | 400, có chủ đích: slug hiệu lực nằm ở **cột** `Entry.slug`, còn `data.slug` chỉ có khi biên tập viên gõ tay ô đó — nên một filter JSONB khớp *một số* bài và bỏ sót số còn lại. Một filter đúng một phần không ai phát hiện được. Lấy một bài theo slug là việc của endpoint chi tiết. |
| **`populate` field `taxonomy`** | 400. Danh mục vốn đã đi kèm mỗi entry ở khoá `taxonomies` (`key` + `name`), nên không có gì để mở thêm. |
| **`populate` sâu hơn một cấp** | Populate tuỳ ý sâu là cách chắc chắn nhất để một client làm sập DB bằng một URL. `populate` mở đúng một cấp và trả một **tóm tắt** (`id`, `slug`, `title`, `publishedAt`), cộng các field nhẹ bạn xin bằng `populate[field]=…` — không phải cả entry. Entry được trỏ tới cũng phải đã đăng **ở ngôn ngữ đang phục vụ**; nếu chưa, nó ra `null` (hoặc bị loại khỏi mảng). |
| **`OR` trong filter** | v1 chỉ có `AND`. Chưa có yêu cầu thật nào cần. |
| **Tìm kiếm toàn văn** | `filter[…][contains]` là tìm chuỗi con, không phải FTS. |
| **Rate limit** | Chưa có. Trần payload có (`pageSize` 100, `populate` 5 và một cấp), nhưng không có trần theo IP. Nếu mở ra Internet cho một app thật thì nên đặt ở tầng trước (CDN/nginx), không ở route. |

Chi tiết đầy đủ: `docs/superpowers/specs/2026-08-20-collection-types-design.md` §12.
