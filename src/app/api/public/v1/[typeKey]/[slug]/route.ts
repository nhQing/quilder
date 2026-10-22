/**
 * Một entry theo slug. Chỉ đọc — xem docblock của route danh sách.
 *
 * 404 cho cả ba trường hợp "không có" / "còn nháp" / "hẹn giờ chưa tới": phân biệt
 * chúng là rò rỉ sự tồn tại của một bài chưa đăng cho bất kỳ ai đoán được slug.
 */

import { errorPublic, jsonPublic, preflight } from '@/lib/collections/public-headers';
import { readPublicOne } from '@/lib/collections/public-read';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ typeKey: string; slug: string }> },
) {
  const { typeKey, slug } = await params;
  const origin = request.headers.get('origin');
  const url = new URL(request.url);

  const result = await readPublicOne(typeKey, slug, url.searchParams);
  if (!result.ok) return errorPublic(result.error, result.status, origin, result.code);

  return jsonPublic(result.payload, {
    origin,
    ifNoneMatch: request.headers.get('if-none-match'),
    maxAge: 60,
  });
}
