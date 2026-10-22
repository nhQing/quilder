/**
 * `setProps` phải đối chiếu với HỢP ĐỒNG của node type.
 *
 * `zOp` khai `props: z.record(z.string(), z.unknown())`, nên tầng cú pháp không
 * nhìn vào bên trong. `applyOne` thì ghi thẳng mọi khoá vào node. Hệ quả là hai
 * lỗi im lặng cùng một gốc:
 *
 *  - **Khoá lạ được NUỐT.** `setProps { params: … }` trên một Instance trả
 *    `ok: true`, ghi một field mà không renderer nào đọc, và người dựng tưởng
 *    component có cơ chế tham số.
 *  - **Giá trị sai hình dạng được nuốt.** `overrides` là `.strict()` trong
 *    `zNode` — nhưng chỉ đường `insertNode` đi qua `zNode`. Qua `setProps` thì
 *    `overrides: { logo: { style: … } }` được nhận và bị bỏ qua lúc render.
 *
 * `insertNode` đã được `zNode` che; đây là bất đối xứng giữa hai đường ghi, đúng
 * kiểu mà `repeat_shape` đã phải vá riêng trước đó.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    token: { findMany: vi.fn().mockResolvedValue([]) },
    collectionType: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { validateOps } from './validate';
import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

function doc(): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'Grid', parentId: null, children: ['inst', 'txt', 'acc', 'panel', 'btn'], effects: [], style: { base: {} } },
      inst: { id: 'inst', type: 'Instance', componentId: 'cmp1', overrides: {}, parentId: 'root', children: [], effects: [], style: { base: {} } },
      txt: { id: 'txt', type: 'Text', tag: 'p', content: [{ t: 'text', v: 'Chào' }], parentId: 'root', children: [], effects: [], style: { base: {} } },
      acc: { id: 'acc', type: 'Composite', composite: 'Accordion', params: {}, slots: {}, parentId: 'root', children: [], effects: [], style: { base: {} } },
      panel: { id: 'panel', type: 'Composite', composite: 'Carousel', params: {}, slots: {}, parentId: 'root', children: [], effects: [], style: { base: {} } },
      btn: { id: 'btn', type: 'Button', label: [{ t: 'text', v: 'Gửi' }], action: { kind: 'link', href: '/a' }, variant: 'primary', parentId: 'root', children: [], effects: [], style: { base: {} } },
    },
  } as unknown as Doc;
}

const setProps = (nodeId: string, props: Record<string, unknown>) => [{ op: 'setProps', nodeId, props }];

describe('setProps — khoá lạ (A7)', () => {
  it('override nội dung hợp lệ vẫn đi qua', async () => {
    const r = await validateOps(
      doc(),
      setProps('inst', { overrides: { logo: { content: [{ t: 'text', v: 'Quilder' }] } } }),
      'human',
    );
    expect(r.ok).toBe(true);
  });

  it('bảng `params` bịa ra trên Instance bị chặn', async () => {
    const r = await validateOps(doc(), setProps('inst', { params: { logoSize: 'lg' } }), 'human');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'props_unknown_key')).toBe(true);
  });

  it('câu lỗi nêu khoá sai VÀ khoá hợp lệ của node type đó', async () => {
    const r = await validateOps(doc(), setProps('inst', { params: { logoSize: 'lg' } }), 'human');
    const msg = (!r.ok && r.issues.find((i) => i.code === 'props_unknown_key')?.message) || '';
    expect(msg).toContain('params');
    expect(msg).toContain('overrides');
  });

  it('khoá lạ trên node thường cũng bị chặn', async () => {
    const r = await validateOps(doc(), setProps('txt', { fontSize: 18 }), 'human');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'props_unknown_key')).toBe(true);
  });

  it('giá trị sai hình dạng cho một field CÓ THẬT cũng bị chặn', async () => {
    // `content` là RichText, tức InlineNode[]. Một chuỗi trần đi qua `setProps`
    // trước đây được ghi thẳng vào node, và `RichTextView` render ra rỗng.
    const r = await validateOps(doc(), setProps('txt', { content: 'Chào' }), 'human');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'props_shape')).toBe(true);
  });

  it('null để XOÁ một field vẫn đi qua — đó là thao tác dọn', async () => {
    const r = await validateOps(doc(), setProps('txt', { part: null }), 'human');
    expect(r.ok).toBe(true);
  });
});

describe('Instance.overrides — khoá style bị nuốt (A6)', () => {
  it('overrides mang `style` bị chặn', async () => {
    const r = await validateOps(
      doc(),
      setProps('inst', { overrides: { logo: { content: [{ t: 'text', v: 'Quilder' }], style: { spacing: { p: 4 } } } } }),
      'human',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'overrides_shape')).toBe(true);
  });

  it('câu lỗi nói overrides chỉ nhận nội dung và style đặt ở đâu', async () => {
    const r = await validateOps(
      doc(),
      setProps('inst', { overrides: { logo: { style: { spacing: { p: 4 } } } } }),
      'human',
    );
    const msg = (!r.ok && r.issues.find((i) => i.code === 'overrides_shape')?.message) || '';
    expect(msg).toContain('style');
    expect(msg).toContain('component');
  });
});

describe('Composite.params — bảng tham số bịa ra (A7)', () => {
  it('tham số CÓ THẬT của Accordion đi qua', async () => {
    const r = await validateOps(doc(), setProps('acc', { params: { single: true } }), 'human');
    expect(r.ok).toBe(true);
  });

  it('tham số bịa ra bị chặn, và câu lỗi nêu tham số thật', async () => {
    // Mỗi schema trong COMPOSITE_PARAMS bọc .catch(), nên tầng render GỠ khoá lạ
    // thay vì ném — đó là lý do ca này im lặng tuyệt đối trước khi có luật này.
    const r = await validateOps(
      doc(),
      setProps('acc', { params: { single: true, animationDuration: 300 } }),
      'human',
    );
    expect(r.ok).toBe(false);
    const msg = (!r.ok && r.issues.find((i) => i.code === 'composite_params')?.message) || '';
    expect(msg).toContain('animationDuration');
    expect(msg).toContain('single');
  });

  it('Carousel khai passthrough CÓ CHỦ ĐÍCH — không siết', async () => {
    // Xem chú thích trong COMPOSITE_PARAMS: Carousel chưa có runtime, và
    // passthrough ở đó để node placeholder đang nằm trong doc không bị từ chối.
    const r = await validateOps(doc(), setProps('panel', { params: { bat_ky: 1 } }), 'human');
    expect(r.ok).toBe(true);
  });
});

/**
 * Ba đường ghi ĐANG CHẠY trong builder mà luật mới bắt được.
 *
 * Chúng không phải test cho luật — chúng là BẢN GIAO cho làn sửa
 * `src/lib/builder/**`. Mỗi ca dưới đây là một op mà code hiện tại sinh ra, và cả
 * ba đều ghi thứ không ai đọc (hoặc phá node) mà trước nay trả `ok: true`.
 */
