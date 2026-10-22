/**
 * Cây danh mục của một loại nội dung.
 *
 * Nằm dưới `/taxonomies/` chứ không phải `/[typeKey]/taxonomies`: đoạn đầu của
 * `/api/public/v1/[typeKey]` là một khoá loại tuỳ ý, nên một tài nguyên có tên cố
 * định phải nằm ở nhánh riêng — nếu không, một loại nội dung tên `taxonomies` sẽ
 * cướp mất đường này, và ai gặp lỗi đó sẽ mất một buổi để hiểu.
 *
 * Danh mục không tồn tại thì `data` RỖNG, không 404: "loại này chưa có danh mục nào"
 * và "không có loại này" là hai câu khác nhau, nhưng ở đây câu thứ hai không thêm gì
 * cho client — nó đã biết loại nào có từ `/types`.
 */

import { jsonPublic, preflight } from '@/lib/collections/public-headers';
import { readPublicTaxonomies } from '@/lib/collections/public-read';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get('origin'));
}

export async function GET(request: Request, { params }: { params: Promise<{ typeKey: string }> }) {
  const { typeKey } = await params;
  return jsonPublic(await readPublicTaxonomies(typeKey), {
    origin: request.headers.get('origin'),
    ifNoneMatch: request.headers.get('if-none-match'),
    maxAge: 300,
  });
}
