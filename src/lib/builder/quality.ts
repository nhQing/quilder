/**
 * Quét doc tìm những chỗ sẽ lên site trong tình trạng dở dang.
 *
 * ## Vì sao đây là "cảnh báo", KHÔNG phải cổng publish
 *
 * Wireframe v2 vẽ nhãn `✕ Cần sửa trước khi publish 2`, tức nó hứa một cổng. Cổng đó
 * **không tồn tại**: `/api/publish` nhận doc nháp nguyên trạng, không kiểm alt, không
 * kiểm bản dịch (spec §1 hàng 5).
 *
 * Spec đã chốt (quyết định #4): **đổi nhãn, không dựng cổng.** Lý do phải nói rõ, vì
 * nó là một khoản nợ có chủ đích — `1e/03` ghi rằng còn 10 `Image` đã migrate mang
 * `_src` và thiếu alt. Dựng cổng thật sẽ chặn publish NGAY vì dữ liệu cũ, tức phải sửa
 * 10 node đó trước khi ai publish được lần nữa; việc đó phình lát 4 từ một dock thành
 * một cuộc di trú dữ liệu.
 *
 * Nên: **10 Image thiếu alt vẫn lên site thật được.** Vấn đề a11y không đóng ở đây, nó
 * chỉ được bày ra. Khi 10 node kia được nối asset, cổng thật trở thành một thay đổi nhỏ
 * và độc lập.
 *
 * ## Vì sao là hàm THUẦN, có test
 *
 * Spec §2 xếp luật 3 vào loại **có thể sai**: một danh sách điều kiện thiếu mà bỏ sót
 * một điều kiện thì tệ hơn không có danh sách — người dùng học được rằng dock "đã kiểm
 * hết" và thôi tự soát. Sai được thì cần type và test.
 */

import { plainText } from '@/lib/doc/plain-text';
import type { Doc, Node, NodeId } from '@/lib/doc/types';
import { labelOf } from './node-label';

export type IssueKind = 'image-alt' | 'button-empty' | 'button-href' | 'text-empty';

export interface Issue {
  kind: IssueKind;
  nodeId: NodeId;
  /** Tên node để hiện trong danh sách — cùng phép gọi tên với cây bên trái. */
  label: string;
  /** Câu nói HẬU QUẢ, không phải tên luật. */
  message: string;
}

/**
 * Câu cho từng loại, viết theo hậu quả.
 *
 * "Thiếu alt" là tên luật; "trình đọc màn hình bỏ qua ảnh này" là điều xảy ra. Người
 * dựng trang không nợ ai một thuộc tính HTML — họ nợ người đọc một câu mô tả.
 */
const MESSAGE: Record<IssueKind, string> = {
  'image-alt':
    'Ảnh không có chữ thay thế. Trình đọc màn hình sẽ bỏ qua nó, và nếu ảnh không tải được thì chỗ đó trống trơn.',
  'button-empty': 'Nút không có chữ. Nó vẫn bấm được nhưng không ai biết nó làm gì.',
  'button-href': 'Nút trỏ tới một địa chỉ trống — bấm vào không đi đâu cả.',
  'text-empty': 'Khối chữ đang trống. Nó vẫn chiếm chỗ trên trang.',
};

/**
 * Mọi cảnh báo của một doc, theo thứ tự node trong `doc.nodes`.
 *
 * Không sắp lại theo mức nghiêm trọng: dock hiện chúng cạnh nhau và mỗi dòng bấm được
 * để chọn node, nên thứ tự hữu ích nhất là thứ tự ổn định — một danh sách nhảy chỗ
 * giữa hai lần render là danh sách người dùng mất dấu.
 */
export function scanQuality(doc: Doc): Issue[] {
  const out: Issue[] = [];

  for (const node of Object.values(doc.nodes) as Node[]) {
    for (const kind of issuesOf(node)) {
      out.push({ kind, nodeId: node.id, label: labelOf(node), message: MESSAGE[kind] });
    }
  }

  return out;
}

/** Cảnh báo của MỘT node. Tách ra để test được từng luật một. */
export function issuesOf(node: Node): IssueKind[] {
  const out: IssueKind[] = [];

  if (node.type === 'Image') {
    /*
     * `decorative: true` là một lời khai CÓ CHỦ ĐÍCH — "ảnh này không mang thông tin,
     * trình đọc màn hình nên bỏ qua". Cảnh báo nó là biến một lựa chọn đúng thành tiếng
     * ồn, và tiếng ồn thì người ta học cách phớt lờ cả danh sách.
     *
     * Ảnh CHƯA CHỌN (`assetId === null`) cũng không cảnh báo ở đây: nó đã hiện rõ là
     * một ô trống trên canvas, và "thiếu alt" không phải điều cần nói về nó.
     */
    if (!node.decorative && node.assetId && !node.alt.trim()) out.push('image-alt');
  }

  if (node.type === 'Button') {
    if (!plainText(node.label).trim()) out.push('button-empty');
    if (node.action.kind === 'link' && !node.action.href.trim()) out.push('button-href');
  }

  if (node.type === 'Text') {
    if (!plainText(node.content).trim()) out.push('text-empty');
  }

  return out;
}
