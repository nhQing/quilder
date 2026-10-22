'use client';

/**
 * Thanh menu duy nhất của vỏ builder — từ giao diện v2 là một thanh DỌC bên trái.
 *
 * ## Vì sao `SECTIONS` là một mảng, và là nguồn sự thật duy nhất
 *
 * Trước file này, mỗi trang tự khai tập link của nó trong `<header>`. Kết quả đo
 * được ngày 22/08/2026: 10 trang cùng họ header nhưng KHÔNG trang nào có cùng tập
 * link, và 7/18 trang không có đường đăng xuất. Đó là hệ quả tất yếu của việc
 * "builder có những khu nào" được trả lời mười lần ở mười chỗ.
 *
 * Nên: một mảng, ở đây. Thêm khu mới là thêm một dòng.
 *
 * ## Vì sao active theo TIỀN TỐ DÀI NHẤT, không phải `startsWith` đầu tiên khớp
 *
 * `/builder` là tiền tố của mọi route builder, nên vòng lặp "khớp cái đầu tiên"
 * sẽ luôn sáng "Trang". Còn khớp bằng `===` thì mọi trang con tắt hết đèn. Tiền tố
 * dài nhất giải cả hai: `/builder/content/tin-tuc` khớp cả `/builder` và
 * `/builder/content`, và `/builder/content` thắng vì dài hơn. Trang sửa
 * `/builder/<pageId>` chỉ khớp `/builder`, nên nó sáng ở "Trang".
 *
 * So sánh theo ĐOẠN đường dẫn, không theo chuỗi: `'/builder/componentsX'
 * .startsWith('/builder/components')` là `true`.
 *
 * ## Hai bề rộng: đầy đủ và rail
 *
 * Dashboard dùng thanh đầy đủ (icon + nhãn). Thư viện và các màn editor thu thanh
 * thành RAIL chỉ có icon (`--shell-rail`), để nhường chỗ cho cây thư mục hoặc
 * Inspector. Nhãn vẫn còn trong `aria-label` + `title`, nên tên của link không đổi
 * với screen reader và với test.
 *
 * ## Không có chữ "Publish" trong thanh
 *
 * Màn editor có nút "Publish trang này" và test tìm nó bằng tên. Một nút Publish
 * thứ hai trong thanh menu là hai nút cùng tên trên một màn — với người dùng lẫn
 * với Playwright.
 *
 * ## Mục vừa bấm báo "đang mở" ngay tại chỗ
 *
 * Mọi khu là một lượt render ở server, nên giữa cú bấm và lúc router commit có một khoảng
 * mà trước đây không gì trên màn đổi — người dùng bấm lại liên tục. Giờ mục vừa bấm nền lên
 * như hover và icon thành spinner (`LinkIcon`, đọc `useLinkStatus`), còn thanh tiến độ ở mép
 * trên là của `NavProgress`. Mục KHÔNG đổi sang màu "đang mở" (`aria-current`) trước khi route
 * đổi thật: màu đó là lời khẳng định "bạn đang ở đây", và nó sai nếu lượt điều hướng bị bỏ.
 * Tên của link không đổi — spinner `aria-hidden`, không có chữ.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { LogoutButton } from './LogoutButton';
import { ThemeToggle, type ThemeChoice } from './ThemeToggle';
import { type IconName } from './ui/Icon';
import { LinkIcon } from './ui/LinkPending';

interface Section {
  href: string;
  label: string;
  icon: IconName;
  /** `me` — việc của riêng người đang đăng nhập, ở cụm dưới cùng cạnh Đăng xuất. */
  group: 'content' | 'system' | 'me';
  /** Chỉ hiện với vai trò admin. Ẩn link KHÔNG phải là cổng — cổng ở page và ở API. */
  admin?: boolean;
  /** Chỉ hiện với vai trò sửa được (editor, admin). Cùng lưu ý như `admin`. */
  writer?: boolean;
}

