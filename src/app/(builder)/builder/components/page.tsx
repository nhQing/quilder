/**
 * Thư viện component.
 *
 * ## Vì sao trang này nói thẳng "khuôn đóng dấu"
 *
 * Chữ "component" gợi ra thứ đồng bộ — sửa một chỗ, cả site đổi theo (Figma,
 * Framer). Ở đây KHÔNG phải vậy: chèn là sao chép cây node với id mới, nên sửa
 * component không đổi trang nào đã chèn nó.
 *
 * Giấu điều đó đi thì người dùng sẽ sửa một component, mở trang, không thấy gì
 * đổi, và kết luận là công cụ hỏng. Nói ra thì họ biết phải làm gì.
 *
 * ## Vì sao đọc thẳng bảng Preset, không qua `listPresetCards`
 *
 * Thẻ ở đây cần thêm cờ builtin, ngày sửa và số phiên bản — ba thứ `PresetCard`
 * không có. Vẫn không đọc cây node: `_count` đếm ở DB, không kéo bảng version lên.
 */

import { prisma } from '@/lib/db';
import { when } from '@/lib/when';
import { PageHeader, PageShell, EmptyState } from '@/components/builder/ui/Page';
import {
  ComponentLibrary,
  NewComponentButton,
  type ComponentCardData,
} from '@/components/builder/ComponentActions';

export const dynamic = 'force-dynamic';

const DAY: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

export default async function ComponentsPage() {
  const presets = await prisma.preset.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: {
      id: true, key: true, name: true, category: true, aiDescription: true,
      builtin: true, updatedAt: true,
      _count: { select: { versions: true } },
    },
  });

  const cards: ComponentCardData[] = presets.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    category: p.category,
    about: p.aiDescription,
    builtin: p.builtin,
    edited: when(p.updatedAt, DAY),
    versions: p._count.versions,
  }));

  return (
    <PageShell>
      <PageHeader
        title="Component"
        count={presets.length}
        description={
          <>
            Chèn component vào trang là <strong className="font-semibold text-shell-ink">sao chép</strong>{' '}
            cây node của nó với id mới. Sửa component ở đây{' '}
            <strong className="font-semibold text-shell-ink">không đổi các trang đã chèn nó</strong> — muốn
            đổi một trang thì sửa thẳng trong trang đó.
          </>
        }
        actions={<NewComponentButton />}
      />

      {/*
        Trạng thái rỗng phải chỉ ra việc LÀM ĐƯỢC TỪ ĐÂY.

        Bản trước bảo người dùng chạy `pnpm exec tsx scripts/extract-presets.ts`. Câu
        đó chỉ đúng trên máy dev: image `runner` là bản standalone của Next — không
        có pnpm, không có tsx, không có thư mục `scripts/`. Trên server đang chạy thì
        đó là một hướng dẫn không thực hiện được, và nó xuất hiện đúng lúc người dùng
        chưa có gì và cần một đường đi.

        Hai đường thật, cả hai đều dùng được trên server: nút ngay phía trên, và tool
        MCP. Script trích chỉ còn được nhắc như một ghi chú cho máy dev.
      */}
      {cards.length ? (
        <ComponentLibrary items={cards} />
      ) : (
        <EmptyState
          icon="cube"
          title="Chưa có component nào"
          description={
            <>
              Bấm <strong className="font-semibold text-shell-ink">Component mới</strong> ở trên để
              tạo một cái trống, hoặc nhờ AI dựng qua MCP bằng tool{' '}
              <code className="font-shell-mono">create_component</code>.
            </>
          }
          action={
            <p className="max-w-[52ch] text-mini text-shell-muted">
              Trên máy dev còn một đường nữa:{' '}
              <code className="font-shell-mono">pnpm exec tsx scripts/extract-presets.ts</code>{' '}
              trích component từ trang thật. Lệnh đó cần mã nguồn nên không chạy được trên
              server.
            </p>
          }
        />
      )}
    </PageShell>
  );
}
