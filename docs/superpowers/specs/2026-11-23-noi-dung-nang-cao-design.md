# Nội dung nâng cao cho bài viết — thiết kế

Ngày: 23/11/2026 · Trạng thái: chờ duyệt

## 1. Ý định

Bài tin tức của maimoney.com cần **sinh động**, và **mỗi bài có hiệu ứng riêng**: bố cục,
màu, chuyển động khác nhau. Phần lớn bài loại này do AI viết thành HTML. Người dùng
**không muốn deploy mỗi khi có bài mới**. Mục tiêu: deploy **một lần**, từ đó mỗi bài
chỉ còn là dữ liệu.

Cách làm: thêm vào loại bài viết một field **"Nội dung nâng cao"**.
- Field có giá trị → site hiện nó ở chỗ **thân bài**.
- Field trống → hiện **"Nội dung"** (`body`) như hiện nay.

App mobile luôn mở trang bài viết trong WebView (app chỉ gọi API để lấy danh sách bài).
Vì vậy bài nâng cao hiện trong app y như trên web. **Không sửa app, không sửa API cho
app.**

## 2. Mục tiêu / không làm / phản mục tiêu

**Mục tiêu**
- Một field mới trên loại `news`. Field hỗ trợ 3 tầng:
  1. HTML + CSS riêng của bài. CSS được khoanh trong khung bài.
  2. Gắn hiệu ứng có sẵn của builder vào phần tử trong bài bằng thuộc tính.
  3. Khối tương tác cần JavaScript, chạy trong iframe cách ly.
- Field trống thì bài hiện y như hôm nay. HTML không kèm CSS riêng cũng trông như
  nội dung thường, vì cùng nhận kiểu chữ thân bài `ARTICLE_CSS`.
- Mỗi ngôn ngữ có bản nâng cao riêng (lớp phủ `i18n`).
- AI ghi được field này qua `create_entry` / `update_entry`, chỉ trên bản nháp, giống
  mọi field khác. Người bấm Đăng.

**Không làm**
- Không thay **phần đầu bài** (tiêu đề, ngày đăng, tác giả, ảnh bìa). Người dùng đã
  chốt: chỉ thay thân bài. Phần đầu bài vẫn theo khuôn trang chung.
- Không có trình soạn thảo trực quan cho nội dung nâng cao. Builder chỉ cần ô mã và
  nút xem trước.
- Không dùng Shadow DOM, không đặt cả bài vào iframe (xem mục 4).
- Không sửa app mobile, không sửa view API `mobile-news`.

**Phản mục tiêu** (có những điều này thì coi là thất bại, dù chạy được)
- Một bài viết làm hỏng phần còn lại của trang: header, footer, vùng pháp lý bị
  khoá, hoặc trang khác.
- Có `<script>` chạy thẳng trong DOM của trang.
- Phải deploy lại để đăng một bài có hiệu ứng mới.
- Bài `/en` hiện nội dung nâng cao tiếng Việt.
- Phần tử kẹt ở trạng thái ẩn, vì CSS đã "giấu chờ hiệu ứng" mà hiệu ứng không chạy.

## 3. Ràng buộc

- Không có `<script>` trong trang. JS chỉ chạy trong iframe sandbox, như CustomCode
  hiện nay (`src/lib/render/custom-code.ts`, `CustomCodeFrame.tsx`): `allow-scripts`,
  không `allow-same-origin`, có CSP, có bịt `</script>`.
- Sanitize ở **cả** đường ghi lẫn đường đọc, giống field `html` hiện nay
  (`entry-data.ts` và `entryBodies` trong `collection-page.ts`). Siết luật về sau vẫn
  bảo vệ được dữ liệu đã lưu.
- Site tài chính: không gõ con số lãi suất hay lợi nhuận vào chữ. Hiệu ứng `counter`
  chỉ được dùng cho số liệu không phải lãi suất/lợi nhuận. Luật này đưa vào hướng dẫn
  cho AI, không chặn bằng code.
- Tôn trọng "giảm chuyển động" (`prefers-reduced-motion`).
- Loại `news` hiện có `body` (`html`, **required**, maxChars 200000).

## 4. Các cách đã cân nhắc

