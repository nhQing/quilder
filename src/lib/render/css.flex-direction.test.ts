/**
 * `layout.flexDirection` phải sinh ra `flex-direction`.
 *
 * Vì sao có file riêng cho một property: trước đây trục chính của flex container
 * chỉ tồn tại ở `Stack.direction` — một field CÓ trong schema, CÓ trong doc, mà
 * compiler chưa bao giờ đọc. Không test nào nổ, không cảnh báo nào bật; nó chỉ
 * lặng lẽ không có tác dụng. Hậu quả đo được trên trang chủ: 27 container đáng lẽ
 * xếp dọc thì xếp ngang, và ở viewport 390 trang tràn ngang 424px.
 *
 * Đó là dạng lỗi mà một dòng test rẻ hơn nhiều so với một buổi truy vết.
 */

import { describe, expect, it } from 'vitest';

import { declarations } from './css';

const decl = (s: Parameters<typeof declarations>[0]) =>
  Object.fromEntries(declarations(s));

describe('layout.flexDirection', () => {
  it('sinh ra flex-direction cho cả bốn giá trị', () => {
    for (const v of ['row', 'column', 'row-reverse', 'column-reverse'] as const) {
      expect(decl({ layout: { display: 'flex', flexDirection: v } })['flex-direction']).toBe(v);
    }
  });

  it('không khai thì không phát — để CSS tĩnh và mặc định của trình duyệt tự lo', () => {
    expect(decl({ layout: { display: 'flex' } })).not.toHaveProperty('flex-direction');
  });

  it('đi kèm display, không thay thế nó', () => {
    const d = decl({ layout: { display: 'flex', flexDirection: 'column', gap: { v: 8, u: 'px' } } });
    expect(d.display).toBe('flex');
    expect(d['flex-direction']).toBe('column');
    expect(d.gap).toBe('8px');
  });
});
