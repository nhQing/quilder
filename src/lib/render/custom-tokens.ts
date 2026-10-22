import 'server-only';

/**
 * Token database → khai báo CSS phát lúc render.
 *
 * ## Vì sao file này phải tồn tại
 *
 * `src/styles/tokens.css` là nguồn sự thật của design system, và nó là một file
 * TĨNH: nó đi qua PostCSS lúc build. Một hàng `Token` mới thêm vào database sau
 * khi image đã build sẽ không bao giờ được file đó khai báo, nên `var(--tên)`
 * resolve về rỗng — thuộc tính bị bỏ qua, màu biến mất, và không có lỗi nào.
 *
 * Đây đúng là lý do site không dùng Tailwind (JIT quét source lúc build, nội
 * dung đổi sau đó). Cùng một cơ chế, cùng một cách gỡ: phát CSS lúc render.
 *
 * ## Hai loại token được phát, vì hai lý do khác nhau
 *
 *  1. **Token tự tạo** (`custom: true`) — chưa ai khai báo chúng ở đâu.
 *  2. **Token nền tảng đã sửa** (`baseValue != null`, từ 03/09/2026) — chúng CÓ
 *     trong `tokens.css`, nhưng khai báo đó đông cứng lúc build, nên giá trị mới
 *     phải được phát đè lên.
 *
 * Vẫn KHÔNG phát 469 token tĩnh còn lại: chúng đã có trong stylesheet, phát lại
 * là nhân đôi từng khai báo trên MỌI lượt tải trang mà không thêm được gì.
 *
 * ## Vì sao khai báo ở `:root` chứ không trong `@layer`
 *
 * Custom property không tuân theo cascade layer như thuộc tính thường — chúng
 * resolve theo specificity và thứ tự nguồn. Đặt trong layer chỉ tạo ảo giác về
 * thứ tự ưu tiên mà không đổi được kết quả. Xem `OVERRIDE_SELECTOR` cho chỗ mà
 * specificity thật sự cắn: khối `[data-theme="light"]` của `tokens.css`.
 */

import { unstable_cache } from 'next/cache';

import { TOKEN_COLOR_RE, TOKEN_NAME_RE, isEmittableOverride } from '@/lib/design/foundations';
import { isSafeTokenValue } from '@/lib/design/token-value';
import { prisma } from '@/lib/db';

/** Tag revalidate — mọi đường tạo/xoá token tự tạo phải gọi nó. */
export const CUSTOM_TOKENS_TAG = 'custom-tokens';

export { TOKEN_COLOR_RE, TOKEN_NAME_RE };

/**
 * Selector cho khối override.
 *
 * ## Vì sao KHÔNG chỉ `:root`
 *
 * `tokens.css` khai lại `--color-bg`, `--color-fg` và `--color-muted` trong khối
 * `[data-theme="light"]` (dòng 927). Specificity của `[data-theme="light"]` là
 * (0,1,0), của `:root` là (0,0,0) — nên một khối `:root` phát sau vẫn THUA ở
 * light theme, bất kể thứ tự nguồn.
 *
 * Hệ quả nếu để nguyên: người dùng đổi Màu nền, thấy đổi trong builder, đổi trên
 * bản dark, và không đổi trên light. Không lỗi, không dấu vết — đúng loại hỏng
 * mà cả file này tồn tại để tránh.
 *
 * Nên phát cả hai selector. Mỗi selector trong danh sách được tính specificity
 * RIÊNG, nên `:root` thắng `:root` của tokens.css bằng thứ tự nguồn, và
 * `[data-theme="light"]` thắng `[data-theme="light"]` cũng bằng thứ tự nguồn.
 *
 * ## Vì sao phát cho MỌI token bị sửa, không chỉ 3 cái đang có trong khối light
 *
 * Một cờ "token này có trong khối light" phải khớp với một file CSS mà file đó
 * đổi độc lập. Cờ trôi = đúng cái lỗi im lặng vừa mô tả, chỉ khác chỗ. Phát thừa
 * vài dòng cho token không có mặt trong khối light thì không hại gì: cùng giá trị,
 * cùng kết quả.
 */
const OVERRIDE_SELECTOR = ':root,\n[data-theme="light"]';

interface TokenRow {
  name: string;
  value: string;
  custom: boolean;
}

/**
 * Token PHẢI được phát lúc render: token tự tạo, và token tĩnh đã bị sửa.
 *
 * Hai loại, một truy vấn, hai lý do khác nhau:
 *
 *  - `custom: true` — chưa ai khai báo chúng ở đâu cả, không phát thì `var(--tên)`
 *    rỗng và màu biến mất.
 *  - `baseValue != null` — `tokens.css` CÓ khai báo, nhưng khai báo đó đông cứng
 *    lúc build. Giá trị mới trong database không có đường nào vào file đó.
 *
 * Vẫn KHÔNG phát 469 token tĩnh còn lại: chúng đã có trong stylesheet, phát lại
 * là nhân đôi từng khai báo trên MỌI lượt tải trang mà không thêm được gì.
 */
async function readEmittedTokens(): Promise<TokenRow[]> {
  return prisma.token.findMany({
    where: { deprecated: false, OR: [{ custom: true }, { NOT: { baseValue: null } }] },
    orderBy: { name: 'asc' },
    select: { name: true, value: true, custom: true },
  });
}

const cachedEmittedTokens = unstable_cache(readEmittedTokens, ['custom-tokens'], {
  tags: [CUSTOM_TOKENS_TAG],
});

