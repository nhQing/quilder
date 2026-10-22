/**
 * Tên kết nối MCP trong cấu hình Claude Desktop (`mcpServers.<tên>`).
 *
 * Trước 20/10/2026 tên luôn là một chuỗi cố định: ai nối HAI builder (dev và product,
 * hay hai dự án) thì khoá thứ hai đè khoá thứ nhất trong `claude_desktop_config.json`,
 * và Claude chỉ còn thấy một. Giờ tên mặc định lấy theo domain của builder, nên mỗi
 * builder một tên; người dùng vẫn sửa được trước khi chép.
 */

const MAX = 48;

/** Chỉ chữ thường, số, `-`, `_` — thứ an toàn làm khoá JSON lẫn tên thư mục trên mọi hệ điều hành. */
export function sanitizeMcpName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX)
    .replace(/[-_]+$/, '');
}

/**
 * `https://builder.abc.com` → `quilder-builder-abc-com`; `http://192.168.1.10:3002` →
 * `quilder-192-168-1-10-3002`. Có cổng thì giữ cổng: hai builder cùng máy khác cổng là hai
 * builder. Domain đã có chữ "quilder" thì không gắn thêm tiền tố. (Trước 21/10/2026 tiền tố
 * là tên cũ cố định; kết nối đã cài với tên cũ vẫn chạy — tên chỉ là khoá trong config.)
 */
export function mcpServerName(origin: string): string {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    host = origin;
  }
  const slug = sanitizeMcpName(host.replace(/^www\./i, ''));
  if (!slug) return 'quilder';
  return sanitizeMcpName(slug.includes('quilder') ? slug : `quilder-${slug}`);
}
