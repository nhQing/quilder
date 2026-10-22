# Đối chiếu với Framer, Figma, Builder.io, Webflow, Plasmic, Wix Studio

Cập nhật: **18/08/2026**.

Mục đích: rút ra cái nên học, cái nên tránh, và cái dự án này **đang làm đúng hơn
họ** — để đừng đánh mất trong lúc thêm tính năng.

## 0. Nguồn và độ tin cậy

| Nguồn | Trạng thái |
|---|---|
| **Plasmic** | Sâu nhất — **đọc mã nguồn thật** (`plasmicapp/plasmic` là mã nguồn mở): `shared/model/model-schema.ts` (schema DSL 759 dòng), `shared/bundles.ts`, `server/db/BundleMigrator.ts`, `commons/StyleToken.ts`, `packages/cli/*`; cộng docs chính thức. **Hai nhánh nghiên cứu độc lập, lệch nhau ba chỗ về versioning/semver/merge; đã đối chiếu và đính chính trong mục 1.4 và 1.5.** Thiếu tiếng nói người dùng (hết ngân sách tìm kiếm) |
| **Figma** | Đủ và sâu — help center, REST + Plugin API, engineering blog, incident record, spec `.fig` do bên thứ ba dịch ngược. **Hai nhánh nghiên cứu ra kết luận ngược nhau về cơ chế khớp override; đã đối chiếu và đính chính trong mục 1.1** |
| **Framer** | Đủ — docs chính thức, changelog, Plugin API, cộng đồng |
| **Builder.io** | Đủ — đọc source SDK trên GitHub, và gọi thẳng API công khai của họ |
| **Webflow** | Đủ về tài liệu (help center, developers docs). **Thiếu tiếng nói người dùng** — Reddit và community chặn truy cập tự động |
| **Wix Studio** | Đủ — support.wix.com + forum chính thức (có staff trả lời) |

Chỗ nào không có bằng chứng đều được ghi rõ thay vì suy diễn.

---

## 1. Đối chiếu theo sáu trục

### 1.1 Instance và override

| | Cách làm |
|---|---|
| **Figma** | **Instance mở.** Override cả cây, bind bằng **`overrideKey` — khoá ổn định trong component gốc, KHÔNG phải tên layer**. Tên chỉ dùng khi *retarget* (đổi variant / swap) |
| **Framer** | **Instance đóng.** Chỉ override property tác giả CHỦ ĐỘNG khai báo (*variable*) + chọn variant |
| **Plasmic** | **Instance đóng.** `TplComponent` chỉ có `vsettings`; override được `args` (props/slot/variant), `attrs`, và style **của chính node instance**. **Không** địa chỉ hoá được node con bên trong component |
| **Webflow** | Properties: **Content** (Text/RichText/Image/Link/Video/Number), **Switch** (ẩn/hiện, gỡ hẳn khỏi DOM), **Collection list**. **KHÔNG override style** — workaround chính thức là custom attribute `class` |
| **Wix Studio** | **Không có component thật.** Global Sections đồng bộ cả design lẫn nội dung, **không override được gì**; muốn khác thì Detach |
| **Builder.io** | Không có instance theo nghĩa này. `component.name` là **chuỗi khớp chính xác** — không id, không version |
| **Dự án này** | Instance đóng theo NỘI DUNG: chỉ chữ/ảnh/link/a11y, `.strict()` chặn style, e2e kiểm 422. Địa chỉ `instanceId/localId` |

**Ba trong sáu chọn instance đóng**, và Plasmic nói thẳng lý do trong kiến trúc: chỉ
khi override đi qua **API công khai** (props/slots/variants) thì diff/merge/versioning
mới làm được. Figma chọn ngược lại và trả giá bằng override mồ côi.

**Ta đúng ở chỗ quan trọng nhất: bind bằng khoá ổn định.** Sự cố **20/01/2022** của
Figma — layer key hỏng ~24 giờ, override rơi hàng loạt trên file của khách, phải ship
bản vá sửa key — là cái giá khi làm sai chỗ này.

#### Đính chính: Figma có HAI cơ chế, và tôi từng viết sai chỗ này

Hai nhánh nghiên cứu Figma của tôi ra kết luận ngược nhau, nên phải nói rõ:

| Tình huống | Cơ chế | Nguồn |
|---|---|---|
| **Trạng thái thường** — sửa component gốc tại chỗ | Override bind vào `overrideKey` — khoá ổn định trên từng layer của component, địa chỉ hoá bằng `GUIDPath` từ gốc instance | Spec `.fig` do bên thứ ba dịch ngược + bài của staff Figma về sự cố 01/2022 |
| **Gắn lại sang component KHÁC** — đổi variant, swap instance | **Khớp TÊN LAYER + giá trị gốc phải trùng** | Tài liệu chính thức, mục "Change preservation" |

Bản trước của tài liệu này viết "khớp theo tên layer chỉ là truyền thuyết dân gian" —
**câu đó quá mạnh và sai một nửa**. Tên layer *có* tài liệu chính thức, chỉ là nó chi
phối **việc retarget**, không phải trạng thái thường. Ngược lại, cơ chế `overrideKey`
thì **không** có trong tài liệu công khai của Figma; bằng chứng đến từ spec dịch ngược
và một bài của staff.

Điều kiện khớp khi đổi variant, nguyên văn:

> "The layer names of the current instance and the variant or instance you're
> selecting must match." … "Figma also checks if the layer properties you've changed
> originally matched between variants."

Đây là lời giải thích chính thức cho "bug kinh điển mất override khi đổi variant":
**không phải bug.** Nếu variant `hover` có màu nền khác `default`, mọi override màu nền
sẽ bị bỏ khi swap — đúng theo thiết kế. Và Figma **cố ý không cam kết**:
`swapComponent` được tài liệu hoá kèm câu *"we may update these override preservation
heuristics from time to time."*

Một nghịch lý trong thiết kế của họ đáng ghi: instance **được phép** override tên
layer, trong khi tên layer lại **là khoá khớp** — Figma không tài liệu hoá cách xử lý
xung đột đó.

Và một lỗ hổng tài liệu có hậu quả thật: Figma có **công cụ đổi tên hàng loạt bằng
regex**, tài liệu ở một bài; cơ chế khớp override theo tên ở một bài khác; **hai bài
không hề dẫn sang nhau** — dù dùng công cụ thứ nhất là **âm thầm phá override** qua cơ
chế thứ hai.

**Ở ta việc đó an toàn**, và đó là hệ quả trực tiếp của việc chọn khoá thay vì tên:
override bind vào `localId`, nên `setName` không thể phá nó. Đây là lý do cụ thể để
không bao giờ đổi sang khớp theo tên cho tiện.

**Bài học cho ta:** ta chỉ có một cơ chế (`instanceId/localId`) và không có nhu cầu
retarget, nên ta tránh được toàn bộ vùng mờ này. Nếu sau này làm "đổi component của
một instance", đây là chỗ phải quyết định tường minh — và nên nói rõ heuristic thay
vì để nó ngầm.

**Webflow là bài học ngược đáng giá nhất.** Vì không cho override style, cách chính
thức của họ là nhét tên class vào custom attribute — mà tài liệu của chính họ ghi:

> "The Style selectors panel doesn't recognize any classes referenced on CMS data or
> component properties."

Nghĩa là **công cụ dọn rác của họ không nhìn thấy đúng những class do cơ chế override
của họ sinh ra**. Bấm "xoá tất cả class không dùng" có thể phá site, im lặng.

**Wix Studio là bài học về việc KHÔNG có component.** Global Section chỉ ở cấp
section (không làm được component nút/card), không override được gì, và Saved Assets
thì "become independent from the original saved version" — tức chỉ là copy-paste có
tổ chức. Community Manager của Wix xác nhận **06/2026** rằng quản lý component toàn
cục "is something that's planned", **không có ETA**; người dùng nói yêu cầu này đã
tồn tại 6 năm.

**Detach: cả bốn công cụ có nó đều MỘT CHIỀU.** Figma, Framer, Webflow, Wix — không
cái nào re-attach được. Webflow nói thẳng mẹo chính thức là "nhân bản instance rồi
unlink bản nhân bản". Ta có `invert()` nên detach của ta sẽ undo được — **tốt hơn cả
bốn**.

**Hai thứ ta còn thiếu:** dọn override mồ côi (Figma ship hẳn lệnh
`Fix instance overrides`), và chính detach.

#### Đẩy override NGƯỢC lên component gốc — Figma có, ta không

Nhánh nghiên cứu thứ ba tìm ra tính năng này trong tài liệu chính thức, và nó là một
khoảng trống thật của ta:

> "Select the instance with overrides → Click next to the component name in the right
> sidebar → Select **Push overrides to main component**."

Nghĩa là quy trình "sửa thử trên một instance, thấy đúng thì nâng thành mặc định cho
mọi chỗ" **có đường đi**, không phải sửa lại từ đầu trong component gốc. Hai giới hạn
họ ghi rõ, và đáng bắt chước **ngay từ đầu** thay vì phát hiện sau:

- chỉ chạy khi instance và component gốc **trong cùng file**;
- "It's **not possible** to push overrides to a component that's nested within another
  component."

Và họ phân biệt rạch ròi hai việc mà ta cũng phải phân biệt: **push** đưa override vào
component gốc và áp ngay cho instance **trong cùng file**; muốn tới file khác thì phải
**publish** library. Ở ta cặp tương ứng là: sửa `Preset.tree` → áp cho bản nháp mọi
trang, và `Publish` → ra site. Kiến trúc đã đúng; chỉ thiếu lệnh push.

#### Detach của Figma lan LÊN, không lan xuống

Chi tiết này chỉ có trong plugin docs, không có trong bài help về detach, và nó ngược
trực giác:

> "For nested instances (instances inside of other instances), [detach] **also detaches
> all ancestor nodes that are instances**."

