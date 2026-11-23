/**
 * Điều kiện của bộ lọc nâng cao (`entry-filters.ts`) → truy vấn. Chỉ chạy ở server.
 *
 * Hai ngả, vì hai loại dữ liệu sống ở hai chỗ:
 *  - **Cột thật** (tác giả, người sửa, các ngày, mục phân loại): mảnh `where` của Prisma.
 *  - **Field trong `data`** (JSON): mảnh SQL thô cho Postgres. Prisma không lọc được JSON
 *    không phân biệt hoa thường, cũng không hỏi được "ảnh này trống không" theo đúng hình
 *    dạng của từng kiểu field.
 *
 * Mọi GIÁ TRỊ người gõ đi vào SQL dưới dạng tham số (`Prisma.sql`). Thứ duy nhất ghép chữ
 * là phép so (`=`, `>`, `<`), lấy từ một bảng cố định trong file này.
 */

import { Prisma } from '@prisma/client';

import type { FilterCond, FilterField } from './entry-filters';

export interface FilterWhere {
  /** Mảnh `where` Prisma, nối bằng AND. */
  and: Prisma.EntryWhereInput[];
  /** Mảnh SQL trên bảng "Entry", nối bằng AND. Rỗng = không cần truy vấn thô. */
  sql: Prisma.Sql[];
}

/** 00:00 giờ Việt Nam của một ngày `YYYY-MM-DD`. */
function startOfDayVN(day: string): Date {
  return new Date(`${day}T00:00:00+07:00`);
}

const ONE_DAY = 24 * 60 * 60 * 1000;

/** Khoảng ngày trên một cột thời gian. `lte` tính TRỌN ngày cuối. */
function dayRange(op: FilterCond['op'], day: string): Prisma.DateTimeNullableFilter {
  const start = startOfDayVN(day);
  return op === 'gte' ? { gte: start } : { lt: new Date(start.getTime() + ONE_DAY) };
}

/**
 * "Field này trống" theo hình dạng của từng kiểu.
 *
 * `CASE` chứ không `AND`/`OR`: Postgres không hứa thứ tự tính của `AND`, và
 * `jsonb_array_length` trên một giá trị không phải mảng là lỗi — `CASE` thì có hứa.
 */
function emptySql(key: string, type: FilterField['fieldType']): Prisma.Sql {
  const v = Prisma.sql`(data -> ${key})`;
  if (type === 'slug') return Prisma.sql`btrim(slug) = ''`;
  if (type === 'image' || type === 'file') {
    // `{ assetId, alt }`, hoặc mảng của chúng khi field nhận nhiều ảnh.
    return Prisma.sql`(CASE
      WHEN ${v} IS NULL THEN true
      WHEN jsonb_typeof(${v}) = 'array' THEN jsonb_array_length(${v}) = 0
      WHEN jsonb_typeof(${v}) = 'object' THEN coalesce(${v} ->> 'assetId', '') = ''
      ELSE coalesce(data ->> ${key}, '') = '' END)`;
  }
  if (type === 'link') {
    // Liên kết chưa điền từng được lưu thành `{ href: "", label: "" }`.
    return Prisma.sql`(CASE
      WHEN ${v} IS NULL THEN true
      WHEN jsonb_typeof(${v}) = 'object' THEN btrim(coalesce(${v} ->> 'href', '')) = ''
      ELSE coalesce(data ->> ${key}, '') = '' END)`;
  }
  return Prisma.sql`(CASE
    WHEN ${v} IS NULL THEN true
    WHEN jsonb_typeof(${v}) = 'null' THEN true
    WHEN jsonb_typeof(${v}) = 'string' THEN btrim(data ->> ${key}) = ''
    WHEN jsonb_typeof(${v}) = 'array' THEN jsonb_array_length(${v}) = 0
    WHEN jsonb_typeof(${v}) = 'object' THEN ${v} = '{}'::jsonb
    ELSE false END)`;
}

/** Biểu thức chữ của một field: slug đọc cột `slug` (nguồn sự thật), còn lại đọc `data`. */
function textSql(key: string, type: FilterField['fieldType']): Prisma.Sql {
  return type === 'slug' ? Prisma.sql`slug` : Prisma.sql`coalesce(data ->> ${key}, '')`;
}

