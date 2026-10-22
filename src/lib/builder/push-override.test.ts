import { describe, expect, it, vi } from 'vitest';

// `push-override.ts` kéo theo `@/lib/db` ở tầng module. `overrideToComponentOps`
// không chạm DB, nên thay prisma bằng một vật rỗng là đủ để nạp file.
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { overrideToComponentOps } from './push-override';
import type { ContentOverride, Node } from '@/lib/doc/types';

/**
 * "Đẩy ghi đè lên component" phải ghi vào ĐÚNG ĐƯỜNG DẪN FIELD của node.
 *
 * Bản trước đẩy `ContentOverride` lên bằng chính tên khoá của override:
 * `props.href` và `props.a11yLabel`. Không node type nào có hai field đó —
 * `href` nằm trong `action.href`, `a11yLabel` nằm trong `a11y.label`. Hai khoá
 * được ghi vào node rồi nằm im: không renderer nào đọc, không lỗi nào báo, và
 * người dùng bấm "đẩy lên component" rồi tưởng đã xong.
 *
 * Hợp đồng `setProps` mới biến ca đó thành lỗi thấy được — xem
 * `doc/validate-setprops-contract.test.ts`.
 *
 * Nguồn sự thật cho "override nào áp vào field nào" là `applyOverride`
 * (`render/instance.ts`). Push là phép NÂNG cùng những giá trị đó thành mặc
 * định, nên hai bên phải nói cùng một luật — kể cả luật `setProps` THAY chứ
 * không merge object lồng.
 */

const button = (action: unknown, a11y?: unknown): Node =>
  ({
    id: 'b1',
    type: 'Button',
    label: [{ t: 'text', v: 'Tải app' }],
    action,
    variant: 'primary',
    parentId: 'root',
    children: [],
    effects: [],
    style: { base: {} },
    ...(a11y ? { a11y } : {}),
  }) as unknown as Node;

const image = (): Node =>
  ({
    id: 'i1',
    type: 'Image',
    assetId: 'a-cu',
    alt: 'cũ',
    fit: 'cover',
    parentId: 'root',
    children: [],
    effects: [],
    style: { base: {} },
  }) as unknown as Node;

const propsOf = (ops: ReturnType<typeof overrideToComponentOps>) =>
  (ops.find((o) => o.op === 'setProps') as { props: Record<string, unknown> } | undefined)?.props;

describe('overrideToComponentOps — đường dẫn field', () => {
  it('href đi vào `action`, KHÔNG phải một field `href` phẳng', () => {
    const ov: ContentOverride = { href: '/moi' };
    const props = propsOf(
      overrideToComponentOps('b1', ov, button({ kind: 'link', href: '/cu' })),
    );
    expect(props).toEqual({ action: { kind: 'link', href: '/moi' } });
    expect(props).not.toHaveProperty('href');
  });

  it('href gửi ĐỦ object action — `kind`, `target`, `rel` đều sống', () => {
    const props = propsOf(
      overrideToComponentOps(
        'b1',
        { href: '/moi' },
        button({ kind: 'link', href: '/cu', target: '_blank', rel: 'noopener' }),
      ),
    );
    expect(props).toEqual({
      action: { kind: 'link', href: '/moi', target: '_blank', rel: 'noopener' },
    });
  });

  it('action không phải link thì href bị BỎ — cùng luật với applyOverride', () => {
    const ops = overrideToComponentOps('b1', { href: '/moi' }, button({ kind: 'submit', formId: 'f' }));
    expect(ops).toEqual([]);
  });

  it('a11yLabel đi vào `a11y.label`, KHÔNG phải field `a11yLabel` phẳng', () => {
    const props = propsOf(
      overrideToComponentOps('b1', { a11yLabel: 'Mở menu' }, button({ kind: 'none' })),
    );
    expect(props).toEqual({ a11y: { label: 'Mở menu' } });
    expect(props).not.toHaveProperty('a11yLabel');
  });

  it('a11y gửi ĐỦ object — `role` và `labelledBy` không bị xoá', () => {
    const props = propsOf(
      overrideToComponentOps(
        'b1',
        { a11yLabel: 'Mở menu' },
        button({ kind: 'none' }, { role: 'button', label: 'cũ', labelledBy: 'lbl1' }),
      ),
    );
    expect(props).toEqual({ a11y: { role: 'button', label: 'Mở menu', labelledBy: 'lbl1' } });
  });

  it('chữ vẫn đi qua setText, không gộp vào setProps', () => {
    const ops = overrideToComponentOps(
      'b1',
      { label: [{ t: 'text', v: 'Mới' }] },
      button({ kind: 'none' }),
    );
    expect(ops).toEqual([
      { op: 'setText', nodeId: 'b1', field: 'label', value: [{ t: 'text', v: 'Mới' }] },
    ]);
  });

  it('alt và assetId của ảnh vẫn là field phẳng — chúng CÓ thật trên ImageNode', () => {
    const props = propsOf(overrideToComponentOps('i1', { alt: 'Ảnh mới', assetId: 'a-moi' }, image()));
    expect(props).toEqual({ alt: 'Ảnh mới', assetId: 'a-moi' });
  });

  it('override lạc loài với node type thì bị bỏ, không sinh op zNode từ chối', () => {
    // Ghi đè `alt` lên một Button là dữ liệu cũ/rác. `applyOverride` bỏ qua nó
    // lúc render; push cũng phải bỏ, nếu không nó sinh `setProps { alt }` mà hợp
    // đồng `setProps` từ chối và cả batch hỏng.
    const ops = overrideToComponentOps('b1', { alt: 'lạc' }, button({ kind: 'none' }));
    expect(ops).toEqual([]);
  });

  it('không có node trong cây component thì không sinh op nào', () => {
    // `setProps` trên một nodeId không tồn tại ném `OpError`, tức cả batch hỏng
    // và không ghi đè nào được nâng — kể cả những cái đúng.
    expect(overrideToComponentOps('mat-tich', { href: '/moi' }, undefined)).toEqual([]);
  });
});
