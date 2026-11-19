/**
 * CSS tô nền vàng chỗ có bản dịch NHÁP chưa publish — CHỈ cho màn xem trước.
 *
 * Chỉ `/preview/[pageId]` gọi hàm này; trang thật (`PublishedPageView`) không bao giờ
 * import nó, nên không có đường nào để ô vàng lọt lên site.
 *
 * `a11yLabel` bị bỏ qua: nó không hiện ra mắt, và nút "link-cover" phủ cả thẻ sẽ làm cả
 * thẻ ngả vàng chỉ vì đổi một nhãn đọc màn hình.
 */

import { parseInstanceAddress } from '@/lib/builder/text-units';

/** Id vào selector: chỉ nhận ký tự an toàn — id lạ bị bỏ chứ không thoát chuỗi. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function translationHighlightCss(units: readonly { nodeId: string; field: string }[]): string {
  const selectors = new Set<string>();
  for (const u of units) {
    if (u.field === 'a11yLabel') continue;
    const inst = parseInstanceAddress(u.nodeId);
    if (inst) {
      if (SAFE_ID.test(inst.instanceId) && SAFE_ID.test(inst.localId)) {
        selectors.add(`[data-n="${inst.instanceId}"] [data-cn="${inst.localId}"]`);
      }
    } else if (SAFE_ID.test(u.nodeId)) {
      selectors.add(`[data-n="${u.nodeId}"]`);
    }
  }
  if (!selectors.size) return '';
  // `!important` vì style của node/component cũng đặt `background`. Viền bằng `box-shadow`
  // (không đổi bố cục) để chỗ chữ trên nền vàng nhạt vẫn thấy được ranh giới.
  return `${[...selectors].join(',\n')}{background-color:rgba(253,224,71,.6)!important;box-shadow:0 0 0 2px rgba(234,179,8,.9)!important;border-radius:3px}`;
}
