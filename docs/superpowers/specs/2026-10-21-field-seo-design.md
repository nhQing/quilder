# Field "SEO" cho Kho dữ liệu: mỗi bài một bộ SEO, mỗi ngôn ngữ một bộ, site đọc được hết (thiết kế)

Ngày 21/10/2026 · nhánh đề xuất `feat/field-seo` · trạng thái: **chờ duyệt**

## 1. Mục tiêu và lý do

Ở màn Kho dữ liệu (`/builder/content/types/[key]`), người dùng thêm được **một field SEO**
vào bất kỳ loại nội dung nào (news, faq, loại tạo sau này). Mỗi bản ghi có bộ SEO riêng.
Mỗi ngôn ngữ của bản ghi cũng có bộ SEO riêng, đi qua lớp phủ `i18n`.

Site public phải **đọc** các giá trị này. Danh sách: `<title>`, meta description, keywords,
Open Graph, canonical, robots, JSON-LD, sitemap. Lưu được mà renderer không đọc thì coi như
chưa làm (bài học cũ: "validator nhận ≠ renderer đọc").

**Vì sao làm bây giờ.** Dữ liệu sắp nhập từ Strapi (`cms-strapi`, component `shared.seo`)
đã có SEO riêng cho từng bài. Không có chỗ chứa thì phải bỏ đi khi nhập.

**Thành công nghĩa là:**

1. Thêm field SEO vào loại `news`, mở một bài, điền "Tiêu đề SEO". `/blogs/post/<slug>`
   ra đúng `<title>` đó. Để trống thì ra tiêu đề bài như hôm nay.
2. `/en/...` của bài đó ra tiêu đề SEO tiếng Anh nếu có. Không có thì ra tiêu đề bài tiếng
   Anh. **Không bao giờ** ra chữ tiếng Việt chỉ vì bản tiếng Việt có tiêu đề SEO.
3. Tick "Ẩn khỏi Google" thì trang có `noindex` và bài biến khỏi `sitemap.xml`.
4. API công khai đọc được field này. Tool MCP đọc được, và ghi được trên bài **nháp**
   (`update_entry` chỉ sửa bài nháp, `requireDraft: true`; luật đó giữ nguyên).

## 2. Quyết định cũ cần đổi

Docblock của `entrySeo()` (`src/lib/render/collection-page.ts:662`) nói rằng **cố ý không**
thêm ô SEO vào form, vì người biên tập sẽ để trống, và một `<title>` trống là thứ Google
hiển thị.

Quyết định mới đổi điều đó nhưng **giữ lý do gốc**:

- Mọi ô SEO đều **tùy chọn** và là **giá trị ghi đè**.
- Ô nào trống thì rơi về giá trị đang suy ra hôm nay: `titleField`, `excerpt/summary/…`, ảnh đầu tiên.
- Không bao giờ ra `<title>` rỗng hay description rỗng. Không có gì để điền thì **bỏ hẳn**
  thẻ, không phát chuỗi rỗng.
- Docblock được viết lại, ghi ngày 21/10/2026 và lý do: dữ liệu nhập từ Strapi đã có SEO
  riêng từng bài, và một loại nội dung không có field SEO thì vẫn chạy đúng như cũ.

## 3. Phạm vi

**Trong phạm vi:** kiểu field, validate, lớp phủ ngôn ngữ, form, render (metadata + JSON-LD),
sitemap, API công khai, MCP, tài liệu, test.

**Ngoài phạm vi** (đã thống nhất, làm sau khi field chạy):

- Thêm field SEO vào loại `news` trong DB "Copy of local".
- Script nhập SEO từ STG `cms-strapi` (`blogs_components` → `components_shared_seos`).
  Thiết kế ở đây phải **nhận được** dữ liệu đó (xem §4.3, ánh xạ ở §11), nhưng không viết script.
- Không đụng dữ liệu thật.

**Không làm, có chủ đích:**

- Không thêm SEO cho **trang thường** (`Page`). Trang thường đã có cột `title`, `description`,
  `ogImageId`, `canonical`, `noindex`, `jsonLd` riêng.
- Không cho field SEO nằm **trong nhóm field** (`group`/`blocks`). Renderer chỉ tìm ở tầng
  ngoài. Cho phép đặt trong nhóm là hứa một thứ không ai đọc.
- Không bỏ `hreflang` của ngôn ngữ đang `noindex` khỏi cụm hreflang của các ngôn ngữ khác.
  Đúng ra nên bỏ, nhưng phải nạp SEO của mọi ngôn ngữ trong `generateMetadata`. Để sau.

## 4. Dữ liệu

### 4.1 Khai báo field

Trong `src/lib/collections/field-def.ts`:

```ts
FIELD_TYPES: [..., 'seo']
FieldDef: | { t: 'seo'; key: string; label: string; help?: string }
zFieldDef: z.object({ t: z.literal('seo'), key: zKey, label: zLabel, help: zHelp }).strict()
```

Không có `required`. Một ô SEO bắt buộc là đúng cái bẫy mà docblock cũ cảnh báo: người ta
sẽ gõ bừa cho qua.

Mặc định khi thêm từ SchemaEditor: `key: 'seo'`, `label: 'SEO'`.

`validateCollectionSchema` thêm hai luật, cùng khuôn với luật của `taxonomy`:

- `kind === 'type'` và có **hơn một** field `seo`: báo
  `Một loại nội dung chỉ có một field SEO (đang có: seo, seo2)`.
