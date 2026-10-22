/**
 * Phạm vi của token service: những đường nó được đi tới.
 *
 * ## Vấn đề nó giải
 *
 * Token service là một JWT mang role của người cấp, và middleware nhận Bearer
 * cho mọi route. Trước 08/10/2026, "AI không publish được" chỉ đúng trong
 * registry tool: ai cầm token MCP cũng gọi thẳng được `POST /api/publish`, hay
 * `POST /api/ops` mà bỏ trường `actor` để lách chặn node khoá và
 * `AI_CSS_ALLOWLIST`. Token do admin cấp thì vào được cả `/api/users`.
 *
 * ## Vì sao là allowlist chứ không phải blocklist
 *
 * Mỗi route mới thêm vào `/api` sẽ tự động MỞ với blocklist, và tự động ĐÓNG
 * với allowlist. Danh sách dưới đây khớp đúng những gì `mcp/server.mjs` gọi:
 * thêm một đường vào đó thì phải thêm vào đây, có chủ đích.
 *
 * File này không import gì để chạy được cả trên Edge (middleware) lẫn trong test.
 */

export function serviceMayReach(pathname: string, method: string): boolean {
  // Danh mục tool và mọi lời gọi tool. Đây là cửa chính, và là cửa duy nhất có
  // validator, AuditLog và rate limit theo token.
  if (pathname === '/api/ai/tool') return method === 'GET' || method === 'POST';

  // upload_asset với `filePath`: proxy tự POST multipart vì byte ảnh không được
  // đi qua context của model. Xem `uploadLocalFile` trong mcp/server.mjs.
  if (pathname === '/api/assets') return method === 'POST';
  // Lời dặn + prompt MCP (`/clone_website`) do builder phát, và bộ clone (token, khổ đo,
  // mã bộ trích) cho `clone_url`/`compare_with_url` chạy ở máy người dùng. Cả hai CHỈ
  // ĐỌC. Thiếu dòng này thì proxy rơi về lời dặn nhúng sẵn và hai tool clone luôn báo
  // "không đủ quyền" (phát hiện khi chạy thật 13/10/2026). POST của guide là `prompts/get`
  // kèm tham số, không ghi gì.
  if (pathname === '/api/ai/guide') return method === 'GET' || method === 'POST';
  if (pathname === '/api/ai/clone-kit') return method === 'GET';

  // screenshot_page: Playwright mang token làm cookie để mở bản nháp. Chỉ ĐỌC.
  if (pathname.startsWith('/preview/') || pathname.startsWith('/render/')) {
    return method === 'GET' || method === 'HEAD';
  }

  return false;
}
