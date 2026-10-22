import { notFound } from 'next/navigation';

/**
 * Màn 2 (đích LOẠI NỘI DUNG) — `/builder/content/types/[key]`.
 *
 * `getTypeShape` đã tự lo phần khó: nó đọc qua `loadGroupTable()` để đo độ sâu
 * lồng của field `group`/`blocks`, và trả `fields: []` (không ném) nếu schema
 * đã lưu không parse được — đúng cách một hàng hỏng không được làm cả màn sửa
 * nó không mở ra được. Khác với đích NHÓM FIELD (`groups/[key]/page.tsx`), ở
 * đây `loadGroupTable()` là ĐÚNG nguồn: màn này không sửa chính cái bảng đó.
 *
 * NHƯNG `getTypeShape` NUỐT lỗi parse — nó chỉ trả `fields: []`, không trả lý
 * do. Ở màn danh sách entry thì im lặng như vậy là đúng (một hàng hỏng không
 * được chặn cả bảng). Ở ĐÂY thì không: màn trắng không giải thích được sẽ để
 * người dùng bấm Lưu, và request đó ghi `[]` đè lên schema thật. Nên page này
 * tự đọc RAW schema và tự `validateCollectionSchema` lại — KHÔNG đổi hành vi
 * "trả mảng rỗng" của `getTypeShape`, chỉ đọc thêm để lấy câu lỗi mà nó đã bỏ.
 */

import { prisma } from '@/lib/db';
import { getTypeShape } from '@/lib/collections/admin-queries';
import { validateCollectionSchema } from '@/lib/collections/field-def';
import { detailBaseForType, relationBaseForType } from '@/lib/render/collection-page';
import { SchemaEditor } from '@/components/builder/SchemaEditor';
import { PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';

export default async function TypeSchemaPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const shape = await getTypeShape(key);
  if (!shape) notFound();

  const [entryCount, groupRows, typeRows, rawType, detailBase, relationBase] = await Promise.all([
    prisma.entry.count({ where: { typeKey: key } }),
    prisma.fieldGroupDef.findMany({
      orderBy: { name: 'asc' },
      select: { key: true, name: true, schema: true },
    }),
    prisma.collectionType.findMany({ select: { key: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.collectionType.findUnique({ where: { key }, select: { schema: true } }),
    // Hai cách site ĐỌC SEO của một loại: trang chi tiết, hoặc trang danh mục lấy loại
    // này làm tham số. Không có cái nào thì field SEO chỉ dùng qua API — form nói ra.
    detailBaseForType(key),
    relationBaseForType(key),
  ]);

  // `shape.groups` LÀ bảng nhóm mà `getTypeShape` đã dùng để validate — đọc lại
  // với đúng bảng đó để câu lỗi (nếu có) khớp với `shape.fields`.
  const checked = validateCollectionSchema(rawType?.schema, shape.groups);

  return (
    // Đầu trang (đường dẫn, tiêu đề, nút Lưu) do `SchemaEditor` dựng: nút Lưu cần state của nó.
    <PageShell>
      <SchemaEditor
        target={{
          kind: 'type',
          key: shape.type.key,
          name: shape.type.name,
          titleField: shape.type.titleField,
          entryCount,
          seoOnSite: Boolean(detailBase || relationBase),
        }}
        fields={shape.fields}
        parseWarning={checked.ok ? null : checked.error}
        rawSchema={rawType?.schema}
        groups={shape.groups}
        groupOptions={groupRows.map((g) => ({
          key: g.key,
          name: g.name,
          fieldCount: Array.isArray(g.schema) ? g.schema.length : 0,
        }))}
        typeOptions={typeRows}
        taxonomies={shape.taxonomies}
      />
    </PageShell>
  );
}