- `kind === 'group'` và có field `seo`: báo `Nhóm field không được chứa field SEO: <key>`.

Renderer tìm field theo **kiểu** (`fields.find(f => f.t === 'seo')`), không theo khóa.
Đổi tên khóa không làm gãy gì.

### 4.2 Hình dạng giá trị

Lưu trong `Entry.data[<key>]`. Tên các khóa con khớp component `shared.seo` của Strapi
để nhập lại được:

```ts
interface SeoValue {
  metaTitle?: string;        // cảnh báo > 60 ký tự, chặn > 120
  metaDescription?: string;  // cảnh báo > 160, chặn > 300
  keywords?: string;         // chặn > 500
  ogImage?: { assetId: string; alt?: string };  // cùng quy ước field image; alt ≤ 300
  canonicalUrl?: string;     // LƯU DƯỚI DẠNG ĐƯỜNG DẪN, xem §4.3
  noindex?: boolean;
  structuredData?: Record<string, unknown> | Record<string, unknown>[];  // JSON-LD
}
```

Đếm ký tự theo code point (`[...s].length`), không theo `s.length`. Tiếng Việt có dấu
dựng sẵn thì hai cách ra cùng số. Emoji thì khác, và người viết đếm emoji là một ký tự.

### 4.3 Validate ở đường ghi (`entry-data.ts`, `case 'seo'`)

Một nhánh trong `valueSchema`. Nó tự động áp cho mọi đường ghi: form, HTTP API, MCP
(`create_entry`, `update_entry` cả `data` lẫn tham số `i18n`), và lớp phủ bản dịch qua
`zEntryDataPartial` (`entry-write.ts:462`). Cùng một cửa như field
`html`, không có bước riêng nào để quên gọi.

Thứ tự, theo đúng khuôn của nhánh `html` (chặn → biến đổi → kiểm):

1. **Shape:** `z.object({...}).strip()`. Mọi khóa con đều `optional`.
2. **Chuẩn hóa** (`.transform`):
   - `trim` mọi chuỗi.
   - Chuỗi rỗng sau `trim`: **xóa khóa**.
   - `ogImage` không có `assetId`: xóa khóa.
   - `noindex: false` ở **bản gốc**: xóa khóa (mặc định đã là false). Ở lớp phủ thì
     `false` cũng xóa luôn, vì `noindex` không kế thừa (§5).
   - Giá trị chỉ còn `{}`: giữ `{}`. Không chuyển thành `undefined`, vì một khóa biến mất
     làm form nhảy sang uncontrolled.
3. **Kiểm:**
   - Độ dài: trần cứng như §4.2. Câu lỗi tiếng Việt, ví dụ
     `seo.metaTitle: Tiêu đề SEO dài quá 120 ký tự (đang có 134)`.
   - **canonicalUrl**, xem mục kế tiếp.
   - **structuredData**: phải là object, hoặc mảng object (JSON-LD cho phép `@graph` hay mảng).
     `JSON.stringify` ≤ 20.000 ký tự. Không đòi `@context`.

**canonicalUrl: chỉ cùng site, lưu bằng đường dẫn.**

- Nhận `/duong-dan` (có thể kèm `?query`; `#hash` bị bỏ).
- **Từ chối** `//host/...` (URL không giao thức trỏ ra domain khác), `javascript:`,
  `mailto:`, và mọi giao thức khác `http(s)`.
- Nhận `https://<host-của-site>/...`, rồi **cắt về đường dẫn** trước khi lưu. Host của site
  lấy từ `configuredSiteOrigin()` (`src/lib/site/origin.ts`, env `SITE_URL` thắng DB),
  **không** từ `siteOrigin()`: hàm đó rơi về localhost, không bao giờ trả `null`.
  So khớp bỏ qua tiền tố `www.`.
- URL tuyệt đối với host lạ: báo
  `seo.canonicalUrl: Đường dẫn chuẩn phải thuộc site này (<host>). Nhập dạng /duong-dan.`

Vì sao lưu đường dẫn: cùng một dữ liệu chạy được trên local, stg và prod. `metadataBase`
(`src/app/(site)/layout.tsx:55`) tự ghép origin lúc render. Lưu URL tuyệt đối thì bài nhập
từ prod sẽ có canonical trỏ prod ngay trên stg.

Validator cần host của site, nên `EntryDataCtx` thêm `siteHost: string | null`. Tham số
**bắt buộc**, cùng lý do đã ghi cho `iframeHosts`. `null` nghĩa là site chưa cấu hình domain
(đang rơi về localhost): khi đó chỉ nhận đường dẫn, mọi URL tuyệt đối đều bị từ chối.
Chỗ dựng ctx: `entry-write.ts:188`.

Với script nhập Strapi sau này: script phải tự cắt `https://<tên miền site cũ>` về đường dẫn
trước khi ghi, vì DB local có thể chưa đặt domain.

**Canonical trong lớp phủ ngôn ngữ là đường dẫn NGUYÊN VĂN** (quyết định của tôi). Không tự
ghép tiền tố `/en`. Lý do: đây là "đường dẫn chuẩn", người điền đang chỉ đúng một URL, và
ghép ngầm thì không chỉ được sang trang của ngôn ngữ khác khi thật sự cần. Bù lại, trong
tab ngôn ngữ phụ, form **cảnh báo** (không chặn) khi đường dẫn không bắt đầu bằng tiền tố của
ngôn ngữ đó: "Đường dẫn này trỏ sang trang của ngôn ngữ khác. Google sẽ bỏ trang tiếng Anh
này." Placeholder là URL `/en/...` của chính bài.

