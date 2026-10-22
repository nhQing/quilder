import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Metadata SEO của trang.
 *
 * Hai tính chất chịu lực, và cả hai hỏng KHÔNG có triệu chứng nào trên giao diện:
 *
 *  1. `canonical` tương đối. `<link rel="canonical" href="trang-chu">` được trình
 *     duyệt hiểu là tương đối với URL hiện tại, nên nó trỏ về đúng chỗ đang đứng —
 *     canonical không làm gì cả, và không có gì báo. Triệu chứng duy nhất là thứ
 *     hạng tìm kiếm.
 *  2. Chuỗi rỗng vs `null`. Route site kiểm `page.description ?? undefined`, nên
 *     một chuỗi rỗng đi qua phép kiểm đó và thành `<meta description="">` — tệ hơn
 *     không có thẻ, vì Google không tự lấy đoạn nào thay thế.
 */

type Args = Record<string, unknown>;

const update = vi.fn(async (_a: Args): Promise<unknown> => ({}));
const auditCreate = vi.fn(async (_a: Args): Promise<unknown> => ({}));
const findUnique = vi.fn(
  async (_a: Args): Promise<unknown> => ({ id: 'p1', slug: 'trang-chu', fixture: false }),
);

vi.mock('@/lib/db', () => ({
  prisma: {
    page: {
      findUnique: (a: Args) => findUnique(a),
      update: (a: Args) => update(a),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        page: { update: (a: Args) => update(a) },
        auditLog: { create: (a: Args) => auditCreate(a) },
      }),
  },
}));

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { setPageSeo } from './set-page-seo';

const run = (input: Parameters<typeof setPageSeo>[0]['input']) =>
  setPageSeo({ pageId: 'p1', input, actorSub: 'u1' });

/** `data` mà lượt `page.update` thực sự nhận. */
const written = () =>
  (update.mock.calls[0]![0] as unknown as { data: Record<string, unknown> }).data;

beforeEach(() => {
  update.mockClear();
  auditCreate.mockClear();
});

describe('canonical', () => {
  it('nhận đường dẫn bắt đầu bằng /', async () => {
    expect((await run({ canonical: '/gioi-thieu' })).ok).toBe(true);
    expect(written().canonical).toBe('/gioi-thieu');
  });

  it('nhận URL tuyệt đối https', async () => {
    expect((await run({ canonical: 'https://example.com/a' })).ok).toBe(true);
  });

  it('TỪ CHỐI đường dẫn tương đối — nó không làm gì và không báo gì', async () => {
    const r = await run({ canonical: 'gioi-thieu' });
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('từ chối scheme lạ', async () => {
    expect((await run({ canonical: 'javascript:alert(1)' })).ok).toBe(false);
    expect((await run({ canonical: 'ftp://a.vn/x' })).ok).toBe(false);
  });

  it('rỗng thành null, không phải chuỗi rỗng', async () => {
    await run({ canonical: '   ' });
    expect(written().canonical).toBeNull();
  });
});

describe('description', () => {
  it('rỗng thành null', async () => {
    // `page.description ?? undefined` ở route site cho chuỗi rỗng đi qua, và kết
    // quả là một thẻ meta rỗng.
    await run({ description: '' });
    expect(written().description).toBeNull();
  });

  it('cắt trắng hai đầu', async () => {
    await run({ description: '  Mô tả ngắn  ' });
    expect(written().description).toBe('Mô tả ngắn');
  });

  it('quá 300 ký tự thì TỪ CHỐI, không tự cắt', async () => {
    // Tự cắt là cắt giữa một từ, ở một chỗ tác giả không chọn. Nói ra để họ tự cắt.
    const r = await run({ description: 'x'.repeat(301) });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('301');
  });
});

describe('noindex', () => {
  it('false là một GIÁ TRỊ, không phải "không đổi"', async () => {
    // `if (args.input.noindex !== undefined)` chứ không `if (args.input.noindex)`:
    // nhánh sau làm việc BỎ noindex thành bất khả — bật được mà không tắt được.
    await run({ noindex: false });
    expect(written().noindex).toBe(false);
  });
});

describe('hàng rào chung', () => {
  it('không có gì để đổi thì từ chối, không ghi audit rỗng', async () => {
    const r = await run({});
    expect(r.ok).toBe(false);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('audit ghi TÊN TRƯỜNG đã đổi, không ghi giá trị', async () => {
    await run({ description: 'A', noindex: true });
    const meta = (auditCreate.mock.calls[0]![0] as unknown as {
      data: { meta: { fields: string[] } };
    }).data.meta;
    expect(meta.fields).toEqual(['description', 'noindex']);
  });

  it('trang không tồn tại thì 404', async () => {
    findUnique.mockResolvedValueOnce(null);
    const r = await run({ description: 'A' });
    expect(r.ok === false && r.status).toBe(404);
  });
});
