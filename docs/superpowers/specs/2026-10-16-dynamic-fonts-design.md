# Font động — tải font lên và dùng mà không build lại — thiết kế

Ngày 16/10/2026, **sửa lại 11/11/2026** · nhánh `feat/dynamic-fonts` (tách từ `main`) ·
trạng thái: **đã duyệt 11/11/2026**

> **Bản sửa 11/11/2026 đổi gì so với 16/10:**
> - Không font nào nằm trong gói dự án. Ba họ của MaiMoney (SF Pro Display, newYork, gilroy)
>   chuyển vào kho font (S3 + DB) bằng một script chạy một lần cho mỗi môi trường (mục 5.2).
>   Bản 16/10 giữ cả bốn họ trong code ở dạng chỉ đọc.
> - Cập nhật hiện trạng sau 47 commit: font của MaiMoney đã dời từ lõi sang gói hôm 21/10,
>   token tự tạo đã nhận font stack từ 21/10, phần nhập token đã dời sang
>   `src/lib/setup/design-tokens.ts`, Inspector không còn bộ chọn họ font.

## 1. Mục tiêu

Hôm nay mọi font của site nằm cứng trong code và đi theo image Docker:

- **Lõi Quilder:** Inter. File ở `public/fonts/`, `@font-face` trong
  `src/styles/base/typography.css`, biến `--font-display` / `--font-body` trong
  `src/styles/tokens.css`.
- **Gói MaiMoney** (dời từ lõi sang hôm 21/10/2026): SF Pro Display, newYork, gilroy. File ở
  `projects/maimoney/public/fonts/` (phục vụ ở `/p/fonts/…`), `@font-face` trong
  `projects/maimoney/styles/fonts.css`. File đó cũng đè `--font-display` / `--font-body`
  sang SF Pro.

Muốn thêm một font thì phải sửa code, build và deploy. Sanitizer cũng gỡ `@font-face` khỏi
`customCss` (`src/lib/render/sanitize-css.ts`), nên không có đường nào thêm font qua dữ liệu.

Cần: **sau một lần deploy, thêm một họ font hoàn toàn mới rồi dùng nó trên trang đang
chạy, bằng màn Cài đặt hoặc bằng Claude qua MCP, không build lại.**

Người dùng đã chốt (16/10/2026):

1. **Nguồn font:** file từ máy (woff2, woff, ttf, otf) và Google Fonts. Font Google được
   kéo về lưu ở kho của mình (self-host), site không gọi Google lúc chạy.
2. **Họ font đã có trang dùng vẫn sửa được.** Được thêm hoặc bớt weight, thay file, đổi
   fallback. Bản nháp thấy ngay; site thật đổi khi Publish. CSS font được niêm phong theo
   release.
3. **File font phục vụ qua chính domain site** (`/mm-font/…`). Cùng nguồn nên không cần cấu
   hình CORS ở môi trường nào.
4. ~~4 họ đang đóng cứng giữ nguyên trong code.~~ **Đổi 11/11/2026:** người dùng không
   muốn file nằm trong gói dự án. Ba họ của gói MaiMoney (SF Pro Display, newYork, gilroy)
   **chuyển vào kho font**, sau đó xoá file khỏi gói (mục 5.2).
   **Inter ở lại lõi** làm font mặc định của engine, chỉ đọc (người dùng chốt 11/11/2026).
   Lý do: Inter không thuộc gói dự án mà là font dự phòng
   của mọi site Quilder. Một bản cài mới, DB trống, vẫn phải có chữ đúng trước khi ai kịp
   tải font lên.
5. Mục **Font** nằm trong **Cài đặt**.

Thành công nghĩa là:

- Ở product, Claude nhận lệnh "đổi tiêu đề trang X sang font Be Vietnam Pro":
  1. Claude gọi `upload_font` với `google` (hoặc `filePath`).
  2. Claude gán token bằng `apply_ops`.
  3. Canvas hiện đúng font, đủ dấu tiếng Việt.
  4. Người dùng bấm Publish thì site thật đổi.

  Không có bước build hay deploy nào trong luồng này.
- Rollback về một release cũ thì font cũng về đúng như lúc release đó được tạo.
- Font hỏng không bao giờ "âm thầm rơi về fallback" mà không ai biết. Thiếu dấu tiếng Việt,
  giấy phép cấm nhúng, không đọc được tên họ: đều được báo ngay lúc tải lên.

## 2. Ngoài phạm vi

- **Font mặc định cho cả site (theme).** Mục Nền tảng đã gỡ ngày 13/10/2026. Đây là **kho
  font để chọn**, không đặt font mặc định.
- **Chuyển Inter của lõi sang dữ liệu.** Ba họ của gói MaiMoney thì **trong** phạm vi
  (mục 5.2).
- **Giảm nhảy layout khi font nạp:** preload font, chỉnh metric fallback
  (`size-adjust`, `ascent-override`).
- **Tự nhập font khi clone website.** `clone_website` hiện chỉ báo "font không có".
- **Tool `delete_font` và `update_font` cho MCP.**
- **Font trong ô soạn bài viết (CKEditor) và font giao diện builder.**
- **File `.ttc`** (bộ nhiều font trong một file).

## 3. Hiện trạng — những chỗ thiết kế phải bám vào