## 5. Lớp phủ ngôn ngữ: luật riêng cho field SEO

### 5.1 Vấn đề

`applyEntryLocale` (`src/lib/collections/i18n.ts`) phủ **cạn**, theo từng khóa của `data`.
Không có lớp phủ cho một khóa thì giữ nguyên giá trị bản gốc. Với field SEO, giữ nguyên
bản gốc là sai theo hai cách:

- **Canonical:** `/en/...` thừa hưởng canonical của bản tiếng Việt, tức báo với Google:
  "trang tiếng Anh là bản sao, hãy bỏ nó". Bản tiếng Anh biến khỏi Google mà không có lỗi nào.
- **Chữ:** bài chưa có lớp phủ tiếng Anh mà bản tiếng Việt có `metaTitle`, thì `/en` ra
  `<title>` tiếng Việt. Trong khi đó luật suy ra (tiêu đề bài tiếng Anh) cho kết quả đúng hơn.

**Đã kiểm:** với ngôn ngữ không mặc định, `entry.data` đưa vào `entrySeo()` **đã** được phủ
`i18n`. Đường đi: `loadDetailEntry` → `getEntryBySlug(typeKey, slug, locale)` →
`toRow(row, locale)` → `applyEntryLocale` (`queries.ts:152`). Hôm nay `/en` không ra tiêu đề
tiếng Việt khi bài đã dịch tiêu đề. Lỗi chỉ xuất hiện khi thêm field SEO mà dùng luật phủ cạn.

### 5.2 Luật

Với ngôn ngữ **không mặc định** `L`, giá trị SEO hiệu lực là:

| Khóa con | Lấy từ | Nếu `L` không có |
|---|---|---|
| `metaTitle`, `metaDescription`, `keywords` | lớp phủ `L` | luật suy ra trên dữ liệu đã phủ của `L` (§6), **không** lấy bản gốc |
| `ogImage.assetId` | lớp phủ `L` | **kế thừa** bản gốc (ảnh không mang ngôn ngữ) |
| `ogImage.alt` | lớp phủ `L` | không kế thừa; renderer dùng tiêu đề |
| `canonicalUrl` | lớp phủ `L` | không kế thừa; trỏ về chính URL của `L` |
| `noindex` | lớp phủ `L` | không kế thừa; mặc định được index |
| `structuredData` | lớp phủ `L` | không kế thừa; dùng `Article` tự sinh từ dữ liệu của `L` |

Luật này áp **cả khi `L` không có lớp phủ nào**. Đó chính là ca nguy hiểm nhất.

Vì sao `noindex` không kế thừa: mỗi ngôn ngữ có trạng thái đăng riêng (`EntryLocale`), và
Strapi cũng lưu `meta_robots` riêng cho từng bản. Kế thừa thì tab tiếng Anh cần một ô ba
trạng thái ("theo bản gốc / ẩn / hiện"). Thứ đó khó hiểu với biên tập viên, mà lợi ích lại nhỏ.

### 5.3 Cài đặt

`applyEntryLocale(data, i18n, locale, seoKey)`. Tham số thứ tư là `string | null`,
**bắt buộc**, để trình biên dịch chỉ ra mọi chỗ gọi:

- `queries.ts:152` (`toRow`) và `queries.ts:667` (`relationTargets`). Hai chỗ này cần
  `seoKey` của loại, lấy từ `getCollectionTypes()` (đã cache).
- `public-read.ts:178` và `:277`.
- `EntryForm.tsx:318` (cột xem trước).

Khi `seoKey !== null`, hàm **không được return sớm** lúc thiếu lớp phủ. Nó luôn thay
`out[seoKey]` bằng `localizeSeo(data[seoKey], overlay?.[seoKey])`.

**Điều kiện đi kèm:** chỉ gọi hàm này cho ngôn ngữ **không mặc định**. Các đường render đã
làm đúng (`locale.isDefault ? undefined : code`). `public-read.ts` nhận `?locale=` thẳng từ
client, nhưng hôm nay `?locale=<mặc định>` không trả bài nào: `publishWhere` đòi một hàng
`EntryLocale` của mã đó (`query-build.ts:201-209`), và ngôn ngữ mặc định không bao giờ có hàng
ấy. Nên không có đường nào lột canonical của bản gốc. **Không đổi** hành vi đó trong PR này.

`localeCoverage(data, i18n, locale, seoKey)`:

- Mẫu số đếm field SEO khi bản gốc có ít nhất một ô **chữ**: `metaTitle`, `metaDescription`,
  `keywords` hoặc `ogImage.alt`.
- Tử số đếm khi lớp phủ có ít nhất một ô chữ.
- Bài chỉ có `noindex` hay `ogImage` (không có chữ) thì không đếm field SEO. Đếm thì độ phủ
  không bao giờ tới 100%, vì không có gì để dịch.

Chỗ gọi: `admin-queries.ts:152`, `EntryForm.tsx:582` và `:901`.

## 6. Luật rơi về: `entrySeo()`

### 6.1 Một luật, hai chỗ đọc

Phần thuần (không DB, không `server-only`) chuyển vào **`src/lib/collections/seo.ts`**.
Form (client) và renderer (server) dùng chung file này:

- `zSeoValue` và các trần (`SEO_LIMITS`): validator, form và bộ đếm ký tự dùng chung một bộ số.
- `localizeSeo(base, overlay)`: luật §5.2.
- `normalizeCanonical(raw, siteHost)`: dùng chung cho validator và renderer.
- `resolveEntrySeo(shape, data)`: thân mới của `entrySeo`.

`collection-page.ts` giữ export `entrySeo` (gọi qua), nên chỗ import cũ không đổi.

### 6.2 Kết quả trả về

```ts
interface EntrySeo {
  title: string | null;          // không bao giờ là ''
  titleIsOverride: boolean;      // true khi lấy từ metaTitle → render dạng `absolute`
  description: string | null;    // không bao giờ là ''; cắt 300 như hôm nay
  articleTitle: string | null;   // tiêu đề CỦA BÀI (titleField), bỏ qua metaTitle
  articleDescription: string | null;  // mô tả suy ra, bỏ qua metaDescription
  imageAssetId: string | null;
  imageAlt: string | null;       // ogImage.alt nếu có
  keywords: string | null;
  noindex: boolean;
  canonical: string | null;      // đường dẫn đã kiểm, hoặc null = dùng luật mặc định
  jsonLd: Record<string, unknown> | Record<string, unknown>[] | null;  // structuredData
}
```

### 6.3 Thứ tự ưu tiên

- **title:** `seo.metaTitle` → `data[titleField]` → `null`. Nếu `null`, `generateMetadata`
  giữ tiêu đề trang mẫu như hôm nay.
- **description:** `seo.metaDescription` → `DESCRIPTION_KEYS` → field `text` đầu tiên khác
  tiêu đề → `null`.
- **imageAssetId:** `seo.ogImage.assetId` → ảnh đầu tiên của field `image` → `null`.
- **keywords, noindex, canonical, jsonLd:** chỉ từ field SEO, không có luật suy ra.
  Riêng `canonical` được kiểm lại bằng `normalizeCanonical` lúc đọc, vì JSONB có thể đã bị
  sửa bằng SQL. Không qua thì trả `null`, tức quay về luật mặc định.

Loại không có field SEO: kết quả y hệt hôm nay. Phải có test khóa điều này.

### 6.4 `metaTitle` là tiêu đề trọn vẹn (quyết định của tôi)

Site có thể bật `title.template` ("%s | MaiMoney", Cài đặt › SEO). Tiêu đề **suy ra** vẫn đi
qua template như hôm nay. `metaTitle` thì phát dạng `title: { absolute }`, **không** nối
template.

Lý do: người gõ tiêu đề SEO đang viết đúng dòng Google sẽ hiện, và khung xem trước trong form
cũng hiện đúng dòng đó. Strapi `meta_title` cũng là tiêu đề trọn vẹn. Nối template vào sẽ
thành "… | MaiMoney | MaiMoney" trên dữ liệu nhập.

## 7. Render

### 7.1 `generateMetadata` (`src/app/(site)/[[...slug]]/page.tsx`)

Trong nhánh `entry && target.typeKey`:

- **title:** `seo.titleIsOverride ? { absolute: seo.title } : seo.title`.
- **description:** như hôm nay.
- **keywords:** thêm `keywords: seo.keywords` khi có.
- **robots:** `page.noindex` (cờ của trang mẫu) giữ nguyên `{ index:false, follow:false }`.
  Thêm: `seo.noindex` → `{ index:false, follow:true }`. Bài ẩn khỏi Google vẫn để Google đi
  theo link sang bài khác. Đây là quyết định của tôi.
- **canonical:** `seo.canonical ?? localePath(locale, slug)`. Khi trống thì giữ luật hiện tại
  (bài trỏ về chính nó). `og:url` đi theo canonical như hôm nay.
- **Ảnh:** `seo.imageAssetId` đã là ứng viên đầu tiên của `imageCandidates`. Khi `ogImage`
  có, `entrySeo` trả nó trước ảnh bìa, nên không cần thêm nhánh. `og:image:alt` dùng
  `seo.imageAlt` **chỉ khi** ảnh được chọn đúng là ảnh OG đó. Ảnh OG đã bị xóa và một ứng viên
  khác được chọn thì alt rơi về `title` như hôm nay.

### 7.2 JSON-LD (`src/app/(site)/PublishedPageView.tsx:127`)

Thứ tự mới:

```
seo.jsonLd (bài tự khai) → page.jsonLd (trang mẫu khai) → articleJsonLd(...) (tự sinh)
```

Bài tự khai đứng trước trang mẫu vì nó cụ thể hơn: trang mẫu dùng chung cho mọi bài.
`articleJsonLd()` chỉ chạy khi cả hai đều không có.

`articleJsonLd()` lấy `headline` và `description` từ `articleTitle`/`articleDescription`,
**không** từ tiêu đề SEO (quyết định của tôi). `Article.headline` là tên bài. Một tiêu đề
SEO kiểu "Lãi suất 8/2026 | Ưu đãi…" viết cho trang kết quả Google, không phải tên bài. Chèn bằng `jsonForScript` như hôm nay.
Hàm đó đã escape `<`, `>`, `&`, nên `</script>` trong `structuredData` không đóng được thẻ.
Phải có test cho đúng ca này, chạy trên dữ liệu đi qua đường render.

### 7.3 Sitemap (`src/app/sitemap.ts`)

