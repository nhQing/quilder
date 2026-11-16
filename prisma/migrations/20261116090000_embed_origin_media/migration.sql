-- Cho phép nhúng YouTube và Google Maps trong field html của bản ghi (iframe).
--
-- Bảng EmbedOrigin chưa có giao diện quản lý, nên origin mới đi bằng migration
-- để staging và production cùng có, không ai phải gõ SQL tay. Cần cho trang
-- sự kiện: video recap (YouTube) và bản đồ địa điểm (Google Maps).
--
-- ON CONFLICT: môi trường nào đã thêm tay một trong các origin này thì bỏ qua.
INSERT INTO "EmbedOrigin" ("id", "origin", "note") VALUES
  ('embedorigin_youtube',        'https://www.youtube.com',          'Video YouTube nhúng trong bài / sự kiện'),
  ('embedorigin_youtubenocookie','https://www.youtube-nocookie.com', 'YouTube chế độ không cookie'),
  ('embedorigin_gmaps',          'https://maps.google.com',          'Bản đồ Google (maps.google.com/maps?...&output=embed)'),
  ('embedorigin_google',         'https://www.google.com',           'Bản đồ Google (www.google.com/maps/embed?...)')
ON CONFLICT ("origin") DO NOTHING;