| Chỗ | Hiện tại | Hệ quả cho tính năng này |
|---|---|---|
| `Asset` (`prisma/schema.prisma:442`) | Đã có `kind = 'font'`; `kind.ts:75` map woff, woff2, ttf, otf | Dùng lại kho asset; không cần kho mới |
| `sniff.ts:159-160` | Chỉ nhận ra `wOF2` và `wOFF` | Phải thêm TTF (`00 01 00 00`, `true`) và OTF (`OTTO`) |
| `custom-tokens.ts` + `design/token-value.ts` | Từ 21/10 token tự tạo nhận mọi giá trị qua `isSafeTokenValue`, kể cả font stack có nháy; `url(` bị chặn | **Không cần mở thêm.** Token font tới trang được ngay |
| `src/lib/setup/design-tokens.ts` `categorize()` | `font*` vào hạng `typography` (thay cho `scripts/import-tokens.ts` cũ) | Token họ font do module font tạo, mang hạng `font`. `categorize` trả `font` cho tên `font-*` / `lv-font-*` có giá trị là font stack, còn `font-size-*`… giữ `typography` |
| Inspector (`Inspector.tsx:750`, mục "Chữ") | **Không có** bộ chọn họ font. `typography.family` có trong schema (`doc/types.ts:229`) và renderer (`css.ts:430`) nhưng chỉ gán được qua AI | Thêm `TokenSelectControl` cho `family`, lọc hạng `font` (mục 11.5) |
| Token `font-newyork`, `font-gilroy` | Token tự tạo trong DB, trỏ vào tên họ khai ở `fonts.css` của gói. `lv-font-display` / `lv-font-head` trong `projects/maimoney/styles/tokens.css` cũng trỏ vào hai tên đó | Script chuyển (mục 5.2) **nhận lại** hai hàng token này, không tạo token mới, nên node đang trỏ vào không gãy |
| `Release` (`schema.prisma:288`) | Niêm phong `tokens`, `assets`, `cssHash` → `StyleBundle` | Thêm cột `fonts`. **Không** cho font vào `StyleBundle`, vì bundle là CSS dẫn xuất từ code, băm theo file |
| `StyleBundle` của release cũ | CSS gộp từ lõi + `styles/index.css` của gói (`static-css.ts`), nên chứa `@font-face` trỏ `/p/fonts/…` | Sau khi xoá file khỏi gói, lùi về release tạo trước lần chuyển thì font rơi về fallback (mục 5.2, hệ quả đã chấp nhận) |
| `(site)/[[...slug]]/page.tsx:432-484` | In `<style data-mm-tokens>` từ bản niêm phong | In `<style data-mm-fonts>` ngay cạnh |
| `/render/[pageId]`, `/render/component/[id]`, `/preview/[pageId]` | Đọc token tự tạo trực tiếp từ DB | Đọc font trực tiếp từ DB theo cùng cách |
| `asset-references-scan.ts` | Quét `Token.value` và `Release.tokens` tìm khoá asset | Thêm `Release.fonts` và `FontFace`, để file không bị dọn khi release cũ còn trỏ tới |
| CSP | Không có CSP trên trang site và builder | Không chặn gì; vấn đề thật là CORS, và đã né bằng route cùng nguồn |
| Image | `node:22-alpine`, Next standalone | Thư viện mới phải là JS thuần hoặc wasm; file `.wasm` phải được kéo vào bản standalone (mục 14) |
| Quyền (`session.ts:140`) | Service token luôn bị từ chối `admin` | Thêm font phải là quyền `write`, nếu không Claude không làm được |

## 4. Mô hình dữ liệu

```prisma
model FontFamily {
  id        String   @id @default(cuid())
  /** Phần đuôi của token `font-<slug>`. BẤT BIẾN: đổi slug là gãy mọi node trỏ vào token. */
  slug      String   @unique
  /** Tên họ trong CSS, ví dụ `Be Vietnam Pro`. Sửa được. So trùng KHÔNG phân biệt hoa thường. */
  cssName   String   @unique
  /** Chuỗi fallback, ví dụ `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. */
  fallback  String
  /** upload | google */
  source    String
  googleFamily String?
  licenseNote  String?
  /** Email người tick "tôi có quyền dùng font này trên web". Null với nguồn google. */
  licenseConfirmedBy String?
  createdBy String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  faces     FontFace[]
}

model FontFace {
  id        String @id @default(cuid())
  familyId  String
  family    FontFamily @relation(fields: [familyId], references: [id], onDelete: Cascade)
  /** "400", hoặc dải "100 900" cho variable font. */
  weight    String
  /** normal | italic */
  style     String
  /** "" = không giới hạn. Dùng "" thay null để @@unique có hiệu lực trên Postgres. */
  unicodeRange String @default("")
  /** vietnamese | latin-ext | latin | "" — nhãn để hiển thị. */
  subset    String @default("")
  /** Mã cảnh báo lúc tải lên (missing_vietnamese, restricted_embedding) — màn Font hiện lại. */
  warnings  String[] @default([])
  assetId   String
  asset     Asset  @relation(fields: [assetId], references: [id], onDelete: Restrict)
  createdAt DateTime @default(now())

  @@unique([familyId, weight, style, unicodeRange])
}