/** `\`, `%`, `_` người gõ là chữ thường, không phải ký tự đại diện của LIKE. */
function likeOf(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const CMP = { eq: '=', gt: '>', lt: '<' } as const;

/** Một điều kiện trên field taxonomy → mảnh `where` Prisma. */
function taxonomyWhere(c: FilterCond, key: string, firstTaxonomyField: string | null): Prisma.EntryWhereInput {
  if (c.op === 'has') return { taxonomies: { some: { taxonomyId: c.value } } };
  if (c.op === 'nhas') return { taxonomies: { none: { taxonomyId: c.value } } };
  // Mục có `fieldKey` null thuộc field taxonomy đầu tiên (`taxonomy-fields.ts`).
  const inField: Prisma.TaxonomyWhereInput =
    key === firstTaxonomyField ? { OR: [{ fieldKey: key }, { fieldKey: null }] } : { fieldKey: key };
  return c.op === 'filled'
    ? { taxonomies: { some: { taxonomy: inField } } }
    : { taxonomies: { none: { taxonomy: inField } } };
}

/**
 * Điều kiện đã qua `parseFilters` → mảnh truy vấn. Điều kiện trỏ tới field không còn thì
 * bị bỏ (đã lọc ở `parseFilters`, đây là chốt thứ hai).
 */
export function entryFilterWhere(
  conds: readonly FilterCond[],
  fields: readonly FilterField[],
  firstTaxonomyField: string | null,
): FilterWhere {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const and: Prisma.EntryWhereInput[] = [];
  const sql: Prisma.Sql[] = [];

  for (const c of conds) {
    const field = byId.get(c.id);
    if (!field) continue;

    if (field.id === 'sys:author' || field.id === 'sys:editor') {
      const col = field.id === 'sys:author' ? 'createdBy' : 'updatedBy';
      and.push({ [col]: c.op === 'eq' ? c.value : { not: c.value } });
      continue;
    }
    if (field.kind === 'sysdate') {
      const col = { 'sys:created': 'createdAt', 'sys:updated': 'updatedAt', 'sys:published': 'publishedAt' }[
        field.id
      ];
      if (col) and.push({ [col]: dayRange(c.op, c.value) });
      continue;
    }

    const key = field.fieldKey;
    if (!key) continue;

    if (field.kind === 'taxonomy') {
      and.push(taxonomyWhere(c, key, firstTaxonomyField));
      continue;
    }
    if (c.op === 'empty') {
      sql.push(emptySql(key, field.fieldType));
      continue;
    }
    if (c.op === 'filled') {
      sql.push(Prisma.sql`NOT ${emptySql(key, field.fieldType)}`);
      continue;
    }

    switch (field.kind) {
      case 'text':
      case 'longtext': {
        const t = textSql(key, field.fieldType);
        if (c.op === 'contains') sql.push(Prisma.sql`${t} ILIKE ${likeOf(c.value)}`);
        else if (c.op === 'ncontains') sql.push(Prisma.sql`${t} NOT ILIKE ${likeOf(c.value)}`);
        else if (c.op === 'eq') sql.push(Prisma.sql`lower(btrim(${t})) = lower(${c.value})`);
        else if (c.op === 'ne') sql.push(Prisma.sql`lower(btrim(${t})) <> lower(${c.value})`);
        break;
      }
      case 'number': {
        if (c.op !== 'eq' && c.op !== 'gt' && c.op !== 'lt') break;
        // Chỉ so giá trị THẬT là số: chữ trong một field số (dữ liệu nhập cũ) không làm
        // cả truy vấn lỗi ép kiểu.
        sql.push(
          Prisma.sql`(CASE WHEN jsonb_typeof(data -> ${key}) = 'number' THEN (data ->> ${key})::numeric END) ${Prisma.raw(CMP[c.op])} ${Number(c.value)}`,
        );
        break;
      }
      case 'date': {
        // Ngày lưu dạng ISO (`2026-11-23` hoặc kèm giờ): 10 ký tự đầu so được như chữ.
        const day = Prisma.sql`(CASE WHEN jsonb_typeof(data -> ${key}) = 'string' THEN left(data ->> ${key}, 10) END)`;
        sql.push(c.op === 'gte' ? Prisma.sql`${day} >= ${c.value}` : Prisma.sql`${day} <= ${c.value}`);
        break;
      }
      case 'boolean':
        // Chưa từng đặt = Không (`false`), giống cách form hiện một ô chưa đặt.
        sql.push(
          c.op === 'true'
            ? Prisma.sql`(data -> ${key}) = 'true'::jsonb`
            : Prisma.sql`(data -> ${key}) IS DISTINCT FROM 'true'::jsonb`,
        );
        break;
      case 'enum':
        sql.push(
          c.op === 'eq'
            ? Prisma.sql`(data ->> ${key}) = ${c.value}`
            : Prisma.sql`(data ->> ${key}) IS DISTINCT FROM ${c.value}`,
        );
        break;
      default:
        break;
    }
  }
  return { and, sql };
}
