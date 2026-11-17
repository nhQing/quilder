-- Tách Danh mục / Tag cho Tin tức (17/11/2026) — chạy SAU khi deploy bản có cột "Taxonomy"."fieldKey".
--
-- Nguồn: dump Strapi cms-strapi-2 (11/09/2026). Group của Strapi → Danh mục (field `cats`),
-- Category của Strapi → Tag (field mới `tags`). Lúc nhập trước đây hai lớp bị gộp vào một
-- danh sách; script này tách lại và gắn đúng cho 144 bài có trong dump.
--
-- Khoá (đoạn URL) của danh mục GIỮ NGUYÊN như site đang chạy (/blogs/dau-tu, ...). Hai tag
-- trùng tên danh mục được khoá mới: `tag-dau-tu`, `tag-tin-tuc-thi-truong`.
--
-- Chạy được nhiều lần (idempotent). Bọc trong một transaction: lỗi giữa chừng thì không đổi gì.
BEGIN;

-- 1. Field `tags` (vai trò Tag) cho loại Tin tức, ngay sau `cats`.
UPDATE "CollectionType" ct
SET "schema" = (
  SELECT jsonb_agg(elem ORDER BY ord) FROM (
    SELECT elem, ord::numeric AS ord FROM jsonb_array_elements(ct."schema") WITH ORDINALITY AS a(elem, ord)
    UNION ALL
    SELECT '{"t":"taxonomy","key":"tags","label":"Tag","role":"tag","multiple":true}'::jsonb,
           (SELECT ord FROM jsonb_array_elements(ct."schema") WITH ORDINALITY AS b(e, ord) WHERE e->>'key' = 'cats') + 0.5
  ) x
)
WHERE ct.key = 'news' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ct."schema") e WHERE e->>'key' = 'tags');

-- 2. Ba mục vốn là Category của Strapi → chuyển sang field `tags` (giữ id, giữ bản dịch).
UPDATE "Taxonomy" SET "fieldKey" = 'tags' WHERE "typeKey" = 'news' AND key IN ('su-kien', 'san-pham', 'tet');

-- 3. Hai tag trùng tên danh mục: tạo mới (bỏ qua nếu đã có).
INSERT INTO "Taxonomy" (id, "typeKey", key, name, i18n, "order", status, "fieldKey")
SELECT 'cbxpcav7u0t02450b1m4o1w45', 'news', 'tag-dau-tu', 'Đầu tư', '{"en": {"name": "Investments"}}'::jsonb, 0, 'published', 'tags'
WHERE NOT EXISTS (SELECT 1 FROM "Taxonomy" WHERE "typeKey" = 'news' AND key = 'tag-dau-tu');
INSERT INTO "Taxonomy" (id, "typeKey", key, name, i18n, "order", status, "fieldKey")
SELECT 'c4b516z1ktamcbi5erthzxee7', 'news', 'tag-tin-tuc-thi-truong', 'Tin Tức Thị Trường', '{"en": {"name": "Market Wrap"}}'::jsonb, 0, 'published', 'tags'
WHERE NOT EXISTS (SELECT 1 FROM "Taxonomy" WHERE "typeKey" = 'news' AND key = 'tag-tin-tuc-thi-truong');

-- 4. Danh mục thật (Group của Strapi) phải đang "Hiện" để vào dải danh mục.
UPDATE "Taxonomy" SET status = 'published'
WHERE "typeKey" = 'news' AND "fieldKey" IS NULL
  AND key IN ('dau-tu', 'tin-tuc-thi-truong', 'tin-tuc-mai-money', 'gia-tri-cong-dong', 'moneytalk-vie', 'uu-dai');