| Cách | Đánh đổi | Kết luận |
|---|---|---|
| **A. HTML nằm thẳng trong trang, CSS được khoanh bằng cách viết lại selector** (dùng lại `sanitize-css.ts`) | Nhận được font, token, `ARTICLE_CSS` của site. Runtime hiệu ứng dùng `document.querySelector` chạy được. Link `#mục` chạy, Google đọc chữ thật. Cần mở rộng bộ lọc CSS cho `@keyframes`. Rủi ro còn lại: CSS của bài làm xấu chính bài đó. | **Chọn** |
| B. Declarative Shadow DOM | Cách ly selector chặt hơn. Nhưng `ARTICLE_CSS` và kiểu của site không vào được, bài không có CSS riêng sẽ hiện trơn. Runtime phải xuyên shadow root. Link `#mục` hỏng. | Loại |
| C. Cả bài là một iframe | Cách ly tuyệt đối, chạy được JS. Nhưng SEO kém, phải tự chỉnh chiều cao, không theo font của trang. | Chỉ dùng cho tầng 3 |

Người dùng chọn A, và chốt chỉ thay thân bài.

## 5. Thiết kế

### 5.1 Field mới

- Kiểu field mới: `advhtml`. Nhãn trên loại `news`: **"Nội dung nâng cao"**, key
  `advanced`, không bắt buộc.
  - Lý do không dùng lại kiểu `html`: `html` gắn với CKEditor và bộ lọc
    `sanitizeArticleHtml`, vốn chặt có chủ ý. Nới bộ lọc đó sẽ mở rộng cho mọi field
    `html` khác.
- Giá trị là một object:
  ```json
  {
    "html": "<style>…</style><section class=\"hero-chart\">…</section>",
    "widgets": {
      "bieu-do-lai-kep": { "html": "…", "css": "…", "js": "…", "height": 420 }
    }
  }
  ```
  - `html`: tầng 1 và tầng 2. Chứa một hoặc nhiều khối `<style>` cùng markup.
  - `widgets`: tầng 3, tuỳ chọn. Mỗi khối có id, được đặt vào bài bằng
    `<div data-mm-widget="bieu-do-lai-kep"></div>`.
  - Tách `widgets` ra để JS **không bao giờ** nằm trong chuỗi HTML của trang. Phần
    `widgets` dùng lại `CustomCodeDoc` và allowlist host sẵn có.
- Giới hạn kích thước: `maxChars` áp cho tổng chuỗi (mặc định 400000, trần sẵn có của
  `html`).
- `body` hiện đang required. Bổ sung luật **"bắt buộc, trừ khi `advanced` có nội
  dung"**: field-def thêm `requiredUnless: 'advanced'`. *(Đề xuất của mình. Phương án
  khác là tắt required của `body`, nhưng như vậy bài thường mất phép kiểm.)*
- `isBlank` trong `src/lib/collections/i18n.ts` phải coi `{ html: '' }` (chỉ còn khoảng
  trắng hoặc chỉ có `<style>`) là **trống**. Hiện tại object luôn bị coi là đã có nội
  dung.

### 5.2 Ưu tiên hiển thị và ngôn ngữ

- Trong khuôn trang chi tiết bài, ô thân bài hiện là node `part="entry:body"`. Bọc node
  này trong một node `part="entry:advanced"`.
  - `entrySlot` vốn trả `null` khi field trống, và node sẽ render con thật của nó (đã có
    sẵn trong `NodeRenderer.tsx`). Nên **khi trống, `body` hiện ra**, không cần logic
    ưu tiên mới.
  - Việc bọc là sửa **dữ liệu** của khuôn trang, không phải code.
  - Builder kiểm lại: khi hai node cùng mang `data-mm-article` lồng nhau thì không bị
    nhân đôi lề hay độ rộng.
- **Không mượn chéo ngôn ngữ.** Hiện tại `applyEntryLocale` phủ cạn từng field: bản
  `/en` thiếu field nào thì lấy field đó của bản tiếng Việt. Với `advanced`, cách này
  sẽ cho `/en` hiện nội dung nâng cao tiếng Việt đè lên `body` tiếng Anh. Luật mới:
  - Ở ngôn ngữ không mặc định, `advanced` chỉ lấy từ lớp phủ của chính ngôn ngữ đó.
  - Lớp phủ không có `advanced` thì coi là trống, và `body` (tiếng Anh, hoặc tiếng Việt
    theo luật cũ) hiện ra.
  - Cách xử lý giống ngoại lệ đã có cho field `seo`.
