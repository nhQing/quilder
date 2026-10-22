/**
 * Node nào trong một doc đang trỏ tới asset nào.
 *
 * Hàm THUẦN — không `server-only`, không prisma. Tách khỏi `asset-usage.ts` vì hai
 * lý do, và cả hai đã cắn thật:
 *
 *  - `server-only` ném ngay khi được import ngoài bối cảnh RSC, nên một script `tsx`
 *    không dùng lại được. Đó là rào chắn đúng và không nên gỡ; thứ nên làm là để
 *    phần thuần đứng ngoài nó.
 *  - Phần đáng sai ở đây là phép DUYỆT, và nó test được không cần DB.
 *
 * Cùng khuôn với `release-snapshot.ts` (thuần) và `style-bundle.ts` (chạm DB) ở
 * Đợt 1.
 */

import type { Doc, Node } from '@/lib/doc/types';
import {
  EFFECT_ASSET_PARAMS,
  effectAssetIds,
  instanceAssetIds,
  styleAssetIds,
} from '@/lib/render/instance';

/**
 * Cây component, chỉ phần phép duyệt này cần.
 *
 * Khai theo HÌNH DẠNG chứ không import `ComponentTree`: giữ file thuần (chỗ khai
 * kiểu đó kéo theo prisma), và giống hệt cách `collectAssetIds` ở `render/page.ts`
 * nhận tham số — hai bên đọc cùng một thứ thì không lệch nhau được.
 */
export type ComponentTreesFor = ReadonlyMap<string, { nodes: Record<string, Node> }>;

/**
 * Tham số effect nào chứa assetId.
 *
 * Hiện chỉ có `image-sequence`, và nó giữ CẢ LÔ khung trong `params.frames` /
 * `params.framesNarrow` / `params.framesSuper` — ba mảng, mỗi mảng tới 400 id.
 *
 * Bảng này cũng là thứ `NodeRenderer` dùng để đổi id → URL cho effect. MỘT bảng
 * cho cả hai việc: thêm lô thứ tư mà chỉ sửa một nơi thì hoặc ảnh bị báo "chưa ai
 * dùng", hoặc lô đó đi xuống trình duyệt dưới dạng id trần — 404 mọi khung.
 *
 * ## Vì sao bảng khai theo TÊN THAM SỐ chứ không quét mù
 *
 * Quét mù mọi chuỗi trong `params` sẽ vớt cả `pinPart`, `folder`, tên vai — rồi
 * báo "có nơi dùng" cho những asset tình cờ trùng id với một chuỗi bất kỳ. Sai
 * theo hướng đó nghĩa là trang quản lý ảnh không bao giờ dọn được gì.
 *
 * Thêm effect mới có tham số asset thì thêm một dòng vào đây. Quên là quay lại
 * đúng cái lỗ mà cả file này sinh ra để vá: ảnh đang hiện trên trang bị báo
 * "chưa ai dùng", và người dùng xoá nó.
 */
/*
 * ĐỊNH NGHĨA của bảng và của `effectAssetIds` nằm ở `render/instance.ts` (từ khi
 * `instanceAssetIds` cũng cần đọc effect của node trong component — để ở đây thì
 * `instance.ts` phải import ngược file này, thành import vòng). Export lại để mọi chỗ
 * import từ đây vẫn chạy và vẫn chỉ có MỘT bảng.
 */
export { EFFECT_ASSET_PARAMS, effectAssetIds };

/**
 * Mọi assetId mà một node trỏ tới.
 *
 * SÁU chỗ, và bỏ sót chỗ nào là báo "không ai dùng" cho một ảnh đang hiện trên
 * trang — thứ dẫn thẳng tới việc người dùng gỡ nhầm.
 *
 * ## Vì sao dùng lại `styleAssetIds` của renderer thay vì tự duyệt style
 *
 * Bản trước chép phép duyệt ra đây, và nó đã lệch đúng như docblock của
 * `render/instance.ts` cảnh báo: vòng lặp `Object.values(node.style)` đọc trượt
 * `states` — lớp LỒNG một cấp (tên state → style), nên nó đọc trúng cái hộp chứa
 * các state chứ không đọc từng state. Header thật dùng đúng cấu trúc ấy
 * (`is-collapsed`, `is-inverted`), nên ảnh nền của header là ảnh "không ai dùng".
 * `render/instance.ts` là hàm thuần, không DB — import được vào đây mà không mất
 * tính chất của file này.
 *
 * ## Vì sao trả về mảng ĐÃ BỎ TRÙNG
 *
 * `assetUsesInDoc` đẩy thẳng danh sách này vào `useCount` của `/builder/assets`.
 * Một node vừa đặt ảnh làm `Image.assetId` vừa đặt chính nó làm nền sẽ hiện "2 nơi
 * dùng" cho một node duy nhất — một con số kiểm kê sai theo hướng ngược lại.
 */
