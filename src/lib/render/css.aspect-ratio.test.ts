/**
 * `size.aspectRatio` — giá trị phải là CSS HỢP LỆ, không chỉ là "có mặt".
 *
 * ## Vì sao file này tồn tại
 *
 * Người dựng báo "đặt aspectRatio không ra `aspect-ratio` trong CSS". Đo lại thì
 * compiler CÓ phát declaration — nhưng phát ra `aspect-ratio: auto16/16`, và đó là
 * cú pháp SAI: trình duyệt vứt nguyên declaration, `getComputedStyle` trả `auto`.
 * Từ phía người dùng, "phát ra một declaration hỏng" và "không phát gì" là một.
 *
 * Grammar của thuộc tính này là `auto || <ratio>` — hai token TÁCH NHAU. `auto16/16`
 * dính liền thì `auto16` là một ident, không phải `auto` + số.
 *
 * ## Vì sao SỬA chứ không ném
 *
 * Đếm trên toàn bộ dữ liệu (4804 `PageVersion`, 95 `PresetVersion`, 6 preset đang
 * dùng) ngày 14/09/2026: chỉ có 10 giá trị khác nhau, 2 hợp lệ (`2752/1536`,
 * `458/718`) và 8 dạng `auto<w>/<h>` dính liền — di sản của bản migrate html→doc,
 * nằm trong header và footer, tức MỌI trang. Ném ở đó là làm trắng cả site để phạt
 * một dấu cách. Vá chỗ dính rồi ném cho phần còn lại: dữ liệu cũ sống, còn lỗi gõ
 * mới thì kêu ngay thay vì im lặng.
 *
 * ## Cảnh báo còn lại, không sửa được ở tầng renderer
 *
 * `auto <ratio>` trên một REPLACED element (ảnh) nghĩa là "ưu tiên tỉ lệ nội tại" —
 * nên kể cả sau khi vá, `auto152/44` vẫn để logo nở theo kích thước gốc. Muốn ghim
 * ô thì giá trị phải KHÔNG có `auto`, ví dụ `244 / 66`. Đó là việc của người dựng.
 */

import { describe, expect, it } from 'vitest';

import { CssCompileError, declarations } from './css';

const ar = (v: string) => Object.fromEntries(declarations({ size: { aspectRatio: v } }))['aspect-ratio'];

describe('size.aspectRatio → aspect-ratio', () => {
  it('giá trị hợp lệ đi qua NGUYÊN VĂN — kể cả khoảng trắng tác giả gõ', () => {
    expect(ar('16/9')).toBe('16/9');
    expect(ar('244 / 66')).toBe('244 / 66');
    expect(ar('2752/1536')).toBe('2752/1536');
    expect(ar('1')).toBe('1');
    expect(ar('auto')).toBe('auto');
    expect(ar('auto 16/9')).toBe('auto 16/9');
  });

  it('`auto` dính liền số được tách ra — nếu không, trình duyệt vứt cả declaration', () => {
    expect(ar('auto16/16')).toBe('auto 16/16');
    expect(ar('auto152/44')).toBe('auto 152/44');
    expect(ar('auto34/22')).toBe('auto 34/22');
  });

  it('giá trị không phải tỉ lệ thì KÊU, không âm thầm phát ra CSS chết', () => {
    for (const bad of ['cover', '16/9/4', 'auto auto', '16 9', 'auto16 9/2', '/9', '16/']) {
      expect(() => ar(bad), bad).toThrow(CssCompileError);
    }
  });

  it('rào chắn charset cũ vẫn đứng — không có đường ra declaration thứ hai', () => {
    expect(() => ar('1; background: url(javascript:alert(1))')).toThrow(CssCompileError);
  });

  it('không khai thì không phát', () => {
    expect(Object.fromEntries(declarations({ size: { width: 'full' } }))).not.toHaveProperty(
      'aspect-ratio',
    );
  });
});
