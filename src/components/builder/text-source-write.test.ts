import { describe, expect, it } from 'vitest';

import { sourceWriteFor as panelWrite } from './ContentPanel';
import { sourceWriteFor as tableWrite } from './TextTable';
import type { TextUnit } from '@/lib/builder/text-units';
import type { Doc, Node } from '@/lib/doc/types';

/**
 * Hai bề mặt sửa chữ phải GỬI ĐỦ object lồng, không chỉ `text-write.ts`.
 *
 * ## Vì sao một test ở tầng `text-write.ts` là chưa đủ
 *
 * `textWriteOps` đã được vá và `text-write.test.ts` đã khoá hành vi đúng lại. Nhưng
 * tham số `node` ở đó là TUỲ CHỌN — chỗ gọi nằm ngoài bề mặt của làn sửa trước.
 * Một đối số thiếu không phải lỗi biên dịch, không phải test đỏ, và đọc mã thì
 * `textWriteOps({ address, field, text })` trông hoàn toàn bình thường. Hệ quả vẫn
 * y nguyên như trước khi vá: sửa một đường dẫn hay một nhãn a11y qua ô dịch thì
 * `action.target`, `action.rel`, `a11y.role`, `a11y.labelledBy` bị xoá sạch, vì
 * `setProps` THAY chứ không merge (`applyOne` làm `target[key] = value`).
 *
 * Nên phép đo phải đặt ở CHỖ GỌI, và đo đúng cái op sẽ được gửi đi.
 *
 * ## Vì sao không render component
 *
 * `vitest.config.ts` chạy `environment: 'node'`, và hai component này đọc store,
 * `useRouter`, `fetch`. Đối tượng test đúng không phải cái `<textarea>` mà là phép
 * dựng op — nên nó được tách thành hàm thuần và export, cùng khuôn với `attachInert`
 * trong `Canvas.tsx`.
 */

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

const unit = (nodeId: string, field: TextUnit['field']): TextUnit =>
  ({
    nodeId,
    field,
    nodeType: 'Button',
    kind: 'nút',
    path: 'root › btn1',
    text: '',
    flat: true,
    locked: false,
  }) as TextUnit;

const doc = { schemaVersion: 1, rootId: 'root', nodes: { btn1: linkBtn } } as unknown as Doc;
const nodes = { btn1: linkBtn };

/** `props` của op `setProps` đầu tiên. */
const propsOf = (ops: { ops: unknown[] }) =>
  (ops.ops[0] as { props: Record<string, Record<string, unknown>> }).props;

describe.each([
  ['ContentPanel', (u: TextUnit, text: string) => panelWrite(doc, u, text)],
  ['TextTable', (u: TextUnit, text: string) => tableWrite(nodes, u, text)],
])('%s.sourceWriteFor', (_name, write) => {
  it('sửa href giữ nguyên `target` và `rel`', () => {
    // Mất chúng là một cái nút đang mở tab mới bỗng mở cùng tab, và `rel` biến
    // mất kéo theo một lỗ bảo mật `window.opener`. Không tầng nào chặn được vì
    // op vẫn hợp lệ về hình dạng.
    const props = propsOf(write(unit('btn1', 'href'), '/moi'));
    expect(props.action).toEqual({
      kind: 'link', href: '/moi', target: '_blank', rel: 'noopener',
    });
  });

  it('sửa a11yLabel giữ nguyên `role` và `labelledBy`', () => {
    const props = propsOf(write(unit('btn1', 'a11yLabel'), 'Mở menu'));
    expect(props.a11y).toEqual({ role: 'button', label: 'Mở menu', labelledBy: 'lbl1' });
  });

  it('node KHÔNG phải link thì ô href không ghi gì — cùng luật với applyOverride', () => {
    // Không truyền `node` xuống thì `textWriteOps` phải đoán `kind: 'link'`, và
    // op sẽ dựng một action lai trên một nút `submit`. Test này đỏ đúng khi chỗ
    // gọi bỏ quên `node`.
    const submitBtn = { ...(linkBtn as unknown as Record<string, unknown>),
      id: 'btn2', action: { kind: 'submit', formId: 'f1' } } as unknown as Node;
    const submitDoc = { ...doc, nodes: { btn2: submitBtn } } as unknown as Doc;
    const write2 =
      _name === 'ContentPanel'
        ? (u: TextUnit, t: string) => panelWrite(submitDoc, u, t)
        : (u: TextUnit, t: string) => tableWrite({ btn2: submitBtn }, u, t);

    expect(write2(unit('btn2', 'href'), '/moi').ops).toEqual([]);
  });

  it('chữ trong instance vẫn đi `setOverride` — địa chỉ lồng không có trong map node', () => {
    // Đơn vị trong instance có địa chỉ `instanceId/localId`, không phải khoá của
    // `doc.nodes`. Tra ra `undefined` là ĐÚNG, và `textWriteOps` rẽ nhánh trước
    // khi chạm tới `node`. Nếu chỗ gọi "chữa" bằng cách tra theo `localId` thì op
    // sẽ ghi thẳng vào cây component — đổi mọi trang đang dùng nó.
    const { ops } = write(unit('inst1/local9', 'content'), 'Chữ riêng');
    expect(ops).toEqual([
      {
        op: 'setOverride',
        nodeId: 'inst1',
        localId: 'local9',
        patch: { content: [{ t: 'text', v: 'Chữ riêng' }] },
      },
    ]);
  });
});
