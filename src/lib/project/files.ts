/**
 * File ĐỌC LÚC CHẠY của gói dự án đang bật (CSS, token) — đường dẫn tương đối gốc repo.
 *
 * Đọc `QUILDER_PROJECT` trực tiếp, không qua `scripts/project-dir.mjs`: image chạy chỉ cần
 * `styles/` và `public/` của gói, còn hàm kia đòi `index.ts`. Tên gói đã được kiểm lúc build;
 * ở đây chỉ chặn tên lạ để nó không bao giờ thành một đường dẫn ngoài `projects/`.
 */

import { existsSync } from 'node:fs';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** `projects/<gói>/<rel>` nếu có gói và file tồn tại, ngược lại `null`. */
export function projectFile(rel: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = env.QUILDER_PROJECT?.trim();
  if (!name || !NAME_RE.test(name)) return null;
  const path = `projects/${name}/${rel}`;
  return existsSync(path) ? path : null;
}
