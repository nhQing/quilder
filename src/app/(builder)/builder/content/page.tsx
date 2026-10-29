/**
 * Kho dữ liệu — cửa vào của mốc collection type.
 *
 * Không có gì ở đây biết "tin tức" hay "FAQ" là gì; chúng là hàng trong
 * `CollectionType`. Đó là điều làm "thêm một loại nội dung" không phải một lần
 * deploy.
 *
 * ## Vì sao tên màn là "Kho dữ liệu"
 *
 * Bản trước gọi nó "Kho nội dung", cạnh một màn tên "Nội dung" (`/builder/text`).
 * Hai nhãn chỉ khác một chữ, nên thanh menu bắt người dùng đọc kỹ mới phân biệt —
 * và chữ "Kho" không nói được khác biệt thật: bên kia là CÂU CHỮ trong trang, bên
 * này là BẢN GHI có cấu trúc sống độc lập với trang.
 *
 * "Kho dữ liệu" không dùng chung từ nào với "Văn bản", nên phân biệt được bằng cái
 * nhìn đầu tiên. Xem docblock `BuilderNav` cho cả cặp.
 */

import { getSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { getCollectionTypes } from '@/lib/collections/queries';
import { CollectionTypeGrid } from '@/components/builder/CollectionTypeGrid';
import { PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  const [session, types, groups, draftCounts, scheduledCounts] = await Promise.all([
    getSession(),
    getCollectionTypes(),
    prisma.fieldGroupDef.findMany({
      // Cùng quy ước với `getCollectionTypes`: thứ tự người dùng đặt, `createdAt`
      // phá hoà cho hàng mới (`order = 0`).
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, key: true, name: true, icon: true, schema: true },
    }),
    prisma.entry.groupBy({ by: ['typeKey'], where: { status: 'draft', archivedAt: null }, _count: true }),
    prisma.entry.groupBy({
      by: ['typeKey'],
      where: { status: 'published', publishedAt: { gt: new Date() }, archivedAt: null },
      _count: true,
    }),
  ]);

  const draftBy = new Map(draftCounts.map((d) => [d.typeKey, d._count]));
  const schedBy = new Map(scheduledCounts.map((d) => [d.typeKey, d._count]));

  // Đếm số loại đang dùng mỗi nhóm field: thẻ nhóm phải nói được "dùng ở 2 loại",
  // vì đó là thông tin quyết định khi có người muốn sửa một nhóm.
  const usedBy = new Map<string, number>();
  for (const t of types) {
    for (const f of t.schema) {
      const keys = f.t === 'group' ? [f.groupKey] : f.t === 'blocks' ? f.allowed : [];
      for (const k of keys) usedBy.set(k, (usedBy.get(k) ?? 0) + 1);
    }
  }

  return (
    <PageShell width="wide">
      {/* Đầu trang nằm trong `CollectionTypeGrid`: nút Sắp xếp ở đó dùng chung state với lưới. */}
      <CollectionTypeGrid
        canManageViews={session?.role === 'admin'}
        types={types.map((t) => ({
          key: t.key, name: t.name, namePlural: t.namePlural, icon: t.icon,
          singleton: t.singleton, entryCount: t.entryCount,
          draftCount: draftBy.get(t.key) ?? 0,
          scheduledCount: schedBy.get(t.key) ?? 0,
          fieldCount: t.schema.length,
        }))}
        groups={groups.map((g) => ({
          key: g.key, name: g.name, icon: g.icon,
          fieldCount: Array.isArray(g.schema) ? g.schema.length : 0,
          usedBy: usedBy.get(g.key) ?? 0,
        }))}
      />
    </PageShell>
  );
}
