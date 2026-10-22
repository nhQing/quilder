/**
 * Danh sách nội dung đã đăng.
 *
 * KHÔNG có POST/PUT/PATCH/DELETE ở namespace này, và KHÔNG đọc cookie — nên không có
 * bề mặt CSRF. README non-goal: "Không chức năng app trên site marketing… Đây là ranh
 * giới bảo mật." Thêm một method ghi ở đây là mở lại đúng ranh giới đó, và nó sẽ
 * không lộ ra trong bất kỳ test nào vì mọi thứ khác vẫn chạy.
 */

import { errorPublic, jsonPublic, preflight } from '@/lib/collections/public-headers';
import { readPublicList } from '@/lib/collections/public-read';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}

export async function GET(request: Request, { params }: { params: Promise<{ typeKey: string }> }) {
  const { typeKey } = await params;
  const origin = request.headers.get('origin');
  const url = new URL(request.url);

  const result = await readPublicList(typeKey, url.searchParams);
  if (!result.ok) return errorPublic(result.error, result.status, origin, result.code);

  return jsonPublic(result.payload, {
    origin,
    ifNoneMatch: request.headers.get('if-none-match'),
    maxAge: 60,
  });
}
