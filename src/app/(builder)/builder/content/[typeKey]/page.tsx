import { cookies } from 'next/headers';
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
import {
  availableColumns,
  columnFieldKeys,
  columnsCookie,
  visibleColumnIds,
} from '@/lib/collections/entry-columns';
import { taxonomyFieldsOf } from '@/lib/collections/taxonomy-fields';
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

  /*
   * Cột của bảng: suy từ cấu trúc field + ngôn ngữ, lựa chọn đọc từ cookie để lần
   * render đầu đã đúng (xem `entry-columns.ts`). Ngôn ngữ nạp TRƯỚC bảng vì cột
   * ngôn ngữ nằm trong danh sách cột.
   */
  const [locales, jar] = await Promise.all([listAllLocales(), cookies()]);
  const columns = availableColumns(shape.fields, {
    titleField: shape.type.titleField,
    slugField: shape.type.slugField,
    locales: locales.filter((l) => !l.isDefault).map((l) => l.code),
  });
  const visible = visibleColumnIds(columns, jar.get(columnsCookie(typeKey))?.value);

  const { rows, total, counts } = await listAdminEntries({
    typeKey,
    status,
    taxonomyId: sp.taxonomy,
    q: sp.q,
    page,
    pageSize,
    // Mọi cột field CHỌN ĐƯỢC, không chỉ cột đang hiện: bật một cột là việc ở client,
    // không phải một vòng tải lại trang.
    fieldKeys: columnFieldKeys(columns),
  });

  // Dữ liệu cho khu API. Ngôn ngữ đã nạp ở trên cho cột của bảng.
  const site = await prisma.site.findFirst({ select: { primaryDomain: true } });

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
        columns={columns}
        visibleColumns={visible}
        firstTaxonomyField={taxonomyFieldsOf(shape.fields)[0]?.key ?? null}
        page={page}
        pageSize={pageSize}
        filter={{ status: status ?? 'all', taxonomy: sp.taxonomy ?? '', q: sp.q ?? '' }}
      />

      {/* DƯỚI bảng: bảng là việc hằng ngày, khu này là việc một lần mỗi dự án. */}
      <ApiPanel rows={apiRows} hasOrigin={!!origin} />
    </PageShell>
  );
}
