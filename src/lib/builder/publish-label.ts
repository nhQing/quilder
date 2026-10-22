/**
 * Nhãn nút "Publish trang này".
 *
 * ## Vì sao đếm LẦN SỬA, không đếm chỗ đổi
 *
 * Cách nghĩ đầu tiên là đếm node thêm/mất/đổi chữ qua `diffDocs`. Nó sai ở đây:
 * `doc-diff.ts` **cố ý không so style** (docblock của nó gọi việc so style ở mức
 * thuộc tính là "một dự án riêng"). Nên người dùng đổi một màu rồi nhìn nút nói
 * "0 thay đổi", trong khi bấm vào thì site thật đổi thật. Một con số nói sai còn
 * tệ hơn không có con số.
 *
 * Đếm lần lưu thì không bao giờ nói `0` khi có thứ để đẩy — và nhãn nói đúng thứ
 * nó đếm: "3 lần sửa chưa publish". Chi tiết "thêm gì, mất gì" là việc của
 * "Xem diff" ở lát 3.
 *
 * ## Vì sao con số tính ở CLIENT
 *
 * Server gửi `baseSeq` một lần lúc tải trang; store biết `seq` hiện tại; hiệu là
 * con số. Nút phải cập nhật sau MỖI lần lưu, và một lần lưu xảy ra sau mỗi cú bấm
 * trong inspector — fetch lại nghĩa là mỗi cú bấm kéo theo một request chỉ để cập
 * nhật một con số.
 */

export interface PublishLook {
  text: string;
  disabled: boolean;
}

const BASE = 'Publish trang này';

export function publishLook(a: {
  /** Bản nháp đang mở. `null` ở chế độ sửa component. */
  seq: number | null;
  /** Bản đang nằm trong release đang chạy. `null` = trang chưa publish lần nào. */
  baseSeq: number | null;
}): PublishLook {
  if (a.seq === null) return { text: BASE, disabled: false };
  if (a.baseSeq === null) {
    return { text: `${BASE} · chưa publish lần nào`, disabled: false };
  }

  const ahead = a.seq - a.baseSeq;
  // `<= 0` chứ không `=== 0`: số của client có thể đã cũ hơn server (người khác vừa
  // publish), và một nhãn "-1 lần sửa" là cách nói "tôi không biết" bằng con số.
  if (ahead <= 0) return { text: BASE, disabled: true };

  return { text: `${BASE} · ${ahead} lần sửa chưa publish`, disabled: false };
}