- **Bản tiếng Anh rỗng thì không đăng được.** Bản tiếng Việt chỉ có `advanced` (với
  `body` trống) và lớp phủ `en` không có cả `body` lẫn `advanced`: nếu render, `/en` sẽ
  hiện nội dung mẫu của khuôn trang. Luật `requiredUnless` vì thế áp cả ở **đường
  đăng bản dịch** (`EntryLocale`, `set_entry_locale`), không chỉ khi lưu bản gốc. Lớp
  phủ đang được kiểm bằng `allOptional` trong `entry-data.ts`.
  - Thêm một phép kiểm lúc đăng locale: `advanced` của ngôn ngữ đó, hoặc `body` sau
    khi phủ, phải có chữ.
  - *(Quyết định của mình. Không chọn mượn `advanced` tiếng Việt, vì đó là một phản
    mục tiêu.)*

### 5.3 Tầng 1: HTML + CSS khoanh vùng

Hàm mới `sanitizeAdvancedHtml(value, scope)`, chạy ở cả hai đường. Hàm làm bốn việc:

1. **Tách các khối `<style>`** khỏi HTML và gộp chúng thành một chuỗi CSS.
2. **Lọc HTML** bằng `sanitize-html` với allowlist rộng hơn `sanitizeArticleHtml`.
   - Thẻ được phép: các thẻ chữ và khối thường gặp, gồm `section`, `article`,
     `header`, `footer`, `aside`, `div`, `span`, `figure`, `figcaption`, `picture`,
     `source`, `img`, `table` và họ hàng, `details`, `summary`, `blockquote`, `ul`,
     `ol`, `li`, `a`, `h1`–`h6`, `p`, `br`, `hr`, `strong`, `em`, `mark`, `small`,
     `sup`, `sub`, `time`.
   - SVG được phép (danh sách thẻ hình học và gradient), trừ `foreignObject`,
     `script` và `use` trỏ ra ngoài.
   - Thuộc tính được phép: `class` (tự do, vì CSS đã khoanh vùng), `id`, `role`,
     `aria-*`, `alt`, `src`/`srcset` (chỉ `https:` và asset của site), `href`
     (`https:`, `mailto:`, `tel:`, `#`), `width`/`height`, các thuộc tính SVG, và
     `data-mm-fx*` / `data-mm-widget` (xem dưới).
   - Mọi `on*`, `javascript:` và `data-fx` gõ tay đều bị gỡ.
   - `style` inline đi qua cùng bộ lọc CSS với khối `<style>`.
3. **Lọc và khoanh CSS** bằng `sanitize-css.ts`, mở rộng thành một chế độ "bài viết".
   - Phạm vi là `[data-n="<id node ô thân bài>"]`, giống `nodeScope`. Selector
     `body`, `html`, `:root` được đổi thành chính phạm vi đó.
   - Giữ các luật sẵn có: `fixed` → `absolute`, gỡ `@import`, gỡ `url()` nguy hiểm,
     gỡ `expression`, gỡ `<`, gỡ `!important`.
   - **Mới:** cho phép `@keyframes`, và đổi tên theo bài (`ten` → `a<hash>-ten`, hash
     lấy từ entry id). Mọi `animation`/`animation-name` trong cùng CSS được viết lại
     theo tên mới, nên keyframes của hai bài hay của site không đè nhau.
   - Cho phép thuộc tính hiệu ứng theo cuộn bằng CSS (`animation-timeline`,
     `view-timeline`, `scroll-timeline`, `animation-range`).
   - `url()` chỉ nhận `https:` và asset của site.
   - `@font-face` không được phép: bài dùng font của site.
4. **Thêm lớp giảm chuyển động** do hệ thống sinh, có `!important` (chỉ hệ thống được
   dùng). Khi người đọc bật giảm chuyển động, mọi animation trong phạm vi bài chạy
   gần như tức thì (`animation-duration: .01ms; animation-iteration-count: 1`) để
   phần tử về trạng thái cuối, không kẹt ẩn.

Kết quả render: thẻ `<style>` (CSS đã khoanh) đặt ngay trước markup, bên trong node ô
thân bài. Node đó vẫn mang `data-mm-article`, nên `ARTICLE_CSS` vẫn áp.

**Tràn ngang:** cột chữ mặc định rộng 72ch. `ARTICLE_CSS` thêm class
`.tran-ngang` để khối rộng hết màn hình
(`width: 100vw; margin-inline: calc(50% - 50vw)`). Builder kiểm lại để class này không
gây thanh cuộn ngang trên mobile.

### 5.4 Tầng 2: hiệu ứng có sẵn trong bài

- Cách viết trong HTML:
  ```html
  <div data-mm-fx="scroll-reveal" data-mm-fx-params='{"delay":0.2,"shift":"2rem"}'>…</div>
  ```
