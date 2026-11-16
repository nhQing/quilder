-- Chạy SAU KHI đã deploy bản code có cờ `allowVideo` cho field `image`.
-- Chạy trước khi deploy thì zod strict của FieldDef từ chối khoá lạ và loại "news" lỗi schema.
-- Bật cho field "cover" của loại news: ô chọn nhận cả video, trang chi tiết vẽ <video>.
BEGIN;
UPDATE "CollectionType" ct
SET schema = (
  SELECT jsonb_agg(CASE WHEN f->>'key' = 'cover' THEN f || '{"allowVideo": true}'::jsonb ELSE f END ORDER BY ord)
  FROM jsonb_array_elements(ct.schema) WITH ORDINALITY AS t(f, ord)
)
WHERE ct.key = 'news';
SELECT f->>'key' AS field, f->>'allowVideo' AS allow_video
FROM "CollectionType" ct, jsonb_array_elements(ct.schema) f
WHERE ct.key = 'news' AND f->>'key' IN ('cover', 'thumbnail');
COMMIT;
