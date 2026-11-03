# Form mẫu hệ thống — chỉnh mọi thứ của form ngay ở sidebar

Ngày: 03/11/2026 · Trạng thái: người dùng đã duyệt mô tả trong chat ("triển khai đi").
Ghi chú *(gọi của AI)* = quyết định của người viết, người dùng chưa duyệt riêng.

## 1. Vì sao

Người quản trị không thấy hợp lý khi form nằm trên trang nhưng URL nhận dữ liệu lại sửa ở
màn Cài đặt. Họ muốn: một form mẫu cố định → nhân bản ra → tùy biến giao diện, ô nhập, URL,
cách báo kết quả, tất cả ở sidebar khi chọn form. Làm được vậy thì phần sửa Form ở Cài đặt
không cần nữa.

Hiện trạng (đối chiếu code 03/11/2026):

- Form là `Composite` khoá `Form` (`src/lib/composites/Form.tsx`, params ở
  `src/lib/composites/registry.ts:50-136`). Ô nhập nằm trong `params.fields`, không phải
  node con. Slot `heading` (trên `<form>`) và `note` (dưới) là node thật.
- Form giữ KHOÁ (`params.endpointKey`), URL nằm trong `Site.globals.endpoint`. Giữ cơ chế này
  là có chủ ý (registry.ts:89-103): nhiều form dùng chung một nơi nhận, URL không lẫn vào diff
  nội dung, globals được seal vào Release nên đổi URL phải Publish và rollback trả URL cũ.
- Sidebar (Inspector) chỉ có `EndpointPicker` chọn khoá (Inspector.tsx:460). URL chỉ sửa ở
  Cài đặt (`SiteEndpointsForm`, API `src/app/api/settings/endpoints/route.ts`, quyền `admin`).
  Nhãn ô / chữ nút sửa được dạng chữ phẳng qua `ContentPanel`, nhưng không thêm/bớt/sắp ô,
  không đổi loại ô hay bắt buộc.
- Giao diện bên trong form chỉ chỉnh được bằng `customCss` tay (form danh sách chờ trên trang
  chủ, node `waitlist-f`, có ~20 dòng CSS). Không có cơ chế style có kiểu cho phần con.
- Sau khi gửi: chỉ có dòng chữ `status` dưới nút, hoặc `successPanel` phát `modal:show` để
  effect `modal` bao ngoài chuyển panel (chỉ khi form nằm trong popup). Không có hộp thoại.

## 2. Mục tiêu

1. **Mẫu hệ thống "Form"**: một component do hệ thống tạo, không xoá được, không sửa trực
   tiếp, chỉ nhân bản / chèn bản sao. Nội dung: tiêu đề, mô tả, một ô email, nút gửi.
2. **Khối "Form" trong sidebar** khi chọn một Composite Form:
   - Ô nhập: thêm, bớt, kéo sắp; mỗi ô có loại (text, email, tel, number, textarea, select,
     checkbox), nhãn, chữ gợi ý, bắt buộc, trợ giúp, lựa chọn (với select).
   - Chữ nút gửi; lời báo thành công / thất bại (chế độ dòng chữ).
3. **"Gửi tới" sửa URL ngay ở sidebar**, giữ cơ chế khoá dùng chung:
   - Hiện URL thật của nơi nhận. Admin sửa và lưu tại chỗ → mọi form dùng khoá đó đổi theo.
   - Dùng chung với form khác thì ghi rõ "Dùng chung với N form: /trang-a, component X".
   - "Dùng URL riêng" tách form này sang khoá mới (đã có action `split`).
   - Chọn lại một nơi nhận đã có từ danh sách (như `EndpointPicker` hiện tại).
   - Người không phải admin: thấy URL, không sửa URL, không tạo nơi nhận mới, không "Dùng URL
     riêng"; câu nhắc "Chỉ admin đổi được URL nhận". *(gọi của AI)* Họ VẪN chọn được một nơi
     nhận ĐÃ CÓ trong bảng (như hôm nay) — mọi URL trong bảng đều do admin đặt, nên chuyển giữa
     chúng không đưa dữ liệu khách tới chỗ admin chưa duyệt. Không phải làm validator biết role.
