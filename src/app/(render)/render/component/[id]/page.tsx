import { notFound } from 'next/navigation';
import '@/styles/site.css';
// CSS của gói dự án (QUILDER_PROJECT), nối SAU CSS lõi — cùng thứ tự với bó của site công khai.
import '@project/styles.css';

/**
 * Nội dung iframe khi builder đang sửa một COMPONENT.
 *
 * Song song với `/render/[pageId]`, và cố ý giống nó tới từng chi tiết: cùng
 * `data-n` để click-to-select hoạt động, cùng việc KHÔNG mount EffectRuntime
 * (motion làm rect nhảy nên khung chọn lệch khỏi element).
 *
 * ## Vì sao component render bằng `data-n`, không phải `data-cn`
 *
 * Ở đây cây component ĐANG LÀ tài liệu được sửa, không phải nội dung nhúng trong
 * một instance. Nên nó đi qua đúng `NodeRenderer` và đúng `compileDoc` như một
 * trang — và nhờ vậy canvas, cây node, inspector và undo dùng lại nguyên vẹn.
 *
 * `data-cn` chỉ xuất hiện khi component được render BÊN TRONG một instance, nơi
 * `data-n` đã thuộc về node instance của trang.
 */

import { prisma } from '@/lib/db';
import { compileDoc } from '@/lib/render/css';
import { customTokensCss } from '@/lib/render/custom-tokens';
import { draftSiteGlobals } from '@/lib/render/draft-globals';
import { NodeRenderer, type RenderContext } from '@/lib/render/NodeRenderer';
import { collectAssetIds, loadAssets } from '@/lib/render/page';
import { treeToDoc } from '@/lib/doc/apply-to-preset';
import type { PresetTree } from '@/lib/doc/preset';

export const dynamic = 'force-dynamic';

export default async function ComponentRender({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const preset = await prisma.preset.findUnique({
    where: { id },
    select: { tree: true, name: true },
  });
  if (!preset) notFound();

  const doc = treeToDoc(preset.tree as unknown as PresetTree);

  // Component không chứa được instance (chặn ở `applyOpsToPreset`), nên không
  // cần nạp cây component lồng nhau ở đây.
  const assets = await loadAssets(collectAssetIds(doc));
  const { css } = compileDoc(doc);
  const tokenCss = await customTokensCss();

  const ctx: RenderContext = {
    doc,
    scope: { site: await draftSiteGlobals(), page: { title: preset.name, slug: '' } },
    assets,
  };

  return (
    <>
      {tokenCss && (
        <style
          data-mm-tokens=""
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: tokenCss }}
        />
      )}
      <style
        data-mm-doc=""
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: css }}
      />
      {/* Con trỏ phải là mũi tên chọn, không phải cursor tuỳ biến của website —
          nếu không sẽ không biết mình đang chỉ vào đâu. Giống hệt /render/[pageId]. */}
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: '*{cursor:default!important}a,button{cursor:pointer!important}',
        }}
      />
      <NodeRenderer nodeId={doc.rootId} ctx={ctx} />
    </>
  );
}