`entriesOfType(typeKey)` loại bài có `noindex` ở bản gốc. Loại luôn bài có `canonicalUrl`
trỏ sang đường dẫn **khác** với URL của chính nó, vì sitemap chỉ được chứa URL chuẩn
(quyết định của tôi). Canonical trỏ về chính nó thì giữ. Hàm tra `seoKey` của loại qua
`getCollectionTypes()`. Loại không có field SEO thì truy vấn y như cũ.

**Bẫy phải tránh:** viết `NOT: { data: { path: [seoKey, 'noindex'], equals: true } }` thì
trên Postgres, bài **không có** khóa `noindex` cho ra `NULL`, và `NOT NULL` loại luôn bài đó.
Kết quả: mọi bài không đặt SEO biến khỏi sitemap. Test vitest mock Prisma (`sitemap.test.ts`)
**không bắt được** lỗi này. Builder phải chạy thử trên Postgres thật một lần (`/sitemap.xml`
trên dev, có ít nhất một bài không có khóa `seo`) và ghi kết quả vào PR.
Gợi ý: `$queryRaw` với `COALESCE((data #>> '{<key>,noindex}')::boolean, false) = false`,
hoặc `OR` tường minh. Builder chọn.

**Hôm nay sitemap chỉ có URL của ngôn ngữ mặc định**. PR này thêm URL của từng ngôn ngữ và
loại theo từng ngôn ngữ, xem Q1 ở §12.

### 7.4 Không đổi

- `relation-expand.ts:114`: ảnh trên thẻ bài liên quan vẫn là ảnh đầu tiên, **không** phải
  ảnh OG. Ảnh OG là ảnh để chia sẻ, không phải ảnh bìa. Chỉ sửa comment "cùng luật với
  `entrySeo`" cho khỏi sai.
- Bài viết không có field SEO: mọi đầu ra giống hệt hôm nay.

## 8. Builder (giao diện)

Người dùng thật là **biên tập viên nội dung**, không phải dev. Nhãn tiếng Việt, phần chính
không hiện JSON.

### 8.1 SchemaEditor

- Thêm `'seo'` vào bảng chọn kiểu (`SchemaEditor.tsx:72`), nhóm mới "Tìm kiếm & chia sẻ".
- Làm mờ khi loại đã có field SEO, kèm `title` giải thích. Khuôn có sẵn ở `hasTaxonomy`
  (`:355`, `:456`).
- Ẩn hẳn khi đang sửa **nhóm field** (`kind === 'group'`), như `taxonomy` (`:349`).
- Field SEO không có tùy chọn cấu hình nào ngoài khóa, nhãn, gợi ý.

### 8.2 Khối SEO trong form bài (`FieldInput.tsx` `case 'seo'`, có thể tách `SeoFieldInput.tsx`)

Một khối **thu gọn được**, mặc định **đóng**. Tiêu đề khối có một dòng tóm tắt:
"Đang dùng giá trị tự động" hoặc "Đã đặt riêng: tiêu đề, mô tả". Khi đóng, người viết vẫn
biết trạng thái mà không phải mở ra.

Khi mở, theo thứ tự:

1. **Xem trước kết quả Google.** Ba dòng: tiêu đề (xanh), URL (origin + đường dẫn), mô tả.
   Dùng giá trị **hiệu lực**: ô đã gõ, hoặc giá trị rơi về, qua cùng `resolveEntrySeo`.
   Tiêu đề rơi về được nối `title.template` của site, giống hệt site. Cắt hiển thị bằng
   CSS (`line-clamp`), không cắt chuỗi.
2. **Tiêu đề SEO**: ô một dòng. **Placeholder là giá trị rơi về**, đúng cái Google sẽ thấy
   nếu để trống. Bộ đếm `48/60`: quá 60 chuyển màu cảnh báo kèm câu "Google thường cắt sau
   khoảng 60 ký tự". Quá 120 chuyển màu lỗi; lưu sẽ bị server từ chối.
3. **Mô tả SEO**: ô nhiều dòng, placeholder là mô tả rơi về, bộ đếm 160/300 cùng khuôn.
4. **Ảnh khi chia sẻ**: bộ chọn ảnh (`AssetPickerBox`) cộng một ô "Mô tả ảnh". Trống thì hiện
   ảnh rơi về ở dạng mờ, chú thích "Đang dùng ảnh bìa". Giá trị ghi ra **phải** là
   `{ assetId, alt }` (xem §13, rủi ro R4).
5. **Ẩn khỏi Google**: checkbox, kèm câu giải thích hậu quả: "Bài vẫn mở được bằng đường link,
   nhưng không hiện trên Google và không có trong sitemap."
6. **Nâng cao** (thu gọn, mặc định đóng):
   - **Từ khóa**: ô một dòng, gợi ý "phân cách bằng dấu phẩy".
   - **Đường dẫn chuẩn (canonical)**: ô một dòng. Placeholder là URL của chính bài.
     Gợi ý: "Chỉ điền khi bài này là bản sao của một trang khác trên site."
   - **Dữ liệu có cấu trúc (JSON-LD)**: textarea monospace, cùng hành vi parse-khi-rời-ô của
     field `json`. Gợi ý: "Để trống thì hệ thống tự sinh dữ liệu kiểu Article."

