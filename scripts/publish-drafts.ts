/**
 * Publish cả site qua `/api/publish` — đăng nhập bằng BUILDER_EMAIL / BUILDER_PASSWORD.
 *
 * Dùng sau khi seed bằng script: các script seed dựng BẢN NHÁP, còn release chỉ đi qua API
 * (đúng một đường publish, và `revalidateTag` chỉ gọi được trong Next). Stack e2e chạy nó
 * ngay khi dev server sẵn sàng.
 *
 *   E2E_BASE_URL=http://localhost:3003 pnpm exec tsx scripts/publish-drafts.ts [nhãn]
 */

import { api } from './api-client';

const label = process.argv[2] ?? 'publish-drafts';
const json = await api<{ pageCount: number; ms: number }>('/api/publish', { action: 'publish', label });
console.log(`đã publish ${json.pageCount} trang trong ${json.ms}ms`);
