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

const setPageSeo = vi.fn();
vi.mock('@/lib/builder/set-page-seo', () => ({ setPageSeo: (...a: unknown[]) => setPageSeo(...a) }));

import { SITE_TOOLS } from './site-tools';
import type { ToolContext } from './tools';

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

/**
 * `set_page_seo` — đường GHI SEO cho MCP.
 *
 * Luật nghiệp vụ (trần mô tả, canonical hợp lệ, rỗng → null) đã có test ở
 * `set-page-seo.test.ts`; ở đây chỉ khoá hai thứ của lớp tool: lược đồ nhận đúng
 * bốn cột SEO, và `run` chuyển thẳng xuống `setPageSeo` với đúng người ghi.
 */
describe('set_page_seo', () => {
  const tool = SITE_TOOLS.find((t) => t.name === 'set_page_seo');
  const parse = (input: unknown) =>
    (tool?.input as { safeParse: (v: unknown) => { success: boolean } }).safeParse(input);
  const ctx = { session: { sub: 'u1' }, origin: 'https://b.test' } as unknown as ToolContext;

  it('là tool GHI', () => {
    expect(tool?.readOnly).toBe(false);
  });

  it('nhận bốn cột SEO, và null để gỡ', () => {
    expect(parse({ pageId: 'p1', description: 'Mô tả' }).success).toBe(true);
    expect(parse({ pageId: 'p1', noindex: true }).success).toBe(true);
    expect(parse({ pageId: 'p1', canonical: '/maicash', ogImageId: 'a1' }).success).toBe(true);
    expect(parse({ pageId: 'p1', description: null, canonical: null, ogImageId: null }).success).toBe(true);
  });

  it('từ chối khoá lạ — jsonLd không sửa được ở đây', () => {
    expect(parse({ pageId: 'p1', jsonLd: {} }).success).toBe(false);
  });

  it('chuyển xuống setPageSeo với người ghi của phiên', async () => {
    setPageSeo.mockResolvedValueOnce({ ok: true, seo: { description: 'Mô tả' } });
    const out = await (tool!.run as (i: unknown, c: ToolContext) => Promise<unknown>)(
      { pageId: 'p1', description: 'Mô tả' },
      ctx,
    );
    expect(setPageSeo).toHaveBeenCalledWith({ pageId: 'p1', input: { description: 'Mô tả' }, actorSub: 'u1' });
    expect(out).toMatchObject({ ok: true, pageId: 'p1', seo: { description: 'Mô tả' } });
  });

  it('trả nguyên câu lỗi của setPageSeo', async () => {
    setPageSeo.mockResolvedValueOnce({ ok: false, status: 400, error: 'Mô tả tối đa 300 ký tự (đang 301)' });
    const out = await (tool!.run as (i: unknown, c: ToolContext) => Promise<unknown>)(
      { pageId: 'p1', description: 'x'.repeat(301) },
      ctx,
    );
    expect(out).toEqual({ ok: false, error: 'Mô tả tối đa 300 ký tự (đang 301)' });
  });
});
