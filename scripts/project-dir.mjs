/**
 * Thư mục gói dự án đang dùng — một nguồn cho next.config, vitest và static-css.
 *
 * `QUILDER_PROJECT=<tên>` → `projects/<tên>`; trống → gói rỗng `src/project/none`.
 * Đặt tên gói mà thư mục không có `index.ts` thì NÉM: build Quilder thuần thay cho bản
 * một site chỉ vì gõ sai tên gói là một site mất hết section, không một dòng lỗi.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const NONE_PROJECT = 'src/project/none';

/** Tên gói hợp lệ: chữ thường, số, gạch nối — vừa tên thư mục, vừa an toàn trong đường dẫn. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** @returns {{ name: string | null, dir: string }} `dir` là đường dẫn tương đối từ gốc repo. */
export function projectDir(env = process.env, root = process.cwd()) {
  const name = env.QUILDER_PROJECT?.trim() || null;
  if (!name) return { name: null, dir: NONE_PROJECT };
  if (!NAME_RE.test(name)) {
    throw new Error(`QUILDER_PROJECT="${name}" không hợp lệ — chỉ chữ thường, số, gạch nối.`);
  }
  const dir = `projects/${name}`;
  if (!existsSync(join(resolve(root), dir, 'index.ts'))) {
    throw new Error(
      `QUILDER_PROJECT="${name}" nhưng không có ${dir}/index.ts. ` +
        `Clone gói vào ${dir}/, hoặc bỏ biến để build Quilder thuần.`,
    );
  }
  return { name, dir };
}
