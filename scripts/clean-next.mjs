/**
 * Xoá cache build của Next (`.next`).
 *
 * Vì sao cần một script chứ không phải `rm -rf .next` trong package.json: máy dev
 * chính của dự án là Windows, ở đó `rm -rf` không tồn tại. `fs.rm` chạy giống nhau
 * trên mọi nền tảng.
 *
 * Khi nào dùng: dev server bị kill giữa lúc compile sẽ để lại manifest trang trỏ
 * tới một vendor chunk chưa kịp ghi ra đĩa. Triệu chứng là
 * `Cannot find module './vendor-chunks/<pkg>@<ver>.js'` — trông y như thiếu
 * dependency, nhưng `node_modules` vẫn đủ. Xoá `.next` là xong; `pnpm install`
 * không giải quyết gì vì package chưa bao giờ thiếu.
 */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), '.next');
await rm(target, { recursive: true, force: true });
console.log(`Đã xoá ${target}`);
