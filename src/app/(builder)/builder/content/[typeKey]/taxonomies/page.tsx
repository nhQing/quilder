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
import { listAllLocales } from '@/lib/i18n/queries';
import { TaxonomyManager } from '@/components/builder/TaxonomyManager';
import { inPool, roleOf, taxonomyFieldsOf } from '@/lib/collections/taxonomy-fields';
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

  // Kể cả ngôn ngữ chưa bật: dịch sẵn trước khi công bố là nhịp làm việc thật.
  const locales = (await listAllLocales()).filter((l) => !l.isDefault);

  const grouped = await prisma.entryTaxonomy.groupBy({
    by: ['taxonomyId'],
    where: { taxonomy: { typeKey }, entry: { archivedAt: null } },
    _count: { entryId: true },
  });
  const counts = Object.fromEntries(grouped.map((g) => [g.taxonomyId, g._count.entryId]));
  const taxFields = taxonomyFieldsOf(shape.fields);

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

      {/*
        Một loại có NHIỀU field phân loại (vd Danh mục + Tag) thì mỗi field một khối,
        mỗi khối một danh sách riêng — xem `lib/collections/taxonomy-fields.ts`.
      */}
      {taxFields.length > 1 ? (
        <div className="flex flex-col gap-10">
          {taxFields.map((f) => (
            <section key={f.key} className="flex flex-col gap-3">
              <h2 className="text-section font-semibold">
                {f.label}{' '}
                <span className="text-small font-normal text-shell-muted">
                  · {roleOf(f) === 'tag' ? 'Tag' : 'Danh mục'} · <span className="font-shell-mono">{f.key}</span>
                </span>
              </h2>
              <TaxonomyManager
                typeKey={typeKey}
                typeName={shape.type.namePlural}
                fieldKey={f.key}
                taxonomies={shape.taxonomies.filter((t) => inPool(shape.fields, f, t.fieldKey))}
                counts={counts}
                locales={locales.map((l) => ({ code: l.code, label: l.label }))}
              />
            </section>
          ))}
        </div>
      ) : (
        <TaxonomyManager
          typeKey={typeKey}
          typeName={shape.type.namePlural}
          taxonomies={shape.taxonomies}
          counts={counts}
          locales={locales.map((l) => ({ code: l.code, label: l.label }))}
        />
      )}
    </PageShell>
  );
}
