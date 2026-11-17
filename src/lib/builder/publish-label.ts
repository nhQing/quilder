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

/**
 * `extra` (17/11/2026): thay đổi NGOÀI cây node — bản dịch và component — mà `seq` không
 * thấy. Thiếu nó thì trang chỉ có bản tiếng Anh mới bị coi là "không có gì để đẩy" và
 * nút mờ, dù bấm Publish sẽ đổi site thật. Xem `lib/publish/pending-extra.ts`.
 */
export function publishLook(a: {
  /** Bản nháp đang mở. `null` ở chế độ sửa component. */
  seq: number | null;
  /** Bản đang nằm trong release đang chạy. `null` = trang chưa publish lần nào. */
  baseSeq: number | null;
  /** Bản dịch / component khác bản đang chạy — do server đếm lúc tải trang. */
  extra?: { translations: number; components: number };
}): PublishLook {
  if (a.seq === null) return { text: BASE, disabled: false };
  if (a.baseSeq === null) {
    return { text: `${BASE} · chưa publish lần nào`, disabled: false };
  }

  // `<= 0` thì coi như không có lần sửa nào: số của client có thể đã cũ hơn server
  // (người khác vừa publish), và một nhãn "-1 lần sửa" là cách nói "tôi không biết".
  const ahead = a.seq - a.baseSeq;
  const parts: string[] = [];
  if (ahead > 0) parts.push(`${ahead} lần sửa`);
  if (a.extra?.translations) parts.push(`${a.extra.translations} bản dịch`);
  if (a.extra?.components) parts.push(`${a.extra.components} component`);

  if (!parts.length) return { text: BASE, disabled: true };
  return { text: `${BASE} · ${parts.join(', ')} chưa publish`, disabled: false };
}
