import 'server-only';

/**
 * Tạo và sửa loại nội dung. Một luật, hai vỏ — route HTTP và MCP đều gọi vào đây.
 *
 * `key` chỉ đặt được LÚC TẠO. Không có hàm nào ở đây đổi nó, và đó là chủ đích:
 * key nằm trong binding của doc và trong URL API mà mobile gọi, nên đổi nó là làm
 * chết cả hai — im lặng, vì binding sai chỉ rơi về `fallback`.
 */

import { prisma } from '@/lib/db';
import { toSlug } from '@/lib/builder/create-page';
import { parsePageCollection } from '@/lib/builder/page-collection';
// Không `import { revalidateTag }` ở đây: `cache.ts` tự nhận là CHỖ DUY NHẤT gọi
// `revalidateTag` cho nội dung, và một lời tự nhận không đúng thì tệ hơn không có —
// khi mỗi chỗ ghi tự chọn tag, không còn một chỗ nào để đọc và thấy thiếu tag nào.
import { revalidateCollection, revalidateTypes } from './cache';
import { MAX_FIELD_DEPTH, schemaDepth, validateCollectionSchema, type FieldDef } from './field-def';
import { groupClosure, loadGroupTable, typesUsing } from './group-table';
import { checkSchemaChange, diffSchema } from './schema-change';
import { isUniqueCollision } from './unique-retry';

/**
 * Khoá dành riêng — không cho loại nội dung nào chiếm, vì chúng là SEGMENT TĨNH
 * trong route của chính mốc này: `/builder/content/types/[key]` (màn cấu trúc),
 * `/builder/content/[typeKey]/taxonomies` (cây danh mục), và
 * `/builder/content/groups/[key]` (màn cấu trúc nhóm field, Task 4). Next ưu
 * tiên segment tĩnh hơn segment động, nên một loại mang một trong ba khoá này
 * sẽ không bao giờ mở được bảng entry của nó — ví dụ `/builder/content/groups`
 * luôn trỏ vào màn cấu trúc nhóm, không bao giờ vào bảng entry của loại
 * `groups`. Chặn ở đây, lúc tạo, rẻ hơn nhiều so với đổi hình dạng URL sau này.
 *
 * `views` cùng lý do, ở ba chỗ một lúc: `/builder/content/views` (màn quản lý view),
 * `/api/collections/views` và `/api/public/v1/views/[viewKey]` — chỗ cuối là đường gọi
 * của app, nên một loại tên `views` sẽ không bao giờ gọi được qua API công khai.
 */
const RESERVED_TYPE_KEYS = new Set(['types', 'taxonomies', 'groups', 'views']);

