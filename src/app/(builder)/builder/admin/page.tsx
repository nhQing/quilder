import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { UserAdmin } from '@/components/builder/UserAdmin';
import { PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';

/**
 * Quản lý tài khoản.
 *
 * Middleware đã bảo đảm có phiên hợp lệ, nhưng KHÔNG kiểm vai trò — nó chạy trên
 * Edge và không đọc được database. Kiểm quyền là việc ở đây, và mỗi route API
 * bên dưới cũng tự kiểm lại: một trang server component ẩn nút đi không phải là
 * cổng, vì API vẫn gọi thẳng được.
 *
 * Tiêu đề trang nằm trong `UserAdmin`, không ở đây: nút "Thêm tài khoản" trên tiêu
 * đề mở dialog của chính component đó.
 */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/builder/login?next=/builder/admin');
  if (session.role !== 'admin') redirect('/builder');

  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
    select: {
      id: true, email: true, name: true, role: true, createdAt: true,
      lockedAt: true, avatarAssetId: true,
    },
  });

  return (
    <PageShell>
      <UserAdmin
        meId={session.sub}
        users={users.map((u) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
          lockedAt: u.lockedAt?.toISOString() ?? null,
        }))}
      />
    </PageShell>
  );
}
