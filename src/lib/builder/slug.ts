/**
 * Chuỗi bất kỳ → slug.
 *
 * Trả RỖNG khi không còn ký tự nào dùng được. Đó là tín hiệu để chỗ gọi bắt người
 * dùng nhập tay, chứ không phải một lỗi — `""` cũng là slug hợp lệ của trang chủ,
 * nên hai trường hợp đó phân biệt ở `validateNewPage` chứ không ở đây.
 *
 * Cắt ở 80 ký tự: dài hơn là một URL không ai gõ được.
 *
 * ## Vì sao nó nằm ở file riêng
 *
 * Trước 27/08/2026 hàm này sống trong `create-page.ts`, file khai `server-only` và
 * import prisma — nên mọi file muốn dùng nó đều kéo theo cả Prisma Client, và test
 * của chúng chết ở `@prisma/client did not initialize yet`. Đây là lần thứ năm
 * cùng một hình dạng lỗi trong dự án này: một hàm thuần mắc kẹt sau một import
 * prisma. Luật rút ra: hàm thuần ở file thuần, ngay từ đầu.
 */
export function toSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/* ── Đường dẫn nhiều đoạn, cú pháp Next.js ────────────────────────────── */

/**
 * Trần số đoạn. Hơn bốn đoạn là đang mô hình hoá một cây thư mục bằng URL, và
 * bảng định tuyến ở đây không phải chỗ để làm việc đó.
 */
export const MAX_SLUG_SEGMENTS = 4;

/**
 * Đoạn ĐỘNG, viết đúng cú pháp Next.js: `[category]`, `[slug]`.
 *
 * Tên trong ngoặc là tài liệu cho người đọc `list_pages` — matcher không đọc nó.
 * Thứ quyết định ý nghĩa của đoạn động là `Page.collection.param`.
 */
const PARAM_RE = /^\[[a-z][a-z0-9-]{0,29}\]$/;

/** Đoạn đầu bị route thật của Next chiếm, hoặc bị `splitLocale` ăn mất. */
export const RESERVED_FIRST_SEGMENTS = [
  'preview',
  'api',
  'builder',
  'render',
  'mm-css',
  'sitemap.xml',
  'robots.txt',
  // Tài nguyên tĩnh của gói dự án (src/app/p/[...path]/route.ts).
  'p',
] as const;

export function isParamSegment(seg: string): boolean {
  return PARAM_RE.test(seg);
}

/** `'blogs/[category]'` → `['blogs', '[category]']`. Slug rỗng → `[]`. */
export function slugSegments(slug: string): string[] {
  return slug ? slug.split('/') : [];
}

/** Trang này là MẪU, không phải một địa chỉ mở được. */
export function isTemplateSlug(slug: string): boolean {
  return slug.includes('[');
}

/**
 * Hình dạng của một mẫu: mọi đoạn động thành `*`.
 *
 * `blogs/[category]` và `blogs/[thang]` cùng ra `blogs/*`. Hai mẫu cùng hình dạng
 * thì thứ tự khớp phụ thuộc thứ tự đọc DB — một cuộc bốc thăm thầm lặng. Đường ghi
 * dùng hàm này để từ chối mẫu thứ hai.
 */
export function slugShape(slug: string): string {
  return slugSegments(slug)
    .map((s) => (isParamSegment(s) ? '*' : s))
    .join('/');
}

/** Tên các đoạn động, theo thứ tự. `blogs/[category]` → `['category']`. */
export function paramNames(slug: string): string[] {
  return slugSegments(slug)
    .filter(isParamSegment)
    .map((s) => s.slice(1, -1));
}

/**
 * Chuỗi bất kỳ → đường dẫn nhiều đoạn.
 *
 * Đặt CẠNH `toSlug` chứ không sửa nó: `toSlug` còn phục vụ mọi chỗ mà một dấu `/`
 * là rác cần bỏ (khoá field, tên taxonomy). Chỉ đường ghi của `Page.slug` mới cần
 * hiểu dấu `/` là ranh giới đoạn.
 *
 * `'//Blogs//Post/'` → `'blogs/post'`; `'Tin Tức/[Slug]'` → `'tin-tuc/[slug]'`.
 *
 * Đoạn trong ngoặc được chuẩn hoá BÊN TRONG ngoặc rồi lắp lại — không chạy `toSlug`
 * lên cả đoạn, vì `toSlug('[slug]')` trả `'slug'`, tức một đoạn động lặng lẽ trở
 * thành một đoạn tĩnh và trang mẫu thành một URL thật.
 */
