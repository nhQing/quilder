-- Cờ "trang này là đồ gá của test, không phải nội dung".
--
-- Xem docblock của `Page.fixture` trong schema.prisma để biết vì sao nó tồn tại.
-- Tóm lại: `list_pages` hiện `/gioi-thieu` y như một trang thật, và đã hai lần có
-- người (một lần là AI) dựng nội dung lên đó rồi làm đỏ 3 spec e2e.

-- AlterTable
ALTER TABLE "Page" ADD COLUMN "fixture" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: đúng một slug, và nó được viết thẳng ra đây chứ không suy đoán.
--
-- Vì sao chỉ `gioi-thieu`: `grep -c` trong e2e/ cho 36 lần chạm `gioi-thieu` và 5
-- lần chạm `tin-tuc` — nhưng cả 5 lần sau đều CHỈ ĐỌC, và docblock của
-- `collection-render.spec.ts` nói rõ `/tin-tuc` là trang phải dựng nội dung thật
-- bằng tay. Đánh cờ nó sẽ chặn đúng thứ spec đó cần.
UPDATE "Page" SET "fixture" = true WHERE "slug" = 'gioi-thieu';