**Tab ngôn ngữ phụ** (EntryForm, `active !== null`): khối hiện **giá trị riêng của ngôn ngữ đó**
(lớp phủ), giống mọi field khác. Placeholder và khung xem trước tính trên dữ liệu **đã phủ**
của ngôn ngữ đó, theo luật §5.2. Ảnh trống thì hiện ảnh của bản gốc với chú thích "Đang dùng
ảnh của bản gốc".

**Props mới cho EntryForm:** origin của site và `title.template`, để khung xem trước đúng.
Lấy ở server page của màn sửa bài.

`form-state.ts` `emptyValue` cho `seo`: `{}`.

## 9. API công khai và MCP

### 9.1 `public-shape.ts`

`fieldOut` thêm `case 'seo'`. Trả **giá trị ghi đè** (không phải giá trị đã rơi về), cùng
ảnh OG đã phân giải URL. Có `?locale=L` thì đó là giá trị ghi đè **đã phủ ngôn ngữ** theo
§5.2, giống mọi field khác của `data` (quyết định của tôi). Ví dụ: `metaTitle` là `null`
khi bản `L` chưa đặt, dù bản gốc có; `ogImage` là ảnh của bản gốc khi `L` chưa chọn ảnh riêng.

```ts
seo: {
  metaTitle: string | null;
  metaDescription: string | null;
  keywords: string | null;
  ogImage: PublicAsset | null;     // qua assetOut, như field image
  canonicalUrl: string | null;     // đường dẫn, ví dụ "/blogs/post/abc"
  noindex: boolean;
  structuredData: object | object[] | null;
} | null                            // null khi bài chưa có giá trị nào
```

Vì sao trả giá trị ghi đè chứ không trả giá trị hiệu lực: `data` của API là **dữ liệu của bài**,
như mọi field khác. Giá trị hiệu lực phụ thuộc template của site và trang mẫu, tức là chuyện
của renderer. Client cần tiêu đề hiệu lực thì tự làm `metaTitle ?? title`. Đây là quyết định
của tôi.

Khóa luôn có mặt (giá trị `null`/`false`), để client không phải hỏi "có khóa này không".
Đúng tinh thần của `emptyOut`.

`collectAssetIds` đã đi sâu vào mọi `{ assetId }`, nên ảnh OG được nạp cùng lượt với ảnh
khác. Không đổi gì.

Tài liệu: `docs/API-PUBLIC.md` thêm mục "Field SEO". `scripts/gen-api-types.ts` thêm kiểu
`SeoValue`. Chạy lại `gen-docs` cho số đếm `FIELD_TYPES`.

Lọc theo field SEO (`filter[seo]…`): **không làm gì riêng**. Hôm nay `public-params.ts` chỉ
từ chối lọc theo `slug`; lọc theo `group`, `json`, `image`, `link` đều đi qua và không khớp
bài nào. Field SEO theo cùng hành vi đó. Sắp xếp đã chỉ nhận cột thật, nên không cần gì thêm.

### 9.2 Tool MCP (`src/lib/ai/collection-tools.ts`)

Đường ghi đã đi qua `validateEntryData`/`validateEntryDataPartial`, nên **nhận được** sẵn.
Chỉ cần sửa mô tả, để agent biết cách dùng:

- `list_collection_types`: thêm một câu: "Field kiểu seo là object `{ metaTitle,
  metaDescription, keywords, ogImage:{assetId,alt}, canonicalUrl (đường dẫn), noindex,
  structuredData }`. Mọi khóa đều tùy chọn; để trống thì site tự suy ra."
- `create_entry`/`update_entry`: thêm dòng `seo → {...}` vào bảng tóm tắt kiểu.
- Mô tả tham số `i18n` của `update_entry` (chỗ ghi lớp phủ bản dịch; `set_entry_locale` chỉ
  đặt slug và trạng thái đăng): một câu về §5.2. Chữ, canonical, noindex và structuredData
  không kế thừa bản gốc; chỉ ảnh OG kế thừa.
- `get_entry`: trả `data` thô như hôm nay, không đổi code.

## 10. Thay đổi cấu trúc và tham chiếu ảnh

- **`schema-change.ts`:** thêm field SEO là `add`, an toàn sẵn. Xóa field SEO là `remove`,
  chỉ ẩn theo luật hiện có. Đổi kiểu sang hay từ `seo` không có trong `SAFE_RETYPE` nên bị
  chặn khi đã có bài. Không cần sửa code, chỉ cần test khóa ba hành vi đó.
- **`asset-references-scan.ts`:** `idsInEntry` đã quét cả `data` lẫn `i18n` bằng
  `collectAssetIds`. Hàm này bắt mọi `{ assetId }` ở mọi độ sâu, nên `seo.ogImage.assetId`
  **đã được tính**, kể cả ảnh OG riêng của bản tiếng Anh. Không cần sửa code, nhưng **phải có
  test**: thiếu nó thì một lần tái cấu trúc sau này có thể làm ảnh OG thành mồ côi và bị xóa
  vĩnh viễn.

## 11. Ánh xạ từ Strapi (để thiết kế nhận được, chưa làm script)

| Strapi `components_shared_seos` | SeoValue |
|---|---|
| `meta_title` | `metaTitle` |
| `meta_description` | `metaDescription` |
| `keywords` | `keywords` |
| `canonical_url` | `canonicalUrl` (script cắt domain prod về đường dẫn) |
| `meta_robots` chứa `noindex` | `noindex: true` |
| `structured_data` | `structuredData` |
| `meta_image` (nếu có) | `ogImage` (cần ánh xạ asset, để PR nhập) |

Bài `vi` vào `data.seo`, bài `en` vào `i18n.en.seo`, nối theo slug. Lưu ý: DB của builder
local và của MCP **khác** DB "Copy of local".

Dữ liệu thật có thể vượt trần: `meta_description` > 300 ký tự, hay `canonical_url` trỏ domain
lạ. Script nhập phải **báo cáo** những bài đó, không được im lặng cắt. Ghi ở đây để PR sau
không quên.

## 12. Hai quyết định lớn đã chốt (user giao "làm phương án tốt nhất", 21/10/2026)

**Q1. Sitemap theo ngôn ngữ: thêm URL của từng ngôn ngữ.** Hôm nay sitemap không phát URL
`/en/...` nào, nên bản tiếng Anh chỉ được Google tìm qua hreflang. Trong PR này,
`entriesOfType` phát thêm, cho mỗi bài, URL của từng ngôn ngữ **đang live** (cùng luật
`isLocalePublished` với hreflang ở `page.tsx:181`, slug theo `localeSlug`). Luật loại áp
**theo từng ngôn ngữ**: `noindex` hay canonical trỏ chỗ khác của bản `L` (đã qua
`localizeSeo`) chỉ loại URL của `L`.
- Chi phí: truy vấn lấy thêm quan hệ `locales` và cờ SEO trong `i18n`. Cờ đọc bằng biểu thức
  JSONB (`data #> '{<key>}'`, `i18n #> '{<code>,<key>}'`), **không** kéo nguyên `data`/`i18n`
  của 5.000 bài.
