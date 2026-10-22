/**
 * Gói RỖNG — thứ alias `@project` trỏ tới khi không đặt `QUILDER_PROJECT` (Quilder thuần).
 * tsconfig cũng trỏ `@project/*` cố định vào đây, nên lõi luôn typecheck được mà không cần
 * gói nào. Xem scripts/project-dir.mjs.
 */
import { defineProject } from '@/lib/project/types';

export default defineProject({ name: 'none' });