Tức detach một icon nằm trong một Button instance sẽ **detach luôn cả Button**; còn
detach Button ở cấp trên thì instance lồng bên trong **vẫn là instance**. Lý do rõ khi
nghĩ tới: một instance không thể chứa một node đã rời khỏi cây component của nó.

Ta chưa có detach (mục 4.6). Khi làm, đây là ràng buộc phải quyết định tường minh —
và ta có `invert()` nên hoàn tác được, thứ cả bốn công cụ kia không có.

Bonus đáng chép về **cách nhìn** detach, từ blog design-system của Figma: họ **log
detach như một metric hạng nhất**, và đọc nó như tín hiệu chẩn đoán chứ không phải
hành vi sai:

> "If someone in our organization is detaching a component, I want to know why."

Ba nghĩa khả dĩ họ liệt kê: có bug, người dùng cần một tính năng chưa có, hoặc họ đang
ghép các thành phần theo cách tác giả không lường tới. Nếu ta thêm detach, **ghi
AuditLog cho nó** — ta đã có hạ tầng, và con số đó trả lời "component nào thiết kế sai".

#### Figma Slots — mô hình đáng học nhất trong cả sáu công cụ

Đây là câu trả lời hiện đại cho "instance không thêm/xoá/sắp xếp lại layer được", và
nó **không** phải nới lỏng dần quyền override. Tác giả component **khai báo tường
minh** một vùng được tự do biên tập:

> "Slots, a type of component property, are flexible areas placed inside main
> components that let you freely add, resize, and arrange content within an instance
> **without having to detach it**."

> "you can start adding content, rearranging layers, and removing objects from the
> slot **as if the slot was a regular frame**."

Và vùng đó **có ràng buộc khai báo được** (`SlotSettings`):

| Trường | Ý nghĩa |
|---|---|
| `minChildren` / `maxChildren` | Giới hạn số con, `null` = không đặt |
| `allowPreferredValuesOnly` | Whitelist: chỉ cho phép các loại con đã liệt kê |
| `stretchChildOnInsert` | Tự fill trục phụ khi chèn |
| `displayEmptyByDefault` | Luôn hiện vùng highlight khi slot rỗng |

Cộng `limitViolations` (`'BELOW_MIN' | 'ABOVE_MAX' | 'HAS_NON_PREFERRED'`) để báo vi
phạm, và `resetSlot()` để trả về nội dung gốc. Nhãn `[Modified]` hiện trên property
panel khi slot đã bị sửa.

Ba giới hạn họ cũng khai báo rõ: không bind slot vào layer gốc của component; không
áp component property cho layer **bên trong** slot; và **xoá slot property là phá mọi
sửa đổi slot ở các instance**.

**Vì sao đây là mô hình đúng cho ta:** nó giữ nguyên triết lý `.strict()` — instance
không được tuỳ ý sửa cấu trúc — nhưng cho tác giả component mở một cửa **có kích
thước và có luật**. So sánh: Framer bắt khai báo từng property (chặt nhưng không cho
cấu trúc); Webflow không cho gì rồi phải hack qua `class` attribute; Wix không có
component. Figma là công cụ duy nhất giải được "vùng tự do có ràng buộc".

Ta đã có `slots` trên `Composite` (`chapter-1..3`, `media-1..3`) — nhưng đó là khoá
**cố định do code composite định nghĩa**, không phải slot khai báo được trên một
component do người dùng tạo, và **không có** min/max hay whitelist. Khoảng cách giữa
hai thứ đó là việc cần làm (mục 4.3).

#### Plasmic: `TplNode` KHÔNG giữ style — mọi thứ nằm trong `vsettings`

Đây là quyết định kiến trúc đáng học nhất trong mã nguồn Plasmic, và nó không hiện ra
từ docs — phải đọc `shared/model/model-schema.ts`:

```
TplNode
  @Const uuid: String
  @WeakRef parent: TplNode?
  locked: Bool?
  vsettings: [VariantSetting]      # ← không có "styles", không có "props", không có "text"

VariantSetting
  @WeakRef variants: [Variant]     # một TỔ HỢP variant, không phải một variant
  args: [Arg]
  attrs: Map[String, Expr]
  rs: RuleSet                      # style tĩnh → thành class
  dataCond: CustomCode? | ObjectPath?   # điều kiện hiển thị
  dataRep: Rep?                    # lặp
  text: RichText?
  columnsConfig: ColumnsConfig?
```

Một node không có style trực tiếp. Nó có một **danh sách các bản cài đặt, mỗi bản gắn
với một tổ hợp variant**. Base variant chỉ là bản có tổ hợp base. Hệ quả: **một cơ chế
duy nhất** phục vụ variant component, hover/focus/press, responsive breakpoint,
ẩn/hiện có điều kiện, lặp danh sách, và override chữ. Không có sáu hệ thống song song.

Và semantics kế thừa được khai báo ngay trong comment của `RuleSet`:

> In base variant, null and empty array are the same. In targeted variants, **null does
> not change the base variant** and **empty array clears the base variant**.

Tức họ phân biệt ba trạng thái: *không nói gì* (kế thừa), *nói là rỗng* (xoá), *nói một
giá trị* (ghi đè). Ta hiện chỉ có hai — một layer style có key hoặc không có key, và
**không có cách nào diễn đạt "ở khổ md hãy XOÁ padding mà base đặt"**. Đây là một
khoảng trống thật, nhỏ, và sẽ cắn đúng lúc ai đó cần bỏ một thuộc tính ở khổ hẹp.

Còn về việc **có nên theo mô hình `vsettings`**: câu trả lời là **không, không phải
bây giờ**. Ta không có variant component, và `Style` theo layer `base|sm|md|lg|xl` đã
là một lát mỏng của cùng ý tưởng. Nhưng nếu component của ta *có* variant sau này
(mục 4.3), thì **đừng thêm một trục lưu trữ thứ hai** cạnh layer responsive — hợp nhất
chúng thành "tổ hợp điều kiện → bản cài đặt" như Plasmic. Retrofit chuyện này rất đắt.

Chi tiết nhỏ nhưng đáng chép: `TplTag.codeGenType: 'auto' | 'alwaysTag' | 'noTag'` —
một directive **cho bộ sinh code** nằm ngay trong model, cho phép một node text render
thành chuỗi trần thay vì bọc `<div>`. Ta cũng sinh HTML từ doc, và cũng sẽ gặp lúc cần
"node này đừng sinh thẻ bọc".

### 1.2 Responsive và bài toán nướng giá trị đo được

Framer, Wix Studio và ta đều **cascade một chiều từ khổ lớn xuống nhỏ**. Giống nhau.

**Wix Studio phân loại thuộc tính rất rõ, và ta nên đối chiếu:**

| | Wix Studio |
|---|---|
| Global mọi breakpoint, KHÔNG override được | nội dung/dữ liệu (text, link, nguồn ảnh), thêm/xoá/thay element, đổi cấu trúc |
| Override được theo breakpoint | design (màu, border, font, size) và layout (vị trí, kích thước) |

**Ta đã khớp đúng mô hình này mà không cố ý**: trong schema của ta, nội dung nằm trên
node (`content`, `alt`, `label`) — **không responsive**; chỉ `style` mới có
`base/sm/md/lg/xl`. Đây là xác nhận từ bên ngoài rằng ranh giới đó đặt đúng chỗ.

**Nhưng Wix mắc một sai lầm kiến trúc mà ta không mắc: breakpoint của họ là CẤP
TRANG, không phải cấp site.** Tài liệu của chính họ:

> "It is not possible to create breakpoints that apply to the entire site by default.
> You need to set those for every section or page you're working on."

20 trang là 20 lần cấu hình tay. Của ta là hằng số toàn cục trong `breakpoints.ts`.

Session 17/08 ta vừa gỡ **421 khai báo `width`** bị nướng từ `getComputedStyle`
(HANDOFF 3.12). Ba cách chống của họ:

- **Framer: REM base per breakpoint + Layout Templates**, và **Fit Text** (`Size=Fit`
  + Min/Max Width đóng vai min/max font-size). Họ nói rõ *"no flashes on refresh, and
  no expensive calculations on resize"* — thuần CSS.
- **Plasmic: `StyleToken.variantedValues`** — một token mang giá trị khác nhau theo
  global variant, nên dark/light hay platform giải ở **tầng token**.
- **Wix: ưu tiên layout engine** (Stacks/Grid) hơn toạ độ, cộng đơn vị tương đối +
  min/max thay số px chết.

**Bài học chung: ghi ý đồ một lần rồi để CSS suy ra**, đừng ghi giá trị đúng ở mỗi
breakpoint.

**Plasmic thêm hai chi tiết đáng ghi thành luật cho ta.**

Thứ nhất, breakpoint của họ **chính là variant** — cụ thể là một `GlobalVariantGroup`
tên "Screen" (`type: 'global-screen'`), và **media query được lưu nguyên văn dưới dạng
string** trong `Variant.mediaQuery`, không phải một cặp số min/max. Docs khẳng định
breakpoint "always **cumulative**" và một dải luôn có "start and never an end" — tức
cascade một chiều, giống ta. Nhưng họ cho **chọn desktop-first hay mobile-first ở cấp
project**; ta cố định desktop-first, và đó là lựa chọn đúng cho site này (đừng thêm cờ).

Thứ hai, và đây là cái đáng thành luật: **override NỘI DUNG theo breakpoint gây flash.**
Docs của họ nói thẳng rằng các override như thế "will appear as flashes of the original
content before showing the overrides (**since JavaScript must run** in order to render
the overrides)", và khuyên chỉ đổi **style** ở breakpoint. Lý do rõ ràng: style variant
biên dịch thành media query thuần CSS nên SSR đúng ngay; còn "hiển thị chữ khác ở khổ
hẹp" thì phải chờ JS quyết định variant nào đang bật.

