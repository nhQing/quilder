# Sửa site bằng Claude Desktop (MCP)

Sửa site bằng lời **không cần API key, không tốn credit** — suy luận
chạy trong Claude Desktop và tính vào gói thuê bao của bạn. Builder chỉ cung cấp
công cụ cho Claude gọi.

## Luồng

```
1. Deploy builder lên abc.com
2. Vào abc.com/builder → đăng nhập
3. Vào /builder/claude → cấp token, tải file, chép cấu hình đã điền sẵn
4. Dán vào Claude Desktop → khởi động lại → xong
```

Bước 3 sinh sẵn khối JSON kèm URL và token, nên không phải ghép tay.

## Nó làm được gì

Claude đọc được cấu trúc trang, tìm node theo lời mô tả, tra design token, và
sửa **bản nháp**. Nó cũng tự chụp ảnh trang để nhìn kết quả mình vừa làm.

Nó **không** publish được. Đưa thay đổi ra site thật vẫn là việc bạn bấm nút
trong builder sau khi xem preview. Đây không phải là dặn dò — công cụ publish
đơn giản không tồn tại trong danh mục Claude nhìn thấy.

## Yêu cầu ở máy chạy Claude Desktop

Chỉ cần **Node.js**. File `server.mjs` không phụ thuộc thư viện nào — tải về thư
mục nào cũng chạy, không cần `npm install`.

Riêng `screenshot_page` cần Playwright. Không có nó thì các tool khác vẫn chạy
bình thường, chỉ tool chụp ảnh báo cách cài:

```bash
npm i playwright && npx playwright install chromium
```

## Bộ công cụ

| Tool | Việc |
|---|---|
| `get_design_system` | Breakpoint, lớp style, luật viết style |
| `list_pages` | Danh sách trang, id, trạng thái publish |
| `get_page_outline` | Cây node (không kèm style, để tiết kiệm context) |
| `get_node` | Chi tiết một node, có style từng lớp |
| `resolve_style` | Style CÓ HIỆU LỰC ở một lớp + property CSS mỗi ô phát ra + customCss có đang đè |
| `list_text_units` | Mọi đoạn chữ của trang, kèm khoá `nodeId:field`, cờ `flat` và op phải dùng để ghi |
| `find_nodes` | Tìm node theo text/tên/type/effect |
| `search_tokens` | Tra design token |
| `list_effects` | Hiệu ứng gắn được, kèm params |
| `apply_ops` | **Ghi** — sửa bản nháp, tối đa 80 thao tác |
| `screenshot_page` | Chụp ảnh bản nháp ở một cỡ màn hình |

## Dùng thế nào

- *"Mở dàn ý trang chủ, rồi chụp ảnh cho tôi xem trên tablet."*
- *"Đổi tiêu đề hero thành 'Ghép khối, dựng nhanh'. Chụp lại cho tôi xem."*
- *"Phần footer trên mobile chữ bị sát mép quá, tăng khoảng cách hai bên."*
- *"Gắn hiệu ứng reveal cho các thẻ ở section giới thiệu."*

Nên mở sẵn `/preview/<pageId>` bên cạnh. Hài lòng rồi thì bấm **Publish** trong
builder.

## Ranh giới an toàn

Mỗi dòng dưới đây là một cơ chế, không phải quy ước:

- **Không publish được.** Không có tool nào làm việc đó.
- **Chỉ chạm bản nháp.** Release đang chạy là dữ liệu bất biến.
- **Thu hồi được, có hiệu lực ngay.** Mỗi lời gọi đều tra bảng `ServiceToken`.
  Đây là lý do bảng đó tồn tại: JWT tự nó không thu hồi được.
- **Trần tần suất** 240 lượt đọc và 40 lượt ghi mỗi phút, tính theo token.
- **Vùng khoá.** Node có `locked` (disclaimer, số giấy phép) bị từ chối với AI.
- **customCss có allowlist.** AI chỉ dùng được một tập property mỹ thuật;
  `position`, `z-index`, `inset`… bị chặn.
- **Tối đa 80 thao tác một lần.**
- **Bốn tầng kiểm tra** trước khi chạm database: cú pháp (Zod) → ngữ nghĩa → chạy
  thử trên bản sao → bất biến cấu trúc.
- **Mọi thay đổi tạo một `PageVersion` mới.** Không có gì bị ghi đè.

## Khi hỏng

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| "Không kết nối được builder" | Builder chưa chạy, hoặc `MM_BUILDER_URL` sai |
| "Token hết hạn hoặc đã bị thu hồi" | Cấp token mới ở `/builder/claude` |
| Claude không thấy công cụ | Sai đường dẫn trong `args`, hoặc chưa khởi động lại |
| "không đủ quyền" | Token đứng tên tài khoản `viewer` |
| "Vượt trần tần suất" | Chờ theo số giây báo trong thông điệp |

Kiểm tra toàn bộ đường dây mà không cần Claude Desktop:

```bash
pnpm mcp:smoke                              # dùng bản trong repo
MM_SERVER_PATH=/đường/dẫn/server.mjs pnpm mcp:smoke   # dùng bản đã tải về
```

Smoke dùng **client chính thức của MCP SDK** để nói chuyện với `server.mjs`. Vì
phần giao thức trong đó được viết tay (để không phụ thuộc thư viện), đây chính là
chốt chặn giữ nó không trôi khỏi chuẩn.

## Về sau

Bộ tool nằm ở `src/lib/ai/tools.ts` và **không biết gì về MCP**. Khi có
`ANTHROPIC_API_KEY`, chat ngay trong builder (`/api/ai/chat`) dùng lại đúng bộ đó
— chỉ khác lớp vận chuyển.
