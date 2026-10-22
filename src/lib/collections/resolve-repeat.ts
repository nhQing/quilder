import 'server-only';

/**
 * `RepeatSpec.source` → danh sách item.
 *
 * Sáu nguồn, mỗi nguồn cần một ngữ cảnh khác nhau. Thứ quan trọng nhất ở đây là thứ
 * KHÔNG có: không nguồn nào chạy một truy vấn cho mỗi item của nguồn cha. Cặp
 * `taxonomy` → `group-entries` đi qua `resolveTaxonomyTree()`, gọi `taxonomyGroups()`
 * ĐÚNG MỘT LẦN cho cả hai cấp — ba truy vấn tổng, xem docblock của hàm đó.
 *
 * Đếm truy vấn là tiêu chí nghiệm thu của mốc 3, không phải chuyện tối ưu về sau:
 * "FAQ theo danh mục" với 7 danh mục mà làm N+1 là 8 lượt đọc cho MỘT khối trên
 * trang chủ, và nó chỉ lộ ra khi có danh mục thứ 30.
 */

import type { RepeatSpec, TaxonomyFilter, TaxonomySort } from '@/lib/doc/types';
import {
  entriesByIds, listEntries, relatedEntries, taxonomyGroups, type EntryRow,
} from './queries';
import { relationIds } from './relation-expand';
import type { RepeatItem } from './repeat';

export interface RepeatContext {
  locale?: string;
  /** Entry của trang chi tiết đang mở. Nguồn `related` và `field` cần nó. */
  entry?: EntryRow;
  /**
   * Danh mục lấy từ URL, cho filter `taxonomy.from: 'url'`.
   *
   * BA trạng thái — `undefined` không có đoạn động, `null` có đoạn động nhưng nó
   * không trỏ vào danh mục nào, một id là phân giải được. Chỗ GỌI phải phân biệt
   * hai cái đầu: gửi `undefined` cho một URL sai là quay lại đúng lỗi
   * "mọi trang danh mục cùng một danh sách". Xem `QueryContext.urlTaxonomyId`.
   */
  urlTaxonomyId?: string | null;
  /**
   * Bản ghi đích lấy từ URL, cho filter `relation.from: 'url'`.
   *
   * Ba trạng thái giống hệt `urlTaxonomyId` ngay trên, và vì đúng lý do đó. Đây là
   * ô mà trang danh mục kiểu mới dùng: slug trên URL phân giải thành một entry của
   * loại đích (`danh-muc`), và id của entry ấy đi vào đây.
   */
  urlRelationId?: string | null;
  /** Gốc của trang chi tiết, ví dụ '/blogs/post'. Dùng để dựng href từ slug. */
  detailBase?: string;
  /** Gốc của trang danh mục, ví dụ '/blogs'. Khối lặp nguồn `taxonomy` dùng gốc NÀY. */
  taxonomyBase?: string;
}

/**
 * `EntryRow` → `RepeatItem`.
 *
 * Ngày đăng và danh mục KHÔNG được nhét vào `data` ở đây, dù trước đây
 * `published_at` từng được nhét. Chúng đi ra thành trường riêng của `RepeatItem`,
 * và `VIRTUAL_KEYS` ở `repeat.ts` là chỗ duy nhất khai chúng đọc được bằng khoá
 * nào, khoá nào thắng field cùng tên, và chỗ nào ở đường ghi phải biết điều đó.
 *
 * Vì sao đổi: nhét vào `data` thì luật "cột hay field thắng" nằm ở THỨ TỰ spread
 * trong hàm này, còn tên khoá nằm ở đây, còn đường ghi thì không biết gì cả — tức
 * ba nơi cho một quy ước. Đúng lý do vì sao `map: { taxonomy: … }` lưu được mà
 * không bao giờ chạy: không có nơi nào để nói "khoá này không tồn tại".
 *
 * Tên khoá vẫn có gạch dưới vì `RepeatSpec.map` đi qua `zFieldKey`
 * (`^[a-z][a-z0-9_]*$`) — `publishedAt` không phải khoá hợp lệ, nên ánh xạ tới nó
 * bị zod từ chối lúc lưu chứ không im lặng không có tác dụng.
 */
function entryToItem(e: EntryRow): RepeatItem {
  return {
    key: e.id,
    data: e.data,
    slug: e.slug,
    typeKey: e.typeKey,
    publishedAt: e.publishedAt?.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    taxonomies: e.taxonomies.map((t) => ({ key: t.key, name: t.name })),
    author: e.author,
  };
}

/**
 * Nguồn KHÔNG phụ thuộc cấp cha. `group-entries` không nằm ở đây — xem
 * `resolveTaxonomyTree`.
 */
