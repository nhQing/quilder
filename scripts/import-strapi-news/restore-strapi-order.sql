-- Khôi phục thứ tự + ngày của tin tức về đúng Strapi (prod cms-strapi-2, dump 11/09/2026).
-- Sinh tự động — đừng sửa tay phần DỮ LIỆU.
--
-- Làm 4 việc trên loại "news" (bài chưa lưu trữ):
--   1. 151 bài có trong Strapi: "createdAt" = created_at của Strapi (khối lặp trên site sắp theo cột này).
--   2. Cùng 151 bài: "publishedAt" = published_at của Strapi (ngày hiện trên thẻ tin). Bài nháp ở Strapi giữ nguyên.
--   3. 3 bài là NHÁP ở Strapi (id 85, 86, 87) -> status 'draft' (cả bản dịch).
--   4. 6 bài KHÔNG có trong Strapi (tạo trong builder) -> status 'draft' (cả bản dịch).
--
-- Khớp bài builder <-> Strapi theo thứ tự: id sinh lúc import ('cs'||md5), slug, slug bị cắt (>= 60 ký tự), tiêu đề.
-- Chốt an toàn: khớp khác 151 bài, hoặc một bài khớp hai nơi -> RAISE EXCEPTION, không ghi gì.
-- Sau khi COMMIT: lưu một bài bất kỳ trong Kho dữ liệu > Tin tức (để xoá cache) hoặc restart app.
-- Muốn chạy thử: dùng file .dryrun.sql (kết thúc bằng ROLLBACK).

BEGIN;

