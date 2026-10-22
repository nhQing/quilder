/**
 * Schema mọi loại nội dung — để mobile sinh model từ đây thay vì gõ tay.
 *
 * `maxAge` 300 chứ không 60: cấu trúc đổi hiếm hơn nội dung hàng chục lần, và một
 * client nạp nó lúc khởi động sẽ hỏi lại ở mỗi lần mở app.
 */

import { jsonPublic, preflight } from '@/lib/collections/public-headers';
import { readPublicTypes } from '@/lib/collections/public-read';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}

export async function GET(request: Request) {
  return jsonPublic(await readPublicTypes(), {
    origin: request.headers.get('origin'),
    ifNoneMatch: request.headers.get('if-none-match'),
    maxAge: 300,
  });
}