/**
 * Một hàng có được ghép vào stylesheet không.
 *
 * Lọc lại dù đường ghi đã kiểm. Dữ liệu có thể vào bảng qua `prisma studio`, qua
 * seed, qua một script sau này — và chỗ DUY NHẤT chắc chắn nằm giữa database và
 * stylesheet là chỗ này. Hàng nào không hợp lệ thì bỏ, không ném: một token hỏng
 * không đáng để cả trang trắng.
 *
 * Token tự tạo nhận mọi giá trị CSS AN TOÀN (`isSafeTokenValue`, từ 21/10/2026 — token
 * riêng của một dự án nằm trong DB, không chỉ màu). Giá trị đè của mục Nền tảng cũ thì
 * theo kiểu của nó — `font-body` là một stack, `leading-body` là một số trần, và
 * bắt chúng qua `TOKEN_COLOR_RE` sẽ loại sạch mọi giá trị đúng.
 */
function usable(row: TokenRow): boolean {
  if (!TOKEN_NAME_RE.test(row.name)) return false;
  if (row.custom) return isSafeTokenValue(row.value);
  // Mục Nền tảng đã gỡ, nhưng giá trị đè cũ vẫn phát — xem `lib/design/foundations.ts`.
  return isEmittableOverride(row.name, row.value);
}

function block(selector: string, rows: TokenRow[]): string {
  if (!rows.length) return '';
  const decls = rows.map((r) => `  --${r.name}: ${r.value};`).join('\n');
  return `${selector} {\n${decls}\n}\n`;
}

/**
 * CSS khai báo token tự tạo và token nền tảng đã sửa, hoặc rỗng khi chưa có gì.
 *
 * Bản đọc bảng LIVE — dùng cho ba màn bản nháp và cho site công khai (màu nền
 * tảng cố ý không đi qua ảnh chụp `Release`; xem `(site)/[[...slug]]/page.tsx`).
 */
export async function customTokensCss(): Promise<string> {
  const rows = (await cachedEmittedTokens()).filter(usable);
  if (!rows.length) return '';

  /*
   * Token tự tạo ở `:root` thường là đủ — không ai khai lại chúng ở khối light,
   * nên không có gì để thắng. Chỉ token nền tảng mới cần selector đôi.
   */
  const custom = rows.filter((r) => r.custom);
  const overridden = rows.filter((r) => !r.custom);

  return block(':root', custom) + block(OVERRIDE_SELECTOR, overridden);
}

/**
 * CHỈ token nền tảng đã sửa — bản dành cho SITE CÔNG KHAI.
 *
 * ## Vì sao site công khai cần một hàm riêng thay vì dùng `customTokensCss`
 *
 * Hai loại token trong bảng đi theo hai hợp đồng khác nhau, và trộn chúng lại là
 * phá một trong hai:
 *
 *  - **Token tự tạo** được SEAL vào `Release` (`publish/route.ts`). Site đọc ảnh
 *    chụp qua `tokenCssFromSeal`. Phát thêm bản live ở đây sẽ khiến thêm một
 *    token là đổi ngay site đang chạy, vòng qua publish — đúng loại lỗi đã phải
 *    sửa hai lần rồi (bản dịch, rồi component).
 *  - **Token nền tảng đã sửa** thì CỐ Ý không qua ảnh chụp (quyết định 03/09/2026:
 *    đổi màu nhận diện phải thấy ngay). Từ 13/10/2026 mục Nền tảng bị gỡ và các
 *    giá trị này đóng băng — xem `lib/design/foundations.ts` — nhưng vẫn phải phát
 *    ở đây, vì nền trắng của site chính là một trong số chúng.
 *
 * Khối này in SAU `tokenCssFromSeal` ở trang site, nên với cùng specificity thì
 * nó thắng — kể cả khi một ngày nào đó cùng một tên có mặt ở cả hai nơi.
 */
export async function foundationOverrideCss(): Promise<string> {
  const rows = (await cachedEmittedTokens()).filter((r) => !r.custom && usable(r));
  return block(OVERRIDE_SELECTOR, rows);
}

/**
 * Ảnh chụp token của một release → khai báo `:root`.
 *
 * Bản dành cho SITE CÔNG KHAI. `customTokensCss` ở trên đọc bảng live và chỉ dành
 * cho ba màn bản nháp — dùng nó ở site nghĩa là thêm một token là đổi ngay site
 * đang chạy, bỏ qua publish.
 *
 * Lọc lại bằng đúng hai regex trên, và vì đúng lý do đã ghi ở đó: chỗ DUY NHẤT
 * chắc chắn nằm giữa dữ liệu và stylesheet là chỗ này. Ảnh chụp còn đi qua thêm
 * một chặng JSONB nữa, nên kiểm lại càng đáng. Hàng nào không hợp lệ thì bỏ,
 * không ném — một token hỏng không đáng để cả trang trắng.
 *
 * Sắp theo tên để hai lần render cùng dữ liệu ra cùng chuỗi. Thứ tự khoá của
 * JSONB không được bảo đảm, và một chuỗi CSS nhảy thứ tự sẽ làm mọi phép so HTML
 * (kể cả `prove-release-sealed.ts`) đỏ vì lý do sai.
 */
export function tokenCssFromSeal(seal: Record<string, string>): string {
  const decls = Object.entries(seal)
    .filter(([name, value]) => TOKEN_NAME_RE.test(name) && isSafeTokenValue(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `  --${name}: ${value};`);

  if (!decls.length) return '';
  return `:root {\n${decls.join('\n')}\n}\n`;
}