Với ta, `Style` phân theo layer `base|sm|md|lg|xl` biên dịch thành media query — **đúng
phía an toàn**. Nhưng `visibility` cũng nhận layer (`{ base: false }`), và `setText`
thì không. Luật rút ra: **mọi thứ phân theo breakpoint phải quyết định được ở tầng CSS.**
Nếu có lúc nào ai đó muốn "chữ khác ở mobile", câu trả lời không phải là thêm layer cho
`setText` — mà là hai node, mỗi node ẩn/hiện bằng CSS.

### 1.3 Design token

| | |
|---|---|
| **Plasmic** | 6 kiểu (Color, Spacing, Opacity, LineHeight, FontFamily, FontSize) + `DataToken`. Token tham chiếu token được, **có phát hiện chu trình**. ID ổn định là **`uuid`** (`name` chỉ là displayName); `regKey` thêm cho token đăng ký từ code. Ref lưu nguyên văn `var(--token-<uuid>)`. Theme đổi qua một lớp CSS-var indirection |
| **Framer** | CHỈ Color + Text Styles. **Không có token spacing/radius/shadow**. Sửa token áp ngay canvas, **phải Publish mới ra live** |
| **Figma** | 6 kiểu (Color, Number, String, Boolean, **Timing, Easing**), **5.000 biến/collection**. Alias biến→biến **cùng kiểu**. **Mode** là chiều thứ hai; giới hạn **10/20/không giới hạn** tuỳ gói. Scoping giới hạn biến áp được vào property nào |
| **Wix Studio** | Hệ ĐÓNG: 6 màu có ngữ nghĩa cố định (tối đa 25), **9 text style cố định**, không tạo style tên riêng được. Lan truyền tức thì |
| **Dự án này** | Phong phú hơn cả ba: space, radius, size, màu, thang chữ, cộng token tự tạo trong DB |

Ta hơn về độ phủ, **nhưng thua ba chỗ**:

1. **Sửa giá trị token đi thẳng ra site thật, không qua publish** (HANDOFF 3.10).
   Framer cũng áp ngay trên canvas nhưng vẫn bắt publish.
2. **Không có ID ổn định cho token.** Doc tham chiếu bằng TÊN (`{$token:'space-l'}`),
   và `Token.name` là khoá `@unique`. Đổi tên là vỡ mọi tham chiếu, im lặng —
   `var(--tên-cũ)` vẫn là CSS hợp lệ, chỉ rỗng. Plasmic tách `regKey` khỏi `name`
   đúng để tránh việc này. Ta đã có `Token.id` (cuid), chỉ là doc không dùng nó.
3. **Không có "reset toàn bộ override".** Đây là cạm bẫy Wix nêu thẳng:

   > "When updating site styles, the changes won't affect elements with existing
   > design overrides. Currently, there's no option to 'reset' all these elements
   > simultaneously."

   Đó chính là cỗ máy sinh style rác: token đổi, nhưng những chỗ đã override thì
   không đổi, và không có cách nào dọn hàng loạt. Ta cũng chỉ gỡ override từng node.

Một lớp bảo vệ ta CÓ mà Webflow không có: `pnpm check:tokens` **phát hiện** token
sai tên, và từ 18/08 nó quét cả cây component (mục 6). Nhưng phát hiện sau không
bằng không vỡ.

**Mô hình `mode` của Figma là thứ đáng học nhất ở trục này**, và nó giải một bài ta
chưa gặp nhưng sẽ gặp: cùng một token mang giá trị khác nhau theo ngữ cảnh (sáng/tối,
thương hiệu, nền tảng). Cách họ làm:

```
explicitVariableModes: { [collectionId]: modeId }   // đặt trên TỪNG NODE, theo TỪNG collection
resolvedVariableModes                               // đọc: đã tính cả kế thừa và mặc định
```

Mode được lưu **per-collection per-node**, nên khi phân giải, mỗi collection **đi lên
cây độc lập** tìm tổ tiên gần nhất có mode tường minh *cho chính collection đó*. Hệ
quả: **không tồn tại "xung đột giữa các collection"** — một câu hỏi mà tài liệu người
dùng của Figma né, nhưng mô hình dữ liệu đã trả lời sẵn. Cặp `explicit…` /
`resolved…` cũng là API đáng bắt chước nguyên xi: một cái là ý định người dùng, một
cái là sự thật sau kế thừa.

Và **extended collections** của họ (Enterprise) là chính mô hình override của
component **áp dụng lại cho token**: parent/child, kế thừa mặc định, override tường
minh, giá trị đã override **tô xanh**, cộng lệnh `removeOverridesForVariable`. Một
khuôn ý niệm dùng ở hai domain — đúng thứ giúp người dùng học một lần.

#### Plasmic: token ref được lưu NGUYÊN VĂN là `var(--token-<uuid>)`

Mã nguồn (`commons/StyleToken.ts`) cho biết cách biểu diễn, và nó đơn giản hơn tôi
tưởng:

```ts
export const getTokenVarName = (token: StyleToken) => `--token-${token.uuid}`;
export const isTokenRef = (ref: string) => ref.startsWith("var(--token-");
export const isMixinPropRef = (ref: string) => ref.startsWith("var(--mixin-");
```

Nghĩa là trong `RuleSet.values` — nơi lưu style — một tham chiếu token **chính là
string CSS `var(--token-<uuid>)`**, không phải một object `{ $token: … }` như của ta.
Hai hệ quả:

- **Không có "propagation engine".** Đổi giá trị token là đổi đúng một chỗ; mọi node
  dùng nó tự đúng vì giá trị chỉ được resolve lúc render. Ta đã ở cùng chỗ này với
  `{ $token }` → `var(--<name>)`.
- **Nhưng họ khoá theo `uuid`, ta khoá theo TÊN.** Và mô hình định danh của họ nói rõ
  điều đó ngay trong comment schema:

  ```
  Token
    name: String    # "This is really more like a displayName, not treated as the stable ID"
    @Const uuid: String
    regKey: String? # "Allows you to treat the name as a display name that can change
                    #  without breaking backcompat"
  ```

  **Đính chính bản đầu:** tôi viết "`regKey` = ID ổn định tách khỏi tên hiển thị".
  Không hẳn — ID ổn định phổ quát là **`uuid`**; `regKey` chỉ dành cho token **đăng ký
  từ code** (`isRegistered`), để mã nguồn nhận diện token mà không phụ thuộc tên. Cả
  hai đều phục vụ cùng một nguyên tắc, nhưng đừng lẫn phạm vi.

  Đây là gốc của mục 4.4: `{ $token: 'space-6' }` của ta bind theo **tên**, nên đổi tên
  token là làm rỗng im lặng mọi tham chiếu. `check:tokens` bắt được (và từ đợt này bắt
  cả trong `Preset.tree`), nhưng bắt *sau khi đã sai* — khác với việc **không thể sai**.

Hai chi tiết nữa đáng chép:

- **Phát hiện chu trình có tên trong type**: `ResolvedToken` ghi thẳng "CSS value may
  be an empty string if a cycle was detected", cộng comment "Return original token if
  we hit a cycle". Token trỏ token là tính năng ta chưa có; nếu thêm, **cycle detection
  phải vào cùng lúc**, không phải sau.
- **`derefTokens: boolean` và `expandMixins: boolean`** là cờ của bộ sinh code: cùng
  một doc xuất ra được **hoặc** giữ `var(--token-…)` **hoặc** inline giá trị đã resolve.
  Ta cũng sẽ cần lựa chọn đó ở đúng một chỗ — ví dụ email HTML hay bản xuất tĩnh không
  chạy được CSS custom property.

Và một điểm họ **chưa** giải xong, ghi ngay trong schema dưới dạng `# TBD: add tokens
support to Theme.` với ba phương án. Họ đã chọn `styleTokenOverrides` +
`variantedValues` **thay vì** token-riêng-cho-từng-theme. Ta chưa có theme; khi có,
đây là bằng chứng nên chọn hướng nào.

### 1.4 Lưu trữ: op, snapshot, hay cả tài liệu

Đây là trục ta khác biệt nhất:

| | |
|---|---|
| **Builder.io** | **Cả tài liệu.** `Patch = {path, op, value}` chỉ là transport cho preview; SDK Gen 2 tự khai `supportsPatchUpdates: false` |
| **Webflow** | **Không có API công khai cho cấu trúc/style.** DOM API chỉ 7 node type mang nội dung, mảng phẳng phân trang, không cha-con, không style ref; endpoint ghi **chỉ ghi được vào locale phụ** |
| **Plasmic** | **Snapshot mỗi revision** (bundle đầy đủ). `PartialRevisionCache` chỉ là cache multiplayer ~10 phút |
| **Wix Studio** | Autosave + Site History; không có API doc công khai |
| **Dự án này** | **15 op có kiểu**, validator server, `invert()` cho undo, AuditLog theo op, `PageVersion.label` |

**Webflow là cảnh báo nặng nhất.** Không có API cho cấu trúc nghĩa là **không diff
được, không review được, không migrate bằng script**. Tuần này ta sửa 421 khai báo
`width` bằng một script chạy qua `/api/ops` — trên Webflow việc đó bất khả.

**Plasmic là cảnh báo về schema.** Họ có một thư mục `bundle-migrations` với khối
lượng thật của ~5 năm tiến hoá, chạy trên **cả revision lẫn bản đã publish**. Ta đang
cố định `schemaVersion: 1` và chưa ai đọc nó — giống hệt Builder.io, nơi `@version`
tồn tại mà **không dòng code nào đọc**.

Đọc `server/db/BundleMigrator.ts` thì cơ chế của họ khác điều tôi viết ở bản đầu, và
khác theo hướng đáng học:

- **Version KHÔNG phải một con số.** Nó là **tên của migration cuối cùng đã chạy**:
  `lastBundleVersion = migrations[migrations.length - 1].name`, rồi sau mỗi bước
  `bundle.version = migration.name`. Danh sách migration được **liệt kê từ filesystem
  và sort tự nhiên** (`Intl.Collator`), không có bảng đăng ký tay. Bundle mới chưa có
  version thì coi như `"0-new-version"`. **Không có hằng số `MODEL_VERSION`** trong mã
  nguồn — tôi đã tìm và không thấy; con số "257" ở bản đầu tài liệu này là suy ra từ
  nguồn thứ cấp, đã bỏ.
- **Hai LOẠI migration, và thứ tự KHÔNG tuần tự thuần.** `bundled` = sửa model mà
  không unbundle; `unbundled` = unbundle nhưng không được sửa model. Code partition
  rồi nối: `return [...bundled, ...unbundled]`. Lý do họ ghi thẳng trong comment:
  mọi migration `bundled` phải chạy trước để bundle đã ở model mới nhất *trước khi*
  bất cứ thứ gì unbundle nó. Đây là loại ràng buộc chỉ lộ ra sau khi đã đau — ta nên
  chép luôn khi dựng hạ tầng migration (§4.5).
- **Backup trước mỗi bước**: `saveBundleBackupForEntity(migration.name, entity, …)`.
- **Chạy lazy lúc ĐỌC**, trong một transaction, không phải một job quét toàn bảng.
- Có cảnh báo rollback: nếu version của bundle *đi trước* migration cuối thì log
  "ahead of the last version" — tức họ giả định việc deploy lùi có xảy ra thật.

**Định dạng bundle của họ đơn giản đến mức đáng chú ý** (`shared/bundles.ts`):

```ts
type BundledInst = { [field: string]: any; __type: string };
type Bundle = { root: string; map: { [id: string]: BundledInst }; deps: string[]; version: string };
```

Một **map phẳng `id → instance`**, mỗi instance tự khai `__type`, `root` trỏ tới entry,
`deps` là UUID các bundle ngoài. Cây chỉ tồn tại về ngữ nghĩa. Giống hệt kết luận của
Figma ở trên, và giống `Doc.nodes` của ta — đây là chỗ ta đã đúng từ đầu.

**Và một đính chính về multiplayer.** Bản đầu tài liệu này viết `PartialRevisionCache`
là "cache multiplayer". Bằng chứng trực tiếp duy nhất tìm được về concurrency lại là
một class lỗi:

```ts
export class OutdatedBundleError extends Error {
  message = "Project data is outdated. Please refresh the page.";
```

Đó là **optimistic concurrency theo revision**, và cách giải quyết xung đột là **bắt
người dùng tải lại trang** — ngược hẳn với CRDT/OT. Không tìm thấy bằng chứng nào cho
CRDT hay OT trong mã nguồn Plasmic. Ghi lại vì nó hạ một kỳ vọng: **một builder
nghiêm túc, mã nguồn mở, 5 năm tuổi vẫn không làm co-editing kiểu Figma.** Ta không
nên coi đó là hạng mục bắt buộc.

Hai kỹ thuật đáng mượn:

- **Plasmic: model phải là CÂY THẬT.** Tham chiếu chéo đánh dấu `@WeakRef`; tham
  chiếu "mạnh" chỉ được có đúng một đường đi từ gốc. Đây là điều kiện tiên quyết để
  diff/merge/bundle làm được — rẻ khi làm sớm, rất đắt khi retrofit.
- **Builder.io: `applyPatchWithMinimalMutationChain`** chỉ clone dọc theo path để
  giữ referential equality cho React memo.
- **Figma: quan hệ cha–con lưu như một link TRÊN CON, không phải mảng `children` trên
  cha**, cộng **fractional indexing** cho thứ tự sibling (chèn giữa hai sibling bằng
  cách lấy trung bình vị trí). Document là cây về ngữ nghĩa nhưng lưu **phẳng**:
  `Map<ObjectID, Map<Property, Value>>`. Hai hệ quả họ nêu thẳng: trạng thái "một node
  có hai cha" trở thành **không biểu diễn được**, và reorder thành **một cập nhật
  property nguyên tử** thay vì viết lại cả mảng.

  Ta đang lưu `children: NodeId[]` trên cha *và* `parentId` trên con — tức có hai
  nguồn sự thật cho cùng một quan hệ, và `ops.ts` phải giữ chúng đồng bộ bằng tay.
  Chưa cắn lần nào (validator chặn), nhưng đây là chỗ Figma đã thiết kế để **không
  thể sai**.

### 1.5 Publish, rollback, môi trường

| | |
|---|---|
| **Plasmic** | Commit = **bản publish**. **Semver TỰ TÍNH** bằng diff API component. Branch + merge **3 chiều** thật, conflict metadata **khai báo per-field trên schema**. Enterprise |
| **Framer** | Publish toàn site, atomic, immutable. **Rollback cấp project**. Staging cần custom domain + Pro. 3.0 có branching |
| **Webflow** | Backup = restore point **mỗi 50 lần auto-save**, **restore cả site**, kèm ~8 tác dụng phụ. Publish từng trang là Team/Enterprise và **không có rollback** |
| **Wix Studio** | **Không có staging.** Publish **toàn site**, không publish từng trang. Site History ghi mọi save + publish kèm ai sửa. Link "Get Client Feedback" hạn **2 tuần** |
| **Dự án này** | Publish = đổi một con trỏ `Site.activeReleaseId`. `ReleaseTimeline` để lùi bản |

**Ta ngang Framer, hơn Webflow và Wix rõ rệt.** Backup của Webflow là disaster
recovery cho cả site chứ không phải version control; publish-từng-trang của họ có
thể để site **không đồng nhất** (trang khác vẫn dùng component/style cũ tới lượt full
publish). Publish của ta là đổi một con trỏ, nguyên tử, không có trạng thái nửa vời.

**Phát hiện mạnh nhất của cả đợt — semver tự tính của Plasmic:**

```
compareSites(prev, curr) → ChangeLogEntry[] → calculateSemVer()
  xoá hoặc đổi giá trị  → major
  thêm                  → minor
  còn lại               → patch
```

Diff chạy trên **API công khai của component** (params, slots, variants), không phải
trên style. Người dùng không cần hiểu semver, mà app tiêu thụ vẫn pin được `^`/`~`.
Điều kiện tiên quyết: component phải CÓ một API công khai — thứ ta chưa có (mục 4.3).

Kèm bài học ngược của chính họ: **pin version không cứu được khi vendor đổi runtime
CSS**. Có case người dùng redeploy đúng bản published cũ mà layout vẫn vỡ, vì reset
CSS của Plasmic nằm ngoài snapshot. Với ta, `site.css` tĩnh cũng nằm ngoài `Release`
— cùng loại rủi ro (mục 4.7).

**Cần hạ mức tin cậy ba chỗ ở trên.** Một nhánh nghiên cứu thứ hai, đi từ docs chính
thức và mã nguồn CLI, **không xác nhận được** phần mạnh nhất của ba khẳng định đó:

| Khẳng định ở bản đầu | Nhánh hai tìm thấy gì |
|---|---|
| "Semver TỰ TÍNH bằng diff API component" | `plasmic.json` nhận semver range, `ProjectDependency.version` là string → version **là** semver. Nhưng trang `/learn/publishing/` **không mô tả** việc chọn hay tính mức bump. Cơ chế `compareSites → calculateSemVer` là bằng chứng mã nguồn từ nhánh một; **không có bằng chứng docs** cho hành vi người dùng thấy |
| "Merge **3 chiều** thật" | Docs branching mô tả hộp thoại merge cho bạn "**decide which branch's changes to use**" — tức resolution ở mức **chọn một bên**, không phải merge từng thuộc tính. Hạ tầng thì có thật: `shared/site-diffs/model-conflicts-meta.ts` tồn tại → họ diff/merge **trên cây model**, không trên text |
| Ngầm hiểu Plasmic đã giải xong bài merge | Docs version-control của họ nói thẳng: "there is **currently no easy way to merge two Plasmic projects**", và branching là **Enterprise-only, upon request** |

Kết luận thực dụng cho ta: **diff trên cây model là hướng đúng và khả thi** (ta có
`Doc.nodes` phẳng, có op có kiểu — điều kiện còn tốt hơn họ), nhưng **đừng lấy "merge
3 chiều" làm chuẩn phải đạt**. Công cụ mạnh nhất trong ngành vẫn đang ở mức "chọn một
bên", và họ vẫn thu phí Enterprise cho nó.

**Và mô hình pin version của họ đúng là mô hình của npm** — nên chép nguyên:

| | Tương đương npm | Nội dung |
|---|---|---|
| `plasmic.json` | `package.json` | `version: "latest"` hoặc **semver range** (`^`, `~`, `>=`) |
| `plasmic.lock` | `package-lock.json` | `ProjectLock.version` = "the exact version that was last synced", `dependencies: {projectId → exact version}`, `branchName`, `lang`, `codegenVersion`, cộng `fileLocks[]` checksum |

Hai chi tiết đáng nhớ:

- **`"latest"` là KHÔNG ổn định, và docs nói thẳng**: nó nghĩa là "the latest
  **unpublished** data seen on Plasmic Studio at the time of sync". Muốn bản published
  mới nhất thì phải viết `">=0.0.0"`. Đây là một cái bẫy đặt tên — `latest` nghe như
  "bản phát hành mới nhất" mà thực ra là "bản nháp". Ta có đúng cặp khái niệm này
  (draft vs `activeReleaseId`); **đừng bao giờ đặt tên một trong hai là "latest"**.
- **Import bắt buộc CÙNG version.** "A project's imports (including transitive
  imports) must all be on the same version." Tức họ **cấm diamond dependency khác
  version**, đổi lấy tính nhất quán thiết kế. Nếu sau này component của ta có version,
  đây là ràng buộc nên chọn — nó biến một lớp lỗi khó hiểu thành một lỗi validate.

