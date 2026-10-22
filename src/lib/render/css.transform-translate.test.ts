/**
 * `transform.translate` — CÓ được render, và cố ý KHÔNG nằm trong `transform`.
 *
 * ## Vì sao file này tồn tại dù không có gì phải sửa
 *
 * Có báo cáo rằng "renderer chỉ đọc `transform.x`/`y`, đặt `transform.translate.y`
 * thì `getComputedStyle` trả `transform: none`". Đo lại: compiler CÓ đọc
 * `translate`, nhưng phát ra property `translate` ĐỘC LẬP — nên `transform` đúng là
 * `none`, và đó là kết quả mong muốn chứ không phải lỗi. Lý do ghi ở `types.ts`
 * (`StyleProps.transform.translate`) và ở `css.ts`: GSAP sở hữu `transform` lúc
 * effect chạy, nên CSS khai `transform` là hai bên ghi đè nhau; tách sang
 * `translate` để vị trí tĩnh sống chung với animation.
 *
 * ## Vì sao KHÔNG bỏ `translate` khỏi schema
 *
 * Dữ liệu, không phải khẩu vị. Quét ngày 14/09/2026: trang chủ đang dùng
 * `transform.translate` ở hai node (`n0000045`, `n0000052`, cùng `-50% / -50%` —
 * mẫu căn giữa tuyệt đối kinh điển), và nó có mặt trong hàng nghìn `PageVersion`.
 * Bỏ khỏi schema là làm hỏng đúng trang quan trọng nhất của site.
 *
 * Test này khoá cả hai nửa lại: `translate` phải render, và nó KHÔNG được gộp vào
 * `transform`. Ai "sửa" theo hướng gộp sẽ thấy đỏ ngay tại đây, kèm lý do.
 */

import { describe, expect, it } from 'vitest';

import type { Doc, StackNode } from '@/lib/doc/types';
import { compileDoc, declarations } from './css';

const decl = (s: Parameters<typeof declarations>[0]) => Object.fromEntries(declarations(s));
const pct = (v: number) => ({ v, u: '%' as const });

describe('transform.translate', () => {
  it('render ra property `translate`, không phải `transform`', () => {
    const d = decl({ transform: { translate: { x: pct(-50), y: pct(-50) } } });
    expect(d.translate).toBe('-50% -50%');
    expect(d).not.toHaveProperty('transform');
  });

  it('chỉ một trục thì trục kia là 0 — `translate: -50%` trần nghĩa là chỉ trục X', () => {
    expect(decl({ transform: { translate: { y: pct(-50) } } }).translate).toBe('0 -50%');
    expect(decl({ transform: { translate: { x: pct(-50) } } }).translate).toBe('-50% 0');
  });

  it('`x`/`y` vẫn ra `transform` — hai đường riêng, cố ý', () => {
    const d = decl({ transform: { x: pct(-50), y: pct(-200) } });
    expect(d.transform).toBe('translateX(-50%) translateY(-200%)');
    expect(d).not.toHaveProperty('translate');
  });

  it('khai cả hai thì phát cả hai, KHÔNG cộng gộp và không nuốt nhau', () => {
    const d = decl({ transform: { y: pct(-200), translate: { y: pct(-50) }, scale: 1.2 } });
    expect(d.transform).toBe('translateY(-200%) scale(1.2)');
    expect(d.translate).toBe('0 -50%');
  });

  it('đi được tới stylesheet, không dừng ở `declarations()`', () => {
    const node = {
      id: 'n0000001',
      type: 'Stack',
      direction: { base: 'column' },
      parentId: null,
      children: [],
      effects: [],
      style: { base: { transform: { translate: { x: pct(-50), y: pct(-50) } } } },
    } as unknown as StackNode;
    const doc: Doc = { schemaVersion: 1, rootId: 'n0000001', nodes: { n0000001: node } };
    expect(compileDoc(doc).css).toContain('translate: -50% -50%;');
  });

  it('không khai thì không phát', () => {
    expect(decl({ transform: { origin: 'top left' } })).not.toHaveProperty('translate');
    expect(decl({ transform: { origin: 'top left' } })).not.toHaveProperty('transform');
  });
});
