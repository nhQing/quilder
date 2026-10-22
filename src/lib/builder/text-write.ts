/**
 * Một đơn vị chữ → op ghi nó.
 *
 * Dùng chung cho bảng thuộc tính (panel phải) và bảng Văn bản. Hàm thuần, không
 * React, không DB — nên luật ở đây test được mà không dựng gì, và hai giao diện
 * không thể ghi khác nhau.
 *
 * ## Vì sao phải có file này
 *
 * Bốn trường chữ ghi bằng BA op khác nhau, và chọn sai op không báo lỗi — nó ghi
 * vào chỗ khác:
 *
 *  - `content` / `label` → `setText`. Giá trị là `RichText`, không phải chuỗi.
 *  - `alt` → `setProps` (nó là field thường của `ImageNode`).
 *  - `a11yLabel` → `setProps` với object `a11y` lồng.
 *  - Bất kỳ trường nào NẰM TRONG instance → `setOverride`, không phải ba cái trên.
 *
 * Cái cuối là chỗ nguy hiểm nhất: `setText` trên một node local của component sẽ
 * sửa CÂY COMPONENT, tức đổi mọi trang đang dùng nó, trong khi người dùng chỉ định
 * sửa chữ ở một trang. Một hàm duy nhất quyết định điều đó thì không có giao diện
 * nào chọn sai được.
 */

import type { Op } from '@/lib/doc/ops';
import type { ContentOverride, Node, RichText } from '@/lib/doc/types';
import {
  flatRichText,
  isFlatRichText,
  parseInstanceAddress,
  type BaseTranslatableField,
  type TranslatableField,
} from '@/lib/builder/text-units';
import { isParamField, paramPathOf, setParamPath } from '@/lib/render/param-paths';

/**
 * Trường dịch được → khoá tương ứng trong `ContentOverride` của instance.
 *
 * Hiện tại mọi cặp đều TRÙNG TÊN, nên bảng này trông thừa. Nó không thừa: nó là
 * chỗ TypeScript kiểm rằng mỗi `TranslatableField` có một khoá thật trong
 * `ContentOverride`. Thêm một trường dịch được mà quên mở khoá override tương ứng
 * sẽ là lỗi biên dịch ở đây, thay vì một bản dịch im lặng không áp ở runtime.
 */
const OVERRIDE_KEY: Record<BaseTranslatableField, keyof ContentOverride> = {
  content: 'content',
  label: 'label',
  alt: 'alt',
  a11yLabel: 'a11yLabel',
  assetId: 'assetId',
  posterAssetId: 'posterAssetId',
  href: 'href',
};

/**
 * Chuỗi từ ô nhập → giá trị đúng hình dạng của trường.
 *
 * Ba hình dạng, và chúng không quy về một được: `RichText` là mảng, asset là
 * `string | null`, còn lại là chuỗi.
 *
 * Rỗng → `null` cho asset: ô chọn ảnh gỡ ảnh đi thì ý người dùng là "không có
 * ảnh", và `assetId: ''` không phải một giá trị hợp lệ ở bất kỳ tầng nào.
 */
function valueFor(field: TranslatableField, text: string): RichText | string | null {
  if (field === 'content' || field === 'label') return flatRichText(text);
  if (field === 'assetId' || field === 'posterAssetId') return text || null;
  return text;
}

export interface TextWriteResult {
  ops: Op[];
  /** Nhãn cho history + audit log. */
  label: string;
}

/**
 * Ops để đặt chữ gốc của một đơn vị.
 *
 * `address` đúng bằng `TextUnit.nodeId`: một id node thường, hoặc
 * `instanceId/localId` cho chữ nằm trong instance.
 *
 * `text` là chuỗi PHẲNG. Chỉ gọi hàm này cho đơn vị `flat` — với `RichText` có cấu
 * trúc (link, nhiều đoạn, `split`), ghi một chuỗi vào sẽ san phẳng cây và làm mất
 * `href` cùng mục tiêu của hiệu ứng tách chữ. `TextUnit.flat` là cờ để kiểm.
 *
 * `node` là node ĐANG SỬA, và nó chỉ cần cho hai trường nằm trong object lồng
 * (`href`, `a11yLabel`) — xem `nestedProps`. Truyền được thì truyền: không có nó,
 * op vẫn hợp lệ nhưng các khoá tuỳ chọn cạnh bên (`action.target`, `action.rel`,
 * `a11y.role`, `a11y.labelledBy`) bị xoá, vì `setProps` THAY chứ không merge.
 */
