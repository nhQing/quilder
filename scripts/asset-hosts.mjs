/**
 * Host ảnh cho `images.remotePatterns` của `next/image` — thông số LÚC BUILD.
 *
 * `remotePatterns` bị nướng vào bundle khi `next build`; đổi CDN là phải build lại, màn
 * Cài đặt không làm được. Thiếu host của kho ảnh thì `/_next/image` trả 400 cho MỌI ảnh
 * raster và trang chỉ còn chữ — hỏng im lặng, nên build production không có host nào là
 * build DỪNG, không ra một image hỏng.
 *
 * Nguồn, theo thứ tự:
 *   1. `ASSET_HOSTS` — danh sách cách nhau bằng dấu phẩy: `https://cdn.abc.vn, cdn-dev.abc.vn`.
 *      Không có scheme thì coi là https. Có path thì path đó là tiền tố cho phép.
 *   2. `S3_PUBLIC_BASE_URL` — khi build tại máy có `.env` (Next nạp `.env` trước config).
 *      Trong Docker thì `.env` bị `.dockerignore` loại, nên ở đó phải truyền
 *      `--build-arg ASSET_HOSTS=…` (xem Dockerfile, `pnpm release`).
 */

/** @returns {{ protocol: 'http' | 'https', hostname: string, port?: string, pathname: string }[]} */
export function parseAssetHosts(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      let url;
      try {
        url = new URL(entry.includes('://') ? entry : `https://${entry}`);
      } catch {
        throw new Error(`ASSET_HOSTS: "${entry}" không phải host hay URL hợp lệ.`);
      }
      const protocol = url.protocol.replace(':', '');
      if (protocol !== 'http' && protocol !== 'https') {
        throw new Error(`ASSET_HOSTS: "${entry}" phải là http hoặc https.`);
      }
      const path = url.pathname.replace(/\/+$/, '');
      return {
        protocol,
        hostname: url.hostname,
        ...(url.port ? { port: url.port } : {}),
        pathname: `${path}/**`,
      };
    });
}

/**
 * Chuỗi host thô theo thứ tự nguồn ở docblock đầu file. `next.config` và `pnpm release`
 * cùng gọi hàm này — hai bản luật riêng từng lệch nhau: release đòi ASSET_HOSTS trong khi
 * `.env` chỉ có S3_PUBLIC_BASE_URL, mà `next build` tại máy thì vẫn chạy.
 */
export function rawAssetHosts(env) {
  return env.ASSET_HOSTS?.trim() || env.S3_PUBLIC_BASE_URL?.trim() || '';
}

/**
 * Danh sách cuối cùng cho `remotePatterns`. `production` = đang `next build` bản thật:
 * rỗng thì ném, kèm hướng dẫn đặt biến.
 */
export function assetRemotePatterns(env, { production }) {
  const patterns = parseAssetHosts(rawAssetHosts(env));
  if (production && patterns.length === 0) {
    throw new Error(
      [
        'Thiếu ASSET_HOSTS lúc build.',
        'Đây là host của kho ảnh (CDN/S3 public), bị đóng vào bản build — thiếu nó thì mọi ảnh trả 400.',
        'Đặt trong .env (build tại máy):   ASSET_HOSTS="https://cdn.ten-mien.vn"',
        'Build Docker:                      docker build --build-arg ASSET_HOSTS=https://cdn.ten-mien.vn …',
      ].join('\n'),
    );
  }
  return patterns;
}
