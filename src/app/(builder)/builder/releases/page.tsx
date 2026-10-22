import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/guard';
import { can } from '@/lib/auth/session';
import { listReleaseTimeline } from '@/lib/builder/queries';
import { ROLLBACK_KEEP_RELEASES, ROLLBACK_WINDOW_TEXT } from '@/lib/builder/rollback-window';
import { PageHeader, PageShell } from '@/components/builder/ui/Page';
import { PendingWork } from '@/components/builder/PendingWork';
import { ReleaseTimeline, type ReleaseRow } from '@/components/builder/ReleaseTimeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Lịch sử publish.
 *
 * Đây là mạng an toàn của cả hệ thống: mỗi lần publish tạo một release bất biến,
 * và lùi bản chỉ là đổi `Site.activeReleaseId`. API đã chạy từ Plan 3 nhưng chưa
 * có chỗ bấm — mà một nút lùi chỉ gọi được bằng `curl` thì lúc cần nhất sẽ không
 * ai dùng được.
 */
export default async function ReleasesPage() {
  const session = await getSession();
  if (!session) redirect('/builder/login?next=/builder/releases');

  // Dư hơn cửa sổ rollback một đoạn, để bản vừa ra khỏi cửa sổ vẫn thấy được kèm nhãn.
  const releases = await listReleaseTimeline(ROLLBACK_KEEP_RELEASES + 20);

  const rows: ReleaseRow[] = releases.map((r) => ({
    id: r.id,
    label: r.label,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy,
    isActive: r.isActive,
    pageCount: r.pageCount,
    changedPages: r.changedPages,
    inRollbackWindow: r.inRollbackWindow,
  }));

  return (
    <PageShell>
      <PageHeader
        title="Lịch sử publish"
        description={
          <>
            Mỗi lần publish là một ảnh chụp bất biến của cả site. Lùi bản chỉ đổi con trỏ
            nên luôn thành công và mất chưa tới một giây — không build, không deploy lại.
            Lùi về đúng nguyên trạng được đảm bảo cho {ROLLBACK_WINDOW_TEXT}: ảnh đã xoá
            hoàn toàn vẫn được giữ cho các bản đó.
          </>
        }
      />

      {/*
        Khối "Chờ publish" — CÙNG component với bảng điều khiển, không phải một bản
        thứ hai.

        Đây là chỗ người ta đứng khi đang nghĩ về cả site, nên câu "còn gì chưa lên"
        thuộc về đây ít nhất bằng ở trang chủ. Chép ra một biến thể riêng cho màn này
        là hai bản của một câu trả lời, và bản ít được nhớ tới sẽ trôi — đúng lỗi mà
        `PendingWork` được dựng thành một component để tránh.

        `key` theo release đang chạy: `PendingWork` tự tải danh sách một lần lúc gắn,
        còn "Publish toàn site" và "Lùi về bản này" ở dưới chỉ `router.refresh()` —
        không có `key` thì khối này giữ danh sách cũ dù mọi trang đã lên. Release đổi
        thì component dựng lại và tải lại.
      */}
      <PendingWork key={rows.find((r) => r.isActive)?.id ?? 'none'} />

      <ReleaseTimeline releases={rows} canPublish={can(session.role, 'publish')} />
    </PageShell>
  );
}