/**
 * Thứ tự chép từ `docs/BUILDER-UI-PROTO.html`, nhãn đã đổi ngày 27/08/2026.
 *
 * ## Vì sao "Văn bản" và "Kho dữ liệu", và vì sao KHÔNG cùng chứa chữ "nội dung"
 *
 *   /builder/text    — CÂU CHỮ nằm trong cây node của từng trang, kèm cột bản dịch
 *   /builder/content — BẢN GHI có cấu trúc (tin tức, FAQ, sản phẩm), sống độc lập
 *                      với trang
 *
 * Hai nhãn không dùng chung một từ nào, nên phân biệt được bằng cái nhìn đầu tiên.
 *
 * "Thư viện", không phải "Ảnh": kho nhận cả PDF, video, âm thanh và font.
 */
const SECTIONS: Section[] = [
  { href: '/builder', label: 'Trang', icon: 'grid', group: 'content' },
  { href: '/builder/text', label: 'Văn bản', icon: 'text', group: 'content' },
  { href: '/builder/content', label: 'Kho dữ liệu', icon: 'database', group: 'content' },
  { href: '/builder/components', label: 'Component', icon: 'cube', group: 'content' },
  { href: '/builder/assets', label: 'Thư viện', icon: 'folder', group: 'content' },
  { href: '/builder/settings', label: 'Cài đặt', icon: 'sliders', group: 'system' },
  { href: '/builder/releases', label: 'Lịch sử publish', icon: 'history', group: 'system' },
  { href: '/builder/admin', label: 'Tài khoản', icon: 'users', group: 'system', admin: true },
  // Token đứng tên CHÍNH người đang đăng nhập, nên nằm cạnh Đăng xuất chứ không trong
  // "Hệ thống". Ẩn với vai trò Xem: token Xem không sửa được gì, server cũng từ chối cấp.
  { href: '/builder/claude', label: 'Kết nối Claude', icon: 'sparkle', group: 'me', writer: true },
];

