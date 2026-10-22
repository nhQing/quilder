import { describe, expect, it } from 'vitest';

import { len } from './css';
import { zLen } from '@/lib/doc/schema';

/**
 * `{ unset: true }` — xoá giá trị mà layer dưới đã đặt.
 *
 * Trạng thái thứ ba mà `Style` trước đây không diễn đạt được: một layer responsive
 * chỉ nói được "ghi đè" (có key) và "kế thừa" (không có key). Thiếu "ở khổ này bỏ
 * hẳn thứ base đặt".
 *
 * `RuleSet` của Plasmic phân biệt đủ ba (docs/BENCHMARK.md §1.1).
 */

describe('len({ unset: true })', () => {
  it('biên dịch thành `unset`', () => {
    expect(len({ unset: true })).toBe('unset');
  });

  it('KHÔNG phải `initial`', () => {
    // `initial` cắt luôn phần kế thừa từ cha với thuộc tính kế thừa (`color`,
    // `font-size`), tức làm nhiều hơn thứ người dùng yêu cầu. `unset` cư xử như
    // `inherit` cho thuộc tính kế thừa và `initial` cho thuộc tính không kế thừa —
    // đúng nghĩa "quên thứ base đặt, giữ nguyên phần còn lại của cascade".
    expect(len({ unset: true })).not.toBe('initial');
    expect(len({ unset: true })).not.toBe('revert');
  });

  it('lồng trong clamp/max/min vẫn ra `unset` ở đúng vị trí', () => {
    // Không có ý nghĩa thực tế, nhưng nó phải không ném: nhánh sentinel được kiểm
    // TRƯỚC `'clamp' in v`, nên nó không bao giờ rơi xuống nhánh phép tính.
    expect(len({ max: [{ unset: true }, { v: 10, u: 'px' }] })).toContain('unset');
  });
});

describe('zLen nhận { unset: true }', () => {
  it('chấp nhận', () => {
    expect(zLen.safeParse({ unset: true }).success).toBe(true);
  });

  it('TỪ CHỐI { unset: false } — nó không có nghĩa nào', () => {
    // Nhận nó là mời người ta viết ra rồi ngạc nhiên khi không có gì xảy ra.
    expect(zLen.safeParse({ unset: false }).success).toBe(false);
  });

  it('TỪ CHỐI trường lạ kèm theo', () => {
    expect(zLen.safeParse({ unset: true, v: 10 }).success).toBe(false);
  });

  it('không phá các nhánh cũ', () => {
    expect(zLen.safeParse({ v: 24, u: 'px' }).success).toBe(true);
    expect(zLen.safeParse({ $token: 'space-m' }).success).toBe(true);
    expect(zLen.safeParse({ clamp: [{ v: 1, u: 'px' }, { v: 2, u: 'px' }, { v: 3, u: 'px' }] }).success).toBe(true);
  });
});
