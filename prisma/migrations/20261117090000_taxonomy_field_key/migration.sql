-- Phân loại theo field (17/11/2026): mỗi field `taxonomy` của một loại có danh sách mục
-- riêng. NULL = field taxonomy đầu tiên của loại, tức mọi hàng hiện có — không đổi hành vi.
ALTER TABLE "Taxonomy" ADD COLUMN "fieldKey" TEXT;