**Còn checksum thì KHÔNG dùng để làm việc tôi tưởng.** `FileLock.checksum` được CLI
**gửi LÊN server** cùng request sync, và server chỉ trả về file nào thật sự khác; cờ
`--all-files` bỏ qua nó. Đó là **conditional fetch / delta sync**, *không* phải cơ chế
phát hiện "dev đã sửa file do máy sinh". Ghi lại vì đây đúng loại kết luận sai mà một
cái tên gợi ra.

### 1.6 Tổ chức editor và công cụ audit

Framer: pane trái ba tab **Pages / Layers / Assets**, component có **canvas riêng**.
Sau session 17–18/08 ta trùng khớp: **Lớp / Component / Trang** (accordion dọc) và
canvas riêng cho component (`/builder/components/[id]/edit`).

**Công cụ audit của họ, và giới hạn:**

- **Wix Responsive Checker** — quét **một trang trên MỌI breakpoint**, phát hiện lỗi
  sizing (chồng lấp, tràn nội dung, khoảng hở ngoài ý muốn) và positioning, **có nút
  auto-fix từng lỗi**. Đây là công cụ tốt nhất trong cả sáu. Giới hạn: từng trang một,
  không quét toàn site.
- **Webflow Audit panel** — chỉ a11y + SEO, đúng 4 check, và **không kiểm bên trong
  component**.
- **Webflow Site health scan** — cảnh báo khi site vượt **1.000 class**; phần
  "Performance" chỉ kiểm xem các toggle có bật không, **không đo tốc độ thật**.

Cảnh báo hiệu năng editor: **Plasmic** chậm khi component nhiều variant vì design
view bày tất cả variant trên artboard riêng (cách chữa: focus mode). **Wix Studio** có
thread lag kéo dài **18 tháng chưa xử lý xong**. Ta bày 5 khung breakpoint cùng lúc —
cùng họ vấn đề, và đó là lý do `fitContent` cho canvas component đáng giá.

#### Figma cố ý giữ cây node "sạch" — và câu hỏi đó ta đã phải tự trả lời

Ba thứ Figma **không** làm trong Layers panel, và đều là lựa chọn có ý thức:

- **Không có ô tìm trong cây.** Tra layer bằng modal `Cmd+F`, không phải filter
  inline. Ô search duy nhất ở sidebar trái là của tab **Assets**.
- **Không có chỉ dấu "node này có override".** Dữ liệu hoàn toàn có sẵn
  (`InstanceNode.overrides` tính được), nhưng họ đẩy trạng-thái-đã-sửa sang properties
  panel. Badge `[Modified]` duy nhất tồn tại là **cho slot, trên properties panel**.
- **Detach không để lại dấu vết.** Instance thành "a regular frame" và row chỉ còn
  icon frame — không gì cho biết nó từng là instance.

Lý do khả dĩ cho điều thứ hai nằm ngay trong tài liệu API của họ: `overrides` **không
bao gồm override kế thừa** ("Inherited overrides are not included"). Một badge cấp
hàng sẽ nhập nhằng giữa *"node này bị override"* và *"một hậu duệ bị override"* — và
với cây lồng sâu, badge lan truyền gây nhiễu hơn là giúp.

**Ta đã vượt Figma ở hai chỗ, và đó là quyết định sản phẩm chứ không phải bắt kịp:**
ô tìm inline trong cây (có `khớp/tổng` khi lọc), và gạch ngang + `🚫` cho node đang
ẩn — cộng đánh dấu cả hậu duệ của node ẩn, đúng câu hỏi Figma né. Ta trả lời được vì
`visibility` là trạng thái của **chính node**, không phải override kế thừa.

Nhưng nếu sau này ta thêm badge "đã tuỳ chỉnh" cho instance, phải trả lời trước đúng
câu hỏi đó: badge nghĩa là node này, hay có hậu duệ?

#### Ba chi tiết nhỏ của Layers panel đáng lấy nguyên

Nhánh thứ ba đọc kỹ tài liệu Layers panel và tìm được ba thứ cụ thể, mức chi tiết mà
chỉ dùng sản phẩm mới thấy:

1. **Gập tất cả CHỪA nhánh của node đang chọn.** Nguyên văn: "If you've already
   selected a layer when you collapse layers, all expanded layers **except for your
   selection** will collapse." Và nút gập là **contextual** — chỉ xuất hiện khi có gì
   đang mở.

   **Ta đang làm khác, và khác theo hướng tệ hơn.** `LayerTree.tsx:376` là
   `setCollapsed(new Set(parentIds))` — gập *tất cả*, kể cả đường tới node đang chọn.
   Hệ quả: bấm "Gập tất cả" khi đang chọn một node thì node đó **biến khỏi cây** trong
   khi inspector vẫn bày thuộc tính của nó. Đúng cái nghịch lý mà `useEffect` mở-đường-
   tới-selection ở dòng 307 tồn tại để tránh — chỉ khác là effect không chạy lại vì
   `selectedId` không đổi. Vá là một dòng: trừ `ancestorsOf(doc, selectedId)` ra khỏi
   tập gập. Chưa làm (xem mục 4.9).

2. **Control ẩn/khoá hiện khi hover, và trở thành THƯỜNG TRỰC khi đang bật.** Mắt-đóng
   và khoá-đóng luôn hiện; trạng thái mở chỉ hiện lúc hover. Nguyên tắc: **hàng chỉ
   mang thêm ký hiệu khi có thông tin thật để mang**. Ta đã ở đúng chỗ này với gạch
   ngang + `🚫` cho node ẩn, nhưng đáng ghi thành luật cho mọi ký hiệu thêm sau này.

3. **Trạng thái mở/gập của Figma là một PROPERTY CỦA NODE trong document**, không phải
   UI state: `'expanded'` nằm trong enum `NodeChangeProperty`. Nghĩa là nó đồng bộ
   multiplayer — hai người mở cùng file thấy cùng cây. Ta lưu trong `localStorage`
   (`persisted.ts`), tức **theo máy, theo người**. Với một builder một người dùng thì
   lựa chọn của ta đơn giản hơn và đúng hơn; ghi lại để nếu có nhiều người cùng sửa thì
   biết đây là một quyết định, không phải một sự bỏ sót.

Cảnh báo về suy diễn từ enum, cũng từ nhánh này: `NodeChangeProperty` (~120 giá trị)
chứa cả `'parent'` và `'type'` — những thứ UI **không** cho override. Nó là **vốn từ
vựng chung cho change-event**, được dùng lại cho `overriddenFields`. **Sự có mặt của
một field trong enum không chứng minh nó override được.** Cùng chỗ đó tài liệu Figma
có một typo thật: `'stokeTopWeight'` (thiếu `r`) cạnh `strokeBottomWeight` viết đúng.

---

## 2. Số đo nền của chính dự án (18/08/2026)

Đo trước khi đọc báo cáo của họ, để có mốc đối chiếu thay vì cảm tính.

| | Trang chủ |
|---|---|
| Node | 158 |
| Khai báo style | 786 |
| Nhóm style rỗng | **0** — cơ chế dọn trong `ops.ts` hoạt động |
| Lớp breakpoint rỗng | 29, **đều là `base`** — schema bắt buộc, không phải rác |
| `customCss` | 3 node, 217 ký tự |
| CSS sinh ra cho trang thật | 32 KB, 262 rule |
| Token trong `Preset.tree` | 154 tham chiếu, tất cả resolve |

Phân bố: `layout` 264 · `spacing` 146 · `typography` 140 · `size` 132 ·
`position` 36 · `effects` 21 · `fill` 19 · `border` 17 · còn lại < 6.

### Ta miễn nhiễm về CẤU TRÚC với bệnh style bloat

`compileDoc` sinh CSS **từ chính tập node**, scope bằng `[data-n="<id>"]`:

```ts
const ids = Object.keys(doc.nodes).sort();
for (const n of nodes) parts.push(rule(sel(n.id), declarations(n.style.base), '  '));
```

Xoá một node thì rule của nó biến mất ở lượt compile kế tiếp, và **không tồn tại khái
niệm "class không dùng"** — không có class nào chia sẻ giữa các node.

Đối chiếu Webflow, nơi bệnh này là **hành vi mặc định chứ không phải lỗi người dùng**:

> "The moment you begin styling an element, a class is automatically created and
> applied to the selected element."

Hậu quả do chính họ đo: health scan cảnh báo **>1.000 class**, và tài liệu khắc phục
sự cố ghi *"Sites with many unused styles can cause Webflow to run slowly"* — style
rác làm chậm **chính công cụ thiết kế**.

Có **một nghiên cứu định lượng** về chuyện này (webstudio.is): lấy 5 template miễn phí
mới nhất mỗi nền tảng, cô lập section, extract JSON, đếm bằng regex — Webflow **11,5
class/section** so với 4 token/section, tức ~65% ít hơn; loại token mặc định thì
khoảng cách lên hơn 3×. ⚠️ **Do một đối thủ của Webflow xuất bản**, nên đọc con số với
thiên lệch đó; phương pháp thì có mô tả và lặp lại được.

Năm nguyên nhân họ nêu đáng đọc như một checklist "đừng làm", vì ta đã tránh cả năm nhờ
CSS-theo-node: (1) **mọi style đều cần một class**, kể cả style dùng một lần; (2) combo
class chỉ dùng được **đúng thứ tự đã tạo**, sửa một cái phải bỏ hết rồi thêm lại;
(3) class tồn tại chỉ để mang một style duy nhất; (4) **nhãn trong Navigator cũng cần
class**, tức thứ chỉ-dành-cho-builder phình vào HTML output; (5) CSS **không atomize**
nên style giống nhau sinh khai báo trùng lặp.