4. **"Sau khi gửi"**, ba chế độ:
   - `inline` — dòng chữ dưới nút (mặc định, như hiện tại).
   - `dialog` — hộp thoại giữa màn hình. Nội dung là HAI SLOT tự thiết kế: `success` và
     `error`, node thật trên canvas, thêm ảnh/nút/chữ tùy ý, dịch được như chữ khác. Hộp thoại
     có nút Đóng, đóng bằng Esc, giữ focus bên trong, trả focus về nút gửi khi đóng.
   - `panel` — chuyển panel của popup bao ngoài (`successPanel` hiện có).
5. **Style từng phần của form bằng bảng style thường**: chọn phần (ô, nhãn, ô nhập, nút gửi,
   dòng thông báo, trợ giúp) rồi chỉnh như chỉnh một node, gồm cả lớp di chuột và focus bàn
   phím, và các breakpoint.
6. **Màn Cài đặt**: bỏ chỗ SỬA form; thay bằng bảng CHỈ XEM — form nào, ở đâu, gửi tới URL nào,
   nút "Mở" vào editor chọn sẵn form đó. *(gọi của AI)* Giữ nút xoá khoá không còn form nào dùng,
   vì đó là việc dọn dẹp duy nhất không làm được ở sidebar.

## 3. Không làm (lần này)

- Nút mẫu có đủ trạng thái (di chuột / đang bấm / focus) — đợt sau.
- Các component mặc định khác (Section trống, Tiêu đề + mô tả, Thẻ, Hỏi đáp) — đợt sau. Đợt
  này dựng KHUNG "mẫu hệ thống" sao cho thêm mẫu sau chỉ là thêm dữ liệu.
- *(gọi của AI)* Mỗi ô nhập thành một node riêng để style riêng từng ô. Mọi ô trong một form
  dùng chung style của phần "ô nhập". Tách node là việc lớn gấp nhiều lần và mở đường làm hỏng
  form (xoá ô bắt buộc, đặt ô ra ngoài `<form>`).
- Hiện thông điệp lỗi do server trả về.

## 4. Chống mục tiêu (hỏng dù "chạy")

- Form đang chạy trên site đổi hành vi hoặc giao diện sau khi triển khai mà không ai sửa nó.
  Form danh sách chờ (`waitlist-f`, `successPanel: "waitlist-done"`) phải chạy y như cũ.
- Người không phải admin đặt được một URL nhận MỚI (sửa URL, tạo nơi nhận, tách URL riêng) —
  qua giao diện hay gọi thẳng API.
- URL đổi trên site thật mà không qua Publish.
- Một param sai làm cả form về mặc định im lặng (`formParams` dùng `.catch(FORM_DEFAULTS)`):
  sidebar không được ghi params không hợp lệ; lỗi phải hiện cạnh ô gây lỗi.
- Hộp thoại chỉ đẹp trong builder: trên site thật không mở, không đóng được bằng bàn phím, hoặc
  slot thành công lóe lên lúc tải trang.
- Mẫu hệ thống bị sửa nhầm qua AI/MCP hay API (rào chỉ ở giao diện là không đủ).

## 5. Ràng buộc đã biết

- `setProps` THAY cả key `params`, không merge (ops.ts:276-287) — mọi ghi phải trải params
  thô cũ, như `withEndpointKey` đang làm.
- Slot không có op riêng: node slot là `children` thường của Composite, `slots` chỉ là bảng
  định tuyến và chỉ đổi qua `setProps`. `removeNode` không dọn id trong `slots`.
- Không có cơ chế style có kiểu cho phần con của node; style luôn nhắm `[data-n="<id>"]`.
- Đổi URL dùng API `/api/settings/endpoints` (POST `setUrl` / `split`), quyền `admin`. Editor
  store hiện không biết role người dùng.