export function textWriteOps(args: {
  address: string;
  field: TranslatableField;
  text: string;
  node?: Node;
}): TextWriteResult {
  const { address, field, text, node } = args;
  const inst = parseInstanceAddress(address);

  /*
   * `param:*` — chữ trong params của Composite. Chỉ ghi được cho node thường của doc
   * (cần `node.params` hiện tại để thay đúng MỘT chuỗi mà không mất phần còn lại —
   * `setProps` thay cả giá trị). Trong instance không có op nào trộn được từng đường
   * (`setOverride` thay cả bản đồ `params`), và đoán bản đồ cũ là đường mất dữ liệu;
   * giao diện khoá ô gốc của đơn vị này, nên trả rỗng thay vì ghi sai.
   */
  if (isParamField(field)) {
    if (!inst && node?.type === 'Composite') {
      return {
        ops: [{
          op: 'setProps',
          nodeId: address,
          props: { params: setParamPath(node.params, paramPathOf(field), text) },
        }],
        label: `sửa chữ params ${address}.${field}`,
      };
    }
    return { ops: [], label: `sửa chữ params ${address}.${field}` };
  }

  // Chữ trong instance: một op duy nhất, chạm đúng một khoá override.
  if (inst) {
    return {
      ops: [
        {
          op: 'setOverride',
          nodeId: inst.instanceId,
          localId: inst.localId,
          patch: { [OVERRIDE_KEY[field]]: valueFor(field, text) },
        },
      ],
      label: `sửa ${inst.localId}.${field}`,
    };
  }

  if (field === 'content' || field === 'label') {
    return {
      ops: [{ op: 'setText', nodeId: address, field, value: flatRichText(text) }],
      label: `sửa chữ ${address}.${field}`,
    };
  }

  if (field === 'alt') {
    return {
      ops: [{ op: 'setProps', nodeId: address, props: { alt: text } }],
      label: `sửa alt ${address}`,
    };
  }

  // Ảnh, video, ảnh chờ: tên trường TRÙNG tên field của node, nên một op duy nhất
  // phục vụ cả `Image.assetId`, `Video.assetId` và `Video.posterAssetId`.
  if (field === 'assetId' || field === 'posterAssetId') {
    return {
      ops: [{ op: 'setProps', nodeId: address, props: { [field]: text || null } }],
      label: `đổi ${field === 'assetId' ? 'ảnh/video' : 'ảnh chờ'} ${address}`,
    };
  }

  // `href` và `a11yLabel` sống trong object LỒNG, và `setProps` thay cả object —
  // xem `nestedProps`.
  const props = nestedProps(field, text, node);
  return {
    ops: props ? [{ op: 'setProps', nodeId: address, props }] : [],
    label: field === 'href' ? `sửa đường dẫn ${address}` : `sửa nhãn a11y ${address}`,
  };
}

/**
 * `href` / `a11yLabel` → `props` cho `setProps`, GỬI ĐỦ object lồng.
 *
 * ## Đính chính một chú thích đã sai suốt
 *
 * Bản trước gửi `{ action: { href } }` và `{ a11y: { label } }`, với lý lẽ ghi
 * thẳng trong file: *"`setProps` merge NÔNG một tầng (xem `mergeDeep`)"*. Không
 * đúng. `mergeDeep` chỉ phục vụ `setStyle`; nhánh `setProps` của `applyOne` làm
 * `target[key] = value` — THAY nguyên giá trị (`doc/ops.ts`).
 *
 * Hai hậu quả, khác hạng nhau:
 *
 *  - `{ action: { href } }` để lại một Button không có `kind`. `zNode` từ chối
 *    node đó, nên `PageVersion` kế tiếp không đọc được — phá dữ liệu, và nó xảy
 *    ra mỗi lần ai đó sửa đường dẫn một nút qua ô dịch.
 *  - `{ a11y: { label } }` hợp lệ về hình dạng nên KHÔNG tầng nào chặn, và nó im
 *    lặng xoá `a11y.role` cùng `a11y.labelledBy`.
 *
 * Luật đúng là luật renderer đã dùng cho instance từ đầu: `{ ...cũ, khoá mới }`
 * — xem `applyOverride` trong `render/instance.ts`.
 *
 * ## Vì sao KHÔNG làm `setProps` merge sâu để chữa
 *
 * `setProps` là op dùng chung của mọi field thường, và một nửa số field đó là
 * union có thẻ hoặc mảng — `action` là `discriminatedUnion('kind')`. Merge sâu
 * một union cho ra vật lai không thuộc nhánh nào, đúng lỗi mà `UNION_KEYS` trong
 * `ops.ts` đã phải chặn riêng cho `setStyle`. Đổi ngữ nghĩa của op thì phải kiểm
 * lại mọi chỗ gọi (UI, MCP, migrate, `invert`); sửa hai chỗ gọi thì không.
 *
 * ## Không có `node` thì sao
 *
 * `href`: vẫn gửi `kind: 'link'`, vì `extractUnits` CHỈ phát đơn vị `href` khi
 * `action.kind === 'link'` — đó là dữ kiện, không phải phỏng đoán. Op hợp lệ,
 * nhưng `target`/`rel` mất. `a11yLabel`: giữ nguyên hành vi cũ.
 */
function nestedProps(
  field: 'href' | 'a11yLabel',
  text: string,
  node: Node | undefined,
): Record<string, unknown> | null {
  if (field === 'href') {
    if (!node) return { action: { kind: 'link', href: text } };
    // `href` chỉ có nghĩa với action dạng link — cùng luật với `applyOverride`.
    // Ghi đè lên `anchor`/`submit` sẽ tạo một action lai mà schema từ chối.
    if (node.type !== 'Button' || node.action.kind !== 'link') return null;
    return { action: { ...node.action, href: text } };
  }
  return { a11y: { ...node?.a11y, label: text } };
}

/**
 * `RichText` → chuỗi để đưa vào ô nhập.
 *
 * KHÔNG dùng `plainText()` của renderer: hàm đó ghép cả cây, kể cả cây có cấu trúc,
 * nên nó trả về chuỗi cho những đơn vị mà ta CỐ Ý không cho sửa. Ở đây chỉ nhận một
 * đoạn phẳng duy nhất; mọi thứ khác trả `null` để chỗ gọi phải xử lý rõ ràng.
 */
export function flatTextOf(value: RichText | undefined): string | null {
  if (!isFlatRichText(value)) return null;
  const only = value![0]!;
  return only.t === 'text' ? only.v : null;
}
