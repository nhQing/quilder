import { describe, expect, it, vi } from 'vitest';

/**
 * Lược đồ đầu vào của `create_page` / `update_page` cho lời khai `collection`.
 *
 * ## Vì sao test ở TẦNG LƯỢC ĐỒ chứ không chạy `run`
 *
 * `run` gọi thẳng `createPage` / `setPageCollection`, tức Prisma. Thứ cần khoá ở đây
 * đứng TRƯỚC chúng: một vai mà zod không nhận thì tool từ chối trước khi có lượt đọc
 * DB nào, và người dựng qua MCP không có cách nào khai vai ấy — đúng hình dạng
 * "tính năng có mà không ai dùng được" mà docblock của `set-page-collection.ts` mô tả.
 */
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { SITE_TOOLS } from './site-tools';

const collectionOf = (toolName: string) => {
  const tool = SITE_TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new Error(`không có tool ${toolName}`);
  return (input: unknown) =>
    (tool.input as { safeParse: (v: unknown) => { success: boolean } }).safeParse(input);
};

describe('zCollection — vai của đoạn động', () => {
  const parseUpdate = collectionOf('update_page');
  const parseCreate = collectionOf('create_page');
  const upd = (collection: unknown) => parseUpdate({ pageId: 'p1', collection });

  it('ba vai cũ vẫn đi qua', () => {
    for (const param of ['list', 'entry', 'taxonomy']) {
      expect(upd({ typeKey: 'tin-tuc', param }).success, param).toBe(true);
    }
    expect(upd(null).success).toBe(true);
  });

  it('nhận vai relation kèm field — cả create_page lẫn update_page', () => {
    const col = { typeKey: 'tin-tuc', param: 'relation', field: 'category' };
    expect(upd(col).success).toBe(true);
    expect(parseCreate({ title: 'Danh mục', slug: 'blogs/[category-slug]', collection: col }).success).toBe(
      true,
    );
  });

  it('từ chối vai relation thiếu field', () => {
    expect(upd({ typeKey: 'tin-tuc', param: 'relation' }).success).toBe(false);
  });

  it('từ chối field đặt nhầm lên vai khác', () => {
    // Im lặng bỏ qua thì người dựng tưởng mình đã khai xong một trang danh mục.
    expect(upd({ typeKey: 'tin-tuc', param: 'taxonomy', field: 'category' }).success).toBe(false);
  });
});
