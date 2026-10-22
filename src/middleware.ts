import { NextResponse, type NextRequest } from 'next/server';

import { serviceMayReach } from '@/lib/auth/service-scope';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { isNoindexSite } from '@/lib/site-mode';

/**
 * Cổng chặn duy nhất cho builder và API.
 *
 * Chạy trên Edge, TRƯỚC React. Đó là lý do nó là cổng thật: không có JavaScript
 * nào trong trang phải chạy để nó có hiệu lực, nên tắt JS không bypass được.
 * Guard phía client (`useEffect` rồi redirect) chỉ là gợi ý lịch sự.
 *
 * Vì chạy trên Edge nên không dùng được Prisma và không dùng được `node:crypto`.
 * Nó CHỈ xác minh chữ ký JWT. Kiểm mật khẩu và tra database là việc của route
 * handler chạy trên Node.
 */

/**
 * Đường dẫn công khai dưới /api — phần còn lại đều phải có phiên.
 *
 * `/api/e2e/ping` trả 404 ở mọi nơi trừ stack e2e; xem docblock của route.
 */
const PUBLIC_API = ['/api/auth/login', '/api/auth/logout', '/api/e2e/ping'];

/**
 * Namespace ĐỌC cho mobile. Mở ở đây, không phải trong từng route.
 *
 * Đây là ngoại lệ duy nhất theo TIỀN TỐ chứ không theo đường dẫn chính xác, nên nó
 * đáng nói rõ: mọi thứ dưới `/api/public/v1` là chỉ đọc, chỉ thấy nội dung đã đăng,
 * và KHÔNG khai một method ghi nào (xem docblock của các route). Ngày có ai thêm một
 * `POST` ở đó, dòng này là thứ đã mở sẵn cửa cho nó — nên phép kiểm "namespace public
 * có method ghi nào không" ở cổng nghiệm thu mốc 4 là bắt buộc, không phải tuỳ chọn.
 *
 * Không đọc cookie ⇒ không có bề mặt CSRF; một request giả từ trang khác chỉ đọc
 * được đúng thứ mà bất kỳ ai cũng đọc được bằng curl.
 */
const PUBLIC_API_PREFIX = '/api/public/';

/**
 * Đường GHI công khai duy nhất: một lượt xem bài, từ chính site này.
 *
 * Docblock của `/api/views/[entryId]` vẫn nói "không đòi đăng nhập" từ ngày nó ra
 * đời, nhưng cổng này chưa bao giờ mở cho nó: khách nhận 401, `ViewCounter` nuốt
 * lỗi, và khu "xem nhiều nhất" chỉ đếm lượt xem của nhân viên.
 *
 * Khớp chính xác method và dạng id, không mở theo tiền tố: mở `/api/views/` sẽ mở
 * luôn mọi route ai đó thêm vào dưới đó về sau. Chống bơm số nằm ở route.
 */
const VIEW_ROUTE = /^\/api\/views\/[a-z0-9]{20,32}$/;

function isPublicWrite(pathname: string, method: string): boolean {
  return method === 'POST' && VIEW_ROUTE.test(pathname);
}

function isProtected(pathname: string): boolean {
  if (pathname.startsWith('/builder')) return true;
  if (pathname.startsWith('/render')) return true;
  if (pathname.startsWith('/preview')) return true;
  if (pathname.startsWith(PUBLIC_API_PREFIX)) return false;
  if (pathname.startsWith('/api')) return !PUBLIC_API.includes(pathname);
  return false;
}

/**
 * Trang đăng nhập phải mở, nếu không sẽ vòng lặp chuyển hướng vô tận.
 *
 * Màn cài đặt lần đầu cũng vậy, và vì một lý do khác: nó tồn tại ĐỂ tạo tài
 * khoản đầu tiên, nên đòi đăng nhập là đòi một thứ chưa thể có.
 *
 * Middleware chạy trên Edge nên KHÔNG đọc được database — nó không biết đã có
 * tài khoản hay chưa, và cũng không nên biết. Ba lớp chặn thật nằm ở
 * `POST /api/auth/setup`: bảng `User` rỗng, mã cài đặt khớp, mật khẩu đủ dài.
 * Xem `src/lib/auth/setup-token.ts`.
 */
