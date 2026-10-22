#!/bin/sh
set -e

# Khởi tạo một stack MỚI, và không làm gì cả trên stack đã chạy.
#
# Bốn bước, mỗi bước tự kiểm trước khi làm, nên chạy lại bao nhiêu lần cũng an
# toàn — đó là điều kiện để service này nằm trong `docker compose up -d` mà không
# ai phải nhớ có nên chạy nó hay không.
#
#   1. Áp migration (Prisma tự bỏ qua migration đã áp).
#   2. Nạp bảng Token từ tokens.css — luôn chạy, vì nó là upsert theo tên.
#   3. Bổ sung site, trang chủ, trang 404 nếu còn thiếu — không phá gì.
#   4. Đồng bộ bảng Effect từ manifest — luôn chạy, vì nó là upsert.
#
# Cố ý KHÔNG tạo tài khoản admin ở đây: mật khẩu truyền qua biến môi trường sẽ
# nằm trong `docker inspect`, trong log của compose, và trong shell history của
# người gõ. Tài khoản đầu tiên tạo bằng `docker compose run --rm bootstrap
# pnpm user:create <email> <mật-khẩu>`, hoặc qua màn cài đặt trong trình duyệt
# nếu đã dựng.

echo "bootstrap: áp migration"
./node_modules/.bin/prisma migrate deploy --schema ./prisma/schema.prisma

# Bước này thiếu suốt từ đầu, và nó là lý do màn Cài đặt trên server hiện 12 thẻ
# "chưa khai báo trong tokens.css" trong khi site vẫn ra đúng màu.
#
# `tokens.css` được biên vào bundle CSS lúc build, nên SITE không cần bảng Token
# để hiện đúng. Bảng Token là CHỈ MỤC: nó là thứ duy nhất mà bộ chọn màu trong
# inspector, màn Cài đặt và `search_tokens` của MCP đọc được. Không nạp nó thì
# trang chạy vẫn đẹp còn người và AI thì mù — hỏng im lặng đúng kiểu khó tìm
# nhất, vì chỗ hỏng và chỗ có triệu chứng không liên quan gì đến nhau.
#
# Upsert theo tên, và giữ nguyên token đã sửa trong builder (`baseValue != null`),
# nên chạy lại ở mỗi lần `up -d` là an toàn — xem docblock của import-tokens.ts.
echo "bootstrap: dong bo bang Token tu tokens.css"
./node_modules/.bin/tsx scripts/import-tokens.ts

# Bổ sung dữ liệu tối thiểu còn thiếu: site, trang chủ, trang 404, release đầu.
#
# Thay cho bước cũ "seed nếu chưa có Site" (20/10/2026). Seed XOÁ site trước khi
# tạo, nên nó chỉ được chạy khi chắc chắn DB trắng — và phép kiểm "chắc chắn" đó
# đã từng nói dối (28/08/2026: lệnh kiểm ném, stderr bị chôn, chuỗi rỗng rơi vào
# nhánh "đã có site"). `ensure-defaults.ts` thì không phá gì: mỗi bước tự kiểm rồi
# mới tạo, nên nó chạy ở MỌI lần `up -d`, và lỗi thì `set -e` dừng bootstrap.
#
# Site đang chạy được bổ sung trang 404 ở dạng NHÁP; nó lên site thật ở lần Publish
# kế, tới lúc đó site vẫn dùng trang 404 trong code.
echo "bootstrap: bổ sung dữ liệu tối thiểu"
./node_modules/.bin/tsx scripts/ensure-defaults.ts

echo "bootstrap: đồng bộ bảng Effect"
./node_modules/.bin/tsx scripts/sync-effects.ts

echo "bootstrap: kiểm đã có tài khoản chưa"
./node_modules/.bin/tsx -e "
import { PrismaClient } from '@prisma/client';
import { setupToken } from './src/lib/auth/setup-token';
void (async () => {
  const p = new PrismaClient();
  const n = await p.user.count();
  await p.\$disconnect();
  if (n > 0) {
    console.log('bootstrap: đã có ' + n + ' tài khoản, bỏ qua màn cài đặt');
    return;
  }
  const t = setupToken(process.env.AUTH_SECRET ?? '');
  console.log('');
  console.log('  ╭───────────────────────────────────────────────╮');
  console.log('  │  Chưa có tài khoản nào.                       │');
  console.log('  │  Mở  /builder/setup  để tạo tài khoản admin.  │');
  console.log('  ╰───────────────────────────────────────────────╯');
  console.log('');
  console.log('  Mã cài đặt:  ' + t);
  console.log('');
  console.log('  Mã này dẫn xuất từ AUTH_SECRET, không lưu ở đâu cả.');
  console.log('  Màn cài đặt tự đóng vĩnh viễn sau khi có tài khoản đầu tiên.');
  console.log('');
})();
"

echo "bootstrap: xong"