- Validator (`composite_params`) phải chặn params sai trước khi ghi; AI cũng ghi qua cùng đường.
- Trang có nhiều ngôn ngữ: chữ trong slot dịch như node Text thường; chữ trong params dịch qua
  `param-paths.ts` (đã có cho nhãn, gợi ý, chữ nút).
- Builder chạy cho nhiều dự án: mẫu hệ thống không chứa gì riêng của MaiMoney.

## 6. Cách làm đã chốt (với người dùng)

- Giữ khoá dùng chung; sửa một chỗ đổi mọi form cùng khoá.
- Hộp thoại sau khi gửi là khối tự thiết kế ("linh hoạt nhất").
- Mẫu hệ thống không xoá được; người dùng nhân bản ra để dùng.

## 7. Thiết kế đề xuất (để người dựng quyết chi tiết)

### 7.1 Mẫu hệ thống

- *(gọi của AI)* Cột mới `Preset.system String? @unique` — khoá hệ thống (`"form"`), theo tiền
  lệ `Page.system`. `builtin` giữ nguyên ý nghĩa cũ (nhãn "Có sẵn", xoá được khi không dùng).
- Tạo trong `ensureSiteDefaults` (`src/lib/setup/defaults.ts`): tạo nếu thiếu, KHÔNG bao giờ ghi
  đè. Chạy ở mọi `up -d` và ở màn cài đặt lần đầu.
- Rào ở server, không chỉ giao diện: `DELETE /api/presets/:id`, `PATCH`, `/ops`, và
  `apply_component_ops` của MCP trả 409 "Mẫu hệ thống — nhân bản rồi sửa bản sao" khi
  `system != null`. Rào đặt ở tầng chung (`applyOpsToPreset`) để mọi đường cùng chịu.
- Chèn vào trang: mẫu hệ thống chỉ chèn dạng BẢN SAO độc lập (đóng dấu), không chèn Instance —
  Instance của một mẫu không sửa được thì form không đổi được URL/ô nhập. Validator từ chối
  Instance trỏ tới preset `system`.
- Thư viện component: nhãn "Mẫu hệ thống", nút Xoá và Sửa ẩn/khoá kèm lý do, Nhân bản nổi bật.

- *(gọi của AI)* Bản sao mới của mẫu KHÔNG mang khoá nào ("chưa chọn nơi nhận"): form hiện tắt
  kèm lời nhắc cho tới khi chọn hoặc tạo nơi nhận. Mang sẵn khoá chung (`newsletter`) thì admin
  sửa URL cho form mới sẽ âm thầm đổi luôn mọi bản sao khác. Cần cho `endpointKey` được vắng
  trong schema (hiện có default `newsletter`) mà form cũ không có khoá vẫn hiểu là `newsletter`
  như trước — người dựng chọn cách phân biệt (ví dụ giá trị rỗng tường minh).

### 7.2 Params mới của Form

- `afterSubmit: 'inline' | 'dialog' | 'panel'`. Thiếu → suy ra: có `successPanel` thì `panel`,
  không thì `inline` — để form cũ chạy y như cũ mà không cần migration dữ liệu.
- Slot mới `success`, `error` (dùng khi `dialog`).
- `misconfig` text đổi từ "Đặt URL ở Cài đặt › Form" sang câu trỏ về sidebar.

### 7.3 Hộp thoại

- Form tự render hộp thoại (gợi ý: `<dialog>` gốc + `showModal()` cho focus trap/Esc), chứa slot
  `success` hoặc `error` theo kết quả, cộng nút Đóng có `aria-label`. Không cần effect `modal`.
- Trên site, slot hộp thoại không hiện khi tải trang (không lóe).
- Trong editor, người dùng phải THẤY và CHỌN được node trong cả hai slot trên canvas: sidebar có
  công tắc "Xem trước: Form / Thành công / Thất bại". Cơ chế để người dựng chọn.
- Chọn `dialog` lần đầu mà slot trống → tạo sẵn nội dung mặc định cho cả hai slot (khung + tiêu
  đề + một dòng chữ) trong cùng một batch op với `setProps`.

