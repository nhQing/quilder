import { describe, expect, it } from 'vitest';

import { isUniqueCollision } from './unique-retry';

describe('isUniqueCollision', () => {
  it('nhận đúng P2002 trên ràng buộc mang tên cột đang xét', () => {
    expect(isUniqueCollision({ code: 'P2002', meta: { target: ['typeId', 'slug'] } }, 'slug')).toBe(true);
    expect(isUniqueCollision({ code: 'P2002', meta: { target: ['typeKey', 'key'] } }, 'key')).toBe(true);
  });

  it('P2002 trên ràng buộc KHÁC thì không tính — đây là lý do hàm này tồn tại', () => {
    // Chỉ kiểm mã lỗi thì ta thử lại vô nghĩa rồi trả một thông báo nói sai chuyện.
    expect(isUniqueCollision({ code: 'P2002', meta: { target: ['email'] } }, 'slug')).toBe(false);
  });

  it('mã lỗi khác thì không tính, dù target có trùng tên', () => {
    // Một lỗi kết nối DB bị biến thành "đường dẫn bị chiếm" làm người sửa tìm sai chỗ.
    expect(isUniqueCollision({ code: 'P1001', meta: { target: ['slug'] } }, 'slug')).toBe(false);
  });

  it('target là chuỗi, không phải mảng, vẫn đọc được', () => {
    expect(isUniqueCollision({ code: 'P2002', meta: { target: 'Entry_typeId_slug_key' } }, 'slug')).toBe(true);
  });

  it('không ném với đầu vào lạ', () => {
    expect(isUniqueCollision(null, 'slug')).toBe(false);
    expect(isUniqueCollision('rác', 'slug')).toBe(false);
    expect(isUniqueCollision({ code: 'P2002' }, 'slug')).toBe(false);
  });
});
