/**
 * Phần THUẦN của kế hoạch nhập mà trình duyệt cần. Tách khỏi `import-plan.ts` vì file đó kéo
 * `node:crypto` (qua `assets/key`) — không đi vào bundle của hộp thoại được.
 */

import type { AssetPlanRow } from './import-plan';

/**
 * File phải tải lên — mỗi KHOÁ ĐÍCH một lần. Khoá đích suy từ tên + sha, nên cùng byte mà khác
 * tên là hai khoá, hai hàng Asset: gộp theo file (sha) sẽ để sót một khoá và commit báo "còn file
 * chưa tải".
 */
export function uploadsNeeded(assets: AssetPlanRow[]): AssetPlanRow[] {
  return [...new Map(assets.filter((a) => a.status === 'upload').map((a) => [a.targetKey, a])).values()];
}
