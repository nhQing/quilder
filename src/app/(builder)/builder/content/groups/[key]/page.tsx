import { notFound } from 'next/navigation';

/**
 * Màn 2 (đích NHÓM FIELD) — `/builder/content/groups/[key]`.
 *
 * ## Vì sao đọc `prisma.fieldGroupDef.findUnique` THÔ, không qua `loadGroupTable()`
 *
 * `loadGroupTable()` có một lượt LÀM RỖNG nhóm nằm trong vòng tham chiếu hoặc
 * lồng quá `MAX_FIELD_DEPTH` (xem docblock của nó) — đúng cho mọi chỗ ĐỌC ĐỂ
 * DÙNG nhóm (form nhập entry, đo độ sâu của một loại khác). Nhưng đây chính là
 * màn SỬA nhóm đó: nếu nó đọc bản đã bị làm rỗng, màn hiện trống, và lần Lưu
 * đầu tiên ghi `[]` đè lên schema thật còn nguyên trong DB — mất cấu trúc, im
 * lặng, không có gì trong log nói rằng chuyện đó vừa xảy ra.
 *
 * Nên đọc thẳng cột `schema`, tự `validateCollectionSchema` với bảng nhóm RỖNG
 * (`{}`, vì tại đây ta chưa cần đo độ sâu lồng của các nhóm KHÁC) chỉ để hiện,
 * và nếu nó không parse được thì hiện CẢNH BÁO kèm dữ liệu thô — không hiện
 * trống, không tự sửa giùm.
 */

import { prisma } from '@/lib/db';
import { validateCollectionSchema, type FieldDef } from '@/lib/collections/field-def';
import { groupClosure, loadGroupTable, typesUsing } from '@/lib/collections/group-table';
import { SchemaEditor } from '@/components/builder/SchemaEditor';
import { PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';

export default async function GroupSchemaPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  const row = await prisma.fieldGroupDef.findUnique({
    where: { key },
    select: { key: true, name: true, schema: true },
  });
  if (!row) notFound();

  const checked = validateCollectionSchema(row.schema, {}, 'group');

  const [groupRows, typeRows, allTypeRows, groups] = await Promise.all([
    prisma.fieldGroupDef.findMany({
      orderBy: { name: 'asc' },
      select: { key: true, name: true, schema: true },
    }),
    prisma.collectionType.findMany({ select: { key: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.collectionType.findMany({ select: { key: true, schema: true } }),
    // Dùng để tính bao đóng ngược (`groupClosure`) trên MỌI nhóm KHÁC — không
    // phải trên `row` đang sửa, nên lượt làm-rỗng của `loadGroupTable()`
    // (xem docblock trên) không đụng tới đúng schema mà màn này sửa.
    loadGroupTable(),
  ]);

  const validTypes = allTypeRows
    .map((t) => ({ key: t.key, parsed: validateCollectionSchema(t.schema, groups) }))
    .filter((t): t is { key: string; parsed: { ok: true; fields: FieldDef[] } } => t.parsed.ok)
    .map((t) => ({ key: t.key, schema: t.parsed.fields }));

  // Tổng số loại đổi theo (trực tiếp CỘNG gián tiếp qua một nhóm khác — dùng
  // đúng `groupClosure`/`typesUsing` mà `upsertFieldGroup` dùng để vô hiệu hoá
  // cache, để con số hiện ra và hành vi ghi KHÔNG đo hai cách khác nhau).
  const usedByCount = typesUsing(validTypes, groupClosure(groups, key)).length;
  // Chỉ tham chiếu TRỰC TIẾP tới đúng khoá này — closure = { key } thay vì bao đóng đầy đủ.
  const directUsedByCount = typesUsing(validTypes, new Set([key])).length;

  return (
    // Đầu trang (đường dẫn, tiêu đề, nút Lưu) do `SchemaEditor` dựng: nút Lưu cần state của nó.
    <PageShell>
      <SchemaEditor
        target={{ kind: 'group', key: row.key, name: row.name, usedByCount, directUsedByCount }}
        fields={checked.ok ? checked.fields : []}
        parseWarning={checked.ok ? null : checked.error}
        rawSchema={row.schema}
        groups={groups}
        groupOptions={groupRows.map((g) => ({
          key: g.key,
          name: g.name,
          fieldCount: Array.isArray(g.schema) ? g.schema.length : 0,
        }))}
        typeOptions={typeRows}
      />
    </PageShell>
  );
}

