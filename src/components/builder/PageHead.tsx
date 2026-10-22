/**
 * Đầu trang dùng chung cho mọi màn builder.
 *
 * ## Vì sao 13 header thành một component
 *
 * Đo ngày 22/08/2026: 13 chỗ tự render đầu trang, và chúng lệch nhau ở đúng bốn
 * chỗ — khoảng cách dưới, căn hàng, cỡ tiêu đề, cỡ dòng eyebrow. Không khác biệt nào
 * trong đó là một quyết định: chúng là trôi dạt của mười ba lần chép-dán, nên chúng
 * quy về một. Nav đã lên `BuilderNav` ở layout, nên ở đây chỉ còn phần thật sự thuộc
 * về một trang: nó là trang gì, nó nằm dưới cái gì, và làm được gì với nó.
 *
 * ## `breadcrumb` và `eyebrow` là hai dạng của MỘT dòng
 *
 * `breadcrumb` là dạng có link của `eyebrow` — truyền một trong hai, không truyền cả
 * hai. Từ giao diện v2, eyebrow tên sản phẩm không hiện nữa: tên sản phẩm đã
 * nằm ở đầu thanh menu, và lặp lại nó trên mọi màn chỉ đẩy tiêu đề xuống.
 *
 * Hình theo design system "Quilder UI": đường dẫn dạng `Breadcrumb`, tiêu đề
 * `text-page` đậm 700, dòng dưới `text-ui` màu `shell-muted`.
 */

import { Breadcrumb } from './ui/Page';

export interface Crumb {
  label: string;
  /** Không có `href` thì crumb là chữ trơ — dùng cho đoạn cuối (chính trang này). */
  href?: string;
}

/** Eyebrow chỉ nhắc lại tên sản phẩm — đã có ở thanh menu. */
const REDUNDANT_EYEBROW = 'Quilder';

export function PageHead({
  eyebrow,
  breadcrumb,
  title,
  subline,
  actions,
}: {
  eyebrow?: string;
  breadcrumb?: Crumb[];
  title: string;
  /** Dòng dưới tiêu đề: metric, hoặc một câu giải thích trang này là gì. */
  subline?: React.ReactNode;
  /** Cụm nút bên phải (Lưu nháp, Đăng, Kết nối Claude…). */
  actions?: React.ReactNode;
}) {
  const crumbs = breadcrumb ?? (eyebrow && eyebrow !== REDUNDANT_EYEBROW ? [{ label: eyebrow }] : []);

  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-[1_1_28rem] flex-col gap-2">
        {crumbs.length > 0 && <Breadcrumb items={crumbs} />}

        {/* `title` cả trong thuộc tính: tên component và tên entry dài hơn chỗ có
            và bị `truncate` cắt — không có tooltip thì không đọc lại được. */}
        <h1 className="truncate text-page font-bold" title={title}>
          {title}
        </h1>

        {subline && <div className="max-w-[78ch] text-ui leading-relaxed text-shell-muted">{subline}</div>}
      </div>

      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
