import { redirect } from 'next/navigation';

/**
 * Kho dữ liệu › View của API: đường gọi ngắn cho app bên ngoài. Chỉ admin — view quyết
 * định app nhận được gì, cùng tầm với cấp token. Route API bên dưới tự kiểm lại quyền;
 * chuyển hướng ở đây chỉ để người không phải admin không thấy một màn bấm gì cũng 403.
 */

import { getSession } from '@/lib/auth/guard';
import { listApiViews } from '@/lib/collections/api-view-store';
import { POPULATE_FIELD_TYPES } from '@/lib/collections/public-params';
import { getCollectionTypes } from '@/lib/collections/queries';
import { ApiViewManager, type ViewTypeHint } from '@/components/builder/ApiViewManager';
import { PageHeader, PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ApiViewsPage() {
  const session = await getSession();
  if (!session) redirect('/builder/login?next=/builder/content/views');
  if (session.role !== 'admin') redirect('/builder/content');

  const [views, types] = await Promise.all([listApiViews(), getCollectionTypes()]);

  // Gợi ý field cho ô query: field của loại, và với mỗi field quan hệ, field nào của
  // loại đích xin được qua `populate[field]=…` — cùng danh sách trắng mà API dùng.
  const hints: ViewTypeHint[] = types.map((t) => ({
    key: t.key,
    name: t.namePlural,
    fields: t.schema.filter((f) => f.t !== 'taxonomy').map((f) => f.key),
    relations: t.schema.flatMap((f) =>
      f.t === 'relation'
        ? [{
            key: f.key,
            target: f.typeKey,
            fields: (types.find((x) => x.key === f.typeKey)?.schema ?? [])
              .filter((x) => POPULATE_FIELD_TYPES.has(x.t))
              .map((x) => x.key),
          }]
        : [],
    ),
  }));

  return (
    <PageShell>
      <PageHeader
        crumbs={[{ label: 'Kho dữ liệu', href: '/builder/content' }]}
        title="View của API"
        count={views.length}
        description="Đường gọi ngắn cho app: app gọi /api/public/v1/views/<khoá>, server tự áp bộ tham số đã lưu trong cùng một lượt. Chỉ bài đã đăng mới ra ngoài, như mọi đường gọi công khai."
      />
      <ApiViewManager views={views} types={hints} />
    </PageShell>
  );
}
