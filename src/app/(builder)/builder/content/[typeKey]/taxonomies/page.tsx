import { notFound } from 'next/navigation';

/**
 * Cây danh mục của một loại nội dung.
 *
 * Số entry của mỗi danh mục đếm ở ĐÂY, không ở `getTypeShape`: nó chỉ cần cho màn
 * này, còn `getTypeShape` được gọi ở cả bảng entry và form entry — thêm một
 * `groupBy` vào đó là bắt hai màn kia trả tiền cho một con số chúng không hiện.
 */

import { prisma } from '@/lib/db';
import { getTypeShape } from '@/lib/collections/admin-queries';
import { TaxonomyManager } from '@/components/builder/TaxonomyManager';
import { PageHeader, PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';

export default async function TaxonomyPage({
  params,
}: {
  params: Promise<{ typeKey: string }>;
}) {
  const { typeKey } = await params;

  const shape = await getTypeShape(typeKey);
  if (!shape) notFound();

  const grouped = await prisma.entryTaxonomy.groupBy({
    by: ['taxonomyId'],
    where: { taxonomy: { typeKey }, entry: { archivedAt: null } },
    _count: { entryId: true },
  });
  const counts = Object.fromEntries(grouped.map((g) => [g.taxonomyId, g._count.entryId]));

  return (
    <PageShell width="narrow">
      <PageHeader
        crumbs={[
          { label: 'Kho dữ liệu', href: '/builder/content' },
          { label: shape.type.namePlural, href: `/builder/content/${typeKey}` },
        ]}
        title="Danh mục"
        count={shape.taxonomies.length}
        description="Hai cấp: danh mục gốc và danh mục con. Số bài chỉ đếm bài chưa lưu trữ."
      />

      <TaxonomyManager
        typeKey={typeKey}
        typeName={shape.type.namePlural}
        taxonomies={shape.taxonomies}
        counts={counts}
      />
    </PageShell>
  );
}
