import { describe, expect, it } from 'vitest';

import { describeSave, type SaveState } from './save-state';

/**
 * Luật 1 của `3e`: "Ba trạng thái, ba chip. Không dùng chung một biến state cho
 * thành công và thất bại."
 *
 * Thứ đáng test ở đây KHÔNG phải ba chuỗi — mà là việc ba trạng thái **loại trừ
 * nhau**. Bản trước dùng `saving: boolean` + `lastError: string | null` là hai biến
 * rời, nên `saving && lastError` biểu diễn được, và `EditorShell.tsx:63` ghi lại
 * hậu quả: publish hỏng vẫn hiện chữ xanh. Union làm trạng thái đó không tồn tại,
 * và các test dưới đây khoá lại ba nhánh của nó.
 */

describe('describeSave', () => {
  it('đang lưu — không có version, vì chưa biết sẽ là bản nào', () => {
    expect(describeSave({ k: 'saving' })).toEqual({
      text: 'đang lưu…',
      tone: 'muted',
      retryable: false,
    });
  });

  it('đã lưu — mang số phiên bản để đối chiếu được với lịch sử', () => {
    expect(describeSave({ k: 'clean', seq: 41 })).toEqual({
      text: 'đã lưu · v41',
      tone: 'ok',
      retryable: false,
    });
  });

  it('đã lưu mà seq = null (chế độ sửa component) thì bỏ phần version, không hiện "vnull"', () => {
    expect(describeSave({ k: 'clean', seq: null })).toEqual({
      text: 'đã lưu',
      tone: 'ok',
      retryable: false,
    });
  });

  it('lỗi lưu — tone danger, bấm thử lại được, câu lỗi đầy đủ ở title', () => {
    const look = describeSave({
      k: 'error',
      message: 'Image cần alt, hoặc đặt decorative: true nếu là ảnh trang trí.',
      retry: [],
    });
    expect(look.tone).toBe('danger');
    expect(look.retryable).toBe(true);
    expect(look.text).toBe('lỗi lưu');
    // Câu lỗi KHÔNG vào `text`: chip bị `truncate`, nên một câu dài đẩy chữ "thử
    // lại" ra khỏi khung và nút biến mất khỏi mắt người dùng.
    expect(look.title).toBe('Image cần alt, hoặc đặt decorative: true nếu là ảnh trang trí.');
  });

  it('KHÔNG có trạng thái nào vừa ok vừa danger — ba nhánh loại trừ nhau', () => {
    const all: SaveState[] = [
      { k: 'saving' },
      { k: 'clean', seq: 1 },
      { k: 'error', message: 'x', retry: [] },
    ];
    const tones = all.map((s) => describeSave(s).tone);
    expect(new Set(tones).size).toBe(3);
  });
});
