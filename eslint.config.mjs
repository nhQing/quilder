/**
 * Cấu hình ESLint (flat config).
 *
 * Trước 08/10/2026 repo không có file này: `next lint` dừng ở câu hỏi tương tác "bạn
 * muốn cấu hình thế nào?" và treo, còn `next.config.mjs` đặt `ignoreDuringBuilds` để
 * build không bao giờ chạm tới lint. Nghĩa là các dòng `eslint-disable-next-line` rải
 * trong code chưa từng được kiểm là còn cần hay không.
 *
 * `eslint-config-next` 15 vẫn xuất cấu hình kiểu cũ, nên đi qua FlatCompat — đúng mẫu
 * mà `create-next-app` sinh ra.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      '.next/**',
      '.next-e2e/**',
      'node_modules/**',
      'generated/**',
      'test-results/**',
      'playwright-report/**',
      '.e2e-cache/**',
      'projects/*/scripts/migrate/out/**',
      // Thư mục nháp cục bộ (đã gitignore): ảnh chụp đo, bản build riêng của server chụp.
      '_to_delete/**',
      'public/**',
      'next-env.d.ts',
      // Worktree và bộ nhớ của Claude Code (`.claude/worktrees/<nhánh>` là một bản checkout
      // ĐẦY ĐỦ, kèm `.next-e2e` đã build). Ẩn khỏi git qua `.git/info/exclude`, nên hook
      // pre-push không thấy nó để bỏ qua — và `eslint .` quét ~2.900 lỗi của file build.
      '.claude/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      /*
       * Mọi `dangerouslySetInnerHTML` trong repo đã mang sẵn
       * `eslint-disable-next-line react/no-danger` kèm lý do — nhưng rule chưa từng bật,
       * nên các dòng đó không chặn gì. Bật lên: chỗ MỚI phải dừng lại và ghi lý do, đúng
       * loại chỗ đã sinh ra lỗ JSON-LD (lộ trình nâng cấp A2).
       */
      'react/no-danger': 'error',
      // `_tên` là quy ước "cố ý không dùng" đã có khắp repo (ví dụ `_request`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Test dựng dữ liệu sai hình dạng có chủ đích; `any` ở đó là công cụ, không phải lỗ.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Script chạy bằng node/tsx ngoài Next: không có trang, không có <img>.
    files: ['scripts/**', 'mcp/**', 'e2e/**', 'prisma/**'],
    rules: {
      '@next/next/no-img-element': 'off',
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];

export default config;