export async function resolveRepeat(spec: RepeatSpec, ctx: RepeatContext): Promise<RepeatItem[]> {
  switch (spec.source.kind) {
    case 'query': {
      const rows = await listEntries(
        spec.source.query,
        {
          now: new Date(),
          currentEntryId: ctx.entry?.id,
          currentTaxonomyIds: ctx.entry?.taxonomyIds,
          urlTaxonomyId: ctx.urlTaxonomyId,
          urlRelationId: ctx.urlRelationId,
        },
        ctx.locale,
      );
      return rows.map(entryToItem);
    }

    case 'related': {
      // Không có bài đang mở thì "liên quan tới bài đang mở" không có nghĩa. Trả rỗng
      // chứ KHÔNG rơi về "tin mới nhất": khu đó đã có ở trang danh sách, và hiện lại
      // nó ở đây làm hai khối giống hệt nhau trên một trang mà không ai hiểu vì sao.
      if (!ctx.entry) return [];
      const rows = await relatedEntries({
        typeKey: spec.source.typeKey,
        entryId: ctx.entry.id,
        limit: spec.source.limit,
        locale: ctx.locale,
      });
      return rows.map(entryToItem);
    }

    case 'taxonomy': {
      const tree = await resolveTaxonomyTree(spec.source.typeKey, 1, ctx.locale, {
        filter: spec.source.filter,
        sort: spec.source.sort,
      });
      return tree.groups.map((g) => g.item);
    }

    case 'relation': {
      // Không có bài đang mở thì "quan hệ của bài đang mở" không có nghĩa — trả
      // rỗng, cùng lý lẽ với `related` ngay trên.
      if (!ctx.entry) return [];
      const ids = relationIds(ctx.entry.data[spec.source.path]).slice(0, spec.source.limit);
      const rows = await entriesByIds(ids, ctx.locale);
      return rows.map(entryToItem);
    }

    case 'group-entries':
      // Nguồn này cần danh mục của cấp cha, thứ chỉ biết khi cấp cha đã resolve. Nó
      // được giải quyết trong cùng lượt `resolveTaxonomyTree` của cấp cha; gọi thẳng
      // vào đây là thiếu ngữ cảnh, và trả rỗng là câu trả lời trung thực.
      return [];

    case 'field': {
      if (!ctx.entry) return [];
      // Rút `path` ra biến TRƯỚC `map`: bên trong closure, TS không còn giữ phép thu
      // hẹp của `switch` trên `spec.source`, và `spec.source.path` sẽ không biên dịch.
      const path = spec.source.path;
      const raw = ctx.entry.data[path];
      if (!Array.isArray(raw)) return [];
      return raw.map((v, i) => ({
        key: `${path}-${i}`,
        data: typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {},
      }));
    }
  }
}

export interface TaxonomyTree {
  /** Cấp NGOÀI: một item mỗi danh mục, kèm id để cấp trong tra ngược. */
  groups: { item: RepeatItem; taxonomyId: string }[];
  /** Cấp TRONG: entry của từng danh mục, đã cắt theo `limit` của cấp trong. */
  entriesByTaxonomy: Map<string, RepeatItem[]>;
}

/**
 * Cả HAI cấp của "FAQ theo danh mục" trong MỘT lượt.
 *
 * ## Vì sao một hàm cho hai cấp
 *
 * `taxonomyGroups()` đã trả về danh mục KÈM entry và số bài của chúng, trong ba truy vấn tổng.
 * Gọi nó một lần cho cấp ngoài rồi một lần nữa cho cấp trong là sáu truy vấn cho đúng
 * bộ dữ liệu đó — và tệ hơn, hai lượt đọc ở hai thời điểm khác nhau, nên số bài mà
 * tiêu đề nhóm nói ("12 câu hỏi") có thể lệch với số câu thực sự hiện ra.
 *
 * `limit` là `limit` của CẤP TRONG, vì nó quyết định `take` của truy vấn thứ hai. Cấp
 * ngoài chỉ cần tên danh mục, thứ đã nằm trong truy vấn thứ nhất.
 */
export async function resolveTaxonomyTree(
  typeKey: string,
  innerLimit: number,
  locale?: string,
  opts: { filter?: TaxonomyFilter; sort?: TaxonomySort } = {},
): Promise<TaxonomyTree> {
  const groups = await taxonomyGroups(typeKey, innerLimit, locale, opts);
  const entriesByTaxonomy = new Map<string, RepeatItem[]>();

  for (const g of groups) entriesByTaxonomy.set(g.taxonomy.id, g.entries.map(entryToItem));

  return {
    groups: groups.map((g) => ({
      taxonomyId: g.taxonomy.id,
      item: {
        // Item của cấp ngoài là một DANH MỤC, không phải một entry: `data` mang tên
        // danh mục để ánh xạ `name` → tiêu đề nhóm hoạt động y như với entry.
        key: g.taxonomy.id,
        // `entryCount` chứ không `entries.length`: cái sau đã bị cắt theo `limit`
        // của cấp trong, nên tiêu đề nhóm sẽ nói "3 bài" cho một danh mục 40 bài.
        data: { name: g.taxonomy.name, key: g.taxonomy.key, count: g.entryCount },
        slug: g.taxonomy.key,
      },
    })),
    entriesByTaxonomy,
  };
}
