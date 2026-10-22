import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/guard';
import { connectContext, tokenRows } from '@/lib/builder/claude-connect';
import { AccountTabs } from '@/components/builder/AccountTabs';
import { TokenAdmin } from '@/components/builder/TokenAdmin';
import { PageHeader, PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Tài khoản › Kết nối Claude: MỌI token của mọi người — chỗ admin trả lời "máy nào đang
 * có quyền ghi vào site" và thu hồi.
 *
 * Cấp token không nằm ở đây: mỗi người (kể cả admin) tự cấp cho máy mình ở
 * `/builder/claude`, link ở cuối thanh menu. Màn này chỉ xem và thu hồi.
 */
export default async function TokensPage() {
  const session = await getSession();
  if (!session) redirect('/builder/login?next=/builder/admin/tokens');
  // Người không phải admin sang màn cá nhân, không về trang chủ: `mcp/server.mjs` bản cũ
  // (trước 16/10/2026) trên máy người dùng vẫn chỉ tới đường này khi token hết hạn.
  if (session.role !== 'admin') redirect('/builder/claude');

  const [tokens, { origin, platform }] = await Promise.all([tokenRows(), connectContext()]);

  return (
    <PageShell>
      <PageHeader
        title="Tài khoản"
        description="Mọi máy đang nối Claude Desktop vào builder, của mọi người. Thu hồi có hiệu lực ngay."
      />

      <AccountTabs current="tokens" />

      <TokenAdmin scope="all" tokens={tokens} origin={origin} platform={platform} />
    </PageShell>
  );
}
