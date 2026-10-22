import { describe, expect, it } from 'vitest';

/**
 * Tính chất chịu lực: kết quả KHÔNG phụ thuộc múi giờ của máy đang chạy.
 *
 * Test này là cái bẫy đặt sẵn cho lần sau. Bỏ `timeZone` khỏi `when()` thì trên
 * máy dev Việt Nam mọi thứ vẫn xanh — đúng cách lỗi gốc đã lọt qua 275 test e2e —
 * nhưng ở đây nó đỏ ngay trên bất kỳ máy nào không ở UTC+7, kể cả CI chạy UTC.
 *
 * Vì vậy các chuỗi kỳ vọng được ghi THẲNG ra, không dựng lại bằng `toLocaleString`:
 * một kỳ vọng tự tính bằng chính hàm đang test thì luôn đúng và không chứng minh gì.
 */

import { DISPLAY_TZ, when } from './when';

describe('when', () => {
  it('cùng một chuỗi bất kể máy ở múi giờ nào', () => {
    // 2026-09-09T20:02:00Z là 03:02 ngày 10/09 ở UTC+7 — mốc vắt qua nửa đêm,
    // nên nó bắt được cả lỗi lệch NGÀY chứ không chỉ lệch giờ.
    expect(when('2026-09-09T20:02:00Z')).toBe('03:02 10/9/26');
  });

  it('mốc giữa ban ngày không đổi ngày', () => {
    expect(when('2026-09-10T04:30:00Z')).toBe('11:30 10/9/26');
  });

  it('nhận Date, không chỉ chuỗi ISO', () => {
    expect(when(new Date('2026-09-09T20:02:00Z'))).toBe('03:02 10/9/26');
  });

  it('chỗ gọi đổi được hình thức, nhưng không bỏ được múi giờ', () => {
    const opts = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } as const;
    expect(when('2026-09-09T20:02:00Z', opts)).toBe('03:02 10-09');

    // Cố tình đè `timeZone` từ chỗ gọi: hàm vẫn thắng.
    expect(when('2026-09-09T20:02:00Z', { ...opts, timeZone: 'UTC' })).toBe('03:02 10-09');
  });

  it('múi giờ hiển thị là một hằng số dùng chung', () => {
    expect(DISPLAY_TZ).toBe('Asia/Ho_Chi_Minh');
  });
});