CREATE TEMP TABLE _strapi (blog_id int PRIMARY KEY, slug text, title text, created_at timestamp, published_at timestamp) ON COMMIT DROP;
INSERT INTO _strapi VALUES
(2,$mm$chinh-thuc-ra-mat-ung-dung-dau-tu-tich-luy-mai-money$mm$,$mm$Chính thức ra mắt ứng dụng đầu tư tích lũy MaiMoney$mm$,'2024-03-22 08:15:26.535000'::timestamp,'2024-03-22 08:15:29.598000'::timestamp),
(3,$mm$gioi-thieu-mai-green-dau-tu-xanh-voi-loi-tuc-hap-dan-toi-8-5-nam$mm$,$mm$Giới thiệu MaiGreen: Đầu tư xanh với lợi tức hấp dẫn tới 8.5%/năm$mm$,'2024-03-04 08:16:00.892000'::timestamp,'2024-03-04 08:16:02.498000'::timestamp),
(14,$mm$chao-tet-giap-thin-li-xi-1-000-000-vnd$mm$,$mm$Chào Tết Giáp Thìn - Lì xì 1,000,000 VND$mm$,'2024-01-15 06:25:18.485000'::timestamp,'2024-01-15 06:27:39.095000'::timestamp),
(17,$mm$su-kien-ra-mat-ung-dung-dau-tu-and-tich-luy-mai-money-khoi-dau-moi-cho-hanh-trinh-dau-tu-xanh-cua-ban-bat-dau-tai-day$mm$,$mm$Sự kiện ra mắt Ứng dụng Đầu tư & Tích luỹ MaiMoney: Khởi đầu mới cho hành trình đầu tư xanh của bạn bắt đầu tại đây!$mm$,'2024-04-12 09:58:59.992000'::timestamp,'2024-04-12 10:00:35.530000'::timestamp),
(19,$mm$lieu-da-den-luc-ban-nen-thu-mot-mo-hinh-dau-tu-moi$mm$,$mm$Liệu đã đến lúc bạn nên thử một mô hình đầu tư mới?$mm$,'2024-04-16 04:48:08.185000'::timestamp,'2024-04-16 06:57:45.568000'::timestamp),
(22,$mm$dau-tu-dien-tai-tao-tai-sao-khong$mm$,$mm$Đầu tư điện tái tạo - Tại sao không?$mm$,'2024-04-22 08:19:01.767000'::timestamp,'2024-04-22 08:20:56.795000'::timestamp),
(24,$mm$gen-z-nen-lam-gi-de-tranh-cam-thay-fomo-khi-dau-tu$mm$,$mm$FOMO về tài chính? GenZ nên làm gì để cải thiện tình trạng tài chính của bản thân$mm$,'2024-05-03 08:54:48.754000'::timestamp,'2024-05-03 08:56:42.856000'::timestamp),
(26,$mm$nu-quyen-trong-quan-ly-tai-chinh$mm$,$mm$"Nữ quyền" trong quản lý tài chính$mm$,'2024-05-09 10:41:36.740000'::timestamp,'2024-05-09 10:42:32.372000'::timestamp),
(28,$mm$5-cach-healing-tui-tien-trong-nam-2024-cho-gen-z$mm$,$mm$5 cách "healing túi tiền" trong năm 2024 cho GenZ$mm$,'2024-05-14 10:52:43.771000'::timestamp,'2024-05-14 10:52:54.791000'::timestamp),
(30,$mm$phai-lam-gi-neu-ban-khong-dat-duoc-muc-tieu-tai-chinh$mm$,$mm$Phải làm gì nếu bạn không đạt được mục tiêu tài chính?$mm$,'2024-05-16 10:48:01.382000'::timestamp,'2024-05-16 10:48:32.879000'::timestamp),
(31,$mm$thu-nhap-thu-dong-la-gi-lieu-ban-nen-co-nguon-thu-nhap-thu-dong-ca-nhan$mm$,$mm$Thu nhập thụ động là gì? Liệu bạn nên có nguồn thu nhập thụ động cá nhân?$mm$,'2024-05-21 08:59:01.081000'::timestamp,'2024-05-21 08:59:04.072000'::timestamp),
(32,$mm$tiet-kiem-hay-dau-tu-giai-phap-nao-co-loi-cho-ban$mm$,$mm$Tiết kiệm hay đầu tư: Giải pháp nào có lợi cho bạn?$mm$,'2024-05-23 11:01:07.160000'::timestamp,'2024-05-23 11:01:09.307000'::timestamp),
(33,$mm$dau-la-cong-cu-hay-nen-tang-ung-dung-dau-tu-danh-cho-ban$mm$,$mm$Đâu là công cụ hay nền tảng ứng dụng đầu tư dành cho bạn?$mm$,'2024-05-28 10:29:49.245000'::timestamp,'2024-05-28 10:29:51.389000'::timestamp),
(34,$mm$50-30-20-ban-can-biet-gi-de-chi-tieu-hop-ly-hon$mm$,$mm$50/30/20 - Bạn cần biết gì để chi tiêu hợp lý hơn?$mm$,'2024-06-03 10:48:11.959000'::timestamp,'2024-06-03 10:48:19.397000'::timestamp),
(35,$mm$lam-phat-va-vai-tro-cua-lam-phat-trong-nen-kinh-te$mm$,$mm$Lạm phát và vai trò của lạm phát trong nền kinh tế$mm$,'2024-06-07 07:57:20.429000'::timestamp,'2024-06-07 07:57:23.466000'::timestamp),
(36,$mm$tich-tieu-thanh-dai-co-hoi-tich-luy-tai-chinh$mm$,$mm$Cơ hội tích luỹ "tích tiểu thành đại"$mm$,'2024-06-17 03:24:10.285000'::timestamp,'2024-06-17 03:29:06.883000'::timestamp),
(37,$mm$mai-money-va-goc-nhin-dau-tu-moi-tai-viet-nam$mm$,$mm$MaiMoney và góc nhìn đầu tư mới tại Việt Nam$mm$,'2024-06-24 03:14:05.989000'::timestamp,'2024-06-24 03:16:05.699000'::timestamp),
(39,$mm$nguyen-phuong-de-khong-phai-an-mi-tom-cuoi-thang-minh-nen-tranh-de-het-trung-vao-mot-ro$mm$,$mm$Nguyên Phương: "Để không phải ăn mì tôm cuối tháng, mình nên tránh để hết trứng vào một rổ"$mm$,'2024-06-28 07:33:29.071000'::timestamp,'2024-06-28 07:36:40.534000'::timestamp),
(40,$mm$lieu-co-nen-mua-tui-xach-hang-hieu-va-coi-no-la-loai-hinh-dau-tu$mm$,$mm$Liệu có nên mua túi xách hàng hiệu và coi nó là loại hình đầu tư?$mm$,'2024-07-03 10:36:13.993000'::timestamp,'2024-07-03 10:36:35.618000'::timestamp),
(41,$mm$chay-tui-do-hieu-ung-tra-sua-lam-sao-de-tranh-bay-tieu-dung$mm$,$mm$"Cháy túi" do hiệu ứng trà sữa, làm sao để tránh bẫy tiêu dùng?$mm$,'2024-07-10 02:57:19.473000'::timestamp,'2024-07-10 18:29:36.767000'::timestamp),
(42,$mm$ru-ban-moi-nhan-qua-doi$mm$,$mm$Rủ bạn mới - Nhận quà đôi$mm$,'2024-08-13 11:15:14.669000'::timestamp,'2024-08-13 11:15:17.531000'::timestamp),
(43,$mm$maimoney-sets-new-standard-for-wealth-management-in-vietnam$mm$,$mm$MaiMoney sets new standard for wealth management in Vietnam$mm$,'2024-08-23 10:45:32.024000'::timestamp,'2024-08-23 10:45:46.082000'::timestamp),
(45,$mm$minh-con-tre-ma-song-cho-hien-tai-hay-tiet-kiem-cho-tuong-lai-nhi$mm$,$mm$Mình còn trẻ mà... sống cho hiện tại hay tiết kiệm cho tương lai nhỉ?$mm$,'2024-09-23 10:23:40.329000'::timestamp,'2024-09-23 10:23:42.327000'::timestamp),
(46,$mm$ceo-mai-money-mong-nguoi-tre-yen-tam-dau-tu-ma-khong-phai-lo-nghi-qua-nhieu$mm$,$mm$CEO MaiMoney: Mong người trẻ yên tâm đầu tư mà không phải lo nghĩ quá nhiều$mm$,'2024-09-26 10:02:02.031000'::timestamp,'2024-09-26 10:02:03.897000'::timestamp),
(47,$mm$vi-sao-nguoi-viet-duoi-30-tuoi-chua-biet-cach-quan-ly-tien-bac-mot-cach-khoa-hoc$mm$,$mm$Vì sao người Việt dưới 30 tuổi chưa biết cách quản lý tiền bạc một cách khoa học?$mm$,'2024-09-27 08:05:44.320000'::timestamp,'2024-09-27 08:05:46.286000'::timestamp),
(48,$mm$lieu-dau-tu-thay-the-co-thuc-su-thay-the-cac-lua-chon-dau-tu-cua-gen-z$mm$,$mm$Liệu "Đầu Tư Thay Thế" có thực sự thay thế các lựa chọn đầu tư của Gen Z?$mm$,'2024-10-03 08:32:17.887000'::timestamp,'2024-10-03 08:32:25.700000'::timestamp),
(49,$mm$ngan-hang-ghi-nhan-luong-tien-gui-ky-luc-6-83-trieu-ty-vnd-dau-la-co-hoi-cho-ban-di-nguoc-lai-so-dong$mm$,$mm$Ngân hàng ghi nhận lượng tiền gửi kỷ lục 6,83 triệu tỷ VND, đâu là cơ hội cho bạn "đi ngược lại số đông"?$mm$,'2024-10-04 09:46:03.657000'::timestamp,'2024-10-04 09:46:05.121000'::timestamp),
(50,$mm$mai-money-co-thuc-su-la-ung-dung-dang-de-dau-tu$mm$,$mm$MaiMoney có thực sự là ứng dụng đáng để đầu tư?$mm$,'2024-10-07 10:37:13.340000'::timestamp,'2024-10-07 10:37:59.100000'::timestamp),
(51,$mm$net-zero-7-chu-cai-giup-quan-quan-duong-len-dinh-olympia-lan-thu-24-lap-nen-ky-tich-la-gi$mm$,$mm$"Net-zero" - 7 chữ cái giúp Quán quân Đường lên đỉnh Olympia lần thứ 24 lập nên kỳ tích là gì?$mm$,'2024-10-14 10:01:00.297000'::timestamp,'2024-10-14 10:01:01.573000'::timestamp),
(52,$mm$gen-z-muon-nghi-huu-som$mm$,$mm$Gen Z muốn ... nghỉ hưu sớm$mm$,'2024-10-16 04:31:24.266000'::timestamp,'2024-10-16 04:32:18.659000'::timestamp),
(53,$mm$dung-fomo-nua-hay-jomo-di$mm$,$mm$Đừng FOMO nữa, hãy JOMO đi!$mm$,'2024-10-22 07:07:51.165000'::timestamp,'2024-10-22 07:07:53.056000'::timestamp),
(54,$mm$mai-green-cap-nhat-loi-nhuan-tich-luy-moi-tich-luy-tai-chinh-xay-dung-tuong-lai-xanh$mm$,$mm$MaiGreen Cập Nhật Lợi Nhuận Tích Lũy Mới - Tích lũy tài chính, xây dựng tương lai xanh$mm$,'2024-10-23 10:35:11.982000'::timestamp,'2024-10-23 10:35:13.701000'::timestamp),
(55,$mm$tai-sao-chung-ta-lai-tranh-xa-nhung-khoan-dau-tu-dai-han$mm$,$mm$Tại Sao Chúng Ta Lại Tránh Xa Những Khoản Đầu Tư Dài Hạn?$mm$,'2024-10-30 09:10:18.620000'::timestamp,'2024-10-30 09:10:20.830000'::timestamp),
(56,$mm$vi-sao-mai-cash-la-san-pham-dang-de-dau-tu-cho-dong-tien-ngan-han$mm$,$mm$Vì sao MaiCash+ là sản phẩm đáng để đầu tư cho dòng tiền ngắn hạn?$mm$,'2024-11-05 10:32:02.693000'::timestamp,'2024-11-05 10:32:05.314000'::timestamp),
(58,$mm$tai-sao-chuoi-cung-ung-lai-la-lua-chon-dau-tu-cua-mai-money$mm$,$mm$Tại sao chuỗi cung ứng lại là lựa chọn đầu tư của MaiMoney?$mm$,'2024-11-21 10:10:29.511000'::timestamp,'2024-11-21 10:10:30.723000'::timestamp),
(59,$mm$hong-thu-dau-tu-voi-minh-khong-chi-la-chuyen-tien-bac$mm$,$mm$Hồng Thư: "Đầu Tư Với Mình Không Chỉ Là Chuyện Tiền Bạc"$mm$,'2024-12-03 09:39:47.848000'::timestamp,'2024-12-03 09:45:09.515000'::timestamp),
(60,$mm$giai-phap-toi-uu-dong-tien-nhan-roi-mai-cash$mm$,$mm$Giải pháp tối ưu dòng tiền nhàn rỗi MaiCash+$mm$,'2024-12-20 07:23:03.976000'::timestamp,'2024-12-20 07:23:22.937000'::timestamp),
(61,$mm$minigame-dang-ky-tai-khoan-rinh-qua-babythree$mm$,$mm$[MINIGAME] ĐĂNG KÝ TÀI KHOẢN - RINH QUÀ BABYTHREE$mm$,'2024-12-20 10:30:43.380000'::timestamp,'2024-12-20 10:34:18.841000'::timestamp),
(62,$mm$lam-sao-giu-vi-day-ma-tet-van-vui$mm$,$mm$Làm sao giữ ví dày mà tết vẫn vui?$mm$,'2025-01-20 07:20:03.170000'::timestamp,'2025-01-20 07:20:04.533000'::timestamp),
(63,$mm$li-xi-tet-mon-qua-tai-chinh-dau-doi-cho-con-cai$mm$,$mm$Lì xì Tết - Món Quà Tài Chính Đầu Đời cho Con Cái$mm$,'2025-01-30 03:22:31.681000'::timestamp,'2025-01-30 03:22:33.673000'::timestamp),
(64,$mm$li-xi-nam-moi-mien-phi-nap-tien-24-7$mm$,$mm$Lì xì năm mới - Miễn phí Nạp tiền 24/7$mm$,'2025-02-04 08:31:56.600000'::timestamp,'2025-02-04 08:39:42.889000'::timestamp),
(65,$mm$valentine-co-that-su-la-khoan-dau-tu-cam-xuc-and-tai-chinh-xung-dang$mm$,$mm$Valentine có thật sự là khoản Đầu tư cảm xúc & Tài chính xứng đáng?$mm$,'2025-02-14 07:38:10.451000'::timestamp,'2025-02-14 07:38:13.400000'::timestamp),
(66,$mm$bi-danh-thue-lieu-tien-gui-tiet-kiem-con-la-ham-tru-an-uu-tien-cho-tien-nhan-roi-cua-ban$mm$,$mm$Bị đánh thuế, liệu tiền gửi tiết kiệm còn là "hầm trú ẩn" ưu tiên cho tiền nhàn rỗi của bạn?$mm$,'2025-02-23 11:06:56.168000'::timestamp,'2025-02-23 11:12:31.997000'::timestamp),
(67,$mm$gia-vang-tang-co-hoi-hay-canh-bao-cho-nen-kinh-te$mm$,$mm$Giá Vàng Tăng: Cơ Hội Hay Cảnh Báo Cho Nền Kinh Tế?$mm$,'2025-02-27 09:27:11.958000'::timestamp,'2025-02-27 09:27:13.635000'::timestamp),
(68,$mm$pha-vo-moi-rao-can-trao-quyen-cho-doanh-nhan-nu-viet-nam$mm$,$mm$Phá vỡ mọi rào cản, trao quyền cho doanh nhân nữ Việt Nam$mm$,'2025-03-09 11:08:53.130000'::timestamp,'2025-03-09 11:09:25.162000'::timestamp),
(69,$mm$lai-suat-ngan-hang-tren-da-giam-manh-dong-tien-gui-tai-ngan-hang-co-con-toi-uu$mm$,$mm$Lãi Suất Ngân Hàng trên đà giảm mạnh: Dòng Tiền Gửi tại Ngân Hàng có còn tối ưu?$mm$,'2025-03-24 07:34:36.641000'::timestamp,'2025-03-24 07:52:24.071000'::timestamp),
(70,$mm$thi-truong-chao-dao-vi-chinh-sach-thue-cua-trump-lam-sao-de-giu-vung-danh-muc-dau-tu$mm$,$mm$Thị trường chao đảo vì chính sách thuế của Trump – Làm sao để giữ vững danh mục đầu tư?$mm$,'2025-04-09 03:38:07.013000'::timestamp,'2025-04-09 03:38:08.680000'::timestamp),
(71,$mm$dau-tu-o-tuoi-22-nhu-nao-la-dung$mm$,$mm$Đầu tư ở tuổi 22 như nào là "đúng"?$mm$,'2025-04-11 03:03:09.653000'::timestamp,'2025-04-11 03:08:54.444000'::timestamp),
(72,$mm$gioi-thieu-ban-moi-nhan-thuong-1-000-000-vnd$mm$,$mm$Giới thiệu bạn mới - Nhận thưởng 1,000,000 VND$mm$,'2025-04-11 08:01:59.531000'::timestamp,'2025-04-11 08:45:05.995000'::timestamp),
(73,$mm$goc-nhin-tai-chinh-ca-nhan-bao-ve-suc-khoe-va-xay-dung-tai-chinh-ben-vung-1$mm$,$mm$Góc nhìn tài chính cá nhân: Bảo vệ sức khỏe và xây dựng tài chính bền vững$mm$,'2025-04-15 04:44:14.937000'::timestamp,'2025-04-16 01:41:03.879000'::timestamp),
(76,$mm$cam-on-ban-da-dong-hanh-cung-mai-money-tai-bao-ve-suc-khoe-va-xay-dung-tai-chinh-ben-vung$mm$,$mm$Cảm ơn bạn đã đồng hành cùng MaiMoney tại "Bảo vệ sức khỏe và xây dựng tài chính bền vững"$mm$,'2025-04-29 05:00:27.010000'::timestamp,'2025-04-29 06:22:15.518000'::timestamp),
(77,$mm$eric-trump-tham-van-phong-mai-money-tai-ha-noi-trong-khuon-kho-le-khoi-cong-du-an-trump-international-hung-yen$mm$,$mm$Eric Trump thăm văn phòng MaiMoney tại Hà Nội trong khuôn khổ lễ khởi công dự án Trump International Hưng Yên$mm$,'2025-05-29 09:05:24.778000'::timestamp,'2025-05-29 09:08:03.639000'::timestamp),
(79,$mm$ban-co-dang-tra-gia-cho-chinh-cam-xuc-cua-minh$mm$,$mm$Bạn có đang trả giá cho chính cảm xúc của mình?$mm$,'2025-05-29 09:09:27.903000'::timestamp,'2025-05-29 09:09:29.208000'::timestamp),
(80,$mm$mai-money-moi-ban-uu-dai-ca-phe-70-k$mm$,$mm$MaiMoney mời bạn - Ưu đãi cà phê 70K$mm$,'2025-06-09 10:32:48.690000'::timestamp,'2025-06-09 10:32:50.290000'::timestamp),
(81,$mm$mai-money-gop-mat-tai-le-ky-ket-bien-ban-ghi-nho-thuc-day-hop-tac-tai-chinh-so-viet-nam-uc$mm$,$mm$MaiMoney góp mặt tại lễ ký kết Biên bản ghi nhớ thúc đẩy hợp tác Tài chính số Việt Nam - Úc$mm$,'2025-06-12 08:33:02.437000'::timestamp,'2025-06-12 08:33:04.024000'::timestamp),
(82,$mm$xe-su-dung-nguyen-lieu-hoa-thach-bi-cam-o-vanh-dai-1-bai-toan-tai-chinh-cho-nguoi-tre$mm$,$mm$Xe sử dụng nguyên liệu hoá thạch bị cấm: Bài toán tài chính cho người trẻ?$mm$,'2025-07-14 09:56:58.726000'::timestamp,'2025-07-14 10:00:23.520000'::timestamp),
(83,$mm$mai-money-va-play-moolah-ky-ket-bien-ban-ghi-nho-hop-tac-chien-luoc-mo-rong-trai-nghiem-giao-duc-tai-chinh-toan-dien$mm$,$mm$MaiMoney và PlayMoolah Ký Kết Biên Bản Ghi Nhớ Hợp Tác Chiến Lược  Mở Rộng Trải Nghiệm Giáo Dục Tài Chính Toàn Diện tại Việt Nam$mm$,'2025-07-23 03:55:52.458000'::timestamp,'2025-07-23 04:00:20.863000'::timestamp),
(85,$mm$thi-truong-quoc-te-ngay-29-07$mm$,$mm$Thị trường quốc tế ngày 29/07$mm$,'2025-07-29 08:24:21.659000'::timestamp,NULL::timestamp),
(86,$mm$thong-tin-thi-truong-viet-nam-va-the-gioi-30-07$mm$,$mm$Thông tin thị trường Việt Nam và Thế giới 30/07$mm$,'2025-07-30 09:57:27.106000'::timestamp,NULL::timestamp),
(87,$mm$thong-tin-thi-truong-viet-nam-va-the-gioi-31-07$mm$,$mm$Thông tin thị trường Việt Nam và Thế giới 31/07$mm$,'2025-07-31 09:48:57.531000'::timestamp,NULL::timestamp),
(88,$mm$su-kien-vntr-investor-roundtable-hanoi$mm$,$mm$Sự kiện VNTR Investor Roundtable Hanoi$mm$,'2025-08-04 08:24:47.583000'::timestamp,'2025-08-04 08:24:49.164000'::timestamp),
(89,$mm$thong-tin-thi-truong-quoc-te-01-08-2025$mm$,$mm$Thông tin thị trường Quốc tế cuối ngày 01/08/2025$mm$,'2025-08-04 09:23:26.207000'::timestamp,'2025-08-04 09:23:27.694000'::timestamp),
(90,$mm$thong-tin-thi-truong-viet-nam-04-08-2025$mm$,$mm$Thông tin thị trường Việt Nam ngày 04/08/2025$mm$,'2025-08-04 09:35:21.022000'::timestamp,'2025-08-04 09:35:46.774000'::timestamp),
(91,$mm$thong-tin-thi-truong-quoc-te-cuoi-ngay-04-08-2025$mm$,$mm$Thông tin thị trường Quốc tế cuối ngày 04/08/2025$mm$,'2025-08-05 04:31:12.285000'::timestamp,'2025-08-05 04:31:14.740000'::timestamp),
(92,$mm$thong-tin-thi-truong-viet-nam-ngay-05-08-2025$mm$,$mm$Thông tin thị trường Việt Nam ngày 05/08/2025$mm$,'2025-08-05 10:03:39.457000'::timestamp,'2025-08-05 10:03:43.298000'::timestamp),
(93,$mm$thong-tin-thi-truong-viet-nam-06-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 06/08$mm$,'2025-08-06 09:43:43.819000'::timestamp,'2025-08-06 09:45:32.694000'::timestamp),
(94,$mm$thong-tin-thi-truong-quoc-te-cuoi-ngay-06-08-2025$mm$,$mm$Thông tin thị trường Quốc tế cuối ngày 06/08/2025$mm$,'2025-08-07 07:54:55.897000'::timestamp,'2025-08-07 07:54:59.787000'::timestamp),
(95,$mm$thong-tin-thi-truong-viet-nam-ngay-07-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 07/08$mm$,'2025-08-08 08:17:25.701000'::timestamp,'2025-08-08 08:18:07.603000'::timestamp),
(96,$mm$thong-tin-thi-truong-viet-nam-ngay-08-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 08/08$mm$,'2025-08-08 09:35:08.911000'::timestamp,'2025-08-08 09:35:10.991000'::timestamp),
(97,$mm$thong-tin-thi-truong-quoc-te-cuoi-ngay-08-08$mm$,$mm$Thông tin thị trường quốc tế cuối ngày 08/08$mm$,'2025-08-11 04:21:04.227000'::timestamp,'2025-08-11 04:35:06.427000'::timestamp),
(99,$mm$thong-tin-thi-truong-viet-nam-ngay-11-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 11/08$mm$,'2025-08-11 10:35:55.361000'::timestamp,'2025-08-11 10:36:22.475000'::timestamp),
(101,$mm$thong-tin-thi-truong-quoc-te-cuoi-ngay-11-08$mm$,$mm$Thông tin thị trường quốc tế cuối ngày 11/08$mm$,'2025-08-12 04:19:38.655000'::timestamp,'2025-08-12 04:19:43.027000'::timestamp),
(102,$mm$thong-tin-thi-truong-quoc-te-ngay-12-08-1$mm$,$mm$Thông tin thị trường Quốc tế ngày 12/08$mm$,'2025-08-13 09:02:44.471000'::timestamp,'2025-08-13 09:07:28.574000'::timestamp),
(104,$mm$thong-tin-thi-truong-viet-nam-ngay-13-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 13/08$mm$,'2025-08-13 09:30:15.187000'::timestamp,'2025-08-13 09:30:18.289000'::timestamp),
(105,$mm$thong-tin-thi-truong-quoc-te-ngay-13-08$mm$,$mm$Thông tin thị trường quốc tế ngày 13/08$mm$,'2025-08-14 08:52:45.137000'::timestamp,'2025-08-14 08:56:24.995000'::timestamp),
(107,$mm$thong-tin-thi-truong-viet-nam-ngay-14-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 14/08$mm$,'2025-08-14 09:36:17.977000'::timestamp,'2025-08-14 09:39:32.021000'::timestamp),
(108,$mm$thong-tin-thi-truong-quoc-te-ngay-14-08$mm$,$mm$Thông tin thị trường quốc tế ngày 14/08$mm$,'2025-08-15 09:32:20.801000'::timestamp,'2025-08-15 09:32:22.201000'::timestamp),
(110,$mm$thong-tin-thi-truong-viet-nam-ngay-15-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 15/08$mm$,'2025-08-15 10:59:38.344000'::timestamp,'2025-08-15 10:59:39.710000'::timestamp),
(111,$mm$thong-tin-thi-truong-viet-nam-ngay-18-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 18/08$mm$,'2025-08-18 09:46:17.444000'::timestamp,'2025-08-18 09:46:18.651000'::timestamp),
(112,$mm$thong-tin-thi-truong-quoc-te-ngay-18-08$mm$,$mm$Thông tin thị trường quốc tế ngày 18/08$mm$,'2025-08-19 04:34:36.197000'::timestamp,'2025-08-19 04:38:13.725000'::timestamp),
(114,$mm$thong-tin-thi-truong-viet-nam-ngay-19-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 19/08$mm$,'2025-08-19 10:43:44.541000'::timestamp,'2025-08-19 10:43:45.819000'::timestamp),
(115,$mm$thong-tin-thi-truong-quoc-te-ngay-19-08$mm$,$mm$Thông tin thị trường quốc tế ngày 19/08$mm$,'2025-08-20 08:17:27.986000'::timestamp,'2025-08-20 09:16:40.086000'::timestamp),
(117,$mm$thong-tin-thi-truong-viet-nam-ngay-20-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 20/08$mm$,'2025-08-20 09:26:33.987000'::timestamp,'2025-08-20 09:26:35.536000'::timestamp),
(118,$mm$thong-tin-thi-truong-viet-nam-ngay-21-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 21/08$mm$,'2025-08-21 10:44:12.875000'::timestamp,'2025-08-21 10:44:14.552000'::timestamp),
(120,$mm$thong-tin-thi-truong-viet-nam-ngay-25-08-2$mm$,$mm$Thông tin thị trường Việt Nam ngày 25/08$mm$,'2025-08-25 10:26:20.515000'::timestamp,'2025-08-25 10:43:35.044000'::timestamp),
(122,$mm$thong-tin-thi-truong-quoc-te-ngay-25-08$mm$,$mm$Thông tin thị trường quốc tế ngày 25/08$mm$,'2025-08-26 08:35:45.973000'::timestamp,'2025-08-26 08:35:47.402000'::timestamp),
(124,$mm$thong-tin-thi-truong-quoc-te-ngay-28-08$mm$,$mm$Thông tin thị trường quốc tế ngày 28/08$mm$,'2025-08-29 09:08:53.301000'::timestamp,'2025-08-29 09:13:10.416000'::timestamp),
(126,$mm$thong-tin-thi-truong-viet-nam-ngay-29-08$mm$,$mm$Thông tin thị trường Việt Nam ngày 29/08$mm$,'2025-08-29 10:15:08.515000'::timestamp,'2025-08-29 10:16:58.196000'::timestamp),
(127,$mm$thong-tin-thi-truong-quoc-te-02-09$mm$,$mm$Thông tin thị trường Quốc tế 02/09$mm$,'2025-09-03 03:38:34.470000'::timestamp,'2025-09-03 03:51:47.992000'::timestamp),
(129,$mm$thong-tin-thi-truong-viet-nam-ngay-03-09$mm$,$mm$Thông tin thị trường Việt Nam ngày 03/09$mm$,'2025-09-03 15:03:09.620000'::timestamp,'2025-09-03 15:03:11.393000'::timestamp),
(130,$mm$thi-truong-quoc-te-tuan-08-12-09-2025$mm$,$mm$Thị trường Quốc tế tuần 08-12/09/2025$mm$,'2025-09-15 10:29:15.053000'::timestamp,'2025-09-15 10:29:19.081000'::timestamp),
(131,$mm$thi-truong-viet-nam-tuan-15-19-09-2025$mm$,$mm$Thị trường Việt Nam tuần 15-19/09/2025$mm$,'2025-09-19 10:32:25.952000'::timestamp,'2025-09-19 10:32:27.991000'::timestamp),
(132,$mm$thi-truong-quoc-te-tuan-22-26-09-2025$mm$,$mm$Thị trường Quốc tế tuần 22-26/09/2025$mm$,'2025-09-29 10:30:54.777000'::timestamp,'2025-09-29 10:31:24.611000'::timestamp),
(133,$mm$ftse-russell-cong-bo-nang-hang-chung-khoan-viet-nam-len-thi-truong-moi-noi$mm$,$mm$FTSE Russell công bố nâng hạng chứng khoán Việt Nam lên thị trường mới nổi$mm$,'2025-10-08 02:46:16.829000'::timestamp,'2025-10-08 02:47:00.256000'::timestamp),
(134,$mm$tong-hop-thi-truong-tuan-06-10-10-2025$mm$,$mm$Tổng hợp thị trường tuần 06-10/10/2025$mm$,'2025-10-14 09:50:11.568000'::timestamp,'2025-10-14 09:56:48.437000'::timestamp),
(135,$mm$con-tre-ma-chay-tui-day-co-phai-8-sai-lam-nay$mm$,$mm$Còn trẻ mà cháy túi? Đây có phải 8 sai lầm này?$mm$,'2025-10-17 08:28:20.290000'::timestamp,'2025-10-17 08:28:22.076000'::timestamp),
(136,$mm$tong-hop-thi-truong-tuan-13-17-10-2025$mm$,$mm$Tổng hợp thị trường tuần 13-17/10/2025$mm$,'2025-10-20 04:27:26.453000'::timestamp,'2025-10-20 04:27:27.864000'::timestamp),
(137,$mm$8-sai-lam-ban-can-tranh-de-khong-roi-vao-bay-tin-dung$mm$,$mm$8 sai lầm bạn cần tránh để không rơi vào "bẫy tín dụng"$mm$,'2025-10-24 08:58:24.082000'::timestamp,'2025-10-24 08:59:47.294000'::timestamp),
(138,$mm$tong-hop-thi-truong-tuan-20-24-10-2025$mm$,$mm$Tổng hợp thị trường tuần 20-24/10/2025$mm$,'2025-10-27 03:27:47.178000'::timestamp,'2025-10-27 03:29:38.303000'::timestamp),
(139,$mm$7-buoc-bien-giac-mo-so-huu-nha-thanh-hien-thuc$mm$,$mm$7 bước biến giấc mơ sở hữu nhà thành hiện thực$mm$,'2025-10-31 03:00:49.556000'::timestamp,'2025-10-31 03:00:51.644000'::timestamp),
(140,$mm$tong-hop-thi-truong-tuan-27-31-10-2025$mm$,$mm$Tổng hợp thị trường tuần 27-31/10/2025$mm$,'2025-11-04 07:24:14.808000'::timestamp,'2025-11-04 07:27:06.625000'::timestamp),
(141,$mm$8-ly-do-ban-nen-bat-dau-xay-dung-quy-khan-cap-ngay-hom-nay$mm$,$mm$8 lý do bạn nên bắt đầu xây dựng quỹ khẩn cấp ngay hôm nay$mm$,'2025-11-07 08:47:27.100000'::timestamp,'2025-11-07 08:52:47.901000'::timestamp),
(142,$mm$tong-hop-thi-truong-tuan-03-08-11-2025$mm$,$mm$Tổng hợp thị trường tuần 03-08/11/2025$mm$,'2025-11-10 10:16:20.169000'::timestamp,'2025-11-10 10:19:27.511000'::timestamp),
(143,$mm$revenge-saving-khi-noi-lo-tai-chinh-bien-thanh-thoi-quen-tich-cuc$mm$,$mm$“Revenge Saving”: Khi nỗi lo tài chính biến thành thói quen tích cực$mm$,'2025-11-14 08:52:53.034000'::timestamp,'2025-11-14 08:55:12.938000'::timestamp),
(144,$mm$tong-hop-thi-truong-tuan-10-15-11-2025$mm$,$mm$Tổng hợp thị trường tuần 10-15/11/2025$mm$,'2025-11-18 07:26:37.490000'::timestamp,'2025-11-18 07:29:43.603000'::timestamp),
(145,$mm$thoat-khoi-vong-lap-nhan-luong-chi-tieu$mm$,$mm$Thoát Khỏi Vòng Lặp “Nhận Lương - Chi Tiêu”$mm$,'2025-11-21 08:55:14.279000'::timestamp,'2025-11-21 08:55:26.878000'::timestamp),
(146,$mm$tong-hop-thi-truong-tuan-17-22-11-2025$mm$,$mm$Tổng hợp thị trường tuần 17-22/11/2025$mm$,'2025-11-24 10:24:24.296000'::timestamp,'2025-11-24 10:24:25.695000'::timestamp),
(147,$mm$doom-spending-chi-tieu-mat-kiem-soat-vi-lo-so-tuong-lai-1$mm$,$mm$Doom Spending - Chi tiêu mất kiểm soát vì lo sợ tương lai$mm$,'2025-11-28 08:59:53.026000'::timestamp,'2025-11-28 09:05:11.508000'::timestamp),
(148,$mm$tong-hop-thi-truong-tuan-24-29-11-2025$mm$,$mm$Tổng hợp thị trường tuần 24-29/11/2025$mm$,'2025-12-01 09:33:10.655000'::timestamp,'2025-12-01 09:33:11.961000'::timestamp),
(149,$mm$tong-hop-thi-truong-tuan-01-06-11-2025$mm$,$mm$Tổng hợp thị trường tuần 01-06/12/2025$mm$,'2025-12-08 10:03:34.649000'::timestamp,'2025-12-08 10:03:47.987000'::timestamp),
(150,$mm$the-le-chuong-trinh-chia-se-lien-tay-nhan-ngay-100-k$mm$,$mm$Thể lệ chương trình “Chia sẻ liền tay - Nhận ngay 100K”$mm$,'2025-12-09 09:04:09.938000'::timestamp,'2025-12-09 09:26:38.364000'::timestamp),
(151,$mm$khong-thich-mao-hiem-nen-dau-tu-hieu-qua-nhu-the-nao$mm$,$mm$Không thích mạo hiểm nên đầu tư hiệu quả như thế nào?$mm$,'2025-12-12 07:59:23.787000'::timestamp,'2025-12-12 08:00:31.816000'::timestamp),
(152,$mm$tong-hop-thi-truong-tuan-08-13-12-2025$mm$,$mm$Tổng hợp thị trường tuần 08-13/12/2025$mm$,'2025-12-15 08:54:48.673000'::timestamp,'2025-12-15 08:54:50.385000'::timestamp),
(153,$mm$quy-chim-la-gi-cach-lap-quy-chim-don-gian-de-khong-dau-vi$mm$,$mm$Quỹ chìm là gì? Cách lập quỹ chìm đơn giản để không “đau ví”$mm$,'2025-12-19 08:01:38.987000'::timestamp,'2025-12-19 08:07:32.595000'::timestamp),
(154,$mm$tong-hop-thi-truong-tuan-15-19-12-2025$mm$,$mm$Tổng hợp thị trường tuần 15-19/12/2025$mm$,'2025-12-22 10:35:34.051000'::timestamp,'2025-12-22 10:35:35.426000'::timestamp),
(155,$mm$chi-tieu-nhieu-hon-trong-thoi-ky-lam-phat$mm$,$mm$Chi tiêu nhiều hơn trong thời kỳ lạm phát$mm$,'2025-12-26 09:35:14.562000'::timestamp,'2025-12-26 09:35:15.807000'::timestamp),
(156,$mm$tong-hop-thi-truong-tuan-22-27-12-2025$mm$,$mm$Tổng hợp thị trường tuần 22-27/12/2025$mm$,'2025-12-30 08:13:00.211000'::timestamp,'2025-12-30 08:13:01.686000'::timestamp),
(157,$mm$bao-cao-thi-truong-tai-chinh-viet-nam-tuan-cuoi-nam-2025-dau-an-dinh-moi-va-giai-doan-chuyen-tiep-sang-2026$mm$,$mm$Báo cáo thị trường tài chính - Tuần cuối năm 2025$mm$,'2026-01-05 10:13:12.472000'::timestamp,'2026-01-05 10:16:31.617000'::timestamp),
(158,$mm$tong-hop-thi-truong-tuan-05-09-01-2026$mm$,$mm$Tổng hợp thị trường tuần 05-09/01/2026$mm$,'2026-01-13 02:51:20.347000'::timestamp,'2026-01-13 02:51:21.475000'::timestamp),
(159,$mm$can-bang-tich-luy-giua-huu-tri-va-cac-muc-tieu-khac$mm$,$mm$Cân bằng tích lũy giữa hưu trí và các mục tiêu khác$mm$,'2026-01-16 08:58:29.368000'::timestamp,'2026-01-16 08:58:30.594000'::timestamp),
(160,$mm$toan-canh-thi-truong-tai-chinh-tuan-12-16-01-2026-chung-khoan-duy-tri-da-tich-cuc-thanh-khoan-but-pha$mm$,$mm$Toàn cảnh thị trường tài chính tuần 12-16/01/2026$mm$,'2026-01-19 10:33:36.814000'::timestamp,'2026-01-19 10:33:38.395000'::timestamp),
(161,$mm$tong-hop-thi-truong-tuan-19-23-01-2026$mm$,$mm$Tổng hợp thị trường tuần 19-23/01/2026$mm$,'2026-01-26 10:20:08.618000'::timestamp,'2026-01-26 10:20:10.446000'::timestamp),
(162,$mm$minigame-tet-ghi-muc-tieu-hay-li-xi-trao-tay$mm$,$mm$Minigame Tết: Ghi Mục Tiêu Hay – Lì Xì Trao Tay 🧧$mm$,'2026-01-29 03:38:53.698000'::timestamp,'2026-01-29 03:47:21.032000'::timestamp),
(163,$mm$tong-hop-thi-truong-tuan-26-31-01-2026$mm$,$mm$Tổng hợp thị trường tuần 26-31/01/2026$mm$,'2026-02-02 10:28:41.419000'::timestamp,'2026-02-02 10:28:42.851000'::timestamp),
(164,$mm$ban-nen-co-bao-nhieu-tai-khoan-ngan-hang-la-hop-ly$mm$,$mm$Bạn nên có bao nhiêu tài khoản ngân hàng là hợp lý?$mm$,'2026-02-06 08:21:00.962000'::timestamp,'2026-02-06 08:21:02.467000'::timestamp),
(165,$mm$tong-hop-thi-truong-tuan-02-06-02-2026$mm$,$mm$Tổng hợp thị trường tuần 02-06/02/2026$mm$,'2026-02-09 10:14:44.251000'::timestamp,'2026-02-09 10:17:00.777000'::timestamp),
(166,$mm$chi-phi-tinh-ai-trong-ngay-le-valentine-la-bao-nhieu$mm$,$mm$Chi phí tình ái trong ngày lễ Valentine là bao nhiêu?$mm$,'2026-02-13 03:28:27.090000'::timestamp,'2026-02-13 04:52:28.681000'::timestamp),
(167,$mm$dang-sau-lan-song-tich-tru-vang-ky-luc-dang-an-chua-dieu-gi$mm$,$mm$Đằng sau làn sóng tích trữ vàng kỷ lục đang ẩn chứa điều gì?$mm$,'2026-02-27 08:05:01.534000'::timestamp,'2026-02-27 08:05:02.754000'::timestamp),
(168,$mm$4-giai-doan-trong-chu-ky-tai-chinh-cua-mot-nguoi$mm$,$mm$4 giai đoạn trong chu kỳ tài chính của một người$mm$,'2026-03-05 09:17:33.464000'::timestamp,'2026-03-06 01:50:20.804000'::timestamp),
(169,$mm$bao-cao-thi-truong-tai-chinh-tuan-02-06-03-2026$mm$,$mm$Báo cáo thị trường tài chính tuần 02-06/03/2026$mm$,'2026-03-09 10:10:25.153000'::timestamp,'2026-03-09 10:12:43.093000'::timestamp),
(170,$mm$phu-nu-hien-dai-ngay-cang-chu-trong-chu-dong-tai-chinh$mm$,$mm$Phụ nữ hiện đại ngày càng chú trọng chủ động tài chính$mm$,'2026-03-09 10:20:17.635000'::timestamp,'2026-03-09 10:20:18.956000'::timestamp),
(171,$mm$chuyen-gi-se-xay-ra-neu-ban-rut-tien-dung-luc-thi-truong-giam$mm$,$mm$Chuyện gì sẽ xảy ra nếu bạn rút tiền đúng lúc thị trường giảm?$mm$,'2026-03-13 03:10:26.085000'::timestamp,'2026-03-13 03:10:27.197000'::timestamp),
(172,$mm$bao-cao-thi-truong-tai-chinh-tuan-09-13-03-2026$mm$,$mm$Báo cáo thị trường tài chính tuần 09-13/03/2026$mm$,'2026-03-16 08:58:14.338000'::timestamp,'2026-03-16 09:00:19.320000'::timestamp),
(173,$mm$khong-dau-tu-cung-la-rui-ro$mm$,$mm$Không đầu tư cũng là rủi ro$mm$,'2026-03-20 07:33:58.289000'::timestamp,'2026-03-20 07:33:59.670000'::timestamp),
(174,$mm$tong-hop-thi-truong-ngay-16-20-03-2026$mm$,$mm$Tổng hợp thị trường ngày 16-20/03/2026$mm$,'2026-03-23 07:31:07.110000'::timestamp,'2026-03-23 07:31:08.438000'::timestamp),
(175,$mm$tong-hop-thi-truong-ngay-23-27-03-2026$mm$,$mm$Tổng hợp thị trường ngày 23-27/03/2026$mm$,'2026-03-31 02:28:17.090000'::timestamp,'2026-03-31 02:30:01.271000'::timestamp),
(176,$mm$lai-suat-lien-tuc-tang-co-nen-chuyen-sang-gui-tiet-kiem$mm$,$mm$Lãi suất liên tục tăng, có nên chuyển sang gửi tiết kiệm$mm$,'2026-04-03 08:07:02.991000'::timestamp,'2026-04-03 08:09:51.383000'::timestamp),
(177,$mm$tong-hop-thi-truong-ngay-30-03-04-2026$mm$,$mm$Tổng hợp thị trường ngày 30-03/04/2026$mm$,'2026-04-06 09:50:42.781000'::timestamp,'2026-04-06 09:52:27.797000'::timestamp),
(178,$mm$dieu-gi-can-tro-tu-do-tai-chinh-cua-ban$mm$,$mm$Điều gì cản trở tự do tài chính của bạn?$mm$,'2026-04-17 08:38:15.721000'::timestamp,'2026-04-17 08:41:14.047000'::timestamp),
(179,$mm$tong-hop-thi-truong-ngay-13-17-04-2026$mm$,$mm$Tổng hợp thị trường ngày 13-17/04/2026$mm$,'2026-04-20 09:23:38.489000'::timestamp,'2026-04-20 09:26:29.749000'::timestamp),
(180,$mm$tong-hop-thi-truong-ngay-21-25-04-2026$mm$,$mm$Tổng hợp thị trường ngày 20-25/04/2026$mm$,'2026-04-28 08:41:04.590000'::timestamp,'2026-04-28 08:42:53.364000'::timestamp),
(181,$mm$tong-hop-thi-truong-ngay-04-09-05-2026$mm$,$mm$Tổng hợp thị trường ngày 04-09/05/2026$mm$,'2026-05-11 09:46:47.105000'::timestamp,'2026-05-11 09:46:48.192000'::timestamp),
(182,$mm$tong-hop-thi-truong-ngay-11-15-05-2026$mm$,$mm$Tổng hợp thị trường ngày 11-15/05/2026$mm$,'2026-05-18 10:11:53.730000'::timestamp,'2026-05-18 10:14:32.726000'::timestamp),
(183,$mm$tong-hop-thi-truong-ngay-18-23-05-2026$mm$,$mm$Tổng hợp thị trường ngày 18-23/05/2026$mm$,'2026-05-25 10:09:01.079000'::timestamp,'2026-05-25 10:10:26.811000'::timestamp),
(184,$mm$quy-tac-80-20-la-gi$mm$,$mm$Quy tắc 80-20 là gì?$mm$,'2026-05-29 10:06:39.129000'::timestamp,'2026-05-29 10:06:40.337000'::timestamp),
(185,$mm$meo-tiet-kiem-chi-phi-khi-di-du-lich-mot-minh$mm$,$mm$Mẹo tiết kiệm chi phí khi đi du lịch một mình$mm$,'2026-06-05 09:19:02.990000'::timestamp,'2026-06-05 09:21:29.943000'::timestamp),
(186,$mm$tong-hop-thi-truong-ngay-01-05-06-2026$mm$,$mm$Tổng hợp thị trường ngày 01-05/06/2026$mm$,'2026-06-08 10:02:56.102000'::timestamp,'2026-06-08 10:02:57.388000'::timestamp),
(187,$mm$tong-hop-thi-truong-ngay-08-13-06-2026$mm$,$mm$Tổng hợp thị trường ngày 08-13/06/2026$mm$,'2026-06-15 09:44:36.310000'::timestamp,'2026-06-15 09:49:02.364000'::timestamp),
(188,$mm$tong-hop-thi-truong-ngay-22-26-06-2026$mm$,$mm$Tổng hợp thị trường ngày 22–26/06/2026$mm$,'2026-06-29 08:45:12.943000'::timestamp,'2026-06-29 08:54:24.682000'::timestamp),
(189,$mm$cach-lap-ngan-sach-khi-ban-co-thu-nhap-khong-on-dinh$mm$,$mm$Cách lập ngân sách khi bạn có thu nhập không ổn định$mm$,'2026-07-17 03:27:14.296000'::timestamp,'2026-07-17 03:27:18.031000'::timestamp),
(190,$mm$tong-hop-thi-truong-ngay-13-17-07-2026$mm$,$mm$Tổng hợp thị trường ngày 13-17/07/2026$mm$,'2026-07-20 10:03:04.546000'::timestamp,'2026-07-20 10:08:16.224000'::timestamp);

