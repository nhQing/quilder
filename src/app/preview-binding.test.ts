import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Màn XEM TRƯỚC phải nhận đủ ngữ cảnh mà `previewBinding` trả về.
 *
 * ## Vì sao test này đọc FILE thay vì import module
 *
 * Cùng lý do đã ghi ở `site-page-routing.test.ts` ngay bên cạnh: `preview/[pageId]/
 * page.tsx` là một React Server Component kéo theo cả cây render, `server-only` và
 * Prisma. Phần có LOGIC nằm ở `previewBinding` trong `collection-page.ts` và đã có
 * test thật ở đó. Thứ còn lại trong file trang là phép NỐI DÂY, và nó đọc được bằng
 * mắt — nhưng chỉ khi có ai nhìn, nên nó cần một test.
 *
 * ## Vì sao đúng dòng này đáng một test riêng
 *
 * Đây là lần thứ HAI cùng một dòng bị quên. Lần đầu là `urlTaxonomyId` ở
 * `[[...slug]]/page.tsx` trước 09/09/2026; lần này là `urlRelationId` ở đây. Cả hai
 * hỏng theo cùng một kiểu và không sinh lỗi nào: `resolveAllRepeats` nhận
 * `undefined`, hiểu là "không lọc theo URL", và trang danh mục hiện DANH SÁCH ĐẦY ĐỦ
 * như thể nó đúng.
 *
 * Ở màn xem trước, đó là preview nói dối — đúng thứ mà docblock của `previewBinding`
 * tồn tại để cảnh báo, và đắt hơn hẳn ở chỗ khác vì preview chính là nơi người dùng
 * mở ra để NGHIỆM THU trước khi publish.
 */
const PAGE = join(__dirname, '(site)', 'preview', '[pageId]', 'page.tsx');

const src = readFileSync(PAGE, 'utf8');

/** Thân của lời gọi `resolveAllRepeats(doc, { … })` trong file trang. */
const call = () => {
  const start = src.indexOf('resolveAllRepeats(doc, {');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('});', start));
};

describe('preview — ngữ cảnh đi xuống resolveAllRepeats', () => {
  it('urlRelationId đi xuống, không bị bỏ lại ở binding', () => {
    expect(call()).toContain('urlRelationId: binding.urlRelationId,');
  });

  it('urlTaxonomyId vẫn còn — vai cũ không được mất khi thêm vai mới', () => {
    expect(call()).toContain('urlTaxonomyId: binding.urlTaxonomyId,');
  });

  /*
   * `undefined` tường minh ở chỗ đáng lẽ là một id chính là hình dạng của lỗi: nó đọc
   * như "cố ý không lọc", trong khi thứ đang xảy ra là "quên truyền".
   */
  it('không chỗ nào truyền undefined tường minh cho hai ô ấy', () => {
    expect(src).not.toContain('urlRelationId: undefined');
    expect(src).not.toContain('urlTaxonomyId: undefined');
  });
});
