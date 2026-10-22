/**
 * Cuộn tới một node — phần TÍNH TOÁN, tách khỏi DOM để test được bằng số.
 *
 * ## Vì sao có file này
 *
 * Chọn một node từ NGOÀI khung xem trước (hàng ở cây Lớp, một dòng trong danh sách
 * Cảnh báo chất lượng, link "Mở node" của bảng Văn bản) thì khung chọn được vẽ đúng
 * chỗ — nhưng chỗ đó thường nằm ngoài màn hình, và người dùng thấy **không có gì
 * đổi**. Đây là lỗi người dùng báo ngày 19/08/2026 ("không hiển thị rõ ràng được node
 * đang nằm ở đâu"), đã sửa bằng phép kéo `pan` ở canvas kéo–phóng — rồi mất theo đúng
 * canvas đó khi nó bị thay bằng một khung cuộn dọc cùng ngày (commit 8561300). Khung
 * mới cuộn bằng thanh cuộn THẬT bên trong iframe, nên phép kéo cũ không còn gì để
 * kéo, và không ai viết lại nó cho cách cuộn mới.
 *
 * `Canvas.tsx` lo phần DOM (tìm phần tử, đo, gọi `scrollTo`). Ở đây chỉ có câu hỏi
 * "trên MỘT trục, cuộn tới đâu", vì đó là chỗ dễ sai lặng lẽ nhất: lệch một dấu là
 * khung nhảy đi chỗ khác mà vẫn "có cuộn".
 */

import type { Doc, NodeId } from '@/lib/doc/types';

/** Một đoạn trên một trục, toạ độ theo KHUNG NHÌN (như `getBoundingClientRect`). */
export interface Span {
  start: number;
  size: number;
}

/** Khung nhìn của một vùng cuộn trên cùng trục đó. */
export interface Viewport {
  /** Bề dài phần nhìn thấy (`innerHeight`, `clientHeight`…). */
  size: number;
  /** Vị trí cuộn hiện tại. */
  scroll: number;
  /** Vị trí cuộn lớn nhất (`scrollHeight - clientHeight`). */
  max: number;
}

/**
 * Vị trí cuộn mới để `item` hiện ra trong `view`, hoặc `null` nếu KHÔNG cần cuộn.
 *
 * ## Vì sao "không cần" là một kết quả, không phải `view.scroll`
 *
 * Node đang thấy rõ mà vẫn cuộn — dù chỉ căn lại vài pixel — là giật màn hình vì một
 * lý do không có. Bấm lại đúng hàng đang chọn hai lần không được làm khung trôi.
 *
 * ## Hai trường hợp, theo kích thước
 *
 *  - **Lọt khung** (cao không quá khung trừ hai lề): đã thấy trọn vẹn thì để yên; nếu
 *    không thì đưa vào GIỮA. Giữa chứ không sát mép: sát mép thì nhãn id của khung
 *    chọn (nằm trên viền) và phần xung quanh — thứ cho biết node nằm ở đâu — bị cắt.
 *  - **Cao hơn khung** (một section dài): đưa ĐỈNH lên, cách mép một lề. Căn giữa một
 *    khối cao hơn khung là để khung nhìn nằm gọn trong lòng nó — viền không thấy,
 *    nhãn không thấy, tức đúng tình trạng "không biết node ở đâu" vừa sửa. Đỉnh đã
 *    nằm ở nửa trên khung thì để yên: phần còn lại của khối đã lấp phần dưới.
 *
 * `margin` bị kẹp về tối đa một phần tư khung: khung thấp (khổ điện thoại trong pane
 * thấp) mà lề cố định 24px thì có thể chẳng còn chỗ nào "lọt".
 *
 * Kết quả đã kẹp vào `[0, max]` và làm tròn; lệch dưới 1px coi như không cần cuộn.
 */
export function revealScroll(item: Span, view: Viewport, margin: number): number | null {
  if (!(view.size > 0) || !Number.isFinite(item.start) || !Number.isFinite(item.size)) return null;

  const m = Math.max(0, Math.min(margin, view.size / 4));
  const end = item.start + item.size;

  let target: number;
  if (item.size <= view.size - 2 * m) {
    if (item.start >= m && end <= view.size - m) return null;
    target = view.scroll + item.start + item.size / 2 - view.size / 2;
  } else {
    if (item.start >= m && item.start <= view.size / 2) return null;
    target = view.scroll + item.start - m;
  }

  const clamped = Math.round(Math.max(0, Math.min(Math.max(0, view.max), target)));
  return Math.abs(clamped - view.scroll) < 1 ? null : clamped;
}

/**
 * Điểm bắt đầu lướt: cách đích tối đa `reach`, ở PHÍA người dùng đang đứng.
 *
 * ## Vì sao không lướt suốt cả quãng
 *
 * Đo trên trang chủ (11.500px), `scrollTo({ behavior: 'smooth' })` từ đầu trang tới
 * một node ở y≈10.000 mất ~1,5 giây — trình duyệt kéo dài thời gian theo quãng
 * đường. Một giây rưỡi nhìn trang trôi qua sau mỗi cú bấm ở cây Lớp là chậm, và trong
 * lúc trôi thì khung chọn chưa tới chỗ để nhìn. Nhảy thẳng thì mất cảm giác hướng —
 * không biết node nằm trên hay dưới chỗ vừa đứng.
 *
 * Nên: nhảy tức thì tới cách đích một màn, rồi lướt màn cuối. Hướng vẫn đọc được, và
 * quãng lướt luôn ngắn bất kể trang dài bao nhiêu. Quãng ngắn hơn `reach` thì lướt
 * từ chỗ đang đứng như thường (trả lại `from`).
 */
export function glideStart(from: number, to: number, reach: number): number {
  if (!(reach > 0) || Math.abs(to - from) <= reach) return from;
  return to - Math.sign(to - from) * reach;
}

/**
 * Kẹp một đoạn vào `[0, limit]` — phần của nó nằm TRONG một khung cố định.
 *
 * Dùng khi quy đổi từ khung trong iframe ra pane ngoài: phần của node nằm ngoài
 * khung iframe thì đằng nào cũng không thấy được từ pane (khung cắt nó), nên cuộn
 * pane theo phần đó là cuộn tới một chỗ trống.
 */
export function clipSpan(item: Span, limit: number): Span {
  const start = Math.max(0, Math.min(limit, item.start));
  const end = Math.max(0, Math.min(limit, item.start + item.size));
  return { start, size: end - start };
}

/**
 * Thứ tự thử khi tìm chỗ để cuộn tới: chính node, rồi cha, rồi ông… lên tới gốc.
 *
 * Node được chọn có thể KHÔNG có mặt trong khung: `render: false` (nút mắt) hay một
 * tổ tiên đang ẩn làm `NodeRenderer` trả `null` cho cả nhánh, nên không có phần tử
 * `[data-n]` nào để đo. Lúc đó tổ tiên gần nhất CÓ render là câu trả lời đúng nhất cho
 * "node này nằm ở đâu" — chỗ nó sẽ hiện ra nếu được bật lại.
 *
 * Có trần số bước: doc hỏng có vòng `parentId` (validator chặn ở đường ghi, nhưng đây
 * là đường ĐỌC) không được làm treo một cú bấm.
 */
export function revealCandidates(doc: Doc, id: NodeId): NodeId[] {
  const out: NodeId[] = [id];
  let cur = doc.nodes[id]?.parentId ?? null;
  const limit = Object.keys(doc.nodes).length;
  while (cur && out.length <= limit && !out.includes(cur)) {
    out.push(cur);
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return out;
}
