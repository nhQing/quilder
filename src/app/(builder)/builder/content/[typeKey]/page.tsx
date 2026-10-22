import { notFound, redirect } from 'next/navigation';

/**
 * Màn 3 — bảng entry của một loại nội dung.
 *
 * Route `[typeKey]` nằm CẠNH hai route tĩnh `types/` và `groups/`. Next ưu tiên
 * segment tĩnh, nên `/builder/content/types` vẫn là màn cấu trúc chứ không phải
 * bảng entry của một loại tên "types". Đừng đổi `types`/`groups` thành động.
 *
 * Mọi bộ lọc đọc từ `searchParams`, không từ state client — lý do ở đầu
 * `EntryTable.tsx`.
 */

import { prisma } from '@/lib/db';
import { getTypeShape, listAdminEntries } from '@/lib/collections/admin-queries';
import { publicApiUrls, siteOrigin } from '@/lib/collections/api-urls';
import { listAllLocales } from '@/lib/i18n/queries';
import { ApiPanel } from '@/components/builder/ApiPanel';
import { EntryTable } from '@/components/builder/EntryTable';
import { ButtonLink } from '@/components/builder/ui/Button';
import { PageHeader, PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';

const PAGE_SIZES = [20, 50, 100];

export default async function EntryListPage({
  params,
  searchParams,
}: {
  params: Promise<{ typeKey: string }>;
  searchParams: Promise<{
    status?: string;
    taxonomy?: string;
    q?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const { typeKey } = await params;
  const sp = await searchParams;

  const shape = await getTypeShape(typeKey);
  if (!shape) notFound();

  // Loại đơn lẻ không có bảng: nó có đúng một entry, nên bảng là một hàng và một
  // nút. Đưa thẳng vào form.
  if (shape.type.singleton) {
    const single = await listAdminEntries({ typeKey, page: 1, pageSize: 1 });
    if (single.rows[0]) redirect(`/builder/content/${typeKey}/${single.rows[0].id}`);
    redirect(`/builder/content/${typeKey}/moi`);
  }

  const status = (['draft', 'published', 'scheduled', 'archived'] as const).find(
    (s) => s === sp.status,
  );
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const pageSize = PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : 20;

  const { rows, total, counts } = await listAdminEntries({
    typeKey,
    status,
    taxonomyId: sp.taxonomy,
    q: sp.q,
    page,
    pageSize,
  });

  /*
   * Dữ liệu cho khu API, nạp SONG SONG với nhau.
   *
   * Cả hai đều nhỏ và không phụ thuộc nhau; nối tiếp là cộng thêm một vòng đọc DB vào
   * thời gian hiện bảng — thứ người dùng chờ mỗi lần mở màn này, để phục vụ một khu
   * đang đóng.
   */
  const [site, locales] = await Promise.all([
    prisma.site.findFirst({ select: { primaryDomain: true } }),
    listAllLocales(),
  ]);

  const origin = siteOrigin(site?.primaryDomain ?? '');
  const apiRows = publicApiUrls({
    origin,
    typeKey,
    // Danh mục và bài THẬT của loại này. Không có thì hàm bỏ luôn dòng đó — xem
    // docblock `publicApiUrls`: một ví dụ bịa trả danh sách rỗng, và rỗng trông y hệt
    // "API hỏng".
    taxonomyKey: shape.taxonomies[0]?.key,
    sampleSlug: shape.type.slugField ? rows[0]?.slug : undefined,
    // Bỏ field kiểu `slug`: khoá hệ thống luôn được trả, xin lại nó trong `?fields=`
    // là dạy một tham số thừa.
    fieldKeys: shape.fields.filter((f) => f.t !== 'slug').map((f) => f.key),
    locale: locales.find((l) => !l.isDefault && l.enabled)?.code,
  });

  return (
    <PageShell width="wide">
      <PageHeader
        crumbs={[{ label: 'Kho dữ liệu', href: '/builder/content' }]}
        title={shape.type.namePlural}
        count={counts.all}
        actions={
          /* "Cấu trúc field" và "Thêm mục" mang `typeKey` nên chúng thuộc về trang
             này, không thuộc thanh menu toàn cục. */
          <>
            <ButtonLink href={`/builder/content/types/${typeKey}`} icon="sliders">
              Cấu trúc field
            </ButtonLink>
            <ButtonLink href={`/builder/content/${typeKey}/moi`} variant="primary" icon="plus">
              Thêm mục
            </ButtonLink>
          </>
        }
      />

      <EntryTable
        typeKey={typeKey}
        typeName={shape.type.namePlural}
        rows={rows}
        total={total}
        counts={counts}
        taxonomies={shape.taxonomies}
        page={page}
        pageSize={pageSize}
        filter={{ status: status ?? 'all', taxonomy: sp.taxonomy ?? '', q: sp.q ?? '' }}
      />

      {/* DƯỚI bảng: bảng là việc hằng ngày, khu này là việc một lần mỗi dự án. */}
      <ApiPanel rows={apiRows} hasOrigin={!!origin} />
    </PageShell>
  );
}
