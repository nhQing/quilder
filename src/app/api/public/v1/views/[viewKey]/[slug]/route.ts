/**
 * Một entry qua một view đặt sẵn: cùng `fields`/`populate` với danh sách của view, nên
 * màn chi tiết của app nhận đúng hình dạng mà màn danh sách đã nhận.
 */

import { errorPublic, jsonPublic, preflight } from '@/lib/collections/public-headers';
import { readPublicView } from '@/lib/collections/public-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ viewKey: string; slug: string }> },
) {
  const { viewKey, slug } = await params;
  const origin = request.headers.get('origin');
  const url = new URL(request.url);

  const result = await readPublicView(viewKey, url.searchParams, slug);
  if (!result.ok) return errorPublic(result.error, result.status, origin, result.code);

  return jsonPublic(result.payload, {
    origin,
    ifNoneMatch: request.headers.get('if-none-match'),
    maxAge: 60,
  });
}