Điểm (4) là cái đáng ghi nhớ nhất cho ta, và tôi đã kiểm: `NodeRenderer.tsx` **không hề
đọc `node.name`**. Nhãn của node là thứ chỉ tồn tại trong builder — không vào HTML, không
vào selector; selector là `[data-n="<id>"]`, khoá ổn định. Đó đúng là chỗ Webflow trộn
hai mối quan tâm (nhãn cho người và khoá cho máy) và trả giá bằng HTML phình. Đừng bao
giờ để tên hiển thị tham gia vào output.

**Cái giá của mô hình ta, nói thẳng: không có tái dùng.** CSS tăng tuyến tính theo số
node — 158 node ra 262 rule, 32 KB. Webflow đổi chiều ngược lại: chia sẻ class nên
gọn hơn, và đúng vì thế mà rác tích lại. **Hai mô hình, hai loại nợ.** Nợ của ta tăng
đều và dự đoán được; nợ của họ tăng theo số người từng chạm vào site.

---

## 3. Năm thứ ta đang làm ĐÚNG hơn — đừng đánh mất

1. **Op có kiểu + validator server + `invert()`.** Builder.io lưu cả tài liệu,
   Plasmic lưu snapshot. Đừng bao giờ "tối ưu" về phía đó.
2. **API công khai cho cấu trúc và style.** Webflow không có, nên không diff, không
   review, không migrate bằng script. Ta sửa 421 khai báo bằng một script trong một
   buổi.
3. **Override bind bằng khoá ổn định** (`instanceId/localId`) — đúng cơ chế Figma
   dùng, và `zNodeId` cấm `/` với `:` khiến hai hệ địa chỉ an toàn theo CẤU TRÚC.
4. **CSS sinh theo node** → miễn nhiễm style bloat, và không cần workaround kiểu
   `class` attribute của Webflow.
5. **Breakpoint là hằng số cấp site**, không phải cấu hình từng trang như Wix Studio
   — sai lầm mà họ không sửa được sau nhiều năm.

### 3.1 Bằng chứng mạnh nhất cho lựa chọn "AI ghi qua op, KHÔNG ghi vào file"

Phát hiện đắt giá nhất của nhánh Plasmic, và nó nằm trong mã nguồn CLI hiện tại
(`packages/cli/src/actions/sync-components.ts`):

```ts
if ((scheme as any) === "direct") {
  throw new Error(`Direct update codegen scheme is no longer supported`);
} else if (/\/\/\s*plasmic-managed-jsx\/\d+/.test(editedFile)) {
  // … cảnh báo, chỉ ghi đè khi có --force-overwrite
}
```

Đọc ra được cả một lịch sử: Plasmic **từng có** scheme `direct` — sinh code **thẳng vào
file của lập trình viên**, đánh dấu vùng do máy quản bằng comment `//
plasmic-managed-jsx/<số>` (số = version định dạng), và do đó **buộc phải làm merge JSX
ba chiều**. Họ **đã khai tử nó**; đường di cư duy nhất là `--force-overwrite` để chuyển
sang `blackbox`. Package `code-merger` không còn trong danh sách `packages/`.

Thay vào đó docs của họ tuyên bố dứt khoát về quyền sở hữu: `plasmic/PlasmicButton.tsx`
là "owned by Plasmic, and shouldn't be edited by you"; `Button.tsx` là "owned by you,
feel free to edit". Và để bù cho việc không được sửa file kia, họ mở một **API override
5 khoá từ bên ngoài**: `props`, `as`, `render`, `wrap`, `wrapChildren`.

**Vì sao điều này quan trọng với ta:** ta có đúng bài toán đó, chỉ khác vật liệu. Hai
tác giả — người và lớp AI — cùng muốn sửa **một** artifact. Plasmic đã thử cách "cả hai
ghi vào cùng chỗ, rồi merge" và **bỏ**, sau nhiều năm và một package chuyên trách. Ta
đã chọn cách còn lại từ đầu: lớp AI **không ghi file, không ghi doc trực tiếp** — nó
phát op, op qua validator, người bấm Publish. Đây không phải một lựa chọn tạm; đó là
lựa chọn mà công cụ mã nguồn mở trưởng thành nhất trong nhóm đã hội tụ về sau khi thử
hướng kia.

Nguyên tắc kèm theo, cũng từ docs của họ, đáng dán lên tường: *"The fact that a
component is rendered by Plasmic should just be an implementation detail, and someone
should be able to use a Plasmic-rendered component without even knowing what Plasmic
is."*

Bản đảo chiều của cùng ý tưởng là **app hosting**: Studio của Plasmic **không** render
canvas bằng code của Plasmic — nó chạy **bên trong app của lập trình viên** qua một
route `/plasmic-host` chỉ render `<PlasmicCanvasHost/>`. Designer thấy component React
thật, provider thật, data thật. Ta đã ở một dạng nhẹ của cùng kiến trúc — canvas là
iframe trỏ vào route render **thật** của chính app, không phải một bộ mô phỏng. Giữ
nguyên; đây là lý do bản xem trước của ta đáng tin.

---

## 4. Mười khoảng trống, xếp theo giá trị trên rủi ro

### 4.1 Token sửa được bypass publish — CAO
Chỗ duy nhất ta thua Framer. `Release.globals` + `Release.tokens` theo khuôn
`Release.translations`. HANDOFF 3.10, ước 4–6h.

### 4.2 Dọn override mồ côi + "reset override hàng loạt" — CAO
Hai mặt của một vấn đề. Figma ship lệnh sửa chữa riêng cho mồ côi; Wix nêu thẳng
việc thiếu "reset all" là lý do token đổi mà element không đổi. Ta cần: **đếm được
bao nhiêu override đang tồn tại**, **chỉ ra cái nào mồ côi**, và **gỡ hàng loạt**.
HANDOFF 2.3.

Chi tiết UX của Figma đáng copy nguyên, vì nó là khác biệt giữa một menu dùng được và
một form dài: menu reset của họ **chỉ liệt kê thuộc tính THẬT SỰ có override** — "Figma
only lists properties that have changes applied". Tức danh sách **động, sinh từ dữ
liệu**, không phải danh sách tĩnh mọi field có thể override. Với ta, `ContentOverride`
có 6 field (`content`, `label`, `alt`, `assetId`, `href`, `a11yLabel`), nên hiển thị cả
6 lúc nào cũng sẽ sai: người dùng phải tự đoán cái nào đang khác gốc.

Cộng hai mức Figma tách rõ mà ta cũng cần tách: **reset một field** và **reset tất cả**
(`removeOverrides()` — "Removes all **direct** overrides on this instance"; bản cũ
`resetOverrides()` đã deprecated).

### 4.3 Component chưa có API công khai (props có kiểu) — CAO, và nó MỞ KHOÁ nhiều thứ
Hiện chỉ **composite** có `params` với schema zod; preset thì instance chỉ đổi được
chữ và ảnh. Framer gọi *variable*, Plasmic gọi *Param*, Builder.io gọi *inputs*,
Webflow gọi *component properties*. **Bốn trên sáu đều có** — Wix thì không, và bị
người dùng kêu suốt 6 năm.

Quan trọng hơn: đây là **điều kiện tiên quyết cho semver tự tính** (mục 1.5).

Khuôn đã có sẵn: `composites/registry.ts` — một schema zod, ba nơi đọc. Hai thứ đáng
học thêm:

- **`Param.exportType` của Plasmic** (`Internal | External | ToolsOnly`) để phân biệt
  prop nào là API thật.
- **Slot khai báo được của Figma** (mục 1.1) — cho tác giả component mở một vùng tự
  do biên tập **kèm `minChildren`/`maxChildren` và whitelist loại con**. Đây là thứ
  duy nhất trong cả sáu công cụ giải được "cho sửa cấu trúc mà vẫn giữ ranh giới".
  Ta đã có `slots` cho composite, nhưng khoá là cố định trong code và không có ràng
  buộc số con.

Một chi tiết Figma cố ý giữ hẹp và ta nên bắt chước: `componentPropertyReferences`
chấp nhận **đúng ba** field được "nâng" thành property — `visible`, `characters`,
`mainComponent`. Họ không nới lỏng dần, mà thêm `SLOT` như một van xả riêng biệt.
Nới lỏng dần là con đường tới không kiểm soát được.

### 4.4 Token không có ID ổn định, và không có lối xử lý token đã xoá — TRUNG BÌNH CAO
Đổi tên token là vỡ mọi tham chiếu, im lặng. Plasmic tách `regKey` khỏi `name`. Ta đã
có `Token.id`; thiếu là doc tham chiếu bằng `name`. Càng để lâu càng nhiều tham chiếu
phải migrate.

Figma giải nửa còn lại của bài này bằng một cờ đáng copy nguyên: **`deletedButReferenced`**
trên `Variable`. Token bị xoá mà **vẫn còn nơi tham chiếu** thì không biến mất — nó
được giữ lại và đánh dấu. Nghĩa là hệ thống **không bao giờ ở trạng thái dangling**;
thay vì thế nó ở trạng thái "đã xoá nhưng còn nợ", và trạng thái đó **đếm được, tra
được, dọn được**. Ta hiện có `Token.deprecated` — gần, nhưng nó là ý định của con
người, không phải sự thật đo được về việc còn ai dùng hay không.

Ghi chú: API xoá token của ta hiện **từ chối xoá** kèm danh sách chỗ đang dùng
(`api/design-tokens/[id]/route.ts`). Đó là một giải pháp hợp lệ khác cho **cùng** nguyên
tắc "không để dangling" — chặt hơn Figma, và với một site thì đúng hơn. Đừng nới nó ra
mà không có `deletedButReferenced` thay thế.

**Nếu định chuẩn hoá format token**, bản chuẩn để nhắm là **DTCG Design Tokens Format
Module** (designtokens.org). Bốn điều khoản đáng đọc trước khi tự thiết kế:

