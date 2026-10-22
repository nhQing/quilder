'use client';

/**
 * Phân trang của thùng rác. `AssetPager` dựng link bằng `scopeHref` (thư mục) và không
 * biểu diễn được `?trash=1`, nên màn rác có bản riêng — cùng `PagerBar`, dùng `trashHref`.
 */

import { useRouter } from 'next/navigation';

import { PagerBar } from './AssetPager';
import { trashHref } from './types';

export function AssetTrashPager({
  q,
  page,
  pageSize,
  total,
  shown,
}: {
  q: string;
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
      prevHref={trashHref({ page: page - 1, size: pageSize, q })}
      nextHref={trashHref({ page: page + 1, size: pageSize, q })}
      onSize={(size) => router.push(trashHref({ size, q }))}
    />
  );
}
