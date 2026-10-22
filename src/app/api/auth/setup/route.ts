import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

/**
 * Cài đặt site lần đầu, từ trình duyệt: site + domain + tài khoản admin ĐẦU TIÊN.
 *
 * Đây là endpoint công khai duy nhất cấp được quyền admin, nên nó có ba lớp chặn
 * và cả ba đều phải qua:
 *
 *  1. **Bảng `User` phải rỗng.** Đây là lớp thật sự đóng cửa: tạo xong tài khoản
 *     đầu tiên là endpoint này chết vĩnh viễn, không cần ai nhớ tắt nó.
 *  2. **Mã cài đặt** khớp — xem `setup-token.ts`. Lớp 1 một mình không đủ vì
 *     container lên trước khi người vận hành kịp mở trình duyệt. Chỉ đòi ở
 *     production (`setup-policy.ts`): `next dev` không bao giờ là bản public.
 *  3. **Dữ liệu vào hợp lệ**, mật khẩu tối thiểu 12 ký tự. Tài khoản này có toàn
 *     quyền trên site; để mặc định yếu là mời người ta đặt `admin123` rồi quên mất.
 *
 * Kiểm theo đúng thứ tự đó, và luôn trả thông điệp NÓI RÕ cái gì sai, kèm `field`
 * để màn cài đặt mở lại đúng ô — endpoint này chỉ sống vài phút và người đọc lỗi
 * là người vận hành, không phải kẻ tấn công (kẻ tấn công không qua nổi lớp 2).
 *
 * Từ 20/10/2026 nó còn khởi tạo dữ liệu tối thiểu (`ensureSiteDefaults`: site,
 * trang chủ, trang 404, release đầu) — không phá gì nếu đã có.
 */

import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { setupTokenMatches } from '@/lib/auth/setup-token';
import { setupTokenRequired } from '@/lib/auth/setup-policy';
import { SESSION_COOKIE, SESSION_MAX_AGE, sessionCookieSecure, signSession } from '@/lib/auth/session';
import { ensureSiteDefaults } from '@/lib/setup/defaults';
import { ensureDesignTokens } from '@/lib/setup/design-tokens';
import { ensureEffects } from '@/lib/setup/effects';
import { normalizeSiteUrl, SITE_SETTINGS_TAG, siteUrlFromEnv } from '@/lib/site/origin';

export const dynamic = 'force-dynamic';

const MIN_PASSWORD = 12;
const MAX_SITE_NAME = 100;

interface Body {
  siteName?: string;
  siteUrl?: string;
  email?: string;
  password?: string;
  token?: string;
}

type Field = 'siteName' | 'siteUrl' | 'email' | 'password' | 'token';

function fail(status: number, error: string, field?: Field) {
  return NextResponse.json({ error, ...(field ? { field } : {}) }, { status });
}

export async function POST(request: Request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return fail(500, 'Server thiếu AUTH_SECRET');

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return fail(400, 'JSON không hợp lệ');
  }

  // Lớp 1 — cửa đã đóng chưa.
  if ((await prisma.user.count()) > 0) {
    return fail(409, 'Đã có tài khoản. Màn cài đặt chỉ dùng được một lần — hãy đăng nhập.');
  }

  // Lớp 2 — mã cài đặt (chỉ ở production).
  if (setupTokenRequired() && !setupTokenMatches(secret, body.token)) {
    return fail(403, 'Mã cài đặt không đúng. Lấy nó bằng: docker compose -f docker-compose.prod.yaml logs bootstrap', 'token');
  }

  // Lớp 3 — dữ liệu vào.
  const siteName = body.siteName?.trim() ?? '';
  if (!siteName) return fail(400, 'Cần tên site', 'siteName');
  if (siteName.length > MAX_SITE_NAME) {
    return fail(400, `Tên site tối đa ${MAX_SITE_NAME} ký tự`, 'siteName');
  }

  /*
   * Env `SITE_URL` đã đặt thì nó thắng (xem `origin.ts`), và ô URL trên màn đã khoá.
   * Bỏ qua giá trị trong body thay vì lưu nó: lưu là ghi vào DB một giá trị không
   * có tác dụng, và ngày gỡ env thì nó bất ngờ có tác dụng.
   */
  let siteUrl: string | undefined;
  if (!siteUrlFromEnv()) {
    const normalized = normalizeSiteUrl(body.siteUrl);
    if (!normalized) {
      return fail(
        400,
        'URL site phải có dạng https://ten-mien.vn — có http:// hoặc https://, không có đường dẫn phía sau',
        'siteUrl',
      );
    }
    siteUrl = normalized;
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(400, 'Email không hợp lệ', 'email');
  }
  if (password.length < MIN_PASSWORD) {
    return fail(400, `Mật khẩu phải từ ${MIN_PASSWORD} ký tự trở lên`, 'password');
  }

  // Băm NGOÀI transaction: argon2 tốn hàng trăm ms, và giữ transaction mở trong lúc
  // đó là ăn vào thời hạn 5 giây của Prisma.
  const passwordHash = await hashPassword(password);

  /*
   * Đếm lại User BÊN TRONG transaction, cùng lúc khởi tạo site.
   *
   * Hai request tới cùng lúc — hai tab, hoặc một lần bấm đúp — đều thấy `count()`
   * bằng 0 ở trên. Không có phép kiểm thứ hai trong transaction thì cả hai cùng
   * tạo tài khoản, và site có hai admin mà chỉ một người biết.
   */
  const user = await prisma.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return null;
    await ensureSiteDefaults(tx, { name: siteName, siteUrl });
    return tx.user.create({
      data: { email, passwordHash, role: 'admin' },
      select: { id: true, email: true, role: true, name: true },
    });
  });

  if (!user) {
    return fail(409, 'Tài khoản vừa được tạo bởi một request khác. Hãy đăng nhập.');
  }

  /*
   * Token và effect: SAU transaction, và lỗi ở đây không làm hỏng việc cài đặt.
   *
   * Site và tài khoản đã có — đó là thứ không làm lại được từ màn này (nó vừa tự
   * đóng). Thiếu bảng Token/Effect thì site vẫn render đúng; chỉ bộ chọn màu và
   * danh sách effect trống, và `pnpm tokens:import` / `pnpm effects:sync` lấp lại
   * được bất cứ lúc nào. Nên báo ra thành cảnh báo, không thành lỗi.
   */
  const warnings: string[] = [];
  try {
    await ensureDesignTokens(prisma);
  } catch (err) {
    console.error('[setup] nạp bảng Token thất bại:', err);
    warnings.push('Chưa nạp được bảng Token. Chạy `pnpm tokens:import` để nạp lại.');
  }
  try {
    await ensureEffects(prisma);
  } catch (err) {
    console.error('[setup] đồng bộ bảng Effect thất bại:', err);
    warnings.push('Chưa đồng bộ được bảng Effect. Chạy `pnpm effects:sync` để đồng bộ lại.');
  }

  revalidateTag(SITE_SETTINGS_TAG);
  revalidateTag('release');

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'auth.setup',
      targetType: 'User',
      targetId: user.id,
      meta: { email: user.email, siteName, siteUrl: siteUrl ?? null, note: 'cài đặt site qua màn cài đặt' },
    },
  });

  // Đăng nhập luôn: bắt người ta gõ lại mật khẩu vừa đặt xong không thêm an toàn
  // nào, chỉ thêm một bước.
  const token = await signSession({
    sub: user.id,
    email: user.email,
    role: 'admin',
    name: user.name ?? undefined,
  });

  const response = NextResponse.json({ ok: true, user: { email: user.email }, warnings });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(),
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