export function assetIdsOf(node: Node, components?: ComponentTreesFor): string[] {
  const out = new Set<string>();

  if (node.type === 'Image' && node.assetId) out.add(node.assetId);
  if (node.type === 'Video') {
    if (node.assetId) out.add(node.assetId);
    if (node.posterAssetId) out.add(node.posterAssetId);
  }

  if (node.type === 'Instance') {
    /*
     * Ảnh SỐNG TRONG COMPONENT.
     *
     * Không có cây thì không node nào của doc mang id ấy, nên nó "không ai dùng"
     * trên MỌI trang — và xoá nó làm hỏng mọi trang đang cắm instance đó. Đây là
     * nửa còn lại của lỗ mà `collectAssetIds` đã vá ở tầng renderer.
     */
    const tree = components?.get(node.componentId);
    if (tree) {
      for (const id of instanceAssetIds(tree, node.overrides)) out.add(id);
      /*
       * VÀ ảnh MẶC ĐỊNH của component, tức bản chưa phủ override.
       *
       * Đây là chỗ câu hỏi của trang quản lý ảnh KHÁC câu hỏi của renderer, và
       * lấy nhầm một bên là mất dữ liệu. Renderer hỏi "lượt render này cần nạp
       * ảnh nào" — đúng là bản đã phủ override. Trang quản lý hỏi "xoá tấm này
       * thì vỡ chỗ nào", và ảnh mặc định của component vỡ ngay cả khi instance
       * duy nhất trên trang đang thay nó: gỡ override ra là component không còn
       * ảnh, và mọi instance thêm sau đó cũng vậy.
       *
       * Sai theo hướng này là đếm thừa một dòng trong "nơi dùng"; sai theo hướng
       * kia là mời người dùng xoá vĩnh viễn. Hai hướng không cùng hạng.
       */
      for (const id of instanceAssetIds(tree, {})) out.add(id);
    }

    /*
     * Override ĐỌC ĐƯỢC MÀ KHÔNG CẦN CÂY — nó nằm ngay trong doc.
     *
     * `instanceAssetIds` ở trên đã phủ chúng khi có cây, nhưng chỗ gọi không phải
     * lúc nào cũng nạp được cây (`listAssetsWithUsage` hiện chưa nạp). Bỏ qua
     * nhánh này là báo "không ai dùng" cho đúng tấm ảnh mà người dùng vừa tự tay
     * chọn cho instance — ca dễ xảy ra nhất trong ba ca ở đây.
     */
    for (const ov of Object.values(node.overrides ?? {})) {
      if (ov?.assetId) out.add(ov.assetId);
      if (ov?.posterAssetId) out.add(ov.posterAssetId);
    }
  }

  // Ảnh nền: mọi lớp responsive VÀ mọi state. Xem `styleAssetIds`.
  for (const id of styleAssetIds(node)) out.add(id);

  /*
   * Lô khung của `image-sequence`.
   *
   * Chỗ thứ SÁU, và là chỗ đắt nhất nếu bỏ sót: một section clip giữ 120 ảnh
   * trong params chứ không trong một node nào cả. Không đọc ở đây thì cả 120
   * tấm hiện "chưa ai dùng" ở `/builder/assets` — một lời mời xoá hàng loạt, và
   * xoá xong thì clip trên site thật thành một khung đứng im.
   */
  for (const id of effectAssetIds(node)) out.add(id);

  return [...out];
}

/**
 * Map `assetId → id của node dùng nó` cho một doc.
 *
 * `components` tuỳ chọn, cùng khuôn với `collectAssetIds`: chỗ gọi nào nạp được
 * cây component thì truyền vào, và chỉ khi có nó thì ảnh nằm BÊN TRONG component
 * mới được đếm. Thiếu nó, phần còn lại vẫn đúng — không phải một nửa im lặng sai.
 */
export function assetUsesInDoc(doc: Doc, components?: ComponentTreesFor): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const node of Object.values(doc.nodes)) {
    for (const id of assetIdsOf(node, components)) {
      const list = out.get(id) ?? [];
      list.push(node.id);
      out.set(id, list);
    }
  }
  return out;
}