export async function createCollectionType(args: {
  key: string;
  name: string;
  namePlural: string;
  icon?: string;
  singleton?: boolean;
  actorEmail: string;
  actorSub: string;
}): Promise<{ ok: true; type: { id: string; key: string } } | { ok: false; status: number; error: string }> {
  const key = toSlug(args.key);
  if (!key) return { ok: false, status: 400, error: 'Khoá loại nội dung không hợp lệ' };
  if (RESERVED_TYPE_KEYS.has(key)) {
    return { ok: false, status: 400, error: `Khoá "${key}" là từ dành riêng cho đường dẫn, chọn tên khác` };
  }

  const name = args.name.trim();
  if (!name) return { ok: false, status: 400, error: 'Thiếu tên loại nội dung' };

  const existing = await prisma.collectionType.findUnique({ where: { key }, select: { id: true } });
  if (existing) return { ok: false, status: 409, error: `Khoá "${key}" đã tồn tại` };

  // Loại mới có đúng hai field, không phải rỗng: một loại không có tiêu đề thì
  // bảng entry không có gì để hiện, và người dùng gặp một màn trắng ngay sau khi
  // tạo. Không dựng thêm gì — nội dung mẫu thì nửa số trang sẽ đi vào production
  // kèm chữ "Lorem".
  const schema: FieldDef[] = [
    { t: 'text', key: 'title', label: 'Tiêu đề', required: true, maxLength: 200 },
    { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
  ];

  let type: { id: string; key: string };
  try {
    type = await prisma.$transaction(async (tx) => {
      const created = await tx.collectionType.create({
        data: {
          key,
          name,
          namePlural: args.namePlural.trim() || name,
          icon: args.icon,
          singleton: args.singleton ?? false,
          schema: schema as unknown as object,
          titleField: 'title',
          slugField: args.singleton ? null : 'slug',
        },
        select: { id: true, key: true },
      });
      await tx.auditLog.create({
        data: {
          userId: args.actorSub,
          action: 'collectionType.create',
          targetType: 'CollectionType',
          targetId: created.id,
          meta: { key, name },
        },
      });
      return created;
    });
  } catch (e) {
    // `key` ở đây do NGƯỜI DÙNG gõ, nên KHÔNG thử lại: thử lại sẽ âm thầm tạo một
    // key khác thứ họ gõ. Trả đúng cùng một câu mà phép kiểm trước đó trả, để hai
    // đường (kiểm trước và đụng ràng buộc) nói cùng một điều.
    if (isUniqueCollision(e, 'key')) {
      return { ok: false, status: 409, error: `Khoá "${key}" đã tồn tại` };
    }
    throw e;
  }

  revalidateTypes();
  return { ok: true, type };
}

export async function updateCollectionSchema(args: {
  typeKey: string;
  schema: unknown;
  titleField?: string;
  actorEmail: string;
  actorSub: string;
}): Promise<{ ok: true; warnings: string[] } | { ok: false; status: number; error: string }> {
  const type = await prisma.collectionType.findUnique({
    where: { key: args.typeKey },
    select: { id: true, schema: true, titleField: true, _count: { select: { entries: true } } },
  });
  if (!type) return { ok: false, status: 404, error: `Không có loại nội dung "${args.typeKey}"` };

  const groups = await loadGroupTable();

  const next = validateCollectionSchema(args.schema, groups);
  if (!next.ok) return { ok: false, status: 400, error: next.error };

  const prev = validateCollectionSchema(type.schema, groups);
  const changes = diffSchema(prev.ok ? prev.fields : [], next.fields);
  const verdict = checkSchemaChange(changes, type._count.entries);
  if (!verdict.ok) return { ok: false, status: 409, error: verdict.error };

  // Giữ `titleField` hiện có nếu nó còn: đổi THỨ TỰ field không được âm thầm đổi
  // field làm tiêu đề. Chỉ khi field cũ đã bị xoá mới rơi về field đầu tiên.
  const keptTitle = next.fields.some((f) => f.key === type.titleField) ? type.titleField : undefined;
  const titleField = args.titleField ?? keptTitle ?? next.fields[0]?.key;
  if (!titleField || !next.fields.some((f) => f.key === titleField)) {
    return { ok: false, status: 400, error: 'Field làm tiêu đề không có trong cấu trúc' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.collectionType.update({
      where: { id: type.id },
      data: {
        schema: next.fields as unknown as object,
        titleField,
        slugField: next.fields.find((f) => f.t === 'slug')?.key ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'collectionType.updateSchema',
        targetType: 'CollectionType',
        targetId: type.id,
        meta: { changes: changes as unknown as object, entryCount: type._count.entries },
      },
    });
  });

  // Cấu trúc đổi nghĩa là mọi entry đọc ra khác đi — kể cả khi không entry nào bị
  // sửa. Bỏ bước này thì site phục vụ bản cũ và không có gì gợi ý tại sao.
  // `revalidateCollection` vô hiệu hoá cả `TYPES_TAG` lẫn `collection:<key>`.
  revalidateCollection(args.typeKey);
  return { ok: true, warnings: verdict.warnings };
}

export async function upsertFieldGroup(args: {
  key: string;
  name: string;
  schema: unknown;
  icon?: string;
  actorSub: string;
  /**
   * Cho phép ghi một schema RỖNG lên trên một nhóm hiện đang KHÔNG rỗng.
   *
   * Mặc định `false`. Đây là lưới an toàn ở TẦNG LIB, không chỉ ở UI: route
   * `PUT /api/collections/groups` gọi được từ ngoài UI (mốc 1 đã mở nó, và
   * MCP/script có thể gọi thẳng) — một request thiếu `schema` hoặc gửi `[]`
   * do lỗi client sẽ xoá sạch cấu trúc của nhóm mà không có gì cản, và mọi
   * loại đang dùng nhóm đó (trực tiếp hoặc qua một nhóm khác) mất field theo.
   */
  allowEmpty?: boolean;
}): Promise<{ ok: true; group: { id: string; key: string } } | { ok: false; status: number; error: string }> {
  const key = toSlug(args.key);
  if (!key) return { ok: false, status: 400, error: 'Khoá nhóm field không hợp lệ' };

  const groups = await loadGroupTable();
  // Nhóm đang sửa phải có mặt trong bảng tra khi đo độ sâu, nếu không một nhóm tự
  // tham chiếu sẽ đo ra "mồ côi" và lọt qua.
  groups[key] = [];
  const checked = validateCollectionSchema(args.schema, groups, 'group');
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };

  // Ca ghi đè RỖNG: nhóm hiện có N > 0 field, request gửi 0. Đây có thể là chủ
  // đích (dọn sạch một nhóm không còn dùng) — nhưng cũng có thể là body thiếu
  // `schema` hoặc một lỗi client gửi `[]`. Không cách nào phân biệt hai ca đó
  // từ chính request, nên chặn lại và bắt người gọi XÁC NHẬN bằng `allowEmpty`.
  if (checked.fields.length === 0 && !args.allowEmpty) {
    const existing = await prisma.fieldGroupDef.findUnique({ where: { key }, select: { schema: true } });
    const existingCount = Array.isArray(existing?.schema) ? existing.schema.length : 0;
    if (existingCount > 0) {
      return {
        ok: false,
        status: 409,
        error: `Nhóm "${key}" đang có ${existingCount} field. Lưu một cấu trúc rỗng sẽ xoá hết — gửi allowEmpty nếu thật sự muốn.`,
      };
    }
  }

  // Gán fields THẬT vào bảng rồi mới đo: đặt `[]` như trên chỉ bắt được nhóm TỰ tham
  // chiếu, còn A→B→A thì lọt, vì lúc validate B thì A chưa có trong bảng — nên B→A
  // trông như trỏ tới một nhóm mồ côi, và mồ côi được tính như một lá.
  //
  // `schemaDepth` đã có tham số `seen` nên nó bắt vòng ngay; cái thiếu là một lượt đo
  // trong đó nhóm đang sửa đã có nội dung thật.
  groups[key] = checked.fields;

  /*
   * Bao đóng NGƯỢC: mọi nhóm dẫn tới `key`, kể cả `key`. Dùng cho HAI việc — phép kiểm
   * độ sâu ngay dưới, và việc vô hiệu hoá cache ở cuối hàm.
   *
   * Tính cả tham chiếu GIÁN TIẾP: một loại dùng nhóm `bai-viet`, nhóm đó dùng nhóm
   * `cta`, thì sửa `cta` cũng đổi cấu trúc hiệu dụng của loại đó. Chỉ xét tầng ngoài
   * là bỏ sót đúng ca mà `FieldGroupDef` tồn tại để phục vụ.
   *
   * Rút thành `groupClosure` trong `group-table.ts` — dùng lại ở đây và ở
   * `groups/[key]/page.tsx` (hiện "N loại đổi theo, M trực tiếp"), để hai chỗ
   * không đo hai cách khác nhau.
   */
  const touched = groupClosure(groups, key);

  /*
   * Đo độ sâu cho CẢ TẬP `touched`, không chỉ nhóm đang sửa — vì sửa một nhóm có thể
   * đẩy một nhóm KHÁC vượt ngưỡng, và nhóm bị đẩy quá là nhóm mất dữ liệu.
   *
   * Đường hỏng, cụ thể: A sâu 1 → nhận. B = [group → A] đo có bọc = 3 → nhận. Loại T =
   * [group → B] = 3 → nhận. Rồi SỬA A lên sâu 2: A đo có bọc = 3, nên phép kiểm chỉ-đo-
   * chính-mình nhận nó. Giờ B đo có bọc = 4, nên lượt ba của `loadGroupTable` làm
   * `groups.b = []`, `zEntryData` của T dựng `z.object({}).strip()` cho field đó, và
   * LẦN LƯU ENTRY TIẾP THEO xoá sạch nội dung dưới nhóm đó — im lặng, vì `.strip()` là
   * hành vi bình thường của nó.
   *
   * Nên: một schema rỗng không phải một màn trắng, nó là một lệnh xoá trả chậm.
   *
   * Đo "có bọc" (`[{ t: 'group', groupKey: <thành viên> }]`) chứ không đo thẳng schema
   * của nhóm: một nhóm luôn được lồng dưới một field `group`/`blocks`, nên tầng bọc đó
   * là thật. Cùng cách `loadGroupTable` đo ở lượt ba — hai chỗ phải đo GIỐNG nhau, nếu
   * không thì cái này nhận và cái kia làm rỗng.
   *
   * Báo tên nhóm BỊ ĐẨY QUÁ, không phải tên nhóm đang sửa: người dùng cần biết cái nào
   * vỡ, không phải cái nào họ vừa gõ.
   */
  for (const gk of touched) {
    if (schemaDepth([{ t: 'group', key: '_', label: '_', groupKey: gk }], groups) > MAX_FIELD_DEPTH) {
      return {
        ok: false,
        status: 400,
        error:
          gk === key
            ? `Nhóm field "${key}" tạo ra một vòng tham chiếu hoặc lồng sâu quá ${MAX_FIELD_DEPTH} tầng`
            : `Lưu nhóm field "${key}" làm nhóm "${gk}" lồng sâu quá ${MAX_FIELD_DEPTH} tầng`,
      };
    }
  }

  const group = await prisma.$transaction(async (tx) => {
    const saved = await tx.fieldGroupDef.upsert({
      where: { key },
      create: { key, name: args.name.trim() || key, icon: args.icon, schema: checked.fields as unknown as object },
      update: { name: args.name.trim() || key, icon: args.icon, schema: checked.fields as unknown as object },
      select: { id: true, key: true },
    });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'fieldGroup.upsert',
        targetType: 'FieldGroupDef',
        targetId: saved.id,
        meta: { key },
      },
    });
    return saved;
  });

  revalidateTypes();

  /*
   * Và vô hiệu hoá `collection:<key>` của MỌI loại đang dùng nhóm này.
   *
   * `updateCollectionSchema` ngay trên đã viết ra chính lý do: "cấu trúc đổi nghĩa là
   * mọi entry đọc ra khác đi — kể cả khi không entry nào bị sửa". Sửa một nhóm field
   * đổi cấu trúc hiệu dụng của MỌI loại dùng nó, nên cùng lập luận áp y nguyên — chỉ
   * là số loại phải vô hiệu hoá không còn là một.
   *
   * Lọc trong bộ nhớ chứ không query JSONB: số loại nội dung là hàng chục, và một
   * điều kiện JSONB cho "field group có groupKey này HOẶC blocks có key này trong
   * allowed" là một biểu thức không ai đọc lại được sau ba tháng.
   *
   * `touched` (bao đóng ngược, kể cả tham chiếu gián tiếp) đã tính ở TRÊN, trước khi
   * ghi — nó phục vụ cả phép kiểm độ sâu.
   */
  const types = await prisma.collectionType.findMany({ select: { key: true, schema: true } });
  const validTypes = types
    .map((t) => ({ key: t.key, parsed: validateCollectionSchema(t.schema, groups) }))
    .filter(
      (t): t is { key: string; parsed: { ok: true; fields: FieldDef[] } } => t.parsed.ok,
    )
    .map((t) => ({ key: t.key, schema: t.parsed.fields }));
  for (const k of typesUsing(validTypes, touched)) revalidateCollection(k);

  return { ok: true, group };
}