- Vẫn trong `unstable_cache` với tag `collection:<typeKey>`, trần 5.000 **bài**.
- Test: bài có bản `en` live ra hai URL; bản `en` nháp ra một; bản `en` `noindex` ra một.

**Q2. Loại không có trang chi tiết: trang danh mục đọc SEO của bản ghi đích.**
Field SEO thêm được vào mọi loại, như yêu cầu. Nhưng §7 chỉ chạy cho trang chi tiết, nên
trên loại không có trang chi tiết thì SEO chỉ được lưu mà không ai đọc. Đúng cái lỗi
"validator nhận ≠ renderer đọc".
- Loại làm **tham số của trang danh mục** (`param: 'relation'`, ví dụ `/blogs/<danh-mục>`,
  `page.tsx:133-136`): trang đó đọc SEO của bản ghi đích, gồm title, description, ảnh,
  keywords, robots, canonical, JSON-LD. **Chỉ giá trị ghi đè**, không có luật suy ra. Ô trống
  thì giữ đúng metadata hôm nay (của trang mẫu), nên loại danh mục chưa có field SEO không đổi
  một thẻ nào. `perRelation` trong sitemap áp cùng luật loại `noindex`.
  Lý do chọn: trang danh mục là trang SEO quan trọng, và danh mục Strapi có thể đã có
  `shared.seo`.
- Loại **không có trang nào** (faq, singleton…): vẫn thêm được (API và MCP đọc được). Riêng
  SchemaEditor hiện một dòng ngay dưới field: "Loại này chưa có trang chi tiết hay trang danh
  mục trên site, nên SEO chỉ dùng qua API." Hiện lời nhắc, không chặn.
- Test thêm: trang `/blogs/<danh-mục>` có và không có SEO; sitemap bỏ danh mục `noindex`.

Không còn câu hỏi nào mở.

## 13. Rủi ro

- **R1. Sitemap mất sạch bài** vì bẫy `NOT` trên JSONB (§7.3). Đây là rủi ro lớn nhất, và
  test mock không bắt được. Bắt buộc kiểm trên Postgres thật.
- **R2. Canonical tiếng Anh trỏ về bản tiếng Việt** nếu một chỗ gọi `applyEntryLocale` bị
  quên `seoKey`. Đã giảm bằng tham số bắt buộc, và có test `generateMetadata` ở `en` cho bài
  chỉ có SEO tiếng Việt.
- **R3.** (Đã gỡ sau khi đọc lại code: `?locale=<mặc định>` hôm nay không trả bài nào, xem §5.3.)
- **R4. Phát hiện ngoài lề, chưa kiểm khi chạy:** ô ảnh của field `image` trong form
  (`FieldInput.tsx` `case 'image'`) đọc và ghi **chuỗi** `assetId`, trong khi validator
  (`entry-data.ts:55`) đòi `{ assetId, alt }`. Có thể ảnh bìa đang không lưu được qua form,
  hoặc có một bước chuyển đổi tôi chưa thấy. Ô ảnh OG **không được** chép khuôn đó. Lỗi của
  field `image` (nếu có thật) không sửa trong PR này; sẽ báo riêng.
- **R5. Cây làm việc đang có thay đổi chưa commit** của việc khác, trong đó có hai file PR
  này phải sửa: `FieldInput.tsx` (bộ chọn relation mới) và `collection-page.test.ts`.
  Code PR này phải làm trên nền đó mà không cuốn theo. Nên commit hoặc tách việc kia ra trước.

## 14. Danh sách file