-- 4b. Tên theo Strapi: danh mục "Đầu Tư" (group maimoney-dau-tu, EN "Investing 101") khác tag
--     "Đầu tư" (EN "Investments"). Ba danh mục còn lại chỉ bổ sung tên EN nếu đang trống.
UPDATE "Taxonomy" SET name = 'Đầu Tư', i18n = i18n || '{"en": {"name": "Investing 101"}}'::jsonb
WHERE "typeKey" = 'news' AND key = 'dau-tu' AND "fieldKey" IS NULL;
UPDATE "Taxonomy" t SET i18n = t.i18n || jsonb_build_object('en', jsonb_build_object('name', v.en))
FROM (VALUES ('tin-tuc-mai-money', 'MaiMoney News'), ('gia-tri-cong-dong', 'Impact'), ('moneytalk-vie', 'Money Talk')) v(key, en)
WHERE t."typeKey" = 'news' AND t.key = v.key AND coalesce(t.i18n #>> '{en,name}', '') = '';

-- 5. Gắn lại danh mục + tag cho từng bài có trong dump Strapi (xoá liên kết cũ của bài đó rồi ghi lại).
CREATE TEMP TABLE _tax_map (slug text, keys text[]) ON COMMIT DROP;
INSERT INTO _tax_map (slug, keys) VALUES
  ('4-giai-doan-trong-chu-ky-tai-chinh-cua-mot-nguoi', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('5-cach-healing-tui-tien-trong-nam-2024-cho-gen-z', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('50-30-20-ban-can-biet-gi-de-chi-tieu-hop-ly-hon', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('7-buoc-bien-giac-mo-so-huu-nha-thanh-hien-thuc', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('8-ly-do-ban-nen-bat-dau-xay-dung-quy-khan-cap-ngay-hom-nay', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('8-sai-lam-ban-can-tranh-de-khong-roi-vao-bay-tin-dung', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('ban-co-dang-tra-gia-cho-chinh-cam-xuc-cua-minh', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('ban-nen-co-bao-nhieu-tai-khoan-ngan-hang-la-hop-ly', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('bao-cao-thi-truong-tai-chinh-tuan-02-06-03-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('bao-cao-thi-truong-tai-chinh-tuan-09-13-03-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('bao-cao-thi-truong-tai-chinh-viet-nam-tuan-cuoi-nam-2025-dau-an-dinh-moi-va-giai-doan-chuyen-tiep-sang-2026', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('bi-danh-thue-lieu-tien-gui-tiet-kiem-con-la-ham-tru-an-uu-tien-cho-tien-nhan-roi-cua-ban', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('cach-lap-ngan-sach-khi-ban-co-thu-nhap-khong-on-dinh', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('cam-on-ban-da-dong-hanh-cung-mai-money-tai-bao-ve-suc-khoe-va-xay-dung-tai-chinh-ben-vung', ARRAY['su-kien', 'tin-tuc-mai-money']::text[]),
  ('can-bang-tich-luy-giua-huu-tri-va-cac-muc-tieu-khac', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('ceo-mai-money-mong-nguoi-tre-yen-tam-dau-tu-ma-khong-phai-lo-nghi-qua-nhieu', ARRAY['moneytalk-vie', 'tag-dau-tu']::text[]),
  ('chay-tui-do-hieu-ung-tra-sua-lam-sao-de-tranh-bay-tieu-dung', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('chi-phi-tinh-ai-trong-ngay-le-valentine-la-bao-nhieu', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('chi-tieu-nhieu-hon-trong-thoi-ky-lam-phat', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('chinh-thuc-ra-mat-ung-dung-dau-tu-tich-luy-mai-money', ARRAY['san-pham', 'tag-dau-tu', 'tin-tuc-mai-money']::text[]),
  ('chuyen-gi-se-xay-ra-neu-ban-rut-tien-dung-luc-thi-truong-giam', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('con-tre-ma-chay-tui-day-co-phai-8-sai-lam-nay', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('dang-sau-lan-song-tich-tru-vang-ky-luc-dang-an-chua-dieu-gi', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('dau-la-cong-cu-hay-nen-tang-ung-dung-dau-tu-danh-cho-ban', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('dau-tu-dien-tai-tao-tai-sao-khong', ARRAY['gia-tri-cong-dong', 'san-pham', 'tag-dau-tu']::text[]),
  ('dau-tu-o-tuoi-22-nhu-nao-la-dung', ARRAY['moneytalk-vie', 'tag-dau-tu']::text[]),
  ('dieu-gi-can-tro-tu-do-tai-chinh-cua-ban', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('doom-spending-chi-tieu-mat-kiem-soat-vi-lo-so-tuong-lai-1', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('dung-fomo-nua-hay-jomo-di', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('eric-trump-tham-van-phong-mai-money-tai-ha-noi-trong-khuon-kho-le-khoi-cong-du-a', ARRAY['su-kien', 'tin-tuc-mai-money']::text[]),
  ('ftse-russell-cong-bo-nang-hang-chung-khoan-viet-nam-len-thi-truong-moi-noi', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('gen-z-muon-nghi-huu-som', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('gen-z-nen-lam-gi-de-tranh-cam-thay-fomo-khi-dau-tu', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('gia-vang-tang-co-hoi-hay-canh-bao-cho-nen-kinh-te', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('giai-phap-toi-uu-dong-tien-nhan-roi-mai-cash', ARRAY['san-pham', 'tin-tuc-mai-money']::text[]),
  ('gioi-thieu-mai-green-dau-tu-xanh-voi-loi-tuc-hap-dan-toi-8-5-nam', ARRAY['san-pham', 'tag-dau-tu', 'tin-tuc-mai-money']::text[]),
  ('goc-nhin-tai-chinh-ca-nhan-bao-ve-suc-khoe-va-xay-dung-tai-chinh-ben-vung-1', ARRAY['dau-tu', 'su-kien', 'tin-tuc-mai-money']::text[]),
  ('hong-thu-dau-tu-voi-minh-khong-chi-la-chuyen-tien-bac', ARRAY['moneytalk-vie', 'tag-dau-tu']::text[]),
  ('khong-dau-tu-cung-la-rui-ro', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('khong-thich-mao-hiem-nen-dau-tu-hieu-qua-nhu-the-nao', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('lai-suat-lien-tuc-tang-co-nen-chuyen-sang-gui-tiet-kiem', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('lai-suat-ngan-hang-tren-da-giam-manh-dong-tien-gui-tai-ngan-hang-co-con-toi-uu', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('lam-phat-va-vai-tro-cua-lam-phat-trong-nen-kinh-te', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('lam-sao-giu-vi-day-ma-tet-van-vui', ARRAY['tag-dau-tu']::text[]),
  ('li-xi-nam-moi-mien-phi-nap-tien-24-7', ARRAY['san-pham', 'tin-tuc-mai-money']::text[]),
  ('li-xi-tet-mon-qua-tai-chinh-dau-doi-cho-con-cai', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('lieu-co-nen-mua-tui-xach-hang-hieu-va-coi-no-la-loai-hinh-dau-tu', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('lieu-da-den-luc-ban-nen-thu-mot-mo-hinh-dau-tu-moi', ARRAY['gia-tri-cong-dong', 'san-pham', 'tag-dau-tu']::text[]),
  ('lieu-dau-tu-thay-the-co-thuc-su-thay-the-cac-lua-chon-dau-tu-cua-gen-z', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('mai-green-cap-nhat-loi-nhuan-tich-luy-moi-tich-luy-tai-chinh-xay-dung-tuong-lai-xanh', ARRAY['san-pham', 'tin-tuc-mai-money']::text[]),
  ('mai-money-co-thuc-su-la-ung-dung-dang-de-dau-tu', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('mai-money-moi-ban-uu-dai-ca-phe-70-k', ARRAY['su-kien', 'uu-dai']::text[]),
  ('mai-money-va-goc-nhin-dau-tu-moi-tai-viet-nam', ARRAY['san-pham', 'tin-tuc-mai-money']::text[]),
  ('mai-money-va-play-moolah-ky-ket-bien-ban-ghi-nho-hop-tac-chien-luoc-mo-rong-trai-nghiem-giao-duc-tai-chinh-toan-dien', ARRAY['san-pham', 'su-kien', 'tin-tuc-mai-money']::text[]),
  ('maimoney-sets-new-standard-for-wealth-management-in-vietnam', ARRAY['san-pham', 'tin-tuc-mai-money']::text[]),
  ('meo-tiet-kiem-chi-phi-khi-di-du-lich-mot-minh', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('minh-con-tre-ma-song-cho-hien-tai-hay-tiet-kiem-cho-tuong-lai-nhi', ARRAY['moneytalk-vie', 'tag-dau-tu']::text[]),
  ('minigame-tet-ghi-muc-tieu-hay-li-xi-trao-tay', ARRAY['su-kien', 'tin-tuc-mai-money']::text[]),
  ('ngan-hang-ghi-nhan-luong-tien-gui-ky-luc-6-83-trieu-ty-vnd-dau-la-co-hoi-cho-ban-di-nguoc-lai-so-dong', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('nguyen-phuong-de-khong-phai-an-mi-tom-cuoi-thang-minh-nen-tranh-de-het-trung-vao-mot-ro', ARRAY['moneytalk-vie', 'tag-dau-tu']::text[]),
  ('nu-quyen-trong-quan-ly-tai-chinh', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('pha-vo-moi-rao-can-trao-quyen-cho-doanh-nhan-nu-viet-nam', ARRAY['gia-tri-cong-dong', 'tag-dau-tu']::text[]),
  ('phai-lam-gi-neu-ban-khong-dat-duoc-muc-tieu-tai-chinh', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('phu-nu-hien-dai-ngay-cang-chu-trong-chu-dong-tai-chinh', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('quy-chim-la-gi-cach-lap-quy-chim-don-gian-de-khong-dau-vi', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('quy-tac-80-20-la-gi', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('revenge-saving-khi-noi-lo-tai-chinh-bien-thanh-thoi-quen-tich-cuc', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('su-kien-ra-mat-ung-dung-dau-tu-and-tich-luy-mai-money-khoi-dau-moi-cho-hanh-trinh-dau-tu-xanh-cua-ban-bat-dau-tai-day', ARRAY['su-kien', 'tin-tuc-mai-money']::text[]),
  ('su-kien-vntr-investor-roundtable-hanoi', ARRAY['su-kien', 'tin-tuc-mai-money']::text[]),
  ('tai-sao-chung-ta-lai-tranh-xa-nhung-khoan-dau-tu-dai-han', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('tai-sao-chuoi-cung-ung-lai-la-lua-chon-dau-tu-cua-mai-money', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('the-le-chuong-trinh-chia-se-lien-tay-nhan-ngay-100-k', ARRAY['su-kien', 'tin-tuc-mai-money']::text[]),
  ('thi-truong-chao-dao-vi-chinh-sach-thue-cua-trump-lam-sao-de-giu-vung-danh-muc-dau-tu', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('thi-truong-quoc-te-ngay-29-07', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('thi-truong-quoc-te-tuan-08-12-09-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('thi-truong-quoc-te-tuan-22-26-09-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('thi-truong-viet-nam-tuan-15-19-09-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('thoat-khoi-vong-lap-nhan-luong-chi-tieu', ARRAY[]::text[]),
  ('thong-tin-thi-truong-quoc-te-01-08-2025', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-02-09', ARRAY['tag-dau-tu', 'tag-tin-tuc-thi-truong', 'tin-tuc-mai-money', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-cuoi-ngay-04-08-2025', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-cuoi-ngay-06-08-2025', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-cuoi-ngay-08-08', ARRAY['dau-tu', 'tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-cuoi-ngay-11-08', ARRAY['dau-tu', 'tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-ngay-12-08-1', ARRAY['dau-tu', 'tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-ngay-13-08', ARRAY['dau-tu', 'tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-ngay-14-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-mai-money', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-ngay-18-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-mai-money', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-ngay-19-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-mai-money', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-ngay-25-08', ARRAY['dau-tu', 'tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-quoc-te-ngay-28-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-04-08-2025', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-06-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-03-09', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-05-08-2025', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-07-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-08-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-11-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-13-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-14-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-15-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-18-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-19-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-20-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-21-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-mai-money', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-25-08-2', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-mai-money', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-ngay-29-08', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('thong-tin-thi-truong-viet-nam-va-the-gioi-30-07', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('thong-tin-thi-truong-viet-nam-va-the-gioi-31-07', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('thu-nhap-thu-dong-la-gi-lieu-ban-nen-co-nguon-thu-nhap-thu-dong-ca-nhan', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('tich-tieu-thanh-dai-co-hoi-tich-luy-tai-chinh', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('tiet-kiem-hay-dau-tu-giai-phap-nao-co-loi-cho-ban', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('toan-canh-thi-truong-tai-chinh-tuan-12-16-01-2026-chung-khoan-duy-tri-da-tich-cuc-thanh-khoan-but-pha', ARRAY['tag-tin-tuc-thi-truong', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-01-05-06-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-04-09-05-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-08-13-06-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-11-15-05-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-13-17-04-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-13-17-07-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-16-20-03-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-18-23-05-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-21-25-04-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-22-26-06-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-23-27-03-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-ngay-30-03-04-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-01-06-11-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-02-06-02-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-03-08-11-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-05-09-01-2026', ARRAY[]::text[]),
  ('tong-hop-thi-truong-tuan-06-10-10-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-08-13-12-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-10-15-11-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-13-17-10-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-15-19-12-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-17-22-11-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-19-23-01-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-20-24-10-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-22-27-12-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-24-29-11-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-26-31-01-2026', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('tong-hop-thi-truong-tuan-27-31-10-2025', ARRAY['tag-dau-tu', 'tin-tuc-thi-truong']::text[]),
  ('vi-sao-mai-cash-la-san-pham-dang-de-dau-tu-cho-dong-tien-ngan-han', ARRAY['dau-tu', 'san-pham', 'tin-tuc-mai-money']::text[]),
  ('vi-sao-nguoi-viet-duoi-30-tuoi-chua-biet-cach-quan-ly-tien-bac-mot-cach-khoa-hoc', ARRAY['dau-tu', 'tag-dau-tu']::text[]),
  ('xe-su-dung-nguyen-lieu-hoa-thach-bi-cam-o-vanh-dai-1-bai-toan-tai-chinh-cho-nguoi-tre', ARRAY['dau-tu', 'tag-dau-tu']::text[]);

DELETE FROM "EntryTaxonomy" et
USING "Entry" e, _tax_map m
WHERE et."entryId" = e.id AND e."typeKey" = 'news' AND e.slug = m.slug;

INSERT INTO "EntryTaxonomy" ("entryId", "taxonomyId")
SELECT e.id, t.id
FROM _tax_map m
JOIN "Entry" e ON e."typeKey" = 'news' AND e.slug = m.slug
JOIN "Taxonomy" t ON t."typeKey" = 'news' AND t.key = ANY (m.keys)
ON CONFLICT DO NOTHING;

-- Kiểm tra nhanh trước khi COMMIT: số bài khớp, và số bài theo từng mục.
SELECT count(*) AS bai_khop FROM _tax_map m JOIN "Entry" e ON e."typeKey" = 'news' AND e.slug = m.slug;
SELECT t.key, coalesce(t."fieldKey", 'cats') AS field, count(et."entryId") AS so_bai
FROM "Taxonomy" t LEFT JOIN "EntryTaxonomy" et ON et."taxonomyId" = t.id
WHERE t."typeKey" = 'news' GROUP BY t.key, t."fieldKey" ORDER BY 2, 1;

COMMIT;
