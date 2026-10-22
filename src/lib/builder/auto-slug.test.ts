import { describe, expect, it } from 'vitest';

import { autoSlugState } from './auto-slug';

describe('autoSlugState', () => {
  it('auto: ô slug đi theo tiêu đề, không có nút Tạo lại', () => {
    expect(autoSlugState({ title: 'Lãi suất tháng 8', slug: '', manual: false, titleChanged: true })).toEqual({
      suggestion: 'lai-suat-thang-8',
      value: 'lai-suat-thang-8',
      canRegenerate: false,
    });
  });

  it('auto: tiêu đề toàn ký tự lạ thì để trống, không dựng slug rác', () => {
    const s = autoSlugState({ title: '!!! ???', slug: '', manual: false, titleChanged: true });
    expect(s.value).toBe('');
    expect(s.canRegenerate).toBe(false);
  });

  it('manual: giữ nguyên thứ người dùng gõ, không chuẩn hoá giữa chừng', () => {
    const s = autoSlugState({ title: 'Tin tức', slug: 'tin-tuc-2', manual: true, titleChanged: true });
    expect(s.value).toBe('tin-tuc-2');
  });

  it('manual + tiêu đề đã lệch: hiện nút Tạo lại kèm gợi ý', () => {
    const s = autoSlugState({ title: 'Bảng lãi suất mới', slug: 'lai-suat-cu', manual: true, titleChanged: true });
    expect(s.canRegenerate).toBe(true);
    expect(s.suggestion).toBe('bang-lai-suat-moi');
  });

  it('manual + đang khớp: KHÔNG hiện nút', () => {
    const s = autoSlugState({ title: 'Tin tức', slug: 'tin-tuc', manual: true, titleChanged: true });
    expect(s.canRegenerate).toBe(false);
  });

  /*
   * Một cái nút không làm gì cả là cái nút dạy người ta bỏ qua nút. Người dùng gõ
   * dở "Tin Tức" vào ô slug thì `toSlug` hai phía cho cùng kết quả — không đề nghị.
   */
  it('manual: không hiện nút khi khác biệt sẽ tự biến mất lúc lưu', () => {
    const s = autoSlugState({ title: 'Tin tức', slug: 'Tin Tức', manual: true, titleChanged: true });
    expect(s.canRegenerate).toBe(false);
  });

  it('manual + tiêu đề rỗng: không đề nghị một slug rỗng', () => {
    const s = autoSlugState({ title: '', slug: 'tin-tuc', manual: true, titleChanged: true });
    expect(s.canRegenerate).toBe(false);
  });

  /*
   * Đây là ca đã làm e2e đỏ, và nó là cái bẫy chính của tính năng này.
   *
   * Trang chủ có slug RỖNG và đó là giá trị đúng. Một luật "slug khác tiêu đề thì
   * đề nghị" sẽ treo nút "Tạo lại → /trang-chu" lên trang chủ vĩnh viễn, và mời
   * người dùng phá địa chỉ gốc của site. Cùng cách hỏng đó xảy ra với mọi trang
   * đặt slug riêng: "Về chúng tôi" ở `/about`.
   */
  it('manual + chưa đổi tiêu đề: KHÔNG đề nghị, dù slug khác hẳn tiêu đề', () => {
    const home = autoSlugState({ title: 'Trang chủ', slug: '', manual: true, titleChanged: false });
    expect(home.canRegenerate).toBe(false);

    const about = autoSlugState({
      title: 'Về chúng tôi', slug: 'about', manual: true, titleChanged: false,
    });
    expect(about.canRegenerate).toBe(false);
  });

  /*
   * Ô "đường dẫn riêng theo ngôn ngữ": trống nghĩa là CHƯA CÓ, không phải một địa
   * chỉ đang sống. Điền hộ ở đó không phá gì cả, nên vẫn đề nghị.
   */
  it('offerWhenEmpty: đề nghị khi ô trống dù tiêu đề chưa đổi', () => {
    const s = autoSlugState({
      title: 'Interest rates', slug: '', manual: true, titleChanged: false, offerWhenEmpty: true,
    });
    expect(s.canRegenerate).toBe(true);
    expect(s.suggestion).toBe('interest-rates');
  });

  it('offerWhenEmpty: ô đã có giá trị thì lại im, chờ tiêu đề đổi', () => {
    const s = autoSlugState({
      title: 'Interest rates', slug: 'rates', manual: true, titleChanged: false,
      offerWhenEmpty: true,
    });
    expect(s.canRegenerate).toBe(false);
  });
});