- **Danh sách hiệu ứng cho phép trong bài** là allowlist: `scroll-reveal`, `parallax`,
  `counter`, `marquee`, `text-split`, `tilt`, `magnetic`, `image-sequence`,
  `video-lazy`.
  - Hiệu ứng của khung site (`nav-*`, `menu-toggle`, `modal`, `cursor`, `app-link`,
    `filter`, `paginate`, `rail-pin`…) không được dùng trong bài.
  - Builder rà lại danh sách với registry thật.
- Ở đường đọc, server làm bốn việc:
  1. Đánh số từng phần tử có `data-mm-fx`, theo dạng `data-mm-fxid="<nodeId>-<n>"`.
  2. Ghi thêm `data-fx="<tên>"` lên phần tử, để CSS sẵn có nhắm vào
     `[data-fx~="…"]` (vd. `tilt`, `magnetic`) áp đúng. Tác giả không gõ được
     `data-fx`, `data-reveal` hay `data-reveal-group` trực tiếp, vì bộ lọc gỡ chúng.
     Chỉ server sinh ra, và luôn kèm một mục manifest.
  3. **Trạng thái ẩn ban đầu của `scroll-reveal`.** Server ghi thêm `data-reveal`
     (hoặc `data-reveal-group` khi tham số có `stagger`). Nhờ vậy `reveal.css` sẵn có
     lo cả trạng thái trước lẫn sau. Trạng thái ẩn chỉ bật khi
     `html[data-reveal-ready="true"]`, nghĩa là JS đã chắc chắn bỏ ẩn được, và
     `reveal.css` đã có nhánh giảm chuyển động. Do đó phần tử **không bao giờ kẹt
     ẩn**.
     - Tham số riêng của bài (không thuộc `paramsSchema` của effect): `shift`
       (độ dịch, vd. `"2rem"`, `"-40px"`). Server đổi `shift` thành
       `style="--reveal-shift:…"` và gỡ khỏi `params` trước khi đưa vào manifest.
     - Muốn kiểu hiện khác (phóng to, trượt ngang…): CSS của bài được viết
       `[data-revealed="true"]` và **giữ nguyên** tiền tố
       `html[data-reveal-ready="true"]`. Đây là ngoại lệ duy nhất mà chế độ CSS bài
       viết không đổi `html` thành phạm vi; phần còn lại của selector vẫn bị khoanh.
  4. Thêm mục vào manifest hiệu ứng của trang: `{ effect, params, selector }`.
- `EffectRuntime` nhận thêm dạng mục có `selector`: dùng `querySelector(selector)`
  thay cho `[data-n=…]`.
  - Tham số vẫn kiểm bằng `paramsSchema.safeParse` sẵn có. Sai thì bỏ qua và ghi cảnh
    báo, không hỏng trang.
  - JSON trong `data-mm-fx-params` hỏng thì coi như không có tham số.
- Giữ nguyên gates (giảm chuyển động, chỉ chuột tinh) và tải lười theo registry.

### 5.5 Tầng 3: khối tương tác

- `<div data-mm-widget="id">` trong HTML được thay bằng `CustomCodeFrame` với
  `widgets[id]`. Dùng nguyên `custom-code.ts`: sandbox, CSP, allowlist host.
- Chiều cao: **tự đo** theo cơ chế sẵn có của `CustomCodeFrame` (postMessage có kẹp
  giới hạn, kiểm `event.source`, sandbox giữ nguyên). Khối nào khai `height` thì dùng
  chiều cao cố định đó. *(Quyết định của mình: tự đo tránh cắt mất widget hoặc để
  khoảng trống ở khổ 390px.)*
- Id không có trong `widgets` thì thẻ bị gỡ.

### 5.6 Builder (trang sửa bài)

- `FieldInput` cho `advhtml` có ba phần:
  - ô mã HTML (textarea font đơn cách);
  - danh sách khối tương tác (mỗi khối gồm id, html, css, js, chiều cao);
  - nút **Xem trước**, mở `/preview/<pageId của khuôn chi tiết bài>?param=<slug>&locale=<vi|en>`.
    - Trang này render bản nháp qua **khuôn thật**, có `EffectRuntime`, nên thấy đủ
      cả 3 tầng.
    - Trang `/builder/content/news/<id>/preview` cũ không dùng được cho việc này: nó
      chỉ là một `<article>` trơn, không có node để khoanh CSS, không chạy hiệu ứng,
      không có bản tiếng Anh.
    - Builder tìm pageId của khuôn theo loại `news` (trang có vai `entry`).
