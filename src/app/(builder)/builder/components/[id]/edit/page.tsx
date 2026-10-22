import { notFound } from 'next/navigation';
import { presetTreeToDoc } from '@/lib/doc/migrate';

/**
 * Canvas riêng cho một component.
 *
 * ## Vì sao có route này khi đã có chế độ sửa trong editor trang
 *
 * Chế độ trong trang (`/builder/<pageId>?component=<id>`) cố ý là một state chứ
 * không phải một route: người dùng vào đó để sửa MỘT chi tiết rồi quay ra, nên giữ
 * được mức phóng và node đang chọn của trang là phần lớn giá trị.
 *
 * Nhưng nó cần một trang làm chỗ đứng. Component chưa được chèn ở đâu thì không mở
 * ra sửa được, và không có link nào trỏ đúng vào "component này" mà không kèm một
 * trang tuỳ ý. Route này lấp đúng hai chỗ đó.
 *
 * ## Không có canvas thứ hai
 *
 * `ComponentEditorShell` dùng lại `Canvas`, `LayerTree`, `NodeActions`, `Inspector`
 * và cùng một store. Nó không cài lại thứ gì — xem docblock của file đó.
 */

import { ComponentEditorShell } from '@/components/builder/ComponentEditorShell';
import { prisma } from '@/lib/db';
import { listPresets, listTokens } from '@/lib/builder/queries';
import { readEndpointTable } from '@/lib/doc/endpoint-table';
import { loadComponents } from '@/lib/render/components';
import { draftSiteGlobals } from '@/lib/render/draft-globals';

export const dynamic = 'force-dynamic';

export default async function ComponentEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [preset, presets, tokens, globals] = await Promise.all([
    prisma.preset.findUnique({
      where: { id },
      select: { id: true, key: true, name: true, builtin: true, tree: true },
    }),
    listPresets(),
    listTokens(),
    // Bảng endpoint cho ô "Gửi tới" của Form — cùng nguồn với editor trang.
    draftSiteGlobals(),
  ]);
  if (!preset) notFound();

  /*
   * `Preset.tree` là `{ rootId, nodes }` — đúng hình dạng `Doc` trừ `schemaVersion`.
   * Thêm nó vào là cả editor chạy được trên cây component mà không sửa một op nào
   * (xem mục 3.2 của HANDOFF). Đây cũng là thứ `openComponent` trong `EditorShell`
   * làm, và hai chỗ phải giống nhau: lệch đi thì một trong hai đường sẽ nạp một doc
   * mà validator từ chối.
   *
   * `presetTreeToDoc` chứ không `{ ...tree, schemaVersion: 1 }`: cây là dữ liệu sống
   * lâu hơn code, nên nó có thể ở version cũ hơn — dán nhãn thay vì migrate là bỏ
   * qua mọi bước migration, và từ v2 trở đi thì client hiện một hình dạng khác với
   * thứ đường ghi thấy.
   */
  const doc = presetTreeToDoc(preset.tree);

  // Component có thể chứa `Instance`? Không — bị chặn ở đường ghi. Nhưng
  // `Inspector` vẫn nhận `components` để dùng chung một chữ ký với editor trang,
  // nên nạp theo đúng doc thay vì truyền một map rỗng bịa ra.
  const components = await loadComponents(doc);

  return (
    <ComponentEditorShell
      component={{ id: preset.id, key: preset.key, name: preset.name, builtin: preset.builtin }}
      doc={doc}
      tokens={tokens}
      components={components}
      presets={presets}
      endpoints={readEndpointTable(globals)}
    />
  );
}
