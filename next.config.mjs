import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { assetRemotePatterns } from './scripts/asset-hosts.mjs';
import { projectDir } from './scripts/project-dir.mjs';

/** Gói dự án đang chọn — QUILDER_PROJECT. Sai tên gói thì ném ngay, build dừng. */
const project = projectDir();

/**
 * Thư mục cấp một trong `public/` của gói (`img`, `svg`, `fonts`…) — phục vụ CẢ ở đường gốc
 * (`/svg/logo/x.svg`), không chỉ `/p/svg/logo/x.svg`.
 *
 * Vì sao: nội dung đã publish trước khi tách gói (21/10/2026) trỏ thẳng `/svg/…`, `/img/…`
 * trong cây node và trong release đã niêm phong — sửa chúng là sửa lịch sử. Rewrite
 * `afterFiles` chạy SAU khi `public/` của lõi được dò, nên file lõi trùng đường vẫn thắng.
 */
const packPublicDirs = (() => {
  const dir = path.join(project.dir, 'public');
  if (!project.name || !existsSync(dir)) return [];
  const reserved = new Set(['p', 'api', 'builder', '_next']);
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name) && !reserved.has(e.name))
    .map((e) => e.name);
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * Thư mục build RIÊNG cho dev server của stack e2e (`scripts/e2e-stack.mjs` đặt
   * `NEXT_DIST_DIR=.next-e2e`). Mặc định vẫn là `.next` cho mọi thứ khác, kể cả build.
   *
   * Hai `next dev` cùng một `.next` (dev server thường + server e2e) ghi đè chunk của
   * nhau: ngày 09/10/2026 server e2e lỗi `Cannot read properties of undefined (reading
   * call)` dây chuyền ở `/api/public/v1` rồi `/mm-css`, bảy test đỏ. Tệ hơn, cả hai còn
   * dùng chung `.next/cache/fetch-cache` — cache `unstable_cache` của HAI database khác nhau.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Standalone output — image chạy chỉ cần `.next/standalone` + static, không cần node_modules đầy đủ.
  output: 'standalone',

  // KHÁC admin-ui một cách có chủ đích: admin-ui đặt `unoptimized: true` vì nó là
  // dashboard nội bộ. Đây là site marketing công khai — next/image phải tối ưu thật
  // (responsive srcset + AVIF/WebP + width/height từ bảng Asset) để giữ CLS = 0.
  images: {
    formats: ['image/avif', 'image/webp'],

    // Thiếu khối này thì /_next/image trả 400 "url parameter is not allowed" cho
    // MỌI ảnh raster của MỌI trang builder, và trang hiện ra chỉ còn chữ. SVG vẫn
    // sống nên lỗi trông như "mất ảnh lẻ tẻ" chứ không như một lỗi cấu hình:
    // renderer trỏ SVG thẳng CDN, chỉ ảnh raster đi qua optimizer.
    //
    // Host của kho ảnh là THÔNG SỐ LÚC BUILD (21/10/2026): `ASSET_HOSTS`, hoặc host của
    // `S3_PUBLIC_BASE_URL` khi build tại máy có `.env`. Trước đó hai host CDN của
    // một công ty được gõ thẳng ở đây — builder dùng cho công ty khác thì mọi ảnh trả 400.
    // Build production không có host nào là build DỪNG. Xem scripts/asset-hosts.mjs.
    remotePatterns: [
      ...assetRemotePatterns(process.env, { production: process.env.NODE_ENV === 'production' }),
      // MinIO của stack e2e (scripts/e2e-stack.mjs). Chỉ khi MM_E2E=1 — biến đó chỉ có
      // ở `next dev` do stack e2e bật, nên không bản build nào mang host này. Thiếu nó
      // thì trang công khai nào hiện ảnh tải lên TRONG e2e cũng trả 500 (`next/image`
      // từ chối host lạ), và phép thử nào chỉ dò chuỗi trong HTML sẽ không nhận ra.
      ...(process.env.MM_E2E === '1'
        ? [{ protocol: 'http', hostname: 'localhost', port: '9010', pathname: '/builder-e2e/**' }]
        : []),
    ],
  },

  // Lint KHÔNG chạy lúc build, có chủ đích (08/10/2026): `pnpm lint` (eslint.config.mjs)
  // là cổng thật, và CI chạy nó ở mỗi push. Lint tích hợp của `next build` tìm plugin
  // từ gốc dự án, còn pnpm không hoist `eslint-plugin-react-hooks` lên đó — build in
  // "Failed to load plugin" rồi chạy tiếp như không có gì. Một cổng tưởng là có mà không
  // chặn gì thì tệ hơn không có cổng.
  eslint: { ignoreDuringBuilds: true },

  // Huy hiệu dev của Next mặc định nằm ở góc DƯỚI–TRÁI — đúng chỗ thanh thao tác
  // của cây node ("+ Thêm", nhân bản, xoá). Nó chặn pointer event trên vùng nó
  // phủ, nên nút "+ Thêm" chỉ còn bấm được ở dải ~14px sát đáy, và một lần đổi
  // cỡ chữ là mất nốt dải đó (e2e bắt được đúng lúc nó biến mất).
  //
  // Dưới–phải là góc trống duy nhất của bố cục ba pane: giữa là dock của canvas,
  // trên–phải là Xem nháp/Publish, còn pane phải đổ nội dung từ trên xuống.
  devIndicators: { position: 'bottom-right' },

  // `mcp/server.mjs` được PHỤC VỤ cho người dùng tải về (xem
  // /api/tokens/client), nó không được import bởi bất cứ đâu — nên trình theo
  // vết phụ thuộc của Next không thấy nó và bản standalone sẽ thiếu file. Khai
  // tường minh ở đây, nếu không thì trang cấp token chạy tốt ở dev rồi hỏng
  // đúng lúc lên production.
  outputFileTracingIncludes: {
    '/api/tokens/client': ['./mcp/server.mjs'],
    // CSS và public/ của gói được ĐỌC lúc chạy (static-css.ts, route /p/), không import —
    // trình theo vết không thấy chúng. Khai cho mọi route để bản standalone mang theo.
    ...(project.name ? { '/**': [`./${project.dir}/styles/**`, `./${project.dir}/public/**`] } : {}),
  },

  async rewrites() {
    return {
      afterFiles: packPublicDirs.map((d) => ({ source: `/${d}/:path*`, destination: `/p/${d}/:path*` })),
    };
  },

  /*
   * `@project` → gói dự án đang chọn (QUILDER_PROJECT) hoặc gói rỗng.
   * tsconfig trỏ cố định vào gói rỗng; ở đây mới là thứ build dùng thật. Xem
   * scripts/project-dir.mjs và projects/example/README.md.
   */
  webpack(config, { webpack }) {
    const packDir = path.resolve(import.meta.dirname, project.dir);
    // Viết lại request `@project/…` thành đường dẫn tuyệt đối TRƯỚC khi resolve. Không dùng
    // `resolve.alias`: tsconfig khai `@project/*` → gói rỗng (cho typecheck và script tsx), và
    // Next biến `paths` thành plugin resolve chạy TRƯỚC alias — mọi bản build nạp gói rỗng dù
    // QUILDER_PROJECT đặt gì (đo 21/10/2026: composite của gói render thành khung trống, không
    // một dòng lỗi). Gỡ mục đó khỏi plugin thì được ở `next build` nhưng `next dev` gán lại.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^@project\//,(resource) => {
        resource.request = path.join(packDir, resource.request.slice('@project/'.length));
      }),
    );
    return config;
  },
};

export default nextConfig;
