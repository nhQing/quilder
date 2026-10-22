/**
 * `Page.collection` — hình dạng, phép đọc, và luật ghép nó với slug.
 *
 * ## Vì sao ở file THUẦN
 *
 * Bản trước sống trong `src/lib/render/collection-page.ts`, file khai `server-only`
 * và import prisma. Đường ghi (`validateNewPage`, `renamePage`, tool MCP) cần đúng
 * những luật này, và kéo chúng qua đó là kéo cả Prisma Client vào mọi test của đường
 * ghi. Đây là lần thứ sáu cùng một hình dạng lỗi trong dự án — xem docblock của
 * `toSlug`. Luật thuần ở file thuần, ngay từ đầu.
 */

import { isTemplateSlug } from './slug';

/**
 * Vai của đoạn động trong slug của trang.
 *
 * `list` — không có đoạn động; trang liệt kê. (`/blogs`)
 * `entry` — giá trị đoạn động là `slug` của một bản ghi. (`/blogs/post/[slug]`)
 * `taxonomy` — giá trị đoạn động là `key` của một danh mục. (`/blogs/[category]`)
 * `relation` — giá trị đoạn động là `slug` của một bản ghi thuộc loại ĐÍCH của một
 *   field `relation`. (`/blogs/[category-slug]`)
 *
 * ## Vì sao `relation` là một vai RIÊNG chứ không phải `taxonomy` đọc rộng ra
 *
 * Cùng lý do `CollectionFilter` tách `k: 'relation'` khỏi `k: 'taxonomy'`: hai vai
 * này đọc hai NƠI khác nhau. `taxonomy` tra bảng `Taxonomy` theo `key`; `relation`
 * tra bảng `Entry` theo `slug`, và bản ghi tìm được phải là bản ghi ĐÃ ĐĂNG. Gộp
 * hai phép tra vào một vai thì chỗ khai duy nhất nói "tra ở đâu" là kiểu của field —
 * một thứ đọc được từ DB nhưng KHÔNG đọc được từ `Page.collection`, tức bảng định
 * tuyến phải đi hỏi DB mới biết mình là bảng của cái gì.
 *
 * Đây là vai mà mô hình dữ liệu mới cần: `tin-tuc` không còn field `taxonomy`; danh
 * mục của nó là field `relation` tên `category` trỏ sang loại `danh-muc`.
 */
export type PageParamRole = 'list' | 'entry' | 'taxonomy' | 'relation';

export const PAGE_PARAM_ROLES: readonly PageParamRole[] = [
  'list',
  'entry',
  'taxonomy',
  'relation',
];

/**
 * Nhãn của BỐN vai, cùng chữ với mô tả tool MCP để hai chỗ không nói khác nhau.
 *
 * `Record<PageParamRole, …>` là chỗ bắt hai bên lệch: thêm một vai mà quên nhãn thì
 * biên dịch đỏ, chứ không phải một vai âm thầm không đặt được từ giao diện.
 *
 * ## Vì sao nó nằm ĐÂY chứ không nằm cạnh ô chọn
 *
 * Bản trước khai hằng này trong `components/builder/PageRename.tsx` — một module
 * `'use client'`. Danh sách trang (`app/(builder)/builder/page.tsx`) là SERVER
 * component, và nó import hằng ấy về để in huy hiệu vai.
 *
 * Trong React Server Components, mọi export của một module `'use client'` biến thành
 * CLIENT REFERENCE: phía server nhận một proxy, không phải object thật. Đọc
 * `ROLE_LABEL[role]` lúc render ở server vì thế ném lỗi, và cả trang `/builder` trả
 * 500 — "a server-side exception has occurred", không kèm chi tiết vì production ẩn
 * thông báo đi.
 *
 * Đó là một lỗi THẬT đã lên tới stg ngày 14/09/2026. Điều đáng nhớ hơn cả bản sửa:
 * `next build`, `tsc --noEmit` và cả 1906 test đều XANH. Ranh giới client/server
 * không nằm trong bất kỳ phép kiểm nào của repo này — nó chỉ nổ lúc chạy, trên
 * server, sau khi deploy.
 *
 * Hằng dữ liệu thuần mà cả hai phía cùng đọc thì phải sống trong module KHÔNG đánh
 * dấu `'use client'`. `PageRename.tsx` re-export lại để chỗ gọi và test cũ không
 * phải đổi.
 */
export const ROLE_LABEL: Record<PageParamRole, string> = {
  list: 'Danh sách — liệt kê nhiều bản ghi',
  entry: 'Chi tiết — mỗi bản ghi một trang',
  taxonomy: 'Danh mục — mỗi danh mục một trang',
  relation: 'Theo quan hệ — mỗi bản ghi của một field relation một trang',
};

/**
 * Ví dụ slug cho từng vai CẦN đoạn động. Một bản, dùng cho cả câu lỗi lẫn mô tả tool
 * MCP — hai bản sẽ dạy người dựng hai cú pháp khác nhau cho cùng một vai.
 */
export const PARAM_ROLE_EXAMPLE: Record<Exclude<PageParamRole, 'list'>, string> = {
  entry: 'blogs/post/[slug]',
  taxonomy: 'blogs/[category]',
  relation: 'blogs/[category-slug]',
};

export interface PageCollection {
  typeKey: string;
  param: PageParamRole;
  /**
   * CHỈ có nghĩa với `param: 'relation'`, và BẮT BUỘC ở đó.
   *
   * Khoá của một field `relation` trên `typeKey`. Loại ĐÍCH của field ấy là loại
   * mang slug trên URL — nên `field` là thứ duy nhất nối đoạn động với một loại, và
   * nó đọc loại đích từ schema thay vì chép lại tên loại ở đây. Hai bản của cùng một
   * mối quan hệ sẽ lệch nhau ở lần đầu có ai đổi field trỏ sang loại khác.
   *
   * Optional trong KIỂU, bắt buộc trong `parsePageCollection` và
   * `checkCollectionPairing`: ba vai cũ không có nó, và bắt buộc trong kiểu sẽ biến
   * mọi `{ typeKey, param }` đang có thành lỗi biên dịch.
   */
  field?: string;
}