- Chỉ **`$value` là bắt buộc**; một object được nhận là token nhờ **có `$value`**.
- Type phải **không nhập nhằng**: hoặc `$type` tường minh, hoặc kế thừa từ group cha —
  và spec nói thẳng "**Tools must not guess types from value inspection**". Đối chiếu:
  `check-tokens.ts` của ta nhận diện token bằng `typeof obj.$token === 'string'`, tức
  cũng dựa trên **sự có mặt của một key**, không suy ra từ giá trị. Cùng nguyên tắc.
- **Hai cú pháp tham chiếu** phải hỗ trợ cả hai: `{group.token}` và JSON Pointer `$ref`
  (RFC 6901). Kèm yêu cầu **phát hiện circular reference** — lại đúng thứ Plasmic có
  trong `ResolvedToken`.
- Group kế thừa qua **`$extends`**, deep merge, override local thắng.

Lý do spec nêu cho việc có reference đáng ghi lại vì nó là lý do của cả mục này:
"…**creating semantic relationships between tokens**, maintaining consistency across
related values." Token trỏ token không phải tiện tay — nó là chỗ *ý đồ* được ghi.

### 4.5 Hạ tầng migration cho schema doc — TRUNG BÌNH, nợ dồn theo thời gian
`schemaVersion` cố định là 1, chưa ai đọc. Builder.io là ví dụ về việc bỏ qua; Plasmic
là ví dụ về khối lượng thật của ~5 năm tiến hoá.

Khi dựng, chép bốn quyết định của `BundleMigrator` (chi tiết ở §1.4) — chúng rẻ lúc đầu
và đắt lúc retrofit:

1. **Chạy lazy lúc ĐỌC, trong transaction** — không phải một job quét cả bảng. Ta đọc
   `PageVersion.doc` và `Preset.tree` ở vài chỗ xác định, nên đây là chỗ đặt hook.
2. **Migration cũng phải chạy trên bản ĐÃ PUBLISH**, không chỉ bản nháp. Với ta là cả
   `PageVersion` được `ReleaseEntry` trỏ tới — nếu bỏ sót, đổi schema là làm chết site
   đang chạy trong khi bản nháp vẫn xanh.
3. **Backup từng bước trước khi ghi.**
4. **Phân loại migration nếu có bước nào cần "mở" doc ra** — của họ là `bundled` phải
   chạy hết trước `unbundled`. Ta chưa có khái niệm bundle nên có thể chưa cần, nhưng
   nhớ rằng thứ tự tuần tự thuần **không** đủ với mọi hình migration.

### 4.6 Detach instance — TRUNG BÌNH
Bốn trên sáu có, và **cả bốn đều một chiều**. Ta có `invert()` nên sẽ tốt hơn tất cả.

### 4.7 `site.css` tĩnh nằm ngoài `Release` — TRUNG BÌNH
Cùng loại rủi ro đã cắn Plasmic: pin đúng version cũ mà layout vẫn vỡ vì runtime CSS
đổi. Lùi một release của ta không lùi `site.css`.

### 4.8 `Preset.tree` không tự khai schema version — TRUNG BÌNH, và nó ẩn
`Doc` có `schemaVersion`; `Preset.tree` là "đúng hình dạng `Doc` **trừ**
`schemaVersion`" (`types.ts`). Nghĩa là cây component **không tự nói nó thuộc schema
nào**. `apply-to-preset.ts:57` gắn `CURRENT_SCHEMA_VERSION` vào lúc chạy để validator
đọc được — tức nó **giả định** cây đang ở schema mới nhất, và giả định đó không được
kiểm.

Hôm nay đúng, vì `schemaVersion` mới có một giá trị. Ngày `Doc` lên 2 thì mọi
`Preset.tree` lưu từ trước trở thành schema 1 mang nhãn 2, im lặng. Đây là dạng nợ
**rẻ để trả bây giờ** (thêm một cột hoặc một field vào `tree`) và đắt sau, vì lúc đó
phải suy ra version từ nội dung.