/** `href` có phải tiền tố THEO ĐOẠN của `pathname`? */
function covers(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Khu đang mở: tiền tố khớp DÀI NHẤT trong `SECTIONS`, hoặc `null`. */
function activeSection(pathname: string): string | null {
  let best: string | null = null;
  for (const s of SECTIONS) {
    if (covers(s.href, pathname) && (best === null || s.href.length > best.length)) {
      best = s.href;
    }
  }
  return best;
}

/**
 * Màn cần cả chiều ngang: Thư viện (cây thư mục + lưới), màn sửa trang
 * (`/builder/<pageId>`), màn sửa component (`/builder/components/<id>`) và form sửa
 * một mục (`/builder/content/<loại>/<id>`).
 */
export function isWideRoute(pathname: string): boolean {
  if (covers('/builder/assets', pathname)) return true;
  const parts = pathname.split('/').filter(Boolean); // ['builder', ...]
  if (parts[0] !== 'builder') return false;
  if (parts.length === 2) return !SECTIONS.some((s) => s.href === `/builder/${parts[1]}`) && parts[1] !== 'login' && parts[1] !== 'setup';
  // `/builder/components/<id>` và `/builder/components/<id>/edit` (màn sửa component).
  if (parts[1] === 'components' && parts.length >= 3) return true;
  if (parts[1] === 'content' && parts.length >= 4 && parts[2] !== 'types' && parts[2] !== 'groups' && parts[3] !== 'taxonomies') return true;
  return false;
}

export function BuilderNav({
  theme,
  isAdmin,
  isWriter = false,
  signedIn,
  logoUrl = null,
}: {
  theme: ThemeChoice;
  isAdmin: boolean;
  /** Vai trò sửa được (editor, admin). */
  isWriter?: boolean;
  signedIn: boolean;
  /** Logo riêng của builder (Cài đặt → Nhận diện builder). `null` = logo Quilder. */
  logoUrl?: string | null;
}) {
  const pathname = usePathname() ?? '';

  /*
   * Trang đăng nhập và màn cài đặt lần đầu không có thanh menu: chúng nằm ngoài
   * phiên, mọi link trong thanh sẽ bị middleware đá ngược về đây.
   */
  if (covers('/builder/login', pathname) || covers('/builder/setup', pathname)) return null;

  const active = activeSection(pathname);
  const rail = isWideRoute(pathname);
  const shown = SECTIONS.filter((s) => (!s.admin || isAdmin) && (!s.writer || isWriter));

  const item = (s: Section) => {
    const on = active === s.href;
    return (
      <Link
        key={s.href}
        href={s.href}
        aria-current={on ? 'page' : undefined}
        aria-label={rail ? s.label : undefined}
        title={rail ? s.label : undefined}
        className={cn(
          'flex shrink-0 items-center gap-3 rounded-md font-medium text-shell-muted transition-colors hover:bg-shell-raised hover:text-shell-ink',
          focusRing,
          rail ? 'size-12 justify-center' : 'min-h-11 px-3 text-[0.90625rem] max-md:size-11 max-md:justify-center max-md:px-0',
          // Đang chờ điều hướng (xem docblock đầu file). `cursor-progress` để con trỏ cũng nói.
          'has-[[data-link-pending]]:cursor-progress has-[[data-link-pending]]:bg-shell-raised has-[[data-link-pending]]:text-shell-ink',
          on && 'bg-shell-accent-soft font-semibold text-shell-accent hover:bg-shell-accent-soft hover:text-shell-accent',
        )}
      >
        <LinkIcon name={s.icon} size={rail ? 21 : 20} />
        {!rail && <span className="max-md:sr-only">{s.label}</span>}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Khu của builder"
      className={cn(
        ui.panel,
        'z-20 flex shrink-0 gap-1 p-2.5',
        // `relative`: nhãn `sr-only` là `position: absolute`; thiếu nó thì chúng thoát
        // khỏi vùng cuộn ngang của thanh và kéo CẢ TRANG tràn ngang ở bề rộng điện thoại.
        'max-md:relative max-md:items-center max-md:overflow-x-auto',
        'md:sticky md:top-[var(--shell-gutter)] md:h-[calc(100svh-var(--shell-nav))] md:flex-col md:overflow-y-auto',
        rail ? 'md:w-[var(--shell-rail)] md:items-center md:px-3.5 md:py-4' : 'md:w-[var(--shell-sidebar)] md:gap-6 md:px-4 md:py-5',
      )}
    >
      <Link
        href="/builder"
        aria-label="Quilder"
        title={rail ? 'Quilder' : undefined}
        className={cn('flex shrink-0 items-center gap-3 rounded-md text-shell-ink', focusRing, !rail && 'md:px-2')}
      >
        {logoUrl ? (
          /* Logo riêng trên ô TRẮNG viền mảnh: không biết trước nó màu gì, nên không đặt
             nó lên nền accent (logo xanh sẽ chìm) hay nền tối của theme tối. */
          <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-shell-line bg-white p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain" />
          </span>
        ) : (
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-shell-accent">
            {/* Logo một màu trắng của Quilder (public/brand). SVG tĩnh: next/image
                không tối ưu được gì thêm. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/quilder-symbol-white.svg" alt="" className="h-auto w-8" />
          </span>
        )}
        {!rail && (
          <span className="flex flex-col leading-tight max-md:hidden">
            <b className="text-card font-bold">Quilder</b>
            <span className="text-small text-shell-muted">Builder</span>
          </span>
        )}
      </Link>

      <div className={cn('flex gap-1 max-md:flex-row md:flex-col', rail && 'md:items-center md:gap-2')}>
        {!rail && <p className={cn(ui.eyebrow, 'mx-3 mb-1.5 max-md:hidden')}>Nội dung</p>}
        {shown.filter((s) => s.group === 'content').map(item)}
        {rail ? (
          <span aria-hidden className="my-2 h-px w-7 bg-shell-line max-md:hidden" />
        ) : (
          <p className={cn(ui.eyebrow, 'mx-3 mt-4 mb-1.5 max-md:hidden')}>Hệ thống</p>
        )}
        {shown.filter((s) => s.group === 'system').map(item)}
      </div>

      <div className={cn('flex shrink-0 gap-2 max-md:ml-auto max-md:flex-row md:mt-auto md:flex-col', rail && 'md:items-center')}>
        {shown.filter((s) => s.group === 'me').map(item)}
        <ThemeToggle value={theme} vertical={rail} />
        {/* Không có phiên thì không có gì để thoát. */}
        {signedIn && <LogoutButton compact={rail} />}
      </div>
    </nav>
  );
}
