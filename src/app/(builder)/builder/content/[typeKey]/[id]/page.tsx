import { notFound } from 'next/navigation';

/**
 * Màn 4 — form entry. `id === 'moi'` là tạo mới.
 *
 * Vì sao 'moi' chứ không một route `/new` riêng: hai route cho cùng một form nghĩa
 * là hai chỗ nạp `getTypeShape` và hai chỗ phải sửa khi form đổi tham số.
 */

import { getAdminEntry, getEntryActivity, getTypeShape, listWriterOptions } from '@/lib/collections/admin-queries';
import { getSession } from '@/lib/auth/guard';
import { can } from '@/lib/auth/session';
import { allowedEmbedHostnames } from '@/lib/render/embed-origins';
import { listAllLocales } from '@/lib/i18n/queries';
import { detailBaseForType } from '@/lib/render/collection-page';
import { configuredSiteOrigin, siteOrigin } from '@/lib/site/origin';
import { getSiteCrawlSettings } from '@/lib/site/settings';
import { checkTitleTemplate } from '@/lib/site/seo-template';
import { EntryForm } from '@/components/builder/EntryForm';

export const dynamic = 'force-dynamic';

export default async function EntryFormPage({
  params,
}: {
  params: Promise<{ typeKey: string; id: string }>;
}) {
  const { typeKey, id } = await params;
  const shape = await getTypeShape(typeKey);
  if (!shape) notFound();

  const isNew = id === 'moi';
  const entry = isNew ? null : await getAdminEntry(id);
  if (!isNew && !entry) notFound();
  // Entry của loại khác mở qua URL của loại này sẽ render form bằng cấu trúc SAI
  // và lưu đè mất dữ liệu. Chặn ở đây, không phải ở lúc lưu.
  if (entry && entry.typeKey !== typeKey) notFound();

  const locales = await listAllLocales();
  // Ai tạo, ai sửa, lịch sử cập nhật — ô Nhật ký ở cột phải.
  const activity = entry ? await getEntryActivity(entry) : null;
  // Đổi tác giả là thao tác ADMIN (route `entries/[id]/author`): không phải admin thì
  // không nạp danh sách tài khoản, và ô Tác giả chỉ hiện.
  const session = await getSession();
  const writerOptions = session && can(session.role, 'admin') ? await listWriterOptions() : [];
  /*
   * Host được phép cho `<iframe>`, đọc Ở ĐÂY rồi truyền xuống form.
   *
   * Cột xem trước là một component CLIENT, và nó phải làm sạch chuỗi HTML trước khi
   * `dangerouslySetInnerHTML`. Không có danh sách này thì nó phải chọn giữa hai cách
   * sai: gỡ mọi `<iframe>` (bản xem trước không có video mà trang thật thì có — đúng
   * lời hứa mà màn xem trước tồn tại để giữ), hoặc không lọc gì.
   */
  const iframeHosts = await allowedEmbedHostnames();

  // Khung xem trước Google của field `seo` hiện ĐÚNG dòng site sẽ phát: cùng gốc, cùng
  // `title.template`, cùng đường dẫn chi tiết.
  const [origin, configured, crawl, detailBase] = await Promise.all([
    siteOrigin(),
    configuredSiteOrigin(),
    getSiteCrawlSettings(),
    detailBaseForType(typeKey),
  ]);
  const template = crawl.seoTitleTemplate?.trim() ?? '';

  return (
    <EntryForm
      typeKey={typeKey}
      typeName={shape.type.name}
      fields={shape.fields}
      groups={shape.groups}
      taxonomies={shape.taxonomies}
      locales={locales.map((l) => ({
        code: l.code,
        label: l.label,
        isDefault: l.isDefault,
        enabled: l.enabled,
      }))}
      entry={entry}
      iframeHosts={iframeHosts}
      activity={activity}
      writerOptions={writerOptions}
      seoPreview={{
        origin,
        // Cùng host mà `entry-write.ts` dùng để nhận canonical tuyệt đối.
        siteHost: configured ? new URL(configured).host : null,
        titleTemplate: template && !checkTitleTemplate(template) ? template : null,
        detailBase: detailBase ?? null,
        titleField: shape.type.titleField,
      }}
    />
  );
}
