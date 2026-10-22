/**
 * Đổi `Site.primaryDomain`.
 *
 * ## Vì sao là một script chứ không phải một câu SQL trong runbook
 *
 * Runbook bản đầu bảo chạy `psql "$DATABASE_URL" -c "UPDATE ..."`. Hai thứ sai
 * cùng lúc, và cả hai chỉ lộ ra khi có người thật gõ nó: `psql` KHÔNG được cài
 * trên máy dev (Postgres chạy trong Docker, client thì không có), và `"$VAR"` là
 * cú pháp bash chứ không phải PowerShell.
 *
 * Script này chạy ở mọi chỗ mà `pnpm` chạy được — máy dev, máy CI, hay một shell
 * trên server — vì nó dùng đúng Prisma client mà app đã dùng. Không thêm phụ
 * thuộc nào.
 *
 * ## Vì sao KHÔNG có đường sửa trong builder
 *
 * Màn Cài đặt chỉ ĐỌC `primaryDomain`. Đó là chủ đích: đổi domain của một site
 * đang chạy là việc vận hành, không phải việc soạn nội dung, và nó không nên nằm
 * sau cùng một nút bấm với "sửa tiêu đề trang".
 *
 * ## Lưu ý về phạm vi
 *
 * `primaryDomain` KHÔNG sinh ra URL nào. Từ 20/10/2026 gốc URL là `Site.siteUrl` (sửa
 * ở Cài đặt › Tên miền & SEO — lưu ở đó cũng đồng bộ cột này), và env `SITE_URL` nếu
 * đặt thì ghi đè. Script này chỉ đổi nhãn `primaryDomain`.
 *
 *   pnpm site:domain ten-mien.vn
 *   pnpm site:domain            # chỉ xem, không ghi
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Chấp nhận `example.com` và `example.com:3001`, không chấp nhận scheme.
 *
 * Có `https://` ở đây là dấu hiệu người dùng đang nghĩ tới `SITE_URL` — hai thứ
 * khác nhau, và nhận nhầm sẽ làm màn Cài đặt hiện một giá trị vô nghĩa mà không
 * ai sửa lại.
 */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?$/i;

/**
 * `localhost` không có dấu chấm nên `DOMAIN_RE` từ chối nó — nhưng nó là giá trị
 * HỢP LỆ cho DB dev, và chính là giá trị đang có. Chặn nó nghĩa là script này chỉ
 * đi được một chiều: đặt được domain thật rồi không quay lại được.
 */
const LOCALHOST_RE = /^localhost(:\d{2,5})?$/i;

async function main() {
  const next = process.argv[2];

  const site = await prisma.site.findFirst({
    select: { id: true, name: true, primaryDomain: true },
  });
  if (!site) {
    console.error('Chưa có site nào trong database. Chạy seed trước.');
    process.exit(1);
  }

  if (!next) {
    console.log(`${site.name}: ${site.primaryDomain}`);
    console.log('\nĐổi:  pnpm site:domain <domain>');
    return;
  }

  if (next.includes('://')) {
    console.error(
      `"${next}" có scheme. Cột này chỉ giữ domain, ví dụ "ten-mien.vn".\n` +
        'URL đầy đủ đặt ở Cài đặt › Tên miền & SEO (hoặc env SITE_URL) — thứ sitemap và canonical thật sự đọc.',
    );
    process.exit(1);
  }

  if (!DOMAIN_RE.test(next) && !LOCALHOST_RE.test(next)) {
    console.error(`"${next}" không phải domain hợp lệ.`);
    process.exit(1);
  }

  if (next === site.primaryDomain) {
    console.log(`Đã là "${next}" rồi, không đổi gì.`);
    return;
  }

  await prisma.site.update({ where: { id: site.id }, data: { primaryDomain: next } });
  console.log(`${site.name}: ${site.primaryDomain} → ${next}`);
  console.log('\nNhắc: cột này KHÔNG sinh URL. URL site đặt ở Cài đặt › Tên miền & SEO.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
