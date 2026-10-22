/**
 * Kiểu dùng chung của tầng validate, không kéo theo Prisma.
 *
 * `validate.ts` khai `server-only` và import Prisma. Bất cứ module thuần nào cần
 * biết "ai đang gọi" mà import từ đó sẽ kéo cả Prisma client vào — và một hàm
 * thuần không test được thì không phải hàm thuần trên thực tế.
 *
 * `validate.ts` re-export `Actor` từ đây, nên mọi chỗ đang `import type { Actor }
 * from './validate'` vẫn chạy nguyên.
 */

/**
 * Ai đang gọi. AI bị chặn thêm ở vùng khoá, ở customCss, và ở trang đồ gá.
 *
 * Mức đã chốt với chủ dự án là "Vừa": AI ghi được customCss nhưng qua allowlist
 * property, và mọi thay đổi vẫn phải qua diff preview.
 */
export type Actor = 'human' | 'ai';
