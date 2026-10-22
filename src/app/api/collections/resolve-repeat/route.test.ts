import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Ô đếm "khối này đang khớp bao nhiêu bài" phải TRUNG THỰC, kể cả khi câu trả lời là
 * "không đếm được ở đây".
 *
 * ## Lỗi đang đóng
 *
 * Route này không có ngữ cảnh URL — nó chạy trong builder, không trên một địa chỉ
 * công khai. Nó cũng chưa bao giờ truyền `urlTaxonomyId` / `urlRelationId`, nên với
 * một khối khai `from: 'url'` thì `filterToWhere` nhận `undefined`, BỎ điều kiện, và
 * trả về số bài KHÔNG LỌC. Người dựng thấy "10 bài" cho một khối mà site thật trả về
 * ba. Con số sai ở đây tệ hơn không có số: docblock của route nói thẳng rằng đây là
 * "công cụ soát duy nhất trả lời vì sao danh sách của tôi trống".
 *
 * ## Vì sao `needsContext` chứ không phải đếm với `null`
 *
 * `null` nghĩa là "có đoạn động nhưng nó không trỏ vào đâu", tức luôn ra `matched: 0`.
 * Route này đã có một câu trả lời cho đúng tình huống ấy và đã giải thích vì sao:
 * "0 bài là một câu trả lời sai lệch cho một cấu hình không sai". Ba nguồn kia
 * (`related`, `field`, `group-entries`) đi cùng đường, nên cái thứ tư cũng vậy.
 */
const resolveRepeat = vi.hoisted(() => vi.fn(async () => [{ key: 'e1', data: {}, slug: 'a' }, { key: 'e2', data: {}, slug: 'b' }]));

vi.mock('@/lib/auth/guard', () => ({
  requireAuth: async () => ({ sub: 'u1', email: 'se1@example.com', role: 'admin' }),
}));
vi.mock('@/lib/collections/admin-queries', () => ({
  getAdminEntry: async () => null,
  repeatEntryContext: () => ({}),
}));
vi.mock('@/lib/collections/queries', () => ({ getCollectionTypes: async () => [] }));
vi.mock('@/lib/collections/resolve-repeat', () => ({ resolveRepeat }));

import { POST } from './route';

const call = (repeat: unknown) =>
  POST(
    new Request('http://localhost:3001/api/collections/resolve-repeat', {
      method: 'POST',
      body: JSON.stringify({ repeat }),
    }),
  ).then((r) => r.json() as Promise<{ matched: number | null; needsContext?: string }>);

const query = (filter: unknown[]) => ({
  source: { kind: 'query', query: { typeKey: 'tin-tuc', filter, limit: 10 } },
  map: {},
});

beforeEach(() => resolveRepeat.mockClear());

describe('POST /api/collections/resolve-repeat', () => {
  it('khối lọc theo danh mục trên URL: nói không đếm được, KHÔNG trả số chưa lọc', async () => {
    const r = await call(query([{ k: 'relation', field: 'category', from: 'url' }]));
    expect(r.matched).toBeNull();
    expect(r.needsContext).toBeTruthy();
    // Không đếm nghĩa là không chạy truy vấn nào — con số chưa lọc không được sinh ra.
    expect(resolveRepeat).not.toHaveBeenCalled();
  });

  it('nhánh taxonomy from:url cũng vậy — cùng một lỗ, hai hình dạng dữ liệu', async () => {
    const r = await call(query([{ k: 'taxonomy', from: 'url' }]));
    expect(r.matched).toBeNull();
    expect(resolveRepeat).not.toHaveBeenCalled();
  });

  it('điều kiện KHÔNG lấy từ URL vẫn đếm như cũ', async () => {
    const r = await call(query([{ k: 'taxonomy', from: 'fixed', ids: ['t1'] }]));
    expect(r.matched).toBe(2);
    expect(resolveRepeat).toHaveBeenCalledTimes(1);
  });

  it('khối không có điều kiện nào vẫn đếm như cũ', async () => {
    const r = await call(query([]));
    expect(r.matched).toBe(2);
  });
});