export function toSlugPath(input: string): string {
  return input
    .split('/')
    .map((raw) => {
      const seg = raw.trim();
      if (seg.startsWith('[') && seg.endsWith(']') && seg.length > 2) {
        const inner = toSlug(seg.slice(1, -1));
        return inner ? `[${inner}]` : '';
      }
      return toSlug(seg);
    })
    .filter(Boolean)
    .join('/');
}

/**
 * Luật của một `Page.slug`. Trả câu lỗi tiếng Việt, hoặc `null` khi hợp lệ.
 *
 * Chạy trên slug ĐÃ qua `toSlugPath`, nên nó không kiểm ký tự — chỉ kiểm những thứ
 * mà chuẩn hoá không sửa được: số đoạn, chỗ đứng của đoạn động, và va chạm với các
 * route có thật.
 *
 * `''` (trang chủ) là hợp lệ và đi thẳng qua đây.
 */
export function checkSlugPath(
  slug: string,
  opts: { localeCodes?: readonly string[] } = {},
): string | null {
  const segs = slugSegments(slug);
  if (segs.length === 0) return null;

  if (segs.length > MAX_SLUG_SEGMENTS) {
    return `Đường dẫn tối đa ${MAX_SLUG_SEGMENTS} đoạn, đang có ${segs.length}.`;
  }
  for (const s of segs) {
    if (s.length > 80) return `Đoạn "${s.slice(0, 20)}…" dài quá 80 ký tự.`;
    if (s.includes('[') && !isParamSegment(s)) {
      return `Đoạn động "${s}" sai cú pháp. Đúng phải là [ten-doan], chữ thường không dấu.`;
    }
  }

  const params = segs.filter(isParamSegment);
  if (params.length > 1) {
    return 'Mỗi trang chỉ được MỘT đoạn động. Muốn hai cấp thì tách thành hai trang.';
  }
  if (isParamSegment(segs[0]!)) {
    return 'Đoạn động không được đứng đầu — nó sẽ nuốt mọi địa chỉ một đoạn của site.';
  }

  const first = segs[0]!;
  if ((RESERVED_FIRST_SEGMENTS as readonly string[]).includes(first)) {
    return `"${first}" là đường dẫn hệ thống, không dùng làm đoạn đầu được.`;
  }
  if (opts.localeCodes?.includes(first)) {
    return `"${first}" là mã ngôn ngữ đang bật — địa chỉ này sẽ bị hiểu là tiền tố ngôn ngữ.`;
  }

  return null;
}

/**
 * URL → mẫu khớp, theo đúng luật Next.js: **tĩnh thắng động, trái sang phải**.
 *
 * Gọi SAU khi khớp chính xác đã thất bại — thứ tự đó là điều kiện để tính năng này
 * không đổi một URL nào đang chạy.
 *
 * Hoà thì chọn mẫu có NHIỀU đoạn tĩnh nhất. Bất biến "hai mẫu không cùng hình dạng"
 * ở đường ghi bảo đảm không còn hoà nào sau bước đó; nhưng dữ liệu cũ có thể vi
 * phạm, nên hàm vẫn chọn tất định thay vì lấy cái đầu tiên gặp.
 */
export function matchSlugTemplate<T extends { slug: string }>(
  urlSlug: string,
  templates: readonly T[],
): { template: T; params: Record<string, string> } | null {
  // Gõ thẳng chuỗi có ngoặc không được phục vụ như một URL: không chặn thì một con
  // bot gõ đúng `/blogs/[category]` sẽ nhận trang mẫu chưa bind dữ liệu, và Google
  // index nó. Slug của entry không bao giờ chứa `[` (`toSlug` xoá), nên không ca hợp
  // lệ nào mất ở đây.
  if (urlSlug.includes('[')) return null;

  const url = slugSegments(urlSlug);
  if (url.length === 0) return null;

  let best: { template: T; params: Record<string, string>; statics: number } | null = null;

  for (const t of templates) {
    const segs = slugSegments(t.slug);
    if (segs.length !== url.length) continue;

    const params: Record<string, string> = {};
    let statics = 0;
    let ok = true;

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!;
      const u = url[i]!;
      if (isParamSegment(s)) {
        params[s.slice(1, -1)] = u;
      } else if (s === u) {
        statics++;
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // `>` chứ không `>=`: hoà thì giữ cái gặp trước, nên kết quả không phụ thuộc
    // thứ tự sắp xếp của mảng đầu vào miễn là mảng đó ổn định.
    if (!best || statics > best.statics) best = { template: t, params, statics };
  }

  return best ? { template: best.template, params: best.params } : null;
}
