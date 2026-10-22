import path from 'node:path';
import { defineConfig } from 'vitest/config';

import { projectDir } from './scripts/project-dir.mjs';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // Gói dự án đang chọn (QUILDER_PROJECT) — cùng hàm với next.config.mjs.
      '@project': path.resolve(import.meta.dirname, projectDir().dir),
      // `server-only` ném lỗi ngay khi được import ngoài bối cảnh RSC, nên bất kỳ
      // module nào khai nó đều không test được. Trước đây cách chữa là gỡ
      // `server-only` khỏi file cần test (password.ts đã từng bị gỡ) — nhưng như
      // vậy là đánh đổi một rào chắn thật lấy khả năng chạy test.
      //
      // Ở đây thay nó bằng module rỗng. Rào chắn vẫn có hiệu lực khi Next build,
      // vì Next dùng bản thật; chỉ trong vitest nó mới là no-op.
      'server-only': path.resolve(import.meta.dirname, 'test/server-only-stub.ts'),
    },
  },
  /*
   * JSX ở test phải dùng runtime TỰ ĐỘNG.
   *
   * Mặc định esbuild biên dịch JSX thành `React.createElement`, và file nguồn của
   * dự án không import React (Next 15 không cần) — nên mọi test render JSX chết
   * bằng "React is not defined", một câu chỉ về React chứ không về cấu hình.
   * `jsx: 'automatic'` dùng đúng transform mà Next dùng.
   */
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'scripts/**/*.test.mjs',
      // Test của gói dự án đi cùng gói (projects/<tên>/**). Gói không chọn vẫn chạy test
      // của nó: test gói không phụ thuộc gói nào đang bật.
      'projects/*/**/*.test.ts',
      'projects/*/**/*.test.tsx',
    ],
  },
});