describe('ĐANG CHẠY mà sai — bắt được nhờ hợp đồng setProps', () => {
  it('`{ action: { href } }` của text-write.ts bị chặn — nó xoá mất `kind`', async () => {
    // `builder/text-write.ts:134`. Chú thích ở đó nói `setProps` "merge NÔNG một
    // tầng"; `applyOne` thì làm `target[key] = value`. Nên sửa đường dẫn một nút
    // qua ô dịch sẽ biến `action` thành `{ href }` — một Button không có `kind`,
    // tức một `PageVersion` mà `zNode` từ chối ở lần đọc kế tiếp.
    const r = await validateOps(doc(), setProps('btn', { action: { href: '/moi' } }), 'human');
    expect(r.ok).toBe(false);
    const msg = (!r.ok && r.issues.find((i) => i.code === 'props_shape')?.message) || '';
    expect(msg).toContain('kind');
  });

  it('`href` / `a11yLabel` phẳng của push-override.ts bị chặn', async () => {
    // `builder/push-override.ts:66-69` đẩy `ContentOverride` lên cây component
    // bằng đúng tên khoá của override. Nhưng node KHÔNG có field `href` (nó nằm
    // trong `action.href`) và KHÔNG có field `a11yLabel` (nó nằm trong `a11y.label`).
    // Hai khoá đó được ghi vào node rồi nằm đó, không renderer nào đọc.
    const r = await validateOps(doc(), setProps('btn', { href: '/moi', a11yLabel: 'Mở' }), 'human');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'props_unknown_key')).toBe(true);
  });
});
