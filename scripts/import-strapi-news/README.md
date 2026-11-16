# Nhập tin tức Strapi → Quilder

`import-strapi-news.sql` là script DUY NHẤT cần chạy. Nó chứa sẵn dữ liệu (151 bài vi, 27 bản en, 358 file, 7 thư mục)
lấy từ dump Strapi prod `cms-strapi-2` ngày 11/09/2026.

## Chạy

pgAdmin: mở Query Tool trên **STG / maimoney_builder**, mở file (Open File) rồi Execute.
Hoặc: `psql -h 10.60.0.79 -U mai -d maimoney_builder -v ON_ERROR_STOP=1 -f import-strapi-news.sql`

Script nằm trong một transaction. Lỗi giữa chừng thì chạy `ROLLBACK;`. Muốn chạy thử không ghi gì: đổi dòng
`COMMIT;` cuối file thành `ROLLBACK;`. Kết quả xem ở tab Messages (số bài thêm, danh sách bài bị bỏ qua).
Chạy lại an toàn: bài trùng slug / tiêu đề bị bỏ qua, Asset trùng `key` bị bỏ qua.

Sau khi chạy: schema của loại `news` đã đổi trong DB, nên restart app hoặc revalidate cache nếu form admin còn hiện kiểu cũ.

## Ánh xạ

| Strapi | Quilder |
|---|---|
| `blogs` (locale vi) | `Entry` loại `news` |
| `blogs` (locale en), nối bằng `blogs_localizations_links` | `Entry.i18n.en` + `EntryLocale(en)` |
| `title`, `slug`, `description` | `data.title`, `data.slug`, `data.excerpt` |
| `body` (HTML CKEditor) | `data.body` (kiểu `html`, qua đúng `sanitizeArticleHtml` của repo) |
| `image` (ảnh/video đầu bài, 3 bài là mp4) | `data.cover` ("Ảnh bìa") |
| `thumbnail` | `data.thumbnail` (field mới, ngay sau cover) |
| `teams` (createdBy) + avatar | `data.author_name` + `data.author_photo` |
| `shared.seo` | `data.seo` (field mới) |
| `external_link` | `data.external_link` (field mới) |
| `categories` + `blog_groups` | `Taxonomy` + `EntryTaxonomy` (gộp, như STG đang làm) |
| `created_at`, `updated_at`, `published_at` | `createdAt`, `updatedAt`, `publishedAt` (giữ nguyên, UTC) |
| `files` + `upload_folders` | `Asset` (trỏ thẳng `cdn.maimoney.com`) + `AssetFolder` |

## Sinh lại file SQL

```
psql <db-strapi-da-nap-dump> -q -f scripts/import-strapi-news/export.sql -o strapi.json
npx tsx scripts/import-strapi-news/build.mts strapi.json src/lib/collections/html-sanitize.ts scripts/import-strapi-news/import-strapi-news.sql
```

## Video ở đầu trang chi tiết (ảnh bìa là .mp4)

1. Deploy bản code mới (renderer vẽ `<video>` cho `entry:cover`; field `image` có cờ `allowVideo`).
   Build phải có `ASSET_HOSTS` gồm cả `https://cdn.maimoney.com` (cách nhau dấu phẩy với host cũ),
   nếu không `next/image` trả 400 cho mọi ảnh import.
2. Chạy `enable-cover-video.sql` để bật `allowVideo` cho `cover` của loại news.
3. Thẻ tin/danh sách nên bind `entry:thumbnail` thay vì `entry:cover` (cover có thể là video).
