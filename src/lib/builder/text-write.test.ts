import { describe, expect, it } from 'vitest';

import { flatTextOf, textWriteOps } from './text-write';
import { instanceAddress } from './text-units';
import type { Node } from '@/lib/doc/types';

/**
 * Định tuyến op cho bốn trường chữ.
 *
 * Test này canh đúng một loại lỗi, và nó là loại KHÔNG báo gì khi sai: chọn op sai
 * vẫn ghi thành công, chỉ ghi vào chỗ khác. Nặng nhất là `setText` trên một node
 * local của component — nó sửa cây component, tức đổi mọi trang đang dùng, trong khi
 * người dùng chỉ định sửa chữ ở một trang.
 */
describe('textWriteOps', () => {
  it('content của node thường → setText với RichText phẳng', () => {
    const { ops } = textWriteOps({ address: 'n0000029', field: 'content', text: 'Xin chào' });
    expect(ops).toEqual([
      { op: 'setText', nodeId: 'n0000029', field: 'content', value: [{ t: 'text', v: 'Xin chào' }] },
    ]);
  });

  it('label của Button cũng đi qua setText', () => {
    const { ops } = textWriteOps({ address: 'btn1', field: 'label', text: 'Tải app' });
    expect(ops[0]).toMatchObject({ op: 'setText', field: 'label' });
  });

  it('alt là field thường của ImageNode → setProps, KHÔNG phải setText', () => {
    const { ops } = textWriteOps({ address: 'img1', field: 'alt', text: 'Ảnh hero' });
    expect(ops).toEqual([{ op: 'setProps', nodeId: 'img1', props: { alt: 'Ảnh hero' } }]);
  });

  it('a11yLabel ghi vào object a11y lồng', () => {
    const { ops } = textWriteOps({ address: 'x1', field: 'a11yLabel', text: 'Mở menu' });
    // Không có node thì chỉ có `label` để gửi. `setProps` THAY cả object `a11y`
    // (xem `nestedProps`), nên chỗ gọi phải truyền node để `role` sống sót — ca
    // đó nằm ở describe "object lồng phải gửi ĐỦ" bên dưới.
    expect(ops).toEqual([{ op: 'setProps', nodeId: 'x1', props: { a11y: { label: 'Mở menu' } } }]);
  });

  it('chữ TRONG instance đi qua setOverride, không chạm cây component', () => {
    const { ops } = textWriteOps({
      address: instanceAddress('inst1', 'local9'),
      field: 'content',
      text: 'Chữ riêng của trang này',
    });
    expect(ops).toEqual([
      {
        op: 'setOverride',
        nodeId: 'inst1',
        localId: 'local9',
        patch: { content: [{ t: 'text', v: 'Chữ riêng của trang này' }] },
      },
    ]);
    // Không có op nào chạm vào `local9` như một node của doc — đó mới là cây component.
    expect(ops.some((o) => 'nodeId' in o && o.nodeId === 'local9')).toBe(false);
  });

  it('alt trong instance vẫn là CHUỖI trong override, không phải RichText', () => {
    const { ops } = textWriteOps({
      address: instanceAddress('inst1', 'img9'),
      field: 'alt',
      text: 'Logo đối tác',
    });
    expect(ops[0]).toMatchObject({ patch: { alt: 'Logo đối tác' } });
  });

  it('nhãn history nói rõ đang sửa gì', () => {
    expect(textWriteOps({ address: 'n1', field: 'content', text: 'a' }).label)
      .toContain('n1.content');
  });
});

describe('flatTextOf', () => {
  it('đọc được đoạn phẳng', () => {
    expect(flatTextOf([{ t: 'text', v: 'một dòng' }])).toBe('một dòng');
  });

  it('từ chối RichText CÓ CẤU TRÚC — nếu không thì ghi ngược sẽ mất href', () => {
    expect(flatTextOf([{ t: 'link', href: '/tai-app', children: [{ t: 'text', v: 'Tải' }] }]))
      .toBeNull();
    expect(flatTextOf([{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }])).toBeNull();
    expect(flatTextOf([{ t: 'split', mode: 'words', children: [{ t: 'text', v: 'x' }] }]))
      .toBeNull();
  });

  it('rỗng và undefined đều là null, không phải chuỗi rỗng', () => {
    // Phân biệt quan trọng: chuỗi rỗng nghĩa là "sửa được, đang trống", còn `null`
    // nghĩa là "không sửa được bằng ô một dòng".
    expect(flatTextOf(undefined)).toBeNull();
    expect(flatTextOf([])).toBeNull();
  });
});

