import { describe, expect, it } from 'vitest';

import { pageOptionLabel } from './TextPagePicker';

describe('pageOptionLabel — nhãn trang trong ô chọn của màn Văn bản', () => {
  it('tiêu đề kèm đường dẫn; trang chủ là "/"', () => {
    expect(pageOptionLabel({ title: 'Sự kiện MaiMoney', slug: 'events' })).toBe('Sự kiện MaiMoney — /events');
    expect(pageOptionLabel({ title: 'MaiMoney', slug: '' })).toBe('MaiMoney — /');
    expect(pageOptionLabel({ title: 'Chi tiết', slug: '/blogs/post/[slug]' })).toBe('Chi tiết — /blogs/post/[slug]');
  });

  it('trang chưa đặt tiêu đề vẫn có nhãn đọc được', () => {
    expect(pageOptionLabel({ title: '', slug: 'nhap' })).toBe('(chưa đặt tiêu đề) — /nhap');
  });
});