/**
 * `Page.collection` là JSONB, nên nó có thể là bất cứ gì.
 *
 * Cột này do builder ghi, nhưng "do ta ghi" không phải một bảo đảm về hình dạng sau
 * một lần migrate, một lần sửa tay trong Prisma Studio, hay một seed cũ.
 *
 * ## Vì sao `{param}` chứ không `{mode}` như bản 08/09
 *
 * Bản trước để đoạn động NGOÀI slug và suy nó ra từ `mode: 'list' | 'detail'`. Đường
 * dẫn khi ấy sống ở hai chỗ — phần tĩnh trong `Page.slug`, phần động trong
 * `collection` — nên đọc `list_pages` không thấy `/blogs/:category` nằm ở đâu. Từ khi
 * đoạn động nằm thẳng trong slug (`blogs/[category]`), cột này chỉ còn một việc: nói
 * đoạn ấy TRỎ VÀO CÁI GÌ. Đó là `param`.
 *
 * Đổi được hình dạng mà không tốn migration vì §2.2 của spec: chưa từng có đường ghi
 * nào cho cột này, nên không hàng nào trong DB mang `{mode}`.
 */
export function parsePageCollection(v: unknown): PageCollection | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { typeKey?: unknown; param?: unknown; field?: unknown };
  if (typeof o.typeKey !== 'string' || !o.typeKey) return null;
  if (!PAGE_PARAM_ROLES.includes(o.param as PageParamRole)) return null;
  const param = o.param as PageParamRole;

  /*
   * `field` được TRẢ VỀ đúng ở vai `relation`, và bị bỏ ở ba vai kia.
   *
   * Bỏ chứ không từ chối: một hàng mang `field` thừa là dữ liệu vô hại, còn từ chối
   * cả hàng nghĩa là biến một trang đang chạy thành 404 vì một khoá không ai đọc.
   * Đối xứng với việc file này vẫn bỏ qua mọi khoá lạ khác.
   */
  if (param !== 'relation') return { typeKey: o.typeKey, param };

  // Vai `relation` KHÔNG có `field` thì đoạn động không tra được vào đâu — cùng hạng
  // với một mẫu không khai `collection`, nên cùng câu trả lời: không phải một mẫu.
  if (typeof o.field !== 'string' || !o.field) return null;
  return { typeKey: o.typeKey, param, field: o.field };
}

/**
 * Gốc của một mẫu: slug bỏ đoạn động đi.
 *
 * `blogs/post/[slug]` → `/blogs/post`; `blogs/[category]` → `/blogs`.
 *
 * Đây là thứ `repeat` cần để dựng href: `slug` của một entry một mình chỉ là
 * `lai-suat-thang-8`, và một href như thế là đường dẫn tương đối — bấm từ `/blogs` ra
 * `/lai-suat-thang-8`, tức 404. Ca hỏng chỉ lộ ra khi có người bấm.
 */
export function templateBase(slug: string): string {
  const kept = slug
    .split('/')
    .filter((s) => s && !s.startsWith('['))
    .join('/');
  return `/${kept}`;
}

/**
 * Slug và `collection` phải nói CÙNG một chuyện. Trả câu lỗi, hoặc `null`.
 *
 * Hai chiều, và cả hai đều là lỗi im lặng nếu bỏ qua:
 *
 *  - Slug có đoạn động mà không khai `collection` → matcher không biết đoạn ấy trỏ
 *    vào đâu, nên URL trả 404 và không có thông báo nào nói tại sao.
 *  - Khai `param:'entry'` mà slug không có đoạn động → trang không bao giờ nhận được
 *    một giá trị nào; nó là một trang thường mang một lời khai vô nghĩa.
 */
export function checkCollectionPairing(
  slug: string,
  collection: PageCollection | null,
): string | null {
  const isTemplate = isTemplateSlug(slug);

  if (isTemplate && !collection) {
    return 'Đường dẫn có đoạn động thì phải chọn loại nội dung cho nó — nếu không, địa chỉ này chỉ trả 404.';
  }
  if (isTemplate && collection?.param === 'list') {
    return 'Trang danh sách không được có đoạn động. Bỏ [..] khỏi đường dẫn, hoặc đổi vai sang Bài viết / Danh mục.';
  }
  /*
   * Hàng rào cho một `PageCollection` dựng BẰNG TAY.
   *
   * `parsePageCollection` đã đòi `field` ở vai này, nhưng `field` là optional trong
   * KIỂU (xem docblock của nó), nên `{ typeKey, param: 'relation' }` vẫn là một giá
   * trị hợp kiểu và vẫn đi thẳng tới đây được từ đường ghi. Thiếu nó thì mẫu khớp URL
   * rồi không phân giải được đoạn động — tức 404 im lặng trên một trang trông như đã
   * khai đủ.
   */
  if (collection?.param === 'relation' && !collection.field) {
    return 'Vai theo bản ghi phải nói rõ field relation nào (`field`) — không có nó thì đoạn động trên đường dẫn không biết tra vào loại nào, và địa chỉ chỉ trả 404.';
  }
  if (!isTemplate && collection && collection.param !== 'list') {
    return `Vai "${collection.param}" cần một đoạn động trong đường dẫn, ví dụ ${
      PARAM_ROLE_EXAMPLE[collection.param]
    }.`;
  }
  return null;
}