CREATE TEMP TABLE _extra (entry_id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _extra VALUES ('cmvypz9qr006npc01zu9seqr5'), ('cmvypy9e2006kpc01viahx5re'), ('cmuozht5u002rqfc80keov3us'), ('cmuozhqyg002lqfc8wywzttpg'), ('cmtlahyyu005rqfn40miyefji'), ('cmtlag9eg005oqfn42b54ghnr');

CREATE TEMP TABLE _cand ON COMMIT DROP AS
SELECT s.blog_id, e.id AS entry_id,
  CASE WHEN e.id = 'cs' || substr(md5('strapi-blog:' || s.blog_id), 1, 23) THEN 1
       WHEN e.slug = s.slug THEN 2
       WHEN length(e.slug) >= 60 AND s.slug LIKE e.slug || '%' THEN 3
       ELSE 4 END AS prio
FROM _strapi s
JOIN "Entry" e ON e."typeKey" = 'news' AND e."archivedAt" IS NULL
 AND ( e.id = 'cs' || substr(md5('strapi-blog:' || s.blog_id), 1, 23)
    OR e.slug = s.slug
    OR (length(e.slug) >= 60 AND s.slug LIKE e.slug || '%')
    OR lower(e.data->>'title') = lower(s.title) );

CREATE TEMP TABLE _map ON COMMIT DROP AS
SELECT DISTINCT ON (blog_id) blog_id, entry_id, prio FROM _cand ORDER BY blog_id, prio, entry_id;

DO $chk$
DECLARE n int; d int; x int; x_bad int;
BEGIN
  SELECT count(*) INTO n FROM _map;
  SELECT count(*) INTO d FROM (SELECT entry_id FROM _map GROUP BY entry_id HAVING count(*) > 1) t;
  SELECT count(*) INTO x FROM _extra x JOIN "Entry" e ON e.id = x.entry_id;
  SELECT count(*) INTO x_bad FROM _extra x JOIN _map m ON m.entry_id = x.entry_id;
  RAISE NOTICE 'Khớp % / 151 bài Strapi; bài khớp trùng: %; bài ngoài Strapi tìm thấy: % / 6', n, d, x;
  IF n <> 151 THEN RAISE EXCEPTION 'Dừng: chỉ khớp % / 151 bài. Bài Strapi không khớp: %', n,
    (SELECT string_agg(blog_id || ' ' || slug, ', ') FROM _strapi s WHERE NOT EXISTS (SELECT 1 FROM _map m WHERE m.blog_id = s.blog_id)); END IF;
  IF d > 0 THEN RAISE EXCEPTION 'Dừng: có % bài builder khớp với hơn một bài Strapi', d; END IF;
  IF x_bad > 0 THEN RAISE EXCEPTION 'Dừng: một bài "ngoài Strapi" lại khớp với Strapi'; END IF;
END $chk$;

UPDATE "Entry" e
SET "createdAt"   = s.created_at,
    "publishedAt" = COALESCE(s.published_at, e."publishedAt")
FROM _map m JOIN _strapi s ON s.blog_id = m.blog_id
WHERE e.id = m.entry_id;

CREATE TEMP TABLE _to_draft ON COMMIT DROP AS
SELECT m.entry_id FROM _map m JOIN _strapi s ON s.blog_id = m.blog_id WHERE s.published_at IS NULL
UNION SELECT entry_id FROM _extra;

UPDATE "Entry" SET status = 'draft' WHERE id IN (SELECT entry_id FROM _to_draft) AND status <> 'draft';
UPDATE "EntryLocale" SET status = 'draft' WHERE "entryId" IN (SELECT entry_id FROM _to_draft) AND status <> 'draft';

DO $rep$
DECLARE r record; i int := 0;
BEGIN
  RAISE NOTICE 'Chuyển về nháp: % bài', (SELECT count(*) FROM _to_draft);
  RAISE NOTICE '15 bài đầu danh sách sau khi sửa (createdAt giảm dần):';
  FOR r IN SELECT e."createdAt", e.slug FROM "Entry" e
           WHERE e."typeKey" = 'news' AND e."archivedAt" IS NULL AND e.status = 'published'
           ORDER BY e."createdAt" DESC, e."publishedAt" DESC, e.id DESC LIMIT 15 LOOP
    i := i + 1; RAISE NOTICE '%. % %', i, to_char(r."createdAt", 'YYYY-MM-DD HH24:MI'), r.slug;
  END LOOP;
END $rep$;

COMMIT;