/**
 * Hai op ghi vào object LỒNG, và `setProps` THAY chứ không merge.
 *
 * `applyOne` làm `target[key] = value` (xem `doc/ops.ts`, nhánh `setProps`). Nên
 * gửi một object lồng thiếu khoá là XOÁ những khoá còn lại — không phải merge, dù
 * chú thích cũ ở `text-write.ts` khẳng định ngược lại.
 *
 * Hai hậu quả khác hạng nhau:
 *
 *  - `{ action: { href } }` tạo ra một Button KHÔNG có `kind`. Đó là một node mà
 *    `zNode` từ chối, tức `PageVersion` kế tiếp không đọc được — phá dữ liệu.
 *    Hợp đồng `setProps` mới bắt được ca này; xem
 *    `doc/validate-setprops-contract.test.ts`.
 *  - `{ a11y: { label } }` thì HỢP LỆ về hình dạng nên không tầng nào chặn, và nó
 *    im lặng xoá `a11y.role` cùng `a11y.labelledBy`.
 *
 * Luật đúng là luật mà renderer đã dùng cho instance: `{ ...cũ, khoá mới }` —
 * xem `applyOverride` trong `render/instance.ts`.
 */
describe('textWriteOps — object lồng phải gửi ĐỦ', () => {
  const linkBtn = {
    id: 'btn1',
    type: 'Button',
    label: [{ t: 'text', v: 'Tải app' }],
    action: { kind: 'link', href: '/cu', target: '_blank', rel: 'noopener' },
    variant: 'primary',
    parentId: 'root',
    children: [],
    effects: [],
    style: { base: {} },
    a11y: { role: 'button', label: 'Nhãn cũ', labelledBy: 'lbl1' },
  } as unknown as Node;

  it('href giữ nguyên `kind` — thiếu nó là một Button zNode từ chối', () => {
    const { ops } = textWriteOps({
      address: 'btn1',
      field: 'href',
      text: '/moi',
      node: linkBtn,
    });
    expect(ops).toEqual([
      {
        op: 'setProps',
        nodeId: 'btn1',
        props: { action: { kind: 'link', href: '/moi', target: '_blank', rel: 'noopener' } },
      },
    ]);
  });

  it('href KHÔNG làm mất `target`/`rel` — chúng là hành vi mở tab, không phải chữ', () => {
    const { ops } = textWriteOps({ address: 'btn1', field: 'href', text: '/moi', node: linkBtn });
    const props = (ops[0] as unknown as { props: { action: Record<string, unknown> } }).props;
    expect(props.action.target).toBe('_blank');
    expect(props.action.rel).toBe('noopener');
  });

  it('a11yLabel giữ `role` và `labelledBy`', () => {
    const { ops } = textWriteOps({
      address: 'x1',
      field: 'a11yLabel',
      text: 'Mở menu',
      node: linkBtn,
    });
    expect(ops).toEqual([
      {
        op: 'setProps',
        nodeId: 'x1',
        props: { a11y: { role: 'button', label: 'Mở menu', labelledBy: 'lbl1' } },
      },
    ]);
  });

  it('không có node thì href VẪN phải gửi `kind` — ô href chỉ hiện cho action link', () => {
    // `extractUnits` chỉ phát đơn vị `href` khi `action.kind === 'link'`, nên
    // `link` là giá trị đúng chứ không phải một phỏng đoán. Đây là đường lui để
    // chỗ gọi chưa truyền node không sinh ra node hỏng; nó vẫn mất `target`/`rel`.
    const { ops } = textWriteOps({ address: 'btn1', field: 'href', text: '/moi' });
    expect(ops).toEqual([
      { op: 'setProps', nodeId: 'btn1', props: { action: { kind: 'link', href: '/moi' } } },
    ]);
  });

  it('action KHÔNG phải link thì ô href không ghi gì — cùng luật với applyOverride', () => {
    const submitBtn = {
      ...(linkBtn as unknown as Record<string, unknown>),
      action: { kind: 'submit', formId: 'f1' },
    } as unknown as Node;
    const { ops } = textWriteOps({
      address: 'btn1',
      field: 'href',
      text: '/moi',
      node: submitBtn,
    });
    expect(ops).toEqual([]);
  });
});
