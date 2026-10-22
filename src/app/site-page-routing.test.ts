import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nửa ĐỊNH TUYẾN của trang danh mục kiểu mới, đọc ở mức nguồn.
 *
 * ## Vì sao test này đọc FILE thay vì import module
 *
 * Cùng lý do với `metadata-routes.test.ts` ngay bên cạnh: `[[...slug]]/page.tsx` là
 * một React Server Component kéo theo cả cây render, `server-only` và Prisma. Phần
 * có LOGIC đã được tách ra `relationTargetType` / `relationEntryBySlug` trong
 * `collection-page.ts` và có test thật ở đó. Thứ còn lại trong file trang là ba quyết
 * định nối dây, và cả ba đọc được bằng mắt:
 *
 *  1. vai `relation` có một nhánh riêng trong `resolveTarget`;
 *  2. nhánh ấy trả `null` (tức 404) khi đoạn động không phân giải được — GIỐNG nhánh
 *     `taxonomy` ngay trên, không phải render một danh sách rỗng;
 *  3. `urlRelationId` được chuyển xuống `resolveAllRepeats`.
 *
 * Điểm 3 là điểm đã từng mất một lần: trước 09/09/2026 `urlTaxonomyId` không có trong
 * lời gọi ấy, nên cả đường ống filter `from: 'url'` chạy thật ở API mà chết ở trang.
 * Một dòng thiếu, không một lỗi nào.
 */
const PAGE = join(__dirname, '(site)', '[[...slug]]', 'page.tsx');
/**
 * Phần DỰNG trang (gọi `resolveAllRepeats`) tách sang `PublishedPageView.tsx` ngày
 * 20/10/2026, để trang 404 hệ thống dùng chung. Hai file cùng là một đường đi, nên
 * test đọc cả hai.
 */
const VIEW = join(__dirname, '(site)', 'PublishedPageView.tsx');

describe('resolveTarget — vai relation', () => {
  const src = [readFileSync(PAGE, 'utf8'), readFileSync(VIEW, 'utf8')].join('\n');

  it('có nhánh riêng cho vai relation', () => {
    expect(src).toContain("tpl.collection.param === 'relation'");
  });

  it('slug không phân giải được thì 404, không render danh sách rỗng', () => {
    const start = src.indexOf("tpl.collection.param === 'relation'");
    const branch = src.slice(start, src.indexOf('urlRelationId:', start));
    expect(branch).toContain('return null;');
  });

  it('urlRelationId đi xuống resolveAllRepeats', () => {
    const start = src.indexOf('resolveAllRepeats(doc, {');
    expect(start).toBeGreaterThan(-1);
    const call = src.slice(start, src.indexOf('}),', start));
    expect(call).toContain('urlRelationId,');
  });

  /*
   * `undefined` ở chỗ đáng lẽ `null` là ĐÚNG lỗi đang sửa: URL danh mục sai mà hiện
   * danh sách đầy đủ như thể nó đúng. Trang này chọn đường 404 nên không chỗ nào
   * được truyền `undefined` một cách tường minh.
   */
  it('không chỗ nào truyền urlRelationId: undefined', () => {
    expect(src).not.toContain('urlRelationId: undefined');
    expect(src).not.toContain('urlTaxonomyId: undefined');
  });
});
