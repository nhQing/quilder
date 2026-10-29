/**
 * Danh sách qua một view đặt sẵn — xem `public-view.ts`. Chỉ đọc, như mọi route của
 * namespace này.
 *
 * Đoạn `views` là TĨNH nên Next ưu tiên nó hơn `[typeKey]`; vì thế `views` nằm trong
 * `RESERVED_TYPE_KEYS` của `type-write.ts` — một loại mang khoá đó sẽ không bao giờ gọi
 * được qua `/{typeKey}`.
 */

import { errorPublic, jsonPublic, preflight } from '@/lib/collections/public-headers';
import { readPublicView } from '@/lib/collections/public-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}

export async function GET(request: Request, { params }: { params: Promise<{ viewKey: string }> }) {
  const { viewKey } = await params;
  const origin = request.headers.get('origin');
  const url = new URL(request.url);

  const result = await readPublicView(viewKey, url.searchParams);
  if (!result.ok) return errorPublic(result.error, result.status, origin, result.code);

  return jsonPublic(result.payload, {
    origin,
    ifNoneMatch: request.headers.get('if-none-match'),
    maxAge: 60,
  });
}
