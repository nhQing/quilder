# Thêm, bật/tắt, xoá ngôn ngữ ở màn Cài đặt — 21/10/2026

## Vấn đề

Ô "Ngôn ngữ" ở `/builder/settings` chỉ để xem. Bảng `Locale` chỉ có dòng nào lúc seed/cài đặt
tạo (`vi`, `en`); không có API hay giao diện để thêm ngôn ngữ thứ ba, hay bật/tắt ngôn ngữ đang có.

## Hiện trạng có sẵn để dựa vào

- Định tuyến đọc `Locale` từ DB (`getLocales`, cache tag `locales`): thêm một dòng `enabled: true`
  là `/ja/...` có ngay — không cần đổi code.
- Màn Văn bản và nội dung bài viết dùng `listAllLocales()` (kể cả ngôn ngữ đang tắt) → ngôn ngữ mới
  dịch được ngay khi còn tắt.
- Bản dịch lên site qua ảnh chụp `Release.translations`, chụp lúc Publish và **chỉ cho ngôn ngữ
  đang bật**.
- `Translation` và `EntryLocale` khai `onDelete: Cascade` theo `Locale`.

## Quyết định

| # | Quyết định | Vì sao |
|---|---|---|
| 1 | Thêm ngôn ngữ: mã + tên hiển thị, tạo ở trạng thái **tắt** | Đúng luật "dịch xong rồi hãy bật" đang ghi trên màn |
| 2 | Mã: `^[a-z]{2,3}(-[a-z0-9]{2,8})?$` (ví dụ `ja`, `zh-hant`), chữ thường | Mã là tiền tố URL — phải an toàn trong đường dẫn và ổn định |
| 3 | Mã không được trùng đoạn đường dẫn hệ thống (`RESERVED_FIRST_SEGMENTS`) | `/api/...` mà thành tiền tố ngôn ngữ là hỏng cả site |
| 4 | Bật: chặn nếu có trang mà đoạn đầu đường dẫn trùng mã | Trang `/ja-guide` thì không sao, nhưng trang `/ja/...` sẽ bị hiểu thành tiếng Nhật — cùng luật `checkSlugPath` đang áp chiều ngược lại |
| 5 | Bật/tắt có hiệu lực **ngay** (revalidate tag `locales`); hộp xác nhận nói rõ: chữ dịch lên site sau khi **Publish**, chỗ chưa dịch hiện ngôn ngữ mặc định | Danh sách ngôn ngữ vốn không niêm phong theo release; đổi cơ chế đó nằm ngoài phạm vi |
| 6 | Xoá: hỏi xác nhận, nêu số bản dịch trang + bài viết sẽ mất; gõ lại mã nếu có bản dịch | Cascade không lùi được |
| 7 | Không tắt, không xoá, không đổi ngôn ngữ mặc định | Đổi mặc định là đổi URL của cả site đang chạy |
| 8 | Chỉ admin; mỗi thao tác ghi `AuditLog` | Cùng quyền với các khối cấu hình site khác |

## Ngoài phạm vi

Đổi ngôn ngữ mặc định; sửa mã của ngôn ngữ đã có (xoá rồi thêm lại); niêm phong danh sách ngôn ngữ
theo release.

## Thành phần

- `src/lib/i18n/locale-admin.ts` — kiểm mã/tên (thuần, có test) + ba thao tác ghi DB.
- `POST /api/settings/locales`, `PATCH|DELETE /api/settings/locales/[code]`.
- `src/components/builder/SiteLocalesForm.tsx` — danh sách có công tắc bật/tắt, nút xoá, form thêm
  (gợi ý mã phổ biến).
