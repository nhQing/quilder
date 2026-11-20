import { notFound } from 'next/navigation';

/**
 * Bảng Văn bản — mọi đoạn chữ của mọi trang, một chỗ.
 *
 * Tên màn tới 27/08/2026 là "Nội dung"; đổi vì nó gần như trùng "Kho nội dung"
 * (`/builder/content`). Lý do đầy đủ ở docblock của `BuilderNav`.
 *
 * ## Vì sao bảng phẳng, không phải cây
 *
 * Cây node đã có ở pane trái của trang sửa. Lặp lại nó ở đây là bắt người viết
 * nội dung học cấu trúc kỹ thuật để làm một việc thuần chữ nghĩa. Cột Vị trí vẫn
 * giữ đường dẫn tổ tiên, nên vẫn định vị được — nhưng để đọc, không để điều hướng.
 *
 * ## Vì sao server component rút sẵn đơn vị
 *
 * Truyền cả doc xuống client sẽ là hàng trăm KB cho một bảng 10KB, và client sẽ
 * phải lặp lại logic rút đơn vị — hai bản của cùng một quy tắc, và chúng sẽ lệch.
 */

import { getDraftPage, listPages } from '@/lib/builder/queries';
import { extractUnits } from '@/lib/builder/text-units';
import { loadComponents } from '@/lib/render/components';
import { listAllLocales, listDraftTranslations } from '@/lib/i18n/queries';
import { ButtonLink } from '@/components/builder/ui/Button';
import { PageHeader, PageShell } from '@/components/builder/ui/Page';
import { TextTable } from '@/components/builder/TextTable';
import { TextPagePicker } from '@/components/builder/TextPagePicker';

export const dynamic = 'force-dynamic';

export default async function TextPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const [pages, locales] = await Promise.all([listPages(), listAllLocales()]);
  if (!pages.length) notFound();

  const { page: requested } = await searchParams;
  // Trang mặc định là trang đầu, không phải "tất cả trang": gom mọi trang vào
  // một bảng nghe hay nhưng làm cột Vị trí mất nghĩa, và mọi lần sửa phải mang
  // thêm pageId. Chọn trang là một cú bấm.
  const current = pages.find((p) => p.id === requested) ?? pages[0]!;

  const draft = await getDraftPage(current.id);
  if (!draft) notFound();

  // Chữ nằm TRONG instance chỉ thấy được khi có cây component. Thiếu nó thì bảng
  // im lặng bỏ sót mọi chữ của mọi instance — và đó đúng là loại thiếu sót không
  // ai phát hiện, vì bảng vẫn đầy.
  const components = await loadComponents(draft.doc);
  const units = extractUnits(draft.doc, components);
  const translations = await listDraftTranslations(current.id);

  /*
   * Node của RIÊNG những đơn vị ghi vào object lồng.
   *
   * `href` và `a11yLabel` đi qua `setProps`, và `setProps` THAY cả object chứ không
   * merge (`applyOne` làm `target[key] = value`). Không có node cũ trong tay, op sẽ
   * gửi `{ action: { kind, href } }` và `{ a11y: { label } }` — xoá sạch
   * `action.target`, `action.rel`, `a11y.role`, `a11y.labelledBy`. Cả hai đều hợp
   * lệ về hình dạng nên không tầng nào chặn, và người sửa một dòng chữ không có
   * cách nào biết mình vừa gỡ `rel="noopener"` của một nút.
   *
   * LỌC chứ không gửi cả `draft.doc.nodes`: docblock ở đầu file nói vì sao bảng này
   * không nhận cả doc, và lý do đó vẫn đứng. Hai trường trên là toàn bộ nhu cầu,
   * nên map này thường chỉ có mấy cái nút.
   *
   * Đơn vị trong instance KHÔNG vào đây: địa chỉ của nó là `instanceId/localId`,
   * không phải khoá của `doc.nodes`, nên phép tra tự bỏ qua — và đó là đúng, chúng
   * ghi bằng `setOverride` chứ không phải `setProps`.
   */
  const nestedNodes = Object.fromEntries(
    units
      .filter((u) => u.field === 'href' || u.field === 'a11yLabel')
      .flatMap((u) => {
        const node = draft.doc.nodes[u.nodeId];
        return node ? [[u.nodeId, node] as const] : [];
      }),
  );

  // Ngôn ngữ dịch được = mọi ngôn ngữ trừ ngôn ngữ gốc. Gốc sống trong doc và
  // sửa bằng op; cho nó một cột dịch sẽ tạo hai nguồn sự thật cho cùng chuỗi.
  const targets = locales.filter((l) => !l.isDefault);
  const source = locales.find((l) => l.isDefault);

  return (
    <PageShell width="wide">
      <PageHeader
        title="Văn bản"
        description="Câu chữ nằm trong từng trang, kèm cột bản dịch. Bấm vào ô để sửa."
        actions={
          /* "Mở trang sửa" phụ thuộc TRANG ĐANG CHỌN, nên nó không lên được thanh
             menu toàn cục — thanh đó chỉ có đường đi, không có tham số. */
          <ButtonLink href={`/builder/${current.id}`} iconRight="arrow-right">
            Mở trang sửa
          </ButtonLink>
        }
      />

      {/*
        Ô chọn chứ không phải dãy nút (19/11/2026): mười mấy trang thành ba hàng nút đẩy bảng
        xuống dưới màn đầu. Mỗi trang vẫn là một URL (`?page=`) — xem `TextPagePicker`.
      */}
      {pages.length > 1 && (
        <TextPagePicker pages={pages.map((p) => ({ id: p.id, title: p.title, slug: p.slug }))} current={current.id} />
      )}

      <TextTable
        pageId={current.id}
        units={units}
        nodes={nestedNodes}
        targets={targets}
        sourceLabel={source?.label ?? 'Bản gốc'}
        translations={translations}
      />
    </PageShell>
  );
}
