-- Giá trị gốc của một token TĨNH, giữ lại lúc nó bị sửa lần đầu từ màn Cài đặt.
--
-- NULL = chưa ai đụng. Non-null có ba tác dụng cùng lúc, xem doc của `Token` trong
-- schema.prisma: nó là cờ để `render/custom-tokens.ts` biết phải phát khai báo
-- `:root` cho token này, là đường quay về mặc định, và là rào để
-- `pnpm tokens:import` không đồng bộ đè lên màu người dùng vừa đặt.
--
-- Không backfill gì: chưa có token nào bị sửa, và NULL đã đúng nghĩa "nguyên bản".
ALTER TABLE "Token" ADD COLUMN "baseValue" TEXT;
