import { describe, expect, it } from 'vitest';

import type { FieldDef } from './field-def';
import {
  checkRequiredTaxonomy,
  deriveSlug,
  isSlugCollision,
  needsDraftGate,
  uniqueSlug,
} from './entry-write';

describe('uniqueSlug', () => {
  it('trả nguyên slug khi chưa ai dùng', () => {
    expect(uniqueSlug('lai-suat', [])).toBe('lai-suat');
  });

  it('thêm hậu tố -2 khi trùng', () => {
    expect(uniqueSlug('lai-suat', ['lai-suat'])).toBe('lai-suat-2');
  });

  it('đếm tiếp khi -2 cũng trùng', () => {
    expect(uniqueSlug('lai-suat', ['lai-suat', 'lai-suat-2'])).toBe('lai-suat-3');
  });

  it('slug rỗng thành "muc" — không bao giờ trả rỗng', () => {
    // Rỗng là slug HỢP LỆ của trang chủ, nhưng với entry thì nó tạo ra URL
    // /tin-tuc/ trùng trang danh sách.
    expect(uniqueSlug('', [])).toBe('muc');
  });
});

describe('deriveSlug', () => {
  const fields: FieldDef[] = [
    { t: 'text', key: 'title', label: 'Tiêu đề' },
    { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
  ];

  it('sinh từ field mà slug khai `from`, bỏ dấu tiếng Việt', () => {
    expect(deriveSlug(fields, { title: 'Lãi suất tháng 8' })).toBe('lai-suat-thang-8');
  });

  it('slug đã có giá trị thì tôn trọng nó, không sinh lại', () => {
    // Người dùng bấm "Sửa tay" rồi tự đặt. Sinh lại ở đây là ghi đè lựa chọn của
    // họ mỗi lần họ sửa tiêu đề.
    expect(deriveSlug(fields, { title: 'Tiêu đề mới', slug: 'duong-dan-cu' })).toBe('duong-dan-cu');
  });

  it('loại không có field slug thì trả rỗng', () => {
    expect(deriveSlug([{ t: 'text', key: 'a', label: 'A' }], { a: 'x' })).toBe('');
  });

  it('field nguồn trống thì trả rỗng, để chỗ gọi quyết định', () => {
    expect(deriveSlug(fields, {})).toBe('');
  });
});

describe('isSlugCollision', () => {
  it('nhận đúng P2002 trên ràng buộc có chữ slug', () => {
    expect(isSlugCollision({ code: 'P2002', meta: { target: ['typeId', 'slug'] } })).toBe(true);
  });

  it('P2002 trên ràng buộc KHÁC thì không phải đụng slug', () => {
    // Nhầm ở đây nghĩa là thử lại vô nghĩa, rồi trả một thông báo nói sai chuyện.
    expect(isSlugCollision({ code: 'P2002', meta: { target: ['email'] } })).toBe(false);
  });

  it('mã lỗi khác thì không phải đụng slug', () => {
    // Lỗi kết nối DB bị biến thành "đường dẫn bị chiếm" làm người sửa đi tìm sai chỗ.
    expect(isSlugCollision({ code: 'P1001', meta: { target: ['slug'] } })).toBe(false);
  });

  it('không ném với đầu vào lạ', () => {
    expect(isSlugCollision(null)).toBe(false);
    expect(isSlugCollision('rác')).toBe(false);
    expect(isSlugCollision({ code: 'P2002' })).toBe(false);
  });
});

describe('checkRequiredTaxonomy', () => {
  const fields: FieldDef[] = [
    { t: 'text', key: 'title', label: 'Tiêu đề' },
    { t: 'taxonomy', key: 'cats', label: 'Danh mục', required: true, multiple: true },
  ];

  it('bắt buộc mà không gắn danh mục nào thì bị từ chối', () => {
    // Phép kiểm này không thể sống ở `zEntryData`: giá trị không nằm trong `data`, nên
    // validator của `data` nhận một entry thiếu danh mục mà không thấy gì sai.
    expect(checkRequiredTaxonomy(fields, undefined).ok).toBe(false);
    expect(checkRequiredTaxonomy(fields, []).ok).toBe(false);
  });

  it('gắn ít nhất một là đủ', () => {
    expect(checkRequiredTaxonomy(fields, ['t1']).ok).toBe(true);
  });

  it('không có field taxonomy bắt buộc thì rỗng cũng được', () => {
    const optional: FieldDef[] = [{ t: 'taxonomy', key: 'cats', label: 'Danh mục' }];
    expect(checkRequiredTaxonomy(optional, []).ok).toBe(true);
  });

  it('câu lỗi nêu label khi có nhiều ô bắt buộc, để người dùng biết ô nào', () => {
    const two: FieldDef[] = [
      { t: 'taxonomy', key: 'cats', label: 'Danh mục', required: true },
      { t: 'taxonomy', key: 'tags', label: 'Chủ đề', required: true },
    ];
    const r = checkRequiredTaxonomy(two, []);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('Chủ đề');
  });

  it('thông báo là tiếng Việt', () => {
    const r = checkRequiredTaxonomy(fields, []);
    expect(r.ok === false && r.error).toBe('Phải chọn ít nhất một danh mục');
  });
});

describe('needsDraftGate', () => {
  /*
   * Cặp test này khoá lại một luật mà nhìn code rất dễ tưởng là một luật khác:
   * `requireDraft` KHÔNG có nghĩa "chỉ ghi được vào bài nháp", mà là "chỉ ghi được
   * NỘI DUNG BẢN GỐC vào bài nháp".
   *
   * Thiếu nó thì lần refactor sau sẽ gộp hai điều kiện lại thành `if (requireDraft
   * && status !== 'draft')` — ngắn hơn, đọc hợp lý hơn, và làm mọi bài đã đăng thành
   * không dịch được. Đúng thứ MCP tồn tại để làm.
   */

  it('ghi i18n vào bài đã đăng KHÔNG qua cửa nháp', () => {
    // Bản dịch chưa ai thấy. Chặn nó nghĩa là muốn dịch một bài đang chạy thì phải
    // hạ bài xuống nháp — tức là tự tay làm site sập một khoảng để dịch.
    expect(needsDraftGate({ requireDraft: true, i18n: { en: { title: 'Rates' } } })).toBe(false);
  });

  it('ghi data thì PHẢI qua cửa nháp', () => {
    // Nội dung bản gốc của bài đang chạy trên site. Đây là thứ cửa được dựng để giữ.
    expect(needsDraftGate({ requireDraft: true, data: { title: 'Lãi suất' } })).toBe(true);
  });

  it('đổi danh mục cũng phải qua cửa', () => {
    // `taxonomyIds` không nằm trong `data` nên rất dễ bị bỏ sót. Nhưng đổi danh mục
    // của một bài đã đăng là đổi trang danh mục đang chạy.
    expect(needsDraftGate({ requireDraft: true, taxonomyIds: ['t1'] })).toBe(true);
  });

  it('i18n kèm data thì cửa vẫn đóng — không cho đi kèm để lách', () => {
    expect(needsDraftGate({ requireDraft: true, i18n: {}, data: {} })).toBe(true);
  });

  it('không có requireDraft thì không có cửa nào', () => {
    // Đường người dùng (builder). Cửa chỉ dựng cho token máy.
    expect(needsDraftGate({ data: {} })).toBe(false);
    expect(needsDraftGate({ requireDraft: false, data: {} })).toBe(false);
  });

  it('data là null vẫn tính là chạm — chỉ `undefined` mới là "không đổi"', () => {
    // `args.data !== undefined`, không phải `args.data`. Một `null` lọt qua cửa là
    // một lượt xoá nội dung bài đã đăng đi qua cổng không ai canh.
    expect(needsDraftGate({ requireDraft: true, data: null })).toBe(true);
  });
});