function isOpen(pathname: string): boolean {
  return (
    pathname === '/builder/login' ||
    pathname === '/builder/setup' ||
    pathname === '/api/auth/setup' ||
    // Chỉ trả TRẠNG THÁI cài đặt (DB nối được chưa, đã có tài khoản chưa) — không
    // một giá trị cấu hình nào. Màn cài đặt cần nó trước khi có ai đăng nhập được.
    pathname === '/api/setup/status'
  );
}

/**
 * Token trong header `Authorization: Bearer`.
 *
 * Trình duyệt mang phiên bằng cookie; máy (MCP server) mang bằng header. Cùng
 * một JWT, cùng một chữ ký, chỉ khác đường đi. Không nhận Bearer ở đây thì token
 * service bị chặn ngay tại middleware và route handler không bao giờ chạy tới —
 * mọi phép kiểm quyền kỹ lưỡng bên dưới trở thành vô nghĩa.
 */
function bearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token || null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bản nháp và vỏ công cụ không bao giờ được index. Đặt ở đây để mọi đường vào
  // đều có header, kể cả những route quên khai `robots` trong metadata.
  //
  // `SITE_NOINDEX=true` mở rộng nó ra TOÀN site: một bản staging không được cạnh
  // tranh nội dung trùng với site thật, và nội dung nháp không được lên Google.
  // Header đặt ở middleware nên nó phủ cả sitemap.xml, robots.txt và mọi route —
  // không route nào phải nhớ tự khai.
  const noindex =
    isNoindexSite() ||
    pathname.startsWith('/builder') ||
    pathname.startsWith('/preview') ||
    pathname.startsWith('/render');

  const applyHeaders = (response: NextResponse) => {
    if (noindex) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  };

  if (!isProtected(pathname) || isOpen(pathname) || isPublicWrite(pathname, request.method)) {
    // Chuyển tiếp đường dẫn xuống server component.
    //
    // `(site)/layout.tsx` cần biết ngôn ngữ để đặt `<html lang>`, nhưng layout
    // không nhận được params của segment `[[...slug]]` nằm dưới nó. Middleware là
    // chỗ duy nhất thấy được đường dẫn trước khi React chạy.
    //
    // Middleware KHÔNG tự suy ra ngôn ngữ: nó chạy trên Edge nên không đọc được
    // bảng Locale, và hard-code danh sách mã ở đây sẽ tạo một nguồn sự thật thứ
    // hai lệch được khỏi database.
    const forwarded = new Headers(request.headers);
    forwarded.set('x-mm-path', pathname);
    return applyHeaders(NextResponse.next({ request: { headers: forwarded } }));
  }

  const token = bearer(request) ?? request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (session) {
    // Token service chỉ đi được đúng những đường mà MCP proxy dùng. Chặn ở đây
    // chứ không chỉ trong từng route: route mới thêm vào sẽ tự đóng với máy.
    // Xem `service-scope.ts`.
    if (session.kind === 'service' && !serviceMayReach(pathname, request.method)) {
      if (pathname.startsWith('/api')) {
        return NextResponse.json(
          { error: 'Token service chỉ dùng được qua bộ tool AI (/api/ai/tool)' },
          { status: 403 },
        );
      }
      return applyHeaders(
        new NextResponse('Token service không mở được trang này', { status: 403 }),
      );
    }
    // Đường dẫn cũng đi xuống layout ở nhánh ĐÃ đăng nhập. Thiếu nó, `(site)/layout`
    // của màn bản nháp (`/preview/…`) tưởng mình đang ở `/`: sai `<html lang>` cho bản
    // tiếng Anh, và nạp bó CSS của release thay vì của code hiện tại (13/10/2026).
    // Ghi đè, không tin giá trị client gửi lên — cùng cách nhánh công khai làm.
    const forwarded = new Headers(request.headers);
    forwarded.set('x-mm-path', pathname);
    return applyHeaders(NextResponse.next({ request: { headers: forwarded } }));
  }

  // API trả 401 chứ không chuyển hướng: client fetch cần một mã lỗi, không cần
  // trang HTML đăng nhập.
  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 });
  }

  const login = new URL('/builder/login', request.url);
  // Nhớ chỗ định vào, để sau khi đăng nhập quay lại đúng đó.
  login.searchParams.set('next', pathname + request.nextUrl.search);
  return applyHeaders(NextResponse.redirect(login));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|.*\\..*).*)'],
};
