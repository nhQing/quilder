#!/bin/sh
set -e

# admin-ui dùng entrypoint để sed-replace PLACEHOLDER_API_BASE_URL vào bundle đã
# build, vì Next nướng biến NEXT_PUBLIC_* vào lúc build. Ở đây KHÔNG cần trò đó:
# app này đọc mọi thứ ở server (DATABASE_URL, AUTH_SECRET, S3…), nên biến môi
# trường có tác dụng ngay mà không phải vá bundle.

if [ -z "$DATABASE_URL" ]; then
  echo "entrypoint: thiếu DATABASE_URL" >&2
  exit 1
fi

# Kho asset phải cấu hình đủ TRƯỚC khi nhận request.
#
# Thiếu mà vẫn khởi động nghĩa là lỗi lộ ra lúc người dùng tải ảnh đầu tiên — giữa
# một phiên làm việc, và với một thông báo không nói được phải sửa ở đâu. Ở đây thì
# nó lộ ra lúc deploy, kèm tên biến.
#
# S3_ENDPOINT KHÔNG nằm trong danh sách: rỗng là hợp lệ và nghĩa là "AWS thật".
for v in S3_BUCKET S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_PUBLIC_BASE_URL; do
  eval "val=\$$v"
  if [ -z "$val" ]; then
    echo "entrypoint: thiếu $v — tải ảnh lên sẽ không hoạt động. Xem .env.example" >&2
    exit 1
  fi
done

# CSS tĩnh phải có mặt TRƯỚC khi nhận request.
#
# `compileStaticCss` đọc file này lúc chạy — lúc publish, và lúc phục vụ
# `/mm-css/<hash>.css`. Thiếu nó thì container start bình thường, HTML trả 200, và
# site hiện ra KHÔNG CÓ CSS NÀO; Publish thì 500. Đúng chuyện đã xảy ra ngày
# 19/08/2026 ở lần chạy image thật đầu tiên, vì `output: 'standalone'` không gom
# `src/styles` (xem Dockerfile).
#
# Kiểm ở đây để lỗi lộ ra lúc deploy kèm tên file, thay vì lộ ra dưới dạng một trang
# trắng trước mặt khách.
if [ ! -f src/styles/site.css ]; then
  echo "entrypoint: thiếu src/styles/site.css — image build sai, xem Dockerfile" >&2
  exit 1
fi

# CỐ Ý không chạy `prisma migrate deploy` ở đây. Hai lý do:
#
#  1. Prisma CLI không nằm trong output standalone của Next; copy nó vào image
#     làm phình thêm hàng chục MB chỉ để chạy một lệnh mỗi lần deploy.
#  2. Nhiều container cùng start và cùng migrate là một race condition thật.
#     Migration phải là một bước có chủ đích, chạy đúng một lần.
#
# Thay vào đó: kiểm tra schema và fail nhanh với hướng dẫn cụ thể.
node ./scripts/check-schema.mjs

echo "entrypoint: khởi động Next trên ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node server.js