Liên quan: kiểm tra tôi đã chạy trong đợt này cho thấy **id node của preset được giữ
nguyên qua op** — `applyOpsToPreset` sửa tại chỗ trên cùng `nodes` map, và
`extract-presets.ts:48` clone theo đúng id nguồn. Nên kênh thất bại kiểu Figma ("địa chỉ
override trôi") **hiện không có** ở ta. Nhưng nó chỉ đúng chừng nào không ai thêm một
luồng sinh lại id cho cây preset — nếu thêm, **mọi override trên mọi trang mất im
lặng**. Đáng có một test khoá hành vi đó lại.

### 4.9 "Gập tất cả" cất luôn node đang chọn — THẤP, vá một dòng
Xem mục 1.6. Figma chừa nhánh của selection ra; ta gập cả nó, nên node đang chọn biến
khỏi cây trong khi inspector vẫn bày thuộc tính của nó.

### 4.10 Không diễn đạt được "XOÁ giá trị base ở khổ này" — THẤP, nhưng rẻ để vá
`RuleSet` của Plasmic phân biệt ba trạng thái ở một variant được target: **không nói gì**
= kế thừa base, **rỗng** = xoá giá trị base, **có giá trị** = ghi đè. Ta chỉ có hai — một
layer style hoặc có key hoặc không có key, và "không có key" luôn nghĩa là kế thừa.

Chưa cắn vì hầu hết thuộc tính đều ghi đè được bằng một giá trị trung tính
(`padding: 0`). Sẽ cắn ở thuộc tính không có giá trị trung tính, hoặc khi cần trả một
node về đúng giá trị mặc định của trình duyệt ở một khổ. Vá bằng một sentinel tường minh
trong `Style` (không phải `null`, vì `null` đã mang nghĩa khác ở `setVisibility`), cộng
một nhánh trong `css.ts`. Ghi ra đây để lúc nó xảy ra thì biết ngay là vấn đề gì.

---

## 5. Bốn thứ ta nên CHỦ ĐỘNG không theo

- **Framer và Wix bỏ token spacing/radius/shadow toàn cục.** Ta có và nên giữ — site
  này port từ một hệ thiết kế có thang khoảng cách thật. (Người dùng Plasmic cũng
  đang xin thêm token cho radius/shadow.)
- **Builder.io đánh giá binding bằng chuỗi JS** (`new Function` ở browser,
  `isolated-vm` ở Node), với bộ tự chèn `return` bằng cách dò dấu `;` mà chính họ
  đánh dấu `// FIXME: gross hack`; bản Gen 1 dùng `with (rootState)` kèm
  `// TODO: remove`. **Đừng mở đường cho biểu thức tuỳ ý trong doc.**
- **Webflow tự động đổi tên class trùng khi merge branch** ("Button" → "Button 2") —
  một cỗ máy sinh rác gắn thẳng vào tính năng cộng tác. Nếu sau này ta làm branch,
  xung đột tên phải **hỏi người dùng**, không tự đổi.
- **Wix để breakpoint ở cấp trang.** Ta đang đúng; đừng bao giờ "linh hoạt hoá" theo
  hướng đó.

---

## 6. Đã áp dụng ngay trong đợt này

**`pnpm check:tokens` giờ quét cả cây component.** Phát hiện trực tiếp từ báo cáo
Webflow: Audit panel của họ **không kiểm bên trong component**, nên càng
componentize — tức càng làm đúng hướng bảo trì — càng nhiều thứ nằm ngoài tầm kiểm
tra tự động. Ta đang có đúng điểm mù đó: **154 tham chiếu `$token` sống trong
`Preset.tree`** mà script chỉ quét `PageVersion`. Xoá hay đổi tên một token thì
`pnpm verify` vẫn xanh trong khi mọi trang dùng component đó mất padding hoặc mất
màu. Đã vá; hiện cả 5 component đều báo xanh.

---

## 7. Việc tiếp theo được nghiên cứu này định hình

**Visual-diff (HANDOFF 2.1d) giờ có hình dạng cụ thể.** Wix Responsive Checker là bản
mẫu tốt nhất: quét **một trang trên mọi breakpoint**, tìm **chồng lấp, tràn nội dung,
khoảng hở ngoài ý muốn**, và **đề xuất sửa từng lỗi**. Đó đúng là những phép đo tôi
làm tay trong session 17/08 (khe hở phải, tràn ngang) để tìm ra dải đen 240px. Tự
động hoá chúng là việc rẻ và đã có tiền lệ chứng minh giá trị.

---

## 8. Còn để ngỏ và cần kiểm chứng lại

**Về `overrideKey` của Figma: nhánh thứ ba cũng KHÔNG tìm thấy bằng chứng chính thức.**
Nó đọc kỹ `help.figma.com` + `developers.figma.com` và kết luận rằng tài liệu công khai
chỉ nói **tên layer + giá trị gốc + hierarchy**, còn mọi khẳng định về khớp theo GUID
path là "folklore cộng đồng". Điều đó **không lật** bảng hai cơ chế ở mục 1.1 — bảng đó
đã ghi rõ `overrideKey` **không** có trong tài liệu công khai, bằng chứng đến từ spec
`.fig` dịch ngược và một bài của staff. Ba nhánh độc lập cùng không tìm thấy nó trong
docs là một dữ kiện có ích: **nếu định mô phỏng Figma, đừng dựa vào cơ chế đó** — nó
không được cam kết, và `swapComponent` còn được tài liệu hoá kèm câu "we may update
these override preservation heuristics from time to time."

Hai chỗ nữa nhánh ba làm rõ được, đều thuộc loại "hai đường làm cùng một việc, semantics
trái ngược" — đúng loại bẫy ta nên tránh tạo ra:

- `swapComponent()` **giữ** override; nhưng gán `mainComponent = …` trên một nested
  instance thì "**clears all overrides** and performs nested instance swapping".
- Swap qua **Assets panel** chỉ giữ **override text**; swap qua instance khác thì giữ
  nhiều hơn. Hai đường, hai chính sách bảo toàn.

**Hai nguồn của chính Figma xung đột nhau**, tôi không giải quyết được: (a) kiểu
`TIMING` là **milliseconds** (help center) hay **seconds** (plugin docs); (b) nhãn menu
là "Push overrides to main component" hay "Push changes to main component". Nếu định
mô phỏng, kiểm trong sản phẩm trước.

**Vài số liệu lan truyền rộng đã LỖI THỜI** — đáng nhớ vì chúng vẫn xuất hiện khắp
nơi. Giới hạn mode của Figma **không phải** 1/4/40 mà là **10** (Professional) /
**20** (Organization) / **không giới hạn qua extended collections** (Enterprise).
Và Figma có **6 kiểu biến**, không phải 4 — nhưng **REST API vẫn chỉ trả về 4**
(thiếu `TIMING`, `EASING`). Bất đối xứng đó cần biết nếu làm pipeline token qua REST.

**Hai nhánh Plasmic của tôi cũng lệch nhau ba chỗ**, đã ghi tại §1.4 và §1.5. Tóm lại:
số lượng bundle migration ("257") và cơ chế `MODEL_VERSION` là **suy ra từ nguồn thứ
cấp và không xác minh được trong mã nguồn** — cơ chế thật là "version = tên migration
cuối". "Semver tự tính" có bằng chứng mã nguồn nhưng **không có bằng chứng docs**.
"Merge 3 chiều" thì docs mô tả nhẹ hơn nhiều: chọn một bên. Khi trích lại tài liệu này,
trích **cơ chế**, đừng trích con số.

**Ba thứ về Plasmic tôi tìm nhưng KHÔNG thấy bằng chứng là có** — đáng ghi vì thiếu
chúng cũng là một dữ kiện: (a) API "deep override" chọc từ ngoài vào node bên trong một
component lồng — `TplComponent` chỉ có `@WeakRef component`, không có cấu trúc nào mô tả
override xuống cây con, nên **instance đóng của họ là đóng thật**; (b) một khái niệm tên
chính xác là `PlumeSlot`; (c) co-editing đồng thời — xem `OutdatedBundleError` ở §1.4.

**Tiếng nói người dùng Plasmic** (HN / Reddit / forum) không thu được — hết ngân sách
tìm kiếm của đợt. Bù lại, bốn điểm đau dưới đây do **chính docs hoặc mã nguồn của họ
thừa nhận**, nên vẫn dùng được: không có cách dễ để merge hai project; scheme `direct`
bị khai tử; override nội dung theo breakpoint gây flash; branching là Enterprise-only.

### Thiếu bằng chứng

**Tiếng nói người dùng Webflow sau 1–3 năm** — Reddit và Webflow Community đều chặn
truy cập tự động. Mọi kết luận về Webflow ở trên dựa trên **tài liệu của chính họ**,
trong đó có nhiều chỗ họ tự thừa nhận vấn đề (ngưỡng 1.000 class, "unused styles slow
Webflow", và một app bên thứ ba chuyên dọn style tồn tại trên chính chợ ứng dụng của
họ).

Với Wix Studio, **phạm vi và thời hạn giữ của Site History** không tìm được tài liệu
— cần kiểm trực tiếp trong sản phẩm nếu điều đó quan trọng.

---

## 9. Vì sao Figma/Framer "chạy nhanh" — và phần nào áp được vào đây

Câu hỏi của người dùng ngày 19/08/2026: *"Figma, Framer, hay bất kỳ bên nào khác đã làm
gì, để hệ thống của họ chạy rất nhanh?"* Trả lời thẳng: **phần lớn cái làm Figma nhanh
thì ta KHÔNG copy được, và cũng không nên.** Nhưng bốn kỹ thuật cụ thể thì áp được, và
đã áp trong đợt này.

### 9.1 Cái họ làm mà ta không copy được

**Figma là một trình duyệt bên trong trình duyệt.** Họ không dùng DOM để vẽ canvas: có
engine riêng viết bằng C++ biên dịch sang WebAssembly, renderer riêng trên WebGL, và
**engine dàn chữ riêng**. Đổi lại họ phải tự làm những thứ trình duyệt cho không: chọn
chữ, con trỏ nhấp nháy, IME tiếng Việt, in, tìm-trong-trang, screen reader.

Cái giá đó **không trả nổi cho một builder web**, vì mục tiêu của ta ngược lại: khung
xem trước phải **trung thực từng pixel** với site thật. Site thật chạy trên DOM của
trình duyệt, nên khung xem trước phải là DOM của trình duyệt. Một renderer riêng là một
cách nữa để "xem trước đúng, publish ra sai" — đúng loại lỗi tốn nhất.

**Framer**: canvas dựng bằng React nhưng site xuất bản cũng là React của họ, nên hai bên
dùng chung một renderer. Ta không có tính chất đó (site là HTML+CSS do ta sinh), nên
iframe là cách rẻ nhất để có sự trung thực đó.

### 9.2 Ba nguyên tắc của họ thì áp được nguyên văn

1. **Không cho framework UI chạm vào từng frame của một gesture.** Trong Figma, kéo và
   phóng không đi qua vòng dựng lại giao diện; chúng ghi thẳng vào ma trận biến đổi.
   Tương đương ở ta: pan/zoom giữ trong `ref`, ghi vào `style.transform` trong một
   `requestAnimationFrame`, và chỉ đồng bộ về React state **khi gesture đã lắng**.

2. **Chia lát công việc theo mức ưu tiên.** Figma nói rõ họ ưu tiên phản hồi cho thao
   tác của CHÍNH người dùng trước thay đổi đến từ người khác. Tương đương ở ta là thứ
   tự: transform trước, đo lại khung chọn sau, lưu sau nữa.

3. **"Thứ bạn tưởng là điểm nghẽn thường không phải."** Đây là câu cảnh báo hữu ích nhất
   trong toàn bộ nghiên cứu này, và nó đã đúng hai lần trong dự án: (a) cảm giác "chọn
   node bị lag" hoá ra phần lớn là **dev mode** — 639ms ở dev xuống 65ms ở production;
   (b) "zoom không chính xác vị trí chuột" hoá ra **không phải** lỗi công thức neo, mà
   là hệ toạ độ đầu vào sai khi con trỏ nằm trên iframe.

### 9.3 Bốn thứ đã làm — rồi ba trong bốn bị BỎ cùng ngày

Đây là phần đáng đọc nhất của mục này, vì nó là một bài học chứ không phải một danh
sách thành tích.

| Việc | Trước | Sau khi tối ưu | Kết cục |
| --- | --- | --- | --- |
| Pan/zoom trong gesture | mỗi tick bánh xe dựng lại cả Canvas (5 iframe + lưới + outline) | ghi `transform` trong rAF, React chỉ render sau 140ms lắng; **22ms/frame** | **bỏ** — không còn pan/zoom |
| Neo zoom theo con trỏ | lệch **−26px nội dung mỗi tick**, sai số lớn dần theo mức phóng | **0–1px** | **bỏ** — không còn zoom |
| `transition` trên transform | bật cả trong lúc cuộn → khung trễ sau con trỏ | chỉ bật cho bước nhảy | **bỏ** |
| Chiều cao khung | **1400px cứng** cho mọi trang, mọi khổ | đo theo từng khổ, không chặn trên | **bỏ** — quay lại cố định, nhưng theo THIẾT BỊ |

Cùng ngày 19/08/2026, sau khi dùng thật, người dùng bỏ toàn bộ mô hình canvas kéo–phóng:
*"sử dụng canvas không hợp lý"*, *"chỉ hiển thị 1 loại khi xem trên"*, *"có lẽ không cần
hiển thị canvas nữa"*. Chi tiết ở HANDOFF §3.39–3.42.

**Bài học, và nó khớp chính xác với §9.2 điểm 3.** Tôi đã tối ưu rất kỹ một thứ mà lẽ ra
không nên tồn tại. Bốn phép đo ở trên đều thật và đều đúng; ba trong bốn giờ vô giá trị
vì mã chúng đo đã bị xoá. "Thứ bạn tưởng là điểm nghẽn thường không phải" có một anh em
song sinh ít được nói tới: **thứ bạn tưởng cần tối ưu có khi là thứ cần bỏ.**

Chỉ dấu đã ở ngay trong README của chính dự án này, ở mục non-goal, từ trước đó:

> **Không canvas kéo-thả.** Khi bạn muốn canvas, thứ bạn thật sự muốn là inspector tốt hơn.

Mã đã trôi khỏi câu đó, và không cổng kiểm nào bắt được — vì đó là một tuyên bố về sản
phẩm, không phải một bất biến có test. Đáng nhớ: khi đang tối ưu một thứ, đọc lại
non-goal trước.

### 9.4 Đơn vị viewport: giới hạn đã BIẾN MẤT theo quyết định đó

Khi khung cao bằng nội dung, `100svh` **bên trong** khung nghĩa là "cả trang", không
phải "một màn". Đo được: nội dung trong khung Desktop phình lên **65.184px** trong khi
khung cao 9.728px. Webflow và Plasmic vướng đúng chỗ này.

Cách sửa từng được đề xuất là bỏ `vh/svh/dvh` khỏi CSS và dùng
`calc(var(--mm-vh) * 100)` — 11 chỗ trong `src/styles/**`, nhưng nó **đổi CSS được
publish**, tức đổi `cssHash`.

**Không cần làm nữa.** Khung giờ cao bằng một màn THIẾT BỊ (1920×1080, 1440×900,
1024×768, 768×1024, 320×568), nên `100svh` bên trong lại đúng nghĩa "một màn". Nội dung
dài thì cuộn trong khung — đúng như khách sẽ cuộn.

Ghi lại vì đây là dạng kết cục dễ bỏ sót: một quyết định về sản phẩm xoá luôn một hạng
mục kỹ thuật đang chờ. Trước khi làm `--mm-vh`, kiểm lại xem nó còn lý do tồn tại không.