| File | Việc |
|---|---|
| `src/lib/collections/field-def.ts` | kiểu `seo`, zod, 2 luật trong `validateCollectionSchema` |
| `src/lib/collections/seo.ts` (mới) | `zSeoValue`, `SEO_LIMITS`, `localizeSeo`, `normalizeCanonical`, `resolveEntrySeo` |
| `src/lib/collections/entry-data.ts` | `case 'seo'`, `EntryDataCtx.siteHost` |
| `src/lib/collections/entry-write.ts` | dựng ctx với `siteHost` |
| `src/lib/collections/i18n.ts` | tham số `seoKey` cho `applyEntryLocale`, `localeCoverage` |
| `src/lib/collections/queries.ts`, `public-read.ts`, `admin-queries.ts` | truyền `seoKey` |
| `src/lib/collections/form-state.ts` | `emptyValue` |
| `src/lib/collections/public-shape.ts` | `case 'seo'` trong `fieldOut`/`emptyOut` |
| `src/lib/render/collection-page.ts` | `entrySeo` gọi `resolveEntrySeo`, docblock mới |
| `src/lib/collections/relation-expand.ts` | sửa comment |
| `src/app/(site)/[[...slug]]/page.tsx` | title/keywords/robots/canonical/alt |
| `src/app/(site)/PublishedPageView.tsx` | thứ tự JSON-LD |
| `src/app/sitemap.ts` | URL theo ngôn ngữ; loại `noindex` và canonical trỏ chỗ khác (bài và danh mục) |
| `src/app/(site)/[[...slug]]/page.tsx` nhánh `relation` | SEO của bản ghi đích (Q2) |
| `src/components/builder/SchemaEditor.tsx` | bảng chọn kiểu |
| `src/components/builder/FieldInput.tsx` (+ `SeoFieldInput.tsx`) | khối SEO |
| `src/components/builder/EntryForm.tsx` + server page màn sửa bài | props origin/template, `seoKey` |
| `src/lib/ai/collection-tools.ts` | mô tả tool |
| `scripts/gen-api-types.ts`, `docs/API-PUBLIC.md`, `docs/generated/*` | tài liệu, kiểu |

Không có migration Prisma (giá trị nằm trong JSONB `Entry.data`). Vẫn chạy `pnpm db:generate`
trước typecheck theo quy trình.

## 15. Test

Bắt buộc (theo yêu cầu):

1. **zod field SEO** (`seo.test.ts`, `entry-data.test.ts`): nhận giá trị đủ khóa; nhận `{}`;
   chặn `metaTitle` 121 ký tự và `metaDescription` 301 ký tự (câu lỗi tiếng Việt); nhận 120
   và 300; chuỗi trắng bị xóa khóa; canonical `/a?b=1#c` → `/a?b=1`; `https://<site>/a` →
   `/a`; `https://www.<site>/a` → `/a`; từ chối `https://evil.com/a`, `//evil.com/a`,
   `javascript:alert(1)`; `siteHost: null` từ chối mọi URL tuyệt đối; `structuredData`
   chuỗi hay số bị từ chối; quá 20.000 ký tự bị từ chối. Lớp phủ (`zEntryDataPartial`)
   đi qua cùng luật.
2. **Thứ tự của `entrySeo()`**: có ghi đè thì ghi đè thắng; **trống toàn bộ** (`seo: {}`)
   thì ra đúng kết quả của bản không có field SEO; loại không có field SEO thì ra đúng kết
   quả cũ (khóa hồi quy); `metaTitle` toàn khoảng trắng tính là trống; canonical hỏng trong
   JSONB bị bỏ.
3. **`generateMetadata`** (file mới `src/app/site-page-metadata.test.ts`, mock theo khuôn
   `site-page-routing.test.ts`), mỗi ca ở cả `vi` và `en`:
   - bài có SEO đủ: title `absolute`, description, keywords, robots, canonical, ảnh OG;
   - bài không có SEO: giống hệt hôm nay;
   - bài chỉ có SEO tiếng Việt, mở `/en`: title là tiêu đề bài **tiếng Anh**, canonical là
     URL `/en/...` của chính nó, không `noindex`, ảnh OG là ảnh của bản gốc.
4. **Sitemap bỏ bài `noindex`** (`sitemap.test.ts`), cả theo từng ngôn ngữ, cả bài có
   canonical trỏ chỗ khác, cộng một lần chạy thật trên Postgres (R1).
5. **Quét tham chiếu ảnh thấy `ogImage`** (`asset-references-scan.test.ts`), cả trong `data`
   lẫn trong `i18n.en`.

Thêm:

6. `validateCollectionSchema`: hai field SEO bị từ chối; SEO trong nhóm bị từ chối.
7. `i18n.test.ts`: `localizeSeo` theo bảng §5.2; luật áp cả khi không có lớp phủ;
   `localeCoverage` không đếm SEO chỉ có `noindex`.
8. `public-shape.test.ts`: hình dạng §9.1, kể cả bài trống và ảnh đã bị xóa.
9. JSON-LD: `structuredData` chứa `</script>` ra `</script` trong HTML; thứ tự
   bài → mẫu → tự sinh.
10. `schema-change.test.ts`: thêm/xóa/đổi kiểu như §10.

Thứ tự chạy: `pnpm db:generate` → typecheck → lint → vitest.

## 16. Để builder tự quyết

- Tách `SeoFieldInput.tsx` hay viết trong `FieldInput.tsx`.
- Cách viết truy vấn sitemap, miễn qua được R1.
- Bố cục, khoảng cách của khung xem trước Google, theo design system có sẵn của builder.
- Lấy `seoKey` cho `toRow` bằng cách nào (tham số của chỗ gọi, hay tra `getCollectionTypes`
  bên trong).
