/**
 * Kiểm tra DB đã được áp ĐỦ migration chưa, dùng Prisma Client (đã có sẵn trong
 * image) thay vì Prisma CLI (không có trong output standalone, và copy vào thì
 * phình image hàng chục MB).
 *
 * Mục đích là fail NHANH và RÕ. Không có bước này, một container chạy trên DB
 * chưa migrate vẫn start bình thường rồi ném lỗi Prisma khó hiểu ở request đầu
 * tiên — tức lỗi lộ ra trước mặt người dùng thay vì lúc deploy.
 *
 * ## Vì sao so DANH SÁCH MIGRATION, không phải sự tồn tại của bảng "Site"
 *
 * Bản trước chỉ hỏi một câu: bảng "Site" có tồn tại không. Câu đó chỉ bắt được
 * trường hợp DB TRẮNG, và nó bỏ lọt đúng ca hay xảy ra nhất: DB đã có schema cũ,
 * image mới mang theo một migration chưa ai áp. Bảng "Site" vẫn tồn tại nên phép
 * kiểm nói OK, app start, rồi mọi truy vấn chạm cột mới đều ném.
 *
 * Xảy ra thật ngày 28/08/2026 với `20260827110000_site_favicon`: cột
 * `Site.faviconAssetId` không có trong DB của staging, và hệ quả nhìn từ trình
 * duyệt không hề giống một lỗi migration —
 *
 *   /builder    → "Failed to execute 'json' on 'Response': Unexpected end of JSON
 *                 input", vì route handler ném thì Next trả 500 THÂN RỖNG và
 *                 `res.json()` chết trước khi ai kịp đọc mã lỗi
 *   trang chủ   → "Application error: a client-side exception has occurred", vì
 *                 `generateMetadata` của `(site)/layout.tsx` gọi `siteIcons()` và
 *                 nó ném SAU khi shell đã flush — lỗi server nổ ra ở client
 *
 * Không có dòng nào trong hai thông báo đó chỉ về phía DB. Đó là toàn bộ lý do
 * phép kiểm này phải chặt: nó là chỗ duy nhất còn nói được sự thật.
 */

import { readdirSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

const HUONG_DAN = [
  '',
  'Entrypoint cố ý KHÔNG tự migrate: khi chạy nhiều replica, nhiều container',
  'cùng migrate một lúc là một race condition thật. Việc đó thuộc về service',
  '`bootstrap`, và `app` chờ nó bằng service_completed_successfully.',
  '',
  'Áp migration rồi start lại app:',
  '',
  '  docker compose -f docker-compose.prod.yaml up -d bootstrap',
  '  docker logs quilder-bootstrap                         # xem nó nói gì',
  '  docker compose -f docker-compose.prod.yaml up -d app',
  '',
  'hoặc từ máy dev, trỏ DATABASE_URL vào DB đó:  pnpm exec prisma migrate deploy',
  '',
];

function bao(dong) {
  console.error(['', ...dong, ...HUONG_DAN].join('\n'));
  process.exit(1);
}

/**
 * Tên migration trên đĩa. Thư mục `prisma/` được copy vào runner (xem Dockerfile),
 * nên đây là danh sách mà CHÍNH image này cần — không phải danh sách của một bản
 * nào khác.
 */
function tuDia() {
  return readdirSync('./prisma/migrations', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

try {
  const canCo = tuDia();

  /*
   * Chỉ tính migration đã chạy XONG và chưa bị rollback.
   *
   * Một hàng `finished_at IS NULL` là một migration ĐANG dở hoặc ĐÃ CHẾT giữa
   * đường — DB lúc đó ở trạng thái nửa vời, và coi nó là "đã áp" nghĩa là để app
   * chạy trên đúng cái schema không ai biết hình dạng.
   */
  let daAp;
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    daAp = new Set(rows.map((r) => r.migration_name));
  } catch (err) {
    const moTa = String(err).split('\n')[0];
    if (/_prisma_migrations/.test(String(err))) {
      bao(['DB chưa migrate lần nào — bảng "_prisma_migrations" không tồn tại.']);
    }
    console.error('entrypoint: không kết nối được DB —', moTa);
    process.exit(1);
  }

  const thieu = canCo.filter((m) => !daAp.has(m));

  if (thieu.length) {
    bao([
      `DB thiếu ${thieu.length}/${canCo.length} migration mà image này cần:`,
      '',
      ...thieu.map((m) => `  - ${m}`),
      '',
      'App sẽ start được nhưng mọi truy vấn chạm cột mới đều ném, và lỗi hiện ra',
      'ở trình duyệt dưới dạng "Unexpected end of JSON input" hoặc "client-side',
      'exception" — không dòng nào chỉ về phía DB.',
    ]);
  }

  console.log(`entrypoint: schema OK — ${canCo.length} migration đã áp`);
} catch (err) {
  console.error('entrypoint: không kiểm được schema —', String(err).split('\n')[0]);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