/**
 * Xoá một loại nội dung.
 *
 * ## Vì sao TỪ CHỐI khi còn entry, thay vì cascade
 *
 * FK `Entry.typeId` khai `onDelete: Cascade`, nên một lệnh xoá ở đây sẽ kéo theo
 * mọi bài viết của loại đó — im lặng, trong một transaction, không có bảng phiên
 * bản nào để lùi. Cascade ở tầng DB tồn tại để không còn hàng mồ côi khi việc xoá
 * ĐÃ được quyết định; nó không phải một lời cho phép xoá 300 bài bằng một cú bấm.
 *
 * Nên: còn entry là từ chối, và câu lỗi nói đúng số. Muốn xoá thật thì đi qua
 * `archiveEntry` + `purgeEntry` cho từng bài — chậm, và đó là điểm.
 *
 * ## Danh mục KHÔNG cascade, phải xoá tay
 *
 * `Taxonomy` gắn với loại bằng `typeKey` (một chuỗi), không bằng khoá ngoại — nên
 * không có cascade nào dọn nó. Bỏ bước này là để lại danh mục mồ côi của một loại
 * không còn tồn tại, và chúng sẽ hiện ra ở loại tiếp theo trùng `key`.
 */
export async function deleteCollectionType(args: {
  key: string;
  actorSub: string;
}): Promise<{ ok: true; deletedTaxonomies: number } | { ok: false; status: number; error: string }> {
  const type = await prisma.collectionType.findUnique({
    where: { key: args.key },
    select: { id: true, key: true, name: true },
  });
  if (!type) return { ok: false, status: 404, error: 'Không có loại nội dung này' };

  const entries = await prisma.entry.count({ where: { typeId: type.id } });
  if (entries > 0) {
    return {
      ok: false,
      status: 409,
      error: `Loại này còn ${entries} entry (tính cả bài trong lưu trữ). Xoá hẳn từng bài trước, rồi xoá loại.`,
    };
  }

  /*
   * Trang nào đang khai loại này thì phải gỡ lời khai trước.
   *
   * Bỏ qua thì `Page.collection.typeKey` trỏ vào một loại không còn tồn tại, và hậu
   * quả im lặng: mẫu `blogs/post/[slug]` vẫn nằm trong bảng định tuyến, vẫn khớp URL,
   * nhưng `getEntryBySlug` không bao giờ tìm thấy gì — mọi bài viết 404 và không có
   * chỗ nào nói vì sao. Từ chối ở đây thì người xoá thấy ngay trang nào cần sửa.
   */
  const pages = await prisma.page.findMany({
    where: { archivedAt: null },
    select: { slug: true, title: true, collection: true },
  });
  const bound = pages.filter((p) => parsePageCollection(p.collection)?.typeKey === type.key);
  if (bound.length) {
    const list = bound.map((p) => `"${p.title}" (/${p.slug})`).join(', ');
    return {
      ok: false,
      status: 409,
      error: `Còn ${bound.length} trang khai loại này: ${list}. Gỡ loại nội dung khỏi các trang đó trước.`,
    };
  }

  const deletedTaxonomies = await prisma.$transaction(async (tx) => {
    const removed = await tx.taxonomy.deleteMany({ where: { typeKey: type.key } });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'type.delete',
        targetType: 'CollectionType',
        targetId: type.id,
        meta: { key: type.key, name: type.name, taxonomies: removed.count },
      },
    });
    await tx.collectionType.delete({ where: { id: type.id } });
    return removed.count;
  });

  revalidateCollection(type.key);
  revalidateTypes();
  return { ok: true, deletedTaxonomies };
}
