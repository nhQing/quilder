import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/guard';
import { can } from '@/lib/auth/session';
import { connectContext, tokenRows } from '@/lib/builder/claude-connect';
import { TokenAdmin } from '@/components/builder/TokenAdmin';
import { EmptyState, PageHeader, PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Kết nối Claude CỦA TÔI: cấp token cho máy mình, xem và thu hồi token đứng tên mình.
 *
 * Luồng: deploy lên abc.com → đăng nhập ở /builder → vào đây lấy token kèm hướng dẫn đã
 * điền sẵn → dán vào Claude Desktop. Máy người dùng không cần có repo, nên trang này phát
 * luôn cả file server (xem /api/tokens/client).
 *
 * Mở cho mọi người từ 16/10/2026 (trước đó chỉ admin, ở `/builder/admin/tokens`): token mang
 * đúng role của người đứng tên, nên tự cấp không nâng quyền ai. Admin xem token của MỌI
 * người ở Tài khoản › Kết nối Claude.
 */
export default async function ClaudePage() {
  const session = await getSession();
  if (!session) redirect('/builder/login?next=/builder/claude');

  const description =
    'Ra lệnh sửa site trong Claude Desktop. Suy luận chạy trong gói thuê bao Claude của bạn — không cần API key, không tính credit.';

  if (!can(session.role, 'write')) {
    return (
      <PageShell>
        <PageHeader title="Kết nối Claude" description={description} />
        <EmptyState
          icon="key"
          title="Vai trò “Xem” không nối được Claude."
          description="Claude sửa site bằng quyền của tài khoản bạn, mà vai trò Xem thì không sửa được gì. Nhờ quản trị nâng tài khoản lên “Sửa” trước."
        />
      </PageShell>
    );
  }

  const [tokens, { origin, platform }] = await Promise.all([tokenRows(session.sub), connectContext()]);

  return (
    <PageShell>
      <PageHeader title="Kết nối Claude" description={description} />
      <TokenAdmin scope="mine" tokens={tokens} origin={origin} platform={platform} />
    </PageShell>
  );
}
