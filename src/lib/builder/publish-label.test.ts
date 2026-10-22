import { describe, expect, it } from 'vitest';

import { publishLook } from './publish-label';

/**
 * Nhãn nút Publish.
 *
 * Con số này đếm **lần sửa chưa publish**, không đếm chỗ đổi — và nhãn phải nói
 * đúng thứ nó đếm. Lý do không đếm chỗ đổi nằm ở spec §1.4: `diffDocs` cố ý không
 * so style, nên "số thay đổi" sẽ nói `0` sau khi người dùng đổi một màu, trong khi
 * bấm Publish thì site thật đổi thật. Một con số nói sai còn tệ hơn không có con số.
 *
 * Mọi nhãn ở đây PHẢI còn chứa chữ `Publish`: `e2e/editor-safety.spec.ts:19` tìm
 * nút bằng `getByRole('button', { name: 'Publish' })`, và phép so đó là chuỗi con.
 */

describe('publishLook', () => {
  it('nháp đi trước bản đang chạy 3 bản → nói 3 lần sửa', () => {
    expect(publishLook({ seq: 44, baseSeq: 41 })).toEqual({
      text: 'Publish trang này · 3 lần sửa chưa publish',
      disabled: false,
    });
  });

  it('một lần sửa vẫn là "1 lần sửa" — không có dạng số ít riêng trong tiếng Việt', () => {
    expect(publishLook({ seq: 42, baseSeq: 41 })).toEqual({
      text: 'Publish trang này · 1 lần sửa chưa publish',
      disabled: false,
    });
  });

  it('chưa publish lần nào → nói thẳng thế, không nói "41 lần sửa"', () => {
    // baseSeq = null nghĩa là không có ReleaseEntry nào cho trang này. Số 41 ở đây
    // là tổng số bản nháp, không phải số thay đổi so với site thật — nói nó ra là
    // trả lời một câu hỏi người dùng không hỏi.
    expect(publishLook({ seq: 41, baseSeq: null })).toEqual({
      text: 'Publish trang này · chưa publish lần nào',
      disabled: false,
    });
  });

  it('nháp trùng bản đang chạy → không có gì để đẩy, nút tắt', () => {
    expect(publishLook({ seq: 41, baseSeq: 41 })).toEqual({
      text: 'Publish trang này',
      disabled: true,
    });
  });

  it('seq NHỎ HƠN baseSeq (số đã cũ) → coi như không có gì để đẩy, không hiện số âm', () => {
    // Xảy ra thật: người khác lưu rồi publish trong lúc mình đang mở trang, nên
    // `baseSeq` mà server gửi lúc tải trang đã đi trước `seq` của client.
    expect(publishLook({ seq: 40, baseSeq: 41 })).toEqual({
      text: 'Publish trang này',
      disabled: true,
    });
  });

  it('seq = null (chế độ sửa component) → nhãn trơn, không tắt nút', () => {
    // Nhánh này CÓ chạy thật: `EditorShell` giữ nút Publish trên màn khi sửa component
    // NGAY TRONG trang (chỉ `ComponentEditorShell` mới không có nút này), và ép
    // `savedSeq` về `null` lúc đó — xem guard của `lastSeq` trong `EditorShell.tsx`. Nút
    // vẫn hiện nên `publishLook` vẫn bị gọi với `seq: null`; `EditorShell` tự khoá nút
    // bằng `editing !== null` ở ngoài, chứ hàm này không biết gì về `editing` để tự tắt.
    // Rào ở đây là: nếu bị gọi, đừng hiện "vnull" và đừng tự tắt nút một cách bí ẩn.
    expect(publishLook({ seq: null, baseSeq: null })).toEqual({
      text: 'Publish trang này',
      disabled: false,
    });
  });

  it('mọi nhãn còn chứa chữ Publish — e2e tìm nút bằng chuỗi con đó', () => {
    const cases = [
      { seq: 44, baseSeq: 41 },
      { seq: 41, baseSeq: null },
      { seq: 41, baseSeq: 41 },
      { seq: null, baseSeq: null },
    ];
    for (const c of cases) expect(publishLook(c).text).toContain('Publish');
  });
});
