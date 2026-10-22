'use client';

/**
 * Thanh phân trang của kho ảnh.
 *
 * ## Vì sao là `<Link>` chứ không phải `<button>` gọi `router.push`
 *
 * Trang sau là một ĐỊA CHỈ, y như thư mục (xem đầu `AssetGrid.tsx`). Link cho người
 * dùng mở trang 3 ở tab mới, bookmark nó, và cho Next prefetch nó khi con trỏ đi
 * ngang — cả ba đều mất nếu nút là `onClick`.
 *
 * ## Vì sao không có dãy số 1 2 3 … 12
 *
 * Ảnh xếp mới-nhất-trước và không có tên trang nào, nên "trang 7" không mang nghĩa
 * gì với người dùng — họ đang duyệt, không đang tra. Dãy số chỉ thêm một hàng ô bấm
 * cho một cú nhảy không ai nhắm được. Ai cần nhảy xa thì đổi cỡ trang, hoặc vào
 * đúng thư mục.
 *
 * Nó cũng KHÔNG tự ẩn khi chỉ có một trang: bộ chọn cỡ trang nằm ở đây, và một kho
 * 30 file ở cỡ 48 vẫn cần đường để đổi xuống 24.
 */

import { useRouter } from 'next/navigation';

import { ASSET_PAGE_SIZES } from '@/lib/assets/paging';

import { ButtonLink, buttonClass } from '../ui/Button';
import { SelectField } from '../ui/Field';
import { Icon, type IconName } from '../ui/Icon';
import { scopeHref, type Scope } from './types';

const SIZE_OPTIONS = ASSET_PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} / trang` }));

function Step({ href, icon, iconRight, children }: { href: string | null; icon?: IconName; iconRight?: IconName; children: React.ReactNode }) {
  if (href) {
    return (
      <ButtonLink href={href} variant="secondary" size="md" icon={icon} iconRight={iconRight}>
        {children}
      </ButtonLink>
    );
  }
  return (
    <span aria-disabled className={buttonClass('secondary', 'md', 'pointer-events-none opacity-40')}>
      {icon && <Icon name={icon} size={18} />}
      {children}
      {iconRight && <Icon name={iconRight} size={18} />}
    </span>
  );
}

/** Phần nhìn chung của hai thanh phân trang (thư viện và thùng rác). */
export function PagerBar({
  page,
  pageSize,
  total,
  shown,
  prevHref,
  nextHref,
  onSize,
}: {
  page: number;
  pageSize: number;
  /** Tổng số file của cả phạm vi, không phải của trang. */
  total: number;
  /** Số file trang này thật sự vẽ ra. */
  shown: number;
  prevHref: string;
  nextHref: string;
  onSize: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;

  return (
    <nav aria-label="Phân trang" className="flex flex-wrap items-center gap-3 text-small text-shell-muted">
      <span className="tabular-nums">
        {from}–{from + Math.max(0, shown - 1)} / {total} file · trang {page}/{pageCount}
      </span>

      <span className="flex gap-2">
        <Step href={page > 1 ? prevHref : null} icon="chevron-left">
          Trước
        </Step>
        <Step href={page < pageCount ? nextHref : null} iconRight="chevron-right">
          Sau
        </Step>
      </span>

      {/*
        Đổi cỡ trang thì về TRANG 1.

        Đang ở trang 5 của cỡ 24 rồi chuyển sang cỡ 96 thì trang 5 không còn tồn
        tại, và một lưới trống là câu trả lời tệ nhất cho một cú bấm vào bộ chọn.
      */}
      <SelectField
        label="Số file mỗi trang"
        hideLabel
        size="md"
        value={String(pageSize)}
        onChange={(e) => onSize(Number(e.target.value))}
        options={SIZE_OPTIONS}
        wrapperClassName="ml-auto w-36"
      />
    </nav>
  );
}

export function AssetPager({
  scope,
  q,
  used,
  page,
  pageSize,
  total,
  shown,
}: {
  scope: Scope;
  /** Bộ lọc đang mở — phải mang theo khi đổi trang, không thì mất lọc giữa chừng. */
  q: string;
  used: 'used' | 'unused' | undefined;
  page: number;
  pageSize: number;
  total: number;
  shown: number;
}) {
  const router = useRouter();
  return (
    <PagerBar
      page={page}
      pageSize={pageSize}
      total={total}
      shown={shown}
      prevHref={scopeHref(scope, { page: page - 1, size: pageSize, q, used })}
      nextHref={scopeHref(scope, { page: page + 1, size: pageSize, q, used })}
      onSize={(size) => router.push(scopeHref(scope, { size, q, used }))}
    />
  );
}