### 7.4 Style theo phần

- *(gọi của AI)* Trường mới trên Composite: `partStyle?: Record<partName, ResponsiveStyle>`.
  Registry khai mỗi composite có phần nào và selector của phần đó, ví dụ Form:
  `field → .mm-form__row`, `label → .mm-form__label`, `input → .mm-form__input, .mm-form__checkbox`,
  `help → .mm-form__help`, `submit → .mm-form__submit`, `status → .mm-form__status`. Ánh xạ sang
  class có sẵn để không đổi DOM (customCss cũ vẫn khớp).
- Bộ biên dịch CSS phát `[data-n="<id>"] <selector>` cho từng lớp (base, breakpoint, hover,
  focusVisible); `hover` của phần nhắm `:hover` của CHÍNH phần đó.
- Op: `setStyle` nhận thêm `part` (validator kiểm phần có trong registry). AI dùng được cùng op.
- Inspector: khi chọn Form có ô chọn "Đang chỉnh: Cả form / Ô / Nhãn / Ô nhập / Nút gửi / Thông
  báo / Trợ giúp"; bảng style bên dưới ghi vào phần đang chọn.
- Thứ tự ưu tiên: `partStyle` thắng CSS mặc định của `form.css`; `customCss` của node vẫn thắng
  `partStyle` (như hiện tại customCss "luôn thắng").

### 7.5 Sidebar "Gửi tới"

- Mở rộng `EndpointPicker`: hiện URL, ô sửa URL + Lưu (admin), danh sách form dùng chung (từ
  `endpointFormsIn` trên mọi trang/component — server cấp cùng `endpoints`), nút "Dùng URL
  riêng", "Nơi nhận mới". Dùng lại `formEndpointAction` (POST `/api/settings/endpoints`).
- Editor cần biết role: truyền từ server page vào store.
- NavChart dùng cùng khối, giữ chạy.
- *(gọi của AI)* Form nằm trong một Instance của component người dùng: sửa ở sidebar là sửa
  COMPONENT (đổi mọi trang dùng nó), như mọi sửa style/cấu trúc component hôm nay. Không làm
  override params theo từng instance. Sidebar nói rõ điều đó khi form thuộc component.

### 7.6 Màn Cài đặt sau khi đổi

- *(gọi của AI)* Ô "Form" thành "Nơi nhận dữ liệu": bảng CHỈ XEM mỗi nơi nhận — URL, cảnh báo
  http, và danh sách form/biểu đồ đang dùng (nút Mở). Sửa URL / tách / đổi tên chuyển hết sang
  sidebar, cho cả Form lẫn NavChart. Nơi nhận không còn ai dùng: chỉ có nút Xoá (admin).
- API giữ nguyên (PATCH, POST setUrl/split/rename/removeKey) — sidebar và AI vẫn dùng; chỉ giao
  diện Cài đặt bỏ phần sửa.

## 8. Để người dựng tự quyết

- Cách xem trước slot hộp thoại trên canvas.
- Bố cục khối Form trong sidebar, cách kéo sắp ô.
- Tên ô (`name`) tự sinh từ nhãn hay cho sửa; xử lý trùng tên.
- Nút Lưu URL: hiện kèm câu "Site thật đổi khi Publish".
- Nội dung mặc định của slot thành công / thất bại và của mẫu hệ thống.

## 9. Kiểm chứng

- e2e: nhân bản/chèn mẫu → thêm ô, đổi loại, bắt buộc → publish/preview → gửi tới endpoint
  giả → hộp thoại thành công / thất bại hiện, Esc đóng, focus trả về.
- e2e: admin sửa URL ở sidebar → form khác cùng khoá đổi; editor không sửa được (UI + API 403).
- e2e: xoá / sửa mẫu hệ thống qua API và MCP → 409.
- Unit: biên dịch `partStyle` (base, breakpoint, hover, focusVisible); suy `afterSubmit`.
- Hồi quy: form danh sách chờ trên trang chủ staging render và chạy y như trước (so ảnh chụp).
