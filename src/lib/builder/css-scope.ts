/**
 * Selector mà `customCss` của node đang chọn được scope về, theo thứ đang sửa.
 *
 * ## Vì sao cần
 *
 * Cảnh báo "customCss đang đè ô này" so `selector === scope` để biết một rule áp
 * VÔ ĐIỀU KIỆN (xem `declaredProperties`). Trong chế độ sửa component thì scope
 * thật là `[data-c] [data-cn]`, không phải `[data-n]` — nên nếu cứ suy scope từ
 * nodeId thì `always` luôn false và dấu ⚠ không bao giờ hiện cho node component.
 * Cùng loại im lặng mà chính cảnh báo đó tồn tại để dập.
 *
 * ## Vì sao đọc `target` chứ không nhận prop
 *
 * `store.target` đã biết đang sửa trang hay component (`EditTarget`), và nó là
 * cùng nguồn mà `dispatch` dùng để chọn endpoint. Truyền `componentId` xuống ba
 * tầng prop là dựng một nguồn thứ hai cho thứ store đã có.
 */

import { componentNodeScope, nodeScope } from '@/lib/render/sanitize-css';
import type { EditTarget } from './store';

export function scopeForTarget(target: EditTarget | null, nodeId: string): string {
  return target?.kind === 'component'
    ? componentNodeScope(target.id, nodeId)
    : nodeScope(nodeId);
}