model Release {
  // …các cột hiện có…
  /** FontSeal. Null ở release tạo trước tính năng này, nghĩa là không có font động. */
  fonts Json?
}
```

**Bản niêm phong:**

```ts
type FontSeal = {
  families: {
    slug: string;
    cssName: string;
    faces: { key: string; weight: string; style: string; unicodeRange: string }[];
  }[];
};
```

**Token đi kèm.** Mỗi `FontFamily` sở hữu đúng một hàng `Token`:

| Trường | Giá trị |
|---|---|
| `name` | `font-<slug>` |
| `category` | `'font'` |
| `custom` | `true` |
| `value` | `"<cssName>", <fallback>` |
| `aiDescription` | `Họ font <cssName> (<nguồn>), weight …` |

- Hàng token được tạo, sửa và xoá **chỉ qua module font**.
- `DELETE /api/design-tokens/[id]` từ chối token thuộc một họ font, với mã 409 và lời nhắn
  "Xoá ở màn Font".

**Slug** sinh từ `cssName`: bỏ dấu tiếng Việt, chữ thường, nối bằng `-`. Slug mới bị từ
chối khi trùng tên một token đã có, kể cả token tĩnh như `font-display`. Ngoại lệ duy nhất là
script chuyển font của gói (mục 5.2): nó được nhận lại hàng token tự tạo cùng tên
(`font-newyork`, `font-gilroy`) thay vì bị từ chối.

**Tên họ dành riêng.** Trong CSS, tên họ font không phân biệt hoa thường. Một họ tải lên
tên "Gilroy" sẽ **trộn** với `@font-face` tĩnh tên `gilroy`. Vì vậy `cssName` bị từ chối
(mã `name_reserved`) khi trùng, không phân biệt hoa thường, với:
- một họ có sẵn trong `builtin.ts` (mục 5), tức là Inter / Inter Variable;
- một tên đứng trong chuỗi dự phòng của các biến `--font-*` ở `src/styles/tokens.css` của
  lõi, ví dụ "Inter", "Helvetica Neue", "Arial". Một họ tải lên tên "Inter" sẽ được các chuỗi
  dự phòng dùng tới và đổi âm thầm cách hiện của trang đang chạy;
- **không** tính tên trong CSS của gói. "SF Pro Display", "newYork", "gilroy" đứng trong
  chuỗi của gói chính vì gói chờ kho font cung cấp chúng. Sau mục 5.2, gói không còn
  `@font-face` nào để trộn vào;
- một từ khoá chung (`serif`, `sans-serif`, `monospace`, `system-ui`…);
- một `FontFamily` khác.

Lời nhắn gợi ý tên khác, ví dụ "Gilroy Web".

## 5. Họ font có sẵn và font của gói

### 5.1 Họ có sẵn của lõi (chỉ đọc)

`src/lib/fonts/builtin.ts` khai danh sách tĩnh, giờ **chỉ còn Inter**:

| Họ | Token | File |
|---|---|---|
| Inter Variable | `font-display`, `font-body` (giá trị mặc định của lõi), `lv-font-body` (gói MaiMoney) | `/fonts/inter-*.woff2` |

- Test `builtin.test.ts` đọc `@font-face` trong `src/styles/base/typography.css` rồi so với
  danh sách này, để hai bên không lệch nhau.
- `categorize()` trong `src/lib/setup/design-tokens.ts` xếp token tên `font-*` / `lv-font-*`
  mà giá trị là font stack vào hạng `'font'`; `font-size-*`, `font-weight-*` (nếu có) giữ
  `typography`. Hàm nhập phải **cập nhật hạng cho hàng đã có**, không chỉ hàng mới. Nhập
  token đã chạy trong `scripts/bootstrap.sh`, nên mỗi môi trường tự sửa khi deploy.
- **Luật gói dự án** (ghi vào `projects/example/README.md`): gói **không** mang file font hay
  `@font-face`. Gói chỉ được đặt biến (`--font-display: "SF Pro Display", …`) trỏ tới tên họ
  có trong kho font. Thêm font là việc ở Cài đặt › Font.

### 5.2 Chuyển font của gói MaiMoney vào kho (một lần mỗi môi trường)

Script `scripts/fonts-adopt.ts` (chạy bằng `pnpm fonts:adopt`), dùng chung `service.ts` với
đường tải file nên đi qua đúng các bước kiểm tra, cắt bộ chữ và khoá theo nội dung.

**Đầu vào:** đường dẫn một file CSS có `@font-face` (mặc định
`projects/<QUILDER_PROJECT>/styles/fonts.css`), `--actor <email>` để ghi
`licenseConfirmedBy` và AuditLog, `--apply` (không có thì chỉ in kế hoạch).

**Các bước:**

1. Đọc mọi khối `@font-face`: `font-family`, `font-weight`, `font-style`, `unicode-range`,
   `src: url(...)`. Đổi `/p/<x>` thành `projects/<gói>/public/<x>` để tìm file.
2. Gom theo tên họ (không phân biệt hoa thường). Ba họ hiện có:

   | Họ (`cssName` giữ nguyên chữ hoa thường như CSS) | `slug` | Token | Face |
   |---|---|---|---|
   | SF Pro Display | `sf-pro-display` | `font-sf-pro-display` (mới) | 400/500/600/700, woff2 → giữ nguyên byte, giữ `unicode-range` của CSS |
   | newYork | `newyork` | `font-newyork` (**nhận lại** hàng có sẵn) | 400 normal + italic, ttf → cắt sang woff2 |
   | gilroy | `gilroy` | `font-gilroy` (**nhận lại** hàng có sẵn) | 300/400/500/600/700, otf → cắt sang woff2 |

3. Nhận lại token: hàng `Token` cùng tên `font-<slug>` mà `custom: true` thì gắn vào họ, đổi
   hạng sang `font` và **giữ nguyên `value`**. Giá trị đó đang được trang dùng, và đổi chuỗi
   fallback là đổi cách hiện của trang. Hàng tĩnh trùng tên thì dừng và báo lỗi.
4. `source = 'upload'`, `licenseConfirmedBy = <actor>`, `licenseNote` lấy từ comment đầu
   `fonts.css`. Với SF Pro là "Chủ dự án chọn ship SF Pro để khớp Figma — quyết định pháp
   lý 08/09/2026".
5. **Chạy lại không tạo thêm gì.** Họ đã có với cùng tập sha của các face thì bỏ qua và in
   `đã có`.

**Thứ tự ở mỗi môi trường (local, staging, product):**

1. Deploy bản có tính năng font. Lúc này `fonts.css` của gói vẫn còn `@font-face`.
2. `pnpm fonts:adopt --actor <email>`, xem kế hoạch, rồi chạy lại với `--apply`. Từ đây
   canvas có `@font-face` từ cả hai nguồn, cùng tên họ và cùng file gốc, nên chữ không đổi.
3. Người dùng **Publish** một lần để `Release.fonts` có ba họ.
4. Ở **repo gói** (người dùng tự làm): xoá các khối `@font-face` trong `fonts.css` (giữ
   khối `:root` đè `--font-display` / `--font-body`), rồi xoá
   `projects/maimoney/public/fonts/`. Deploy gói.
5. Kiểm: trang site không còn request nào tới `/p/fonts/`, mọi file font tải từ `/mm-font/…`.

**Hệ quả đã chấp nhận** (giống lần chuyển ảnh ngày 10/11/2026): lùi về release tạo **trước**
bước 3 thì `StyleBundle` của release đó trỏ `/p/fonts/…` không còn file, nên chữ rơi về
fallback (system-ui / Inter). Release từ bước 3 trở đi không bị ảnh hưởng.

## 6. Đường đi của CSS

### 6.1 Sinh CSS — hàm thuần

`fontFaceCss(seal: FontSeal): string` (`src/lib/fonts/css.ts`) sinh cho mỗi face:

```css
@font-face {
  font-family: "<cssName đã escape>";
  src: url("/mm-font/<key>") format("woff2");
  font-weight: <weight>;
  font-style: <style>;
  font-display: swap;
  unicode-range: <range>;   /* bỏ dòng này khi range rỗng */
}
```

Khai mọi họ trong kho không tốn băng thông: trình duyệt chỉ tải file của họ, weight và
unicode-range mà trang thật sự dùng.

### 6.2 Bản nháp — thấy ngay

- `draftFontSeal()` đọc `FontFamily` và `FontFace` từ DB, cache bằng `unstable_cache` với
  tag `fonts`.
- `draftFontFaceCss()` = `fontFaceCss(draftFontSeal())`.
- In thành `<style data-mm-fonts>` cạnh `<style data-mm-tokens>` ở `/render/[pageId]`,
  `/render/component/[id]` và `/preview/[pageId]`.
- Mọi thao tác ghi font gọi `revalidateTag('fonts')`. Canvas nạp lại iframe là thấy.

### 6.3 Publish — niêm phong

- Trong transaction của `src/app/api/publish/route.ts`, cạnh `tokenSnapshot`, chụp
  `fonts = draftFontSeal()` (đọc thẳng, không qua cache) vào `Release.fonts`.
- Token font đã nằm trong `Release.tokens`, vì `custom-tokens.ts` được mở cho hạng `font`
  (mục 6.5).
- `(site)/[[...slug]]/page.tsx` và `/preview/release/[id]` in
  `fontFaceCss(release.fonts ?? { families: [] })`.
- **Phạm vi:** giống token màu hiện nay, publish bất kỳ trang nào cũng đưa bộ font hiện tại
  lên cho toàn site. Rollback thì dùng bản niêm phong của release được chọn.

### 6.4 Nhãn "Chưa publish"

Màn Font so phần niêm phong của từng họ trong bản nháp với release mới nhất. Họ nào khác
(thêm, bớt hay thay face, đổi `cssName`) thì mang nhãn **Chưa publish**.

### 6.5 Token font trong `custom-tokens.ts`

- **Không phải sửa** (cập nhật 11/11/2026). Từ 21/10 mọi token tự tạo qua
  `isSafeTokenValue` (`src/lib/design/token-value.ts`): chặn `; { } < > \ ! @`, xuống dòng,
  `url(`, `expression(`, `image-set(`, comment; bắt ngoặc cân và nháy chẵn. Font stack
  `"Be Vietnam Pro", system-ui, sans-serif` đi qua được, ở cả nhánh đọc DB lẫn
  `tokenCssFromSeal`.
- Module font vẫn kiểm `fallback` bằng chính `isSafeTokenValue` **trước khi ghi**, để lỗi
  hiện ngay ở hộp tải lên thay vì token bị lặng lẽ bỏ khi phát.

### 6.6 Route `/mm-font/[...key]`

- Công khai, không cần đăng nhập. Không phải sửa middleware: `matcher` của
  `src/middleware.ts` bỏ qua mọi đường dẫn có dấu chấm, và khoá font luôn có đuôi file.
- **Chỉ nhận** khoá có prefix `public/`, đuôi `woff2`, `woff`, `ttf` hoặc `otf`, và không có
  `..`, `//` hay `\`. Các trường hợp khác trả 404.
- Đọc object bằng S3 client có sẵn (`src/lib/assets/s3.ts`) rồi trả về với:
  - `Content-Type`: `font/woff2`, `font/woff`, `font/ttf` hoặc `font/otf`;
  - `Cache-Control: public, max-age=31536000, immutable`, an toàn vì khoá đã băm theo nội
    dung;
  - `ETag`.
- Không kiểm `FontFace` hay `Asset` trong DB. File của release cũ có thể đã rời bảng
  `Asset` mà vẫn được giữ trên S3 bởi `AssetHold`; mọi object dưới `public/` vốn đã công
  khai trên CDN.

## 7. Tải file font từ máy

Module `src/lib/fonts/` chỉ chạy phía server. Thư viện mới: **`fontkit`** (JS thuần) để
đọc metadata, **`subset-font`** (harfbuzz dạng wasm) để cắt bộ chữ và xuất woff2.

### 7.1 Các bước

1. **Nhận diện kiểu file** bằng `sniff.ts` đã mở rộng.
   - Kiểu hợp lệ: woff2, woff, ttf, otf.
   - `ttcf` trả về `collection_unsupported`.
   - Trên 10 MB (`MAX_ASSET_BYTES`) trả về `too_large`.
2. **Đọc metadata** (`inspect.ts`):
   - **Tên họ:** name ID 16 (typographic family), không có thì ID 1. Không có cả hai thì
     người dùng phải nhập tay (`name_required`).
   - **Weight:** `OS/2.usWeightClass`.
   - **Style:** `italic` khi bit 0 của `OS/2.fsSelection` bật, hoặc `post.italicAngle ≠ 0`.
   - **Variable font:** có trục `wght` trong `fvar` thì weight là dải `"<min> <max>"`.
3. **Cảnh báo.** Không chặn, vẫn cho lưu:
   - `missing_vietnamese`: thiếu một trong các glyph ạ ả ã ế ộ ữ ơ ư Ư Đ. Không kiểm ₫: thử
     ngày 16/10 cho thấy `gilroy-bold.otf` (bản SVN, có đủ dấu) không có ₫, nên kiểm ₫ sẽ
     cảnh báo sai.
   - `restricted_embedding`: bit "Restricted License" (`0x0002`) của `OS/2.fsType` bật.
4. **Chuyển định dạng** (`convert.ts`):
   - TTF, OTF, WOFF: cắt bằng `subset-font` theo tập ký tự ở 7.2 và xuất woff2.
     - Giữ tính năng OpenType mặc định (kerning, ligature) và trục variable.
     - Face nhận `unicodeRange` = tập ký tự đó và `subset = ""`.
     - Mỗi lần xử lý tối đa 30 giây; quá thì trả `too_large`, kèm gợi ý dùng woff2 đã cắt sẵn.
   - WOFF2 tải lên: giữ nguyên byte, không cắt; `unicodeRange = ""`.
5. **Lưu file** qua `uploadAsset` có sẵn: khoá theo nội dung, chống trùng, thư mục
   `fonts/<slug>`.
6. **Ghép vào họ** (`service.ts`), trong một transaction:
   - Chưa có họ cùng `cssName` (không phân biệt hoa thường): tạo `FontFamily` và token.
   - Đã có: thêm `FontFace`.
   - Trùng `(weight, style, unicodeRange)`: **thay** `assetId` của face cũ và trả
     `replaced: true`. File cũ thành asset không còn ai dùng và đi theo luồng thùng rác
     bình thường.
   - Ghi `AuditLog` và gọi `revalidateTag('fonts')`.

### 7.2 Tập ký tự khi cắt

Hợp của ba bộ `latin`, `latin-ext` và `vietnamese` theo cách Google chia, gồm cả
U+0102–0103, U+0110–0111, U+0128–0129, U+0168–0169, U+01A0–01A1, U+01AF–01B0,
U+0300–0301, U+0303–0304, U+0308–0309, U+0323, U+0329, U+1EA0–1EF9 và U+20AB (₫). Hằng số
nằm ở `src/lib/fonts/unicode.ts`.

### 7.3 Gửi hai bước

- `dryRun: true` chỉ chạy bước 1–3 và trả kết quả đọc được, không lưu gì.
- Lần gửi thật mang kèm phần người dùng sửa: `family`, `weight`, `style`, `fallback`.
- File font nhỏ, gửi hai lần không đáng kể, và server không phải giữ file tạm.

### 7.4 Fallback mặc định

| Lựa chọn | Chuỗi |
|---|---|
| Sans (mặc định) | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| Serif | `Georgia, "Times New Roman", serif` |
| Mono | `ui-monospace, Menlo, Consolas, monospace` |
| Tự gõ | Kiểm bằng `isSafeTokenValue` (`src/lib/design/token-value.ts`) |

## 8. Nhập từ Google Fonts

- **Đầu vào:** `{ family, weights?, italic? }`. `family` là tên ("Be Vietnam Pro") hoặc link
  `fonts.google.com/specimen/Be+Vietnam+Pro`. Mặc định lấy mọi weight, có italic.
- **Gọi API** `https://fonts.googleapis.com/css2?family=…&display=swap` với User-Agent của
  Chrome bản mới, để Google trả woff2.
  1. Thử dải variable trước: `:ital,wght@0,100..900;1,100..900`, hoặc không có `ital` khi
     không lấy italic.
  2. Không được (mã 400) thì thử lần lượt từng weight 100–900 × normal/italic, và giữ
     những tổ hợp trả 200.
  3. Có `weights` thì chỉ thử các weight đó.
- **Đọc phản hồi** (`google-parse.ts`, hàm thuần). Mỗi khối `@font-face` có một comment
  `/* <subset> */` đứng trước.
  - Chỉ giữ `vietnamese`, `latin-ext` và `latin`.
  - Mỗi khối thành một face, mang đúng `unicode-range` của Google và `subset` = tên bộ.
- **Tải file** woff2 từ `fonts.gstatic.com` rồi qua `uploadAsset`; không cắt lại.
- **Ghi nhận:** `source = 'google'`, `googleFamily`, `licenseNote = "Google Fonts (OFL/Apache)"`.
  Không cần tick giấy phép.
- **Giới hạn:** mỗi request 10 giây; tối đa 60 file mỗi lần nhập.
- **Lỗi:**
  - `google_not_found`: Google trả 400 với mọi tổ hợp.
  - `google_unreachable`: lỗi mạng hoặc hết giờ. Lời nhắn: *"Server không kết nối được
    Google Fonts. Hãy tải font về máy rồi dùng mục Tải file font."* Builder nội bộ
    (trong mạng nội bộ) có thể không ra được Internet. Claude đi đường vòng bằng cách tải zip về
    máy rồi gọi `upload_font` với `filePath`.

## 9. Giấy phép

- **Tải file hoặc URL:** bắt buộc `licenseConfirmed: true` (mã `license_required` nếu thiếu).
  - Ở màn hình là ô tick *"Tôi có quyền dùng font này trên web"*.
  - Lưu `licenseConfirmedBy` và `licenseNote` (tuỳ chọn).
- **Qua MCP:** mô tả của `upload_font` dặn Claude **phải hỏi người dùng**, không được tự
  điền `licenseConfirmed`.
- **Cờ cấm nhúng** (`restricted_embedding`) chỉ cảnh báo. Người tick xác nhận chịu trách
  nhiệm.

## 10. API và quyền

| Route | Quyền | Việc |
|---|---|---|
| `GET /api/fonts` | read | Danh sách: họ tải lên, họ có sẵn, các face, chỗ dùng, cảnh báo, trạng thái chưa publish |
| `POST /api/fonts` | write | Multipart (`file`, `family?`, `weight?`, `style?`, `fallback?`, `licenseConfirmed`, `licenseNote?`, `dryRun?`), hoặc JSON `{ sourceUrl, … }` hay `{ google: {…} }` |
| `PATCH /api/fonts/[id]` | write | `cssName`, `fallback`, `licenseNote`. Đổi `cssName` thì cập nhật luôn giá trị token |
| `DELETE /api/fonts/[id]/faces/[faceId]` | write | Xoá một face. Chặn khi đó là face cuối của một họ đang được dùng |
| `DELETE /api/fonts/[id]` | **admin** | Xoá họ, face và token. Chặn (409, kèm danh sách chỗ dùng) khi còn nơi dùng |
| `GET /mm-font/[...key]` | công khai | Mục 6.6 |

- `POST /api/fonts` được thêm vào danh sách route của service token
  (`src/lib/auth/service-scope.ts`).
- Mọi thao tác ghi đều ghi `AuditLog`.

**Phản hồi của `POST`:**

```ts
{
  ok: true,
  dryRun: boolean,
  family: { id?: string; slug: string; cssName: string; token: string; created: boolean },
  faces: { weight: string; style: string; subset: string; bytes: number; replaced: boolean }[],
  warnings: { code: 'missing_vietnamese' | 'restricted_embedding'; message: string }[],
}
```

**Mã lỗi:**

| Mã | HTTP |
|---|---|
| `not_font` | 415 |
| `collection_unsupported` | 415 |
| `too_large` | 413 |
| `name_required` | 422 |
| `name_reserved` | 409 |
| `slug_taken` | 409 |
| `license_required` | 422 |
| `google_not_found` | 404 |
| `google_unreachable` | 502 |
| `in_use` | 409 |

Lời nhắn bằng tiếng Việt và nói rõ cách xử lý.

**Đếm chỗ dùng** (`usage.ts`):
- Quét bản nháp và bản live của trang, component và **preset** để tìm `"$token":"font-<slug>"`.
- Tách từ phép kiểm hiện có của `DELETE /api/design-tokens/[id]` thành helper dùng chung;
  route đó cũng được quét thêm preset.
- Trả về số lượng và danh sách: tên, link editor.

## 11. Màn hình

### 11.1 Vị trí

Trang Cài đặt có thêm hai tab **Chung | Font** (`SettingsTabs`, theo mẫu `AccountTabs`).
Font nằm ở `/builder/settings/fonts`; mọi tài khoản đều mở được, còn nút thao tác ẩn hoặc
hiện theo quyền.

### 11.2 Danh sách

```
Font                                   [Nhập từ Google Fonts] [Tải file font]
ⓘ Sửa font hiện ngay trong builder; site thật đổi sau lần Publish tới.

┌──────────────────────────────────────────────────────────────────────┐
│ Tiền về nhanh — Ắ ẩ ữ ộ ₫ 0123      (chữ xem trước, render bằng font đó) │
│ Be Vietnam Pro   [font-be-vietnam-pro ⧉]   Google Fonts   Chưa publish │
│ 100–900 · italic         Dùng ở 4 trang · 1 component          ▸ │
├──────────────────────────────────────────────────────────────────────┤
│ gilroy           [font-gilroy ⧉]   Tải lên (chuyển từ gói 11/2026)       │
│ 300 400 500 600 700      Dùng ở 12 trang                          ▸ │
├──────────────────────────────────────────────────────────────────────┤
│ Inter Variable   [font-body ⧉]   Có sẵn trong lõi (chỉ đọc)             │
│ 100–900                  Font mặc định khi chưa đặt font nào             │
└──────────────────────────────────────────────────────────────────────┘
```

- **Chữ xem trước:**
  - Màn này tự in `@font-face` của mọi họ: họ tải lên dùng `draftFontFaceCss()`, họ có sẵn
    sinh từ `builtin.ts`. Lý do: builder không nạp `tokens.css` hay `typography.css` của site.
  - Thiếu glyph tiếng Việt thì hàng mang huy hiệu cảnh báo.
- **Mở một hàng ra** (chỉ họ tải lên):
  - danh sách face: weight, style, bộ chữ, dung lượng KB, nút **Thay file**, nút **Xoá**;
  - ô fallback (mục 7.4);
  - tên họ CSS (sửa được);
  - ghi chú giấy phép, kèm ai đã xác nhận;
  - danh sách chỗ dùng, mỗi dòng là link sang editor;
  - nút **Xoá họ**: chỉ admin thấy, và bị khoá khi còn chỗ dùng.
- **Họ có sẵn:** hàng không mở được, chỉ hiện token và chỗ dùng.

### 11.3 Hộp "Tải file font"

- Ô kéo thả nhận nhiều file cùng lúc, dùng lại ô kéo thả của phần xuất/nhập trang.
- Mỗi file gửi một lần `dryRun` rồi thành một dòng: tên file, tên họ, weight, style, cảnh
  báo. Ba ô sau sửa được ngay trên dòng.
- Các dòng cùng tên họ được gom thành một họ; chọn fallback cho mỗi họ mới.
- Có ô tick giấy phép và ô ghi chú, rồi bấm **Lưu**. Lần lượt gửi thật từng file, có thanh
  tiến độ; file lỗi được báo ngay trên dòng của nó.

### 11.4 Hộp "Nhập từ Google Fonts"

Gồm ô tên hoặc link, các ô chọn weight (mặc định tất cả), công tắc italic, nút
**Tìm** (chạy `dryRun` và liệt kê face tìm thấy), rồi nút **Nhập**.

### 11.5 Inspector

Mục "Chữ" của Inspector hiện **chưa có** bộ chọn họ font (cập nhật 11/11/2026), nên phải
thêm mới:

- Một ô chọn `typography.family` đặt đầu mục "Chữ", liệt kê token hạng `font`. Mỗi dòng
  hiện tên họ, vẽ bằng chính font đó: vỏ builder in `draftFontFaceCss()` cùng `@font-face`
  của Inter.
- Giá trị ghi vào node là `{ $token: 'font-<slug>' }`, như mọi `TokenRef` khác.
- Cuối danh sách có link "Quản lý font →" sang `/builder/settings/fonts`.

## 12. MCP

### 12.1 `list_fonts` (chỉ đọc)

- **Trả về:**
  - danh sách `{ cssName, token, source: 'builtin' | 'upload' | 'google', faces, fallback,
    usage: { pages, components, presets }, warnings, unpublished }`.
- **Mô tả tool dặn Claude:**
  - *"Kiểm font đã có trước khi tải mới."*
  - *"Gán font bằng `apply_ops`, `setStyle` với `typography.family: { $token: '<token>' }`."*
  - *"Font mới chỉ lên site thật sau khi người dùng Publish."*

### 12.2 `upload_font` (ghi)

- **Nguồn:** đúng một trong ba: `filePath` | `sourceUrl` | `google: { family, weights?, italic? }`.
- **Tham số tuỳ chọn:** `family`, `weight`, `style` (để đè metadata), `fallback`
  (`sans` | `serif` | `mono` | chuỗi tự do), `licenseNote`, `dryRun`.
- **Bắt buộc với `filePath` và `sourceUrl`:** `licenseConfirmed: true`.
- **Mô tả tool dặn Claude:**
  - mỗi lần gọi một file; cả bộ font thì gọi nhiều lần;
  - chạy `dryRun` trước để cho người dùng xem tên họ và weight đọc được;
  - hỏi người dùng về giấy phép.
- **`filePath`:** `mcp/server.mjs` chặn nhánh này giống `upload_asset`.
  1. Đọc file trên máy.
  2. Gửi multipart tới `POST /api/fonts` kèm Bearer token.
  3. Phía server, tool từ chối `filePath`, giống `asset-tools.ts:106`.
- **Kết quả:** giống phản hồi `POST /api/fonts`.

### 12.3 Đi kèm

- Mô tả `search_tokens`: thêm hạng `font`.
- `mcp/contract.snapshot.json` và `mcp/README.md`: thêm hai tool.

## 13. Xuất/nhập trang giữa môi trường

Bám các quyết định của spec `2026-10-14-page-import-export-design.md`.

### 13.1 Xuất

- **Gói có thêm `fonts[]`** cho mỗi họ font tải lên mà trang hoặc component dùng tới
  (`"$token":"font-<slug>"` khớp một `FontFamily`):
  - `slug`, `cssName`, `fallback`, `source`, `googleFamily`, `licenseNote`;
  - `faces[]`, mỗi face gồm `weight`, `style`, `unicodeRange`, `subset` và `assetRef` trỏ
    vào `assets[]`.
- File font đi cùng đường với asset: `files/<sha256>.<ext>`.
- Token của họ font **không** xuất riêng trong `tokens[]`.
- Họ có sẵn không xuất.

### 13.2 Nhập

So khớp theo `slug`:

| Ở đích | Hành động |
|---|---|
| Chưa có họ đó | Tạo họ, các face và token. File qua `uploadAsset` có kiểm sha |
| Có, cùng tập sha của các face | Dùng lại, không làm gì |
| Có, khác | **Dùng bản ở đích**, giống luật component trùng khoá. Cảnh báo cụ thể ở mục "Việc cần làm sau khi nhập", ví dụ *"Gilroy Web ở đây thiếu weight 300 so với gói — vào Cài đặt › Font để tải thêm"* |
| `cssName` trùng một họ khác slug, hoặc trùng họ có sẵn | Blocker, kèm hướng dẫn đổi tên ở nguồn hoặc ở đích |

- Hoàn tác lần nhập **không** xoá họ font đã tạo, giống luật hiện có cho component, token và
  ảnh (`src/lib/transfer/undo.ts`): đó là dữ liệu dùng chung, trang khác có thể đã dùng.

## 14. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Bản Next standalone không mang theo file `.wasm` của harfbuzz/woff2, nên tải font lỗi trên product mà local vẫn chạy | Khai `serverExternalPackages` hoặc `outputFileTracingIncludes` cho `subset-font`; E2E chạy trên bản `next build` + `next start`, không chỉ `next dev`; kiểm trong image Docker trước khi merge |
| `subset-font` chậm hoặc ngốn RAM với font lớn (CJK gần 10 MB) | Trần 10 MB; giới hạn thời gian 30 giây cho một lần xử lý, quá thì `too_large` kèm gợi ý dùng woff2 đã cắt sẵn |
| fontkit đọc sai metadata của font lạ | Bước `dryRun` cho người dùng sửa trước khi lưu |
| Tên họ trùng không phân biệt hoa thường làm trộn `@font-face` | `name_reserved` (mục 4) |
| Băng thông `/mm-font` đi qua server | Cache immutable 1 năm; file nhỏ (30–80 KB); trình duyệt chỉ tải face cần dùng |
| Publish một trang làm đổi font của trang khác dùng chung họ | Đúng như token màu hiện nay; màn Font ghi rõ ở dòng ⓘ và nhãn "Chưa publish" |

## 15. Cấu trúc code

**Mới:**

```
src/lib/fonts/
  builtin.ts          Inter của lõi (+ builtin.test.ts so với typography.css)
  adopt.ts            đọc @font-face của một file CSS → kế hoạch nhận vào kho (thuần, mục 5.2)
  unicode.ts          tập ký tự latin + latin-ext + vietnamese
  inspect.ts          fontkit → metadata + cảnh báo
  convert.ts          subset-font → woff2
  google.ts           gọi css2 + tải file
  google-parse.ts     đọc phản hồi css2 (thuần)
  css.ts              FontSeal → @font-face (thuần)
  seal.ts             DB → FontSeal (bản nháp, publish)
  service.ts          tạo / thêm face / thay / xoá, đồng bộ token, audit, revalidate
  usage.ts            đếm chỗ dùng token (dùng chung với design-tokens)
src/app/api/fonts/route.ts
src/app/api/fonts/[id]/route.ts
src/app/api/fonts/[id]/faces/[faceId]/route.ts
src/app/mm-font/[...key]/route.ts
src/app/(builder)/builder/settings/fonts/page.tsx
src/components/builder/SettingsTabs.tsx
src/components/builder/fonts/{FontList,FontRow,FontUploadDialog,GoogleFontDialog}.tsx
src/lib/ai/font-tools.ts            list_fonts, upload_font
scripts/fonts-adopt.ts              chuyển @font-face của gói vào kho (mục 5.2)
prisma/migrations/<ts>_dynamic_fonts/
```

**Sửa:**

| Nhóm | File |
|---|---|
| Asset | `src/lib/assets/sniff.ts` (TTF, OTF, TTC), `kind.ts` (`UPLOAD_ACCEPT`) |
| Token | `src/lib/setup/design-tokens.ts` (`categorize` → hạng `font`), `src/app/api/design-tokens/[id]/route.ts` (chặn xoá token của họ font). `custom-tokens.ts` không đổi |
| Gói dự án | `projects/example/README.md` (luật: gói không mang file font), `package.json` (`fonts:adopt`) |
| Phát CSS | publish route, `(site)/[[...slug]]/page.tsx`, `/render/[pageId]`, `/render/component/[id]`, `/preview/[pageId]`, `/preview/release/[id]` |
| Giữ file | `src/lib/builder/asset-references*.ts` (quét `Release.fonts` và `FontFace`) |
| Quyền | `src/lib/auth/service-scope.ts` |
| Builder | `settings/page.tsx` (tab), `Inspector.tsx` + `controls.tsx` (bộ chọn họ font mới, link "Quản lý font →") |
| AI/MCP | `src/lib/ai/tools.ts` (đăng ký và mô tả `search_tokens`), `mcp/server.mjs`, `mcp/contract.snapshot.json`, `mcp/README.md` |
| Xuất/nhập | `src/lib/transfer/{manifest,export,import-plan,commit}.ts` |
| Hạ tầng | `package.json` (`fontkit`, `subset-font`), `next.config.mjs` (`serverExternalPackages` và tracing `.wasm` của harfbuzz) |

## 16. Kiểm thử

### Unit (vitest), không gọi mạng thật

- **`sniff`:** nhận đúng TTF, OTF, WOFF, WOFF2; TTC trả `collection_unsupported`.
- **`inspect`** trên file mẫu có giấy phép OFL, đặt trong `tests/fixtures/fonts/`:
  - tên họ lấy ID 16 trước ID 1;
  - đúng weight, italic và dải variable;
  - phát hiện thiếu tiếng Việt và cờ `fsType`.
- **`convert`:** woff2 đầu ra còn đủ glyph ở mục 7.2 và còn trục `wght`.
- **`google-parse`** trên một phản hồi css2 đã lưu: chỉ giữ ba bộ, đúng unicode-range và
  URL.
- **`css`:**
  - escape tên họ có ký tự lạ;
  - bỏ dòng `unicode-range` khi rỗng;
  - có `font-display: swap`;
  - URL dạng `/mm-font/<key>`.
- **`categorize`:** `font-gilroy` có giá trị font stack ra hạng `font`; `font-size-*` giữ
  `typography`; chạy lại thì cập nhật hạng của hàng cũ.
- **`adopt`:** đọc `fonts.css` mẫu ra đúng ba họ và đúng số face; đổi `/p/x` sang đường
  file trong gói; chạy hai lần thì lần hai ra "đã có"; token tự tạo cùng tên được nhận lại
  và giữ nguyên `value`; token tĩnh trùng tên thì báo lỗi.
- **Route `/mm-font`:** chặn `../`, đuôi lạ, khoá ngoài `public/`.
- **`service`:**
  - tạo họ kèm token;
  - thay face trùng khoá;
  - `name_reserved` với họ có sẵn, so không phân biệt hoa thường;
  - chặn xoá face cuối của một họ đang dùng.
- **`usage`:** đếm cả trang, component và preset.
- **`builtin.test.ts`:** danh sách khớp `@font-face` trong `typography.css`.
- **Xuất/nhập:**
  - xuất rồi nhập lại ra đúng họ font;
  - đích khác thì sinh cảnh báo.

### E2E (Playwright, trên stack e2e của dự án)

Stack e2e chạy `next dev` (một phần suite cần `window.__mm`). Rủi ro thiếu `.wasm` ở bản
standalone vì vậy được kiểm riêng, bằng một lần tải font thật vào image Docker
(`pnpm docker:build && pnpm docker:up`) trước khi merge.

1. **Màn Font:** tải một TTF có giấy phép OFL; thấy dòng xem trước và token.
2. **Bản nháp:** gán token trong Inspector; trong iframe canvas,
   `document.fonts.check('16px "<cssName>"')` là `true` sau khi nạp.
3. **Publish:** trang site có `<style data-mm-fonts>`; file được tải từ `/mm-font/…` với
   mã 200 và header `immutable`.
4. **Niêm phong:** thay một face, thì site thật **chưa đổi** (bản niêm phong cũ); Publish
   rồi mới đổi.
5. **Xoá:** nút xoá họ bị khoá khi còn trang dùng.
6. **MCP** (`e2e/mcp.spec.ts`): `upload_font` qua `filePath` rồi `list_fonts`; snapshot
   contract khớp.

Nhập Google Fonts thật chỉ kiểm tay trên dev, vì phụ thuộc mạng.

## 17. Triển khai

1. **Migration:** `FontFamily`, `FontFace`, `Release.fonts`. Release cũ có giá trị `null`,
   nghĩa là không có font động, đúng với thực tế.
2. **Deploy** mỗi môi trường (local, dev, product) một lần. `bootstrap.sh` chạy
   `tokens:import`, nên token font cũ tự sang hạng `font`.
3. **Chuyển font của gói** theo đúng thứ tự ở mục 5.2: `pnpm fonts:adopt` → Publish → người
   dùng xoá `@font-face` và file font khỏi repo gói → deploy gói.
4. **Không cần** biến môi trường hay cấu hình CORS nào. Nhập Google Fonts cần server ra
   được Internet; không có thì vẫn dùng được đường tải file.
5. Sau lần deploy đó, thêm font chỉ là thao tác dữ liệu, rồi Publish.