- Không thêm thư viện editor.
- Ô mã hiện danh sách cảnh báo của bộ lọc (những gì đã bị đổi hoặc gỡ), giống panel
  customCss.
- Tab English có ô "Nội dung nâng cao" riêng.

### 5.7 AI

- Tool `create_entry` / `update_entry` nhận field `advanced` như mọi field. Ranh giới
  chỉ ghi bản nháp giữ nguyên.
- Thêm hướng dẫn cho AI, ví dụ một mục trong `get_node_schema` hoặc tool
  `get_article_guide`, gồm:
  - thẻ và thuộc tính được phép;
  - cách viết `<style>` (không cần tự đặt tiền tố);
  - danh sách hiệu ứng kèm tham số (lấy từ `paramsSchema`);
  - class `.tran-ngang`;
  - cách khai `widgets`;
  - luật tài chính (không có số lãi suất/lợi nhuận).
- Tool trả về danh sách cảnh báo sanitize khi ghi, để AI tự sửa.

### 5.8 API công khai

- **Không trả `advanced` ra API công khai.** App mở WebView nên không cần field này.
  CSS đã khoanh của field chỉ khớp với node của khuôn trang, ngoài trang thì vô dụng.
  - `public-shape` bỏ qua kiểu `advhtml`.
  - API có thêm cờ `hasAdvanced: boolean` cho ai cần biết bài là bài nâng cao.
  - *(Quyết định của mình.)*

### 5.9 Phần phụ thuộc chữ của bài

Mô tả ngắn, tìm kiếm nội bộ, `og:description` tự sinh và đếm thời gian đọc (nếu có):
khi `advanced` có nội dung, lấy chữ thuần từ `advanced.html` (bỏ `<style>`).
Builder rà các chỗ đang đọc `body` để lấy chữ.

## 6. Bàn giao một lần

Một lần deploy gồm:
- kiểu field `advhtml`;
- sanitizer HTML và chế độ CSS bài viết;
- `@keyframes` đổi tên;
- `requiredUnless`;
- luật không mượn chéo ngôn ngữ;
- manifest có `selector` trong `EffectRuntime`;
- widget;
- FieldInput;
- hướng dẫn cho AI.

Sau deploy, phần còn lại là **dữ liệu**, làm trên builder, không deploy:
1. Thêm field `advanced` vào loại `news`.
2. Bọc ô `entry:body` trong ô `entry:advanced` ở khuôn trang chi tiết bài.

## 7. Kiểm thử

- **Bộ lọc HTML:** gỡ `<script>`, `on*`, `javascript:`, `data-fx` gõ tay,
  `foreignObject`. Giữ `class`, `data-mm-fx*`, SVG cơ bản.
- **Bộ lọc CSS chế độ bài viết:**
  - selector được khoanh; `body`/`:root` đổi thành phạm vi;
  - `fixed` → `absolute`; `@import` bị gỡ;
  - `@keyframes` đổi tên và `animation` được viết lại theo, kể cả dạng viết tắt nhiều
    animation;
  - hai bài cùng tên keyframes không đè nhau;
  - `@font-face` bị gỡ; có lớp giảm chuyển động.
- **Ưu tiên hiển thị:** trống → `body`; có → `advanced`; chỉ có `<style>` → coi là
  trống.
- **Ngôn ngữ:**
  - vi có `advanced`, en chỉ có `body` → `/en` hiện `body` tiếng Anh.
  - vi chỉ có `advanced`, en không có gì → đăng bản en bị từ chối.
- **scroll-reveal trong bài:**
  - server ghi `data-reveal`;
  - `shift` thành `--reveal-shift`;
  - không có `data-reveal-ready` thì phần tử vẫn hiện.
- **Hiệu ứng:**
  - tên ngoài allowlist bị gỡ;
  - tham số sai thì phần tử vẫn hiện (không kẹt ẩn);
  - manifest có `selector` tìm đúng phần tử;
  - giảm chuyển động hoạt động.
- **Widget:** id không tồn tại bị gỡ; iframe có sandbox và CSP.
- **Kiểm tra bằng mắt:** một bài mẫu đủ 3 tầng, ở 1440 và 390, trên web và mở trong
  WebView của app.

## 8. Để lại cho người xây

- Tên hàm, chỗ đặt file, cách chia commit.
- Danh sách chính xác thẻ và thuộc tính SVG.
- Cách tính hash cho tên keyframes.
- Giao diện cụ thể của ô mã và danh sách widget.
