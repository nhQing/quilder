-- AlterTable
-- Tên danh mục theo ngôn ngữ. Mặc định rỗng: mọi danh mục đang có hiện tên gốc ở
-- mọi ngôn ngữ, đúng như trước migration.
ALTER TABLE "Taxonomy" ADD COLUMN     "i18n" JSONB NOT NULL DEFAULT '{}';
